/**
 * 微信 access_token 获取方式 + 「凭据失效」自愈 回归测试（无需数据库 / 无需网络）
 *
 * 背景（线上事故）：
 *   管理后台「日志 → 订阅消息」里出现 `invalid credential, access_token is invalid or not latest`，
 *   同一批消息有的成功有的失败。根因有两层：
 *     1) server/utils/wechatToken.js 走的是 cgi-bin/token —— 该接口**每调用一次就作废上一次签发的
 *        token**。本服务是 pm2 cluster 多实例，各实例各有一份进程内缓存，A 刷新后 B 手里的 token
 *        立刻失效，B 发消息就被拒。
 *     2) 40001/42001 不在 subscribeService 的 RETRYABLE_WECHAT_CODES 里，也没有「换新 token 重发」
 *        的动作，于是这条消息直接记 failed 永久失败。
 *
 * 覆盖：
 *   A. 常规获取走 cgi-bin/stable_token，body 为 POST JSON 且 force_refresh=false（不再用会被并发作废的 cgi-bin/token）
 *   B. 有效期内复用进程内缓存（不打微信接口）
 *   C. forceRefresh=true → 请求体 force_refresh=true，并拿到新 token
 *   D. 并发调用只打一次微信接口（refreshPromise 去重）
 *   E. 错误码映射：40125 AppSecret 无效 → 带 wechatCode/status=503/expose；空响应也抛错
 *   F. 40001 首次失败 → 自动换新 token 重发并成功，日志只记一条 sent、不记 failed
 *   G. 40001 连续失败到底 → 记 failed(errcode_40001)，且总共只尝试 3 次
 *   H. 43101 用户拒收仍然「只调一次、不重试」（防止新增可重试码把 43101 也带进来）
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')

const SERVER = path.join(__dirname, '..')
const TOKEN_UTIL = path.join(SERVER, 'utils', 'wechatToken.js')
const SERVICE = path.join(SERVER, 'services', 'subscribeService.js')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}
async function checkAsync(fn, message) {
  await fn()
  testCount++
  console.log('PASS:', message)
}

setTimeout(() => {
  fs.writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 15000)

function injectModule(resolvedPath, exportsObj) {
  const m = new Module(resolvedPath, null)
  m.filename = resolvedPath
  m.loaded = true
  m.exports = exportsObj
  require.cache[resolvedPath] = m
}

function freshRequire(filePath) {
  const resolved = require.resolve(filePath)
  delete require.cache[resolved]
  return require(resolved)
}

// 模板 ID 由环境变量注入；测试自给自足，不依赖本机 .env
function injectTemplateEnv() {
  const src = fs.readFileSync(SERVICE, 'utf8')
  const cfg = src.match(/const TPL_CONFIG = \{([\s\S]*?)\n\}/)[1]
  cfg.split('\n').forEach((line) => {
    const m = line.match(/envKey: '([^']+)'/)
    if (m) process.env[m[1]] = 'TPL_' + m[1]
  })
}

// ===== 加载真实的 wechatToken.js，只顶掉 axios 与 config/wechat =====
function loadTokenUtil(axiosStub) {
  injectModule(require.resolve('axios'), axiosStub)
  injectModule(require.resolve(path.join(SERVER, 'config', 'wechat.js')), {
    appId: 'wx-test-appid',
    appSecret: 'test-appsecret'
  })
  return freshRequire(TOKEN_UTIL)
}

// ===== 加载真实的 subscribeService.js，顶掉 pool / axios / wechatToken / notificationService =====
function loadService(state) {
  injectModule(require.resolve(path.join(SERVER, 'config', 'pool.js')), {
    query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim()
      if (/^SELECT tpl_type, remain, total_granted, total_sent FROM user_subscribe_quota WHERE user_id = \? AND tpl_type = \?/.test(s)) {
        return Promise.resolve([[{ tpl_type: (params || [])[1], remain: state.remain, total_granted: 1, total_sent: 0 }]])
      }
      if (/^SELECT id FROM subscribe_message_log/.test(s)) return Promise.resolve([[]])
      if (/^SELECT openid FROM sys_user/.test(s)) return Promise.resolve([[{ openid: 'openid-A' }]])
      if (/^INSERT INTO subscribe_message_log/.test(s)) {
        state.logs.push(params || [])
        return Promise.resolve([{ insertId: state.logs.length }])
      }
      if (/^UPDATE user_subscribe_quota/.test(s)) return Promise.resolve([{ affectedRows: 1 }])
      return Promise.resolve([[]])
    }
  })

  injectModule(require.resolve('axios'), {
    post(url) {
      state.wechat.push({ url })
      const step = state.plan[Math.min(state.wechat.length - 1, state.plan.length - 1)]
      return Promise.resolve({ data: step })
    }
  })

  injectModule(require.resolve(TOKEN_UTIL), {
    getAccessToken(options) {
      state.tokenCalls.push(options || {})
      return Promise.resolve(state.tokenCalls.length === 1 ? 'stale-token' : 'fresh-token')
    },
    invalidateAccessToken() {}
  })

  injectModule(require.resolve(path.join(SERVER, 'services', 'notificationService.js')), {
    createNotification: () => Promise.resolve({ id: 1 })
  })

  return freshRequire(SERVICE)
}

function newState(overrides) {
  return Object.assign({
    remain: 1,
    plan: [{ errcode: 0, errmsg: 'ok' }],
    wechat: [],
    logs: [],
    tokenCalls: []
  }, overrides || {})
}

async function run() {
  injectTemplateEnv()

  // ---------- A / B / C / D / E：wechatToken.js 本身 ----------
  const tokenCalls = []
  const tokenStub = {
    post(url, body, opts) {
      tokenCalls.push({ url, body, opts })
      return Promise.resolve({ data: { access_token: 'tok-' + tokenCalls.length, expires_in: 7200 } })
    }
  }
  let util = loadTokenUtil(tokenStub)

  await checkAsync(async () => {
    const token = await util.getAccessToken()
    assert.strictEqual(token, 'tok-1')
    const call = tokenCalls[0]
    assert.strictEqual(call.url, 'https://api.weixin.qq.com/cgi-bin/stable_token', '必须走稳定版接口')
    assert.ok(!/cgi-bin\/token\?/.test(call.url), '不能再用每次调用都会作废上一个的 cgi-bin/token')
    assert.strictEqual(call.body.grant_type, 'client_credential')
    assert.strictEqual(call.body.appid, 'wx-test-appid')
    assert.strictEqual(call.body.secret, 'test-appsecret')
    assert.strictEqual(call.body.force_refresh, false, '常规路径绝不能传 force_refresh=true（会作废其它实例的 token）')
  }, 'A. 常规获取走 stable_token + force_refresh=false')

  await checkAsync(async () => {
    const before = tokenCalls.length
    await util.getAccessToken()
    await util.getAccessToken()
    assert.strictEqual(tokenCalls.length, before, '有效期内必须复用缓存，不再打微信接口')
  }, 'B. 有效期内复用进程内缓存')

  await checkAsync(async () => {
    const token = await util.getAccessToken({ forceRefresh: true })
    assert.strictEqual(token, 'tok-2', 'forceRefresh 必须真的换一个新 token')
    assert.strictEqual(tokenCalls[1].body.force_refresh, true, 'forceRefresh 必须透传 force_refresh=true')
  }, 'C. forceRefresh=true 透传到请求体并换新 token')

  // 并发去重（用全新的实例，避免命中上面的缓存）
  const concurrentCalls = []
  util = loadTokenUtil({
    post(url, body) {
      concurrentCalls.push({ url, body })
      return Promise.resolve({ data: { access_token: 'tok-c', expires_in: 7200 } })
    }
  })
  await checkAsync(async () => {
    const tokens = await Promise.all([util.getAccessToken(), util.getAccessToken(), util.getAccessToken()])
    assert.strictEqual(concurrentCalls.length, 1, '并发调用必须复用同一个 refreshPromise')
    assert.deepStrictEqual(tokens, ['tok-c', 'tok-c', 'tok-c'])
  }, 'D. 并发调用只打一次微信接口')

  util = loadTokenUtil({ post: () => Promise.resolve({ data: { errcode: 40125, errmsg: 'invalid appsecret' } }) })
  await checkAsync(async () => {
    let error = null
    try { await util.getAccessToken() } catch (e) { error = e }
    assert.ok(error, 'AppSecret 无效必须抛错，不能静默返回空 token')
    assert.strictEqual(error.wechatCode, 40125)
    assert.strictEqual(error.status, 503)
    assert.strictEqual(error.expose, true)
    assert.ok(/AppSecret/.test(error.message), '错误文案要能直接指出该改哪个环境变量')
  }, 'E. 40125 映射为可暴露的 503 错误')

  util = loadTokenUtil({ post: () => Promise.resolve({ data: undefined }) })
  await checkAsync(async () => {
    let error = null
    try { await util.getAccessToken() } catch (e) { error = e }
    assert.ok(error, '空响应必须抛错（否则会把 undefined 当成 token 拼进 URL）')
    assert.strictEqual(error.status, 503)
  }, 'E2. 微信返回空响应时抛错而不是把 undefined 当 token')

  // ---------- F / G / H：subscribeService 的凭据自愈 ----------
  const data = { thing20: { value: '帖子标题' }, time9: { value: '2026-09-16 10:00' } }

  const stF = newState({
    plan: [
      { errcode: 40001, errmsg: 'invalid credential, access_token is invalid or not latest' },
      { errcode: 0, errmsg: 'ok' }
    ]
  })
  let svc = loadService(stF)
  await checkAsync(async () => {
    const res = await svc.push(7, 'commentReply', data)
    assert.strictEqual(res.sent, true, '凭据失效必须自愈成功，不能记 failed')
    assert.strictEqual(stF.wechat.length, 2, '第一次 40001 → 换新 token 重发一次')
    assert.ok(/stale-token/.test(stF.wechat[0].url), '第一次用的是缓存里的旧 token')
    assert.ok(/fresh-token/.test(stF.wechat[1].url), '重试必须换上新 token')
    assert.strictEqual(stF.tokenCalls.length, 2)
    assert.deepStrictEqual(stF.tokenCalls[1], { forceRefresh: true }, '重试前必须强制刷新 token')
    const statuses = stF.logs.map((p) => p[5])
    assert.deepStrictEqual(statuses, ['sent'], '只记一条 sent，不应出现 failed')
  }, 'F. 40001 → 强制换 token 重发成功，日志只记 sent')

  const stG = newState({ plan: [{ errcode: 40001, errmsg: 'invalid credential' }] })
  svc = loadService(stG)
  await checkAsync(async () => {
    const res = await svc.push(7, 'commentReply', data)
    assert.strictEqual(res.sent, false)
    assert.strictEqual(res.reason, 'errcode_40001')
    assert.strictEqual(stG.wechat.length, 3, '重试到底共 3 次（首次 + 2 次退避重试）后放弃')
    assert.strictEqual(stG.logs.length, 1)
    assert.strictEqual(stG.logs[0][5], 'failed')
    assert.strictEqual(Number(stG.logs[0][6]), 40001)
  }, 'G. 40001 持续失败 → 记 failed(errcode_40001) 并停止重试')

  const stH = newState({ plan: [{ errcode: 43101, errmsg: 'user refuse to accept the msg' }] })
  svc = loadService(stH)
  await checkAsync(async () => {
    const res = await svc.push(7, 'commentReply', data)
    assert.strictEqual(res.reason, 'errcode_43101')
    assert.strictEqual(stH.wechat.length, 1, '43101 额度已清零，绝不能重试')
    assert.strictEqual(stH.tokenCalls.length, 1, '43101 不是凭据问题，不该白刷一次 token')
  }, 'H. 43101 用户拒收仍然只调一次（未被新增的可重试码带进来）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
