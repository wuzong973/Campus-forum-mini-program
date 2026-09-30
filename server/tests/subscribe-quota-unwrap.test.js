/**
 * 订阅额度解包回归测试（无需数据库 / 无需真机）
 *
 * 背景（2026-09-15 修复）：
 *   服务端 `GET /api/v1/subscribe/quota` 的契约是 `{ code, message, data: { quota: {...} } }`，
 *   而客户端 `request.get` 已经解出最外层（resolve(response.data)），
 *   因此 `fetchQuota()` 拿到的是 **`{ quota: { commentNew: 2, ... } }`**，必须再解一层。
 *
 *   早期 `fetchQuota` 少解了这层，导致 `shouldShowDialogAsync` 里 `quota['commentNew']`
 *   恒为 `undefined` → `Number(undefined || 0)` 恒为 0 → 恒判定「需要引导」
 *   → **授权成功后入口永不消失、开关每次刷新都回弹为灰色**（用户误以为授权失败，反复点击堆积额度）。
 *
 * 覆盖：
 *   A. fetchQuota 解出「模板类型 → 剩余额度」的扁平表，而不是 { quota: {...} }
 *   B. 本地已授权 + 额度充足 → entryVisibleAsync 为 false（入口隐藏，即订阅真正生效）
 *   C. 本地已授权 + 额度为 0 → entryVisibleAsync 为 true（入口重现，提示重新订阅）
 *   D. 响应结构异常（不含任何已知模板键）→ 退化为本地判定，而不是恒 true
 *   E. 请求失败（null）→ 退化为本地判定
 *   F. 源码护栏：fetchQuota 必须解包 quota 字段
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')
const fs = require('fs')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PREFS_KEY = 'subscribe_comment_prefs'

let testCount = 0
async function checkAsync(fn, message) {
  await fn()
  testCount++
  console.log('PASS:', message)
}
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

setTimeout(() => {
  fs.writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

// 加载真实 utils/subscribe.js：只替换 wx 与 utils/request
function loadRealSubscribe({ quotaResponse, storage = {} } = {}) {
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
  const store = Object.assign({}, storage)
  const warns = []
  const sandbox = {
    wx: {
      getStorageSync: (k) => store[k],
      setStorageSync: (k, v) => { store[k] = v },
      removeStorageSync: (k) => { delete store[k] },
      showToast: () => {},
      showModal: () => {},
      openSetting: () => {},
      getSetting: (opt) => { opt && opt.success && opt.success({ subscriptionsSetting: { mainSwitch: true, itemSettings: {} } }) },
      requestSubscribeMessage: (opt) => { opt && opt.success && opt.success({}) }
    },
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/utils\/request$|^\.\/request$/.test(norm)) {
        return {
          get: () => Promise.resolve(quotaResponse),
          post: () => Promise.resolve(null)
        }
      }
      throw new Error('subscribe.js 出现未预期依赖：' + modulePath)
    },
    console: {
      log: () => {},
      warn: (...args) => warns.push(args.join(' ')),
      error: () => {}
    },
    Promise,
    setTimeout,
    module: { exports: {} },
    exports: {}
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(source, sandbox, { filename: 'utils/subscribe.js' })
  const mod = sandbox.module.exports
  assert.ok(mod && typeof mod.entryVisibleAsync === 'function', '真实 subscribe.js 未正确导出')
  return { mod, store, warns }
}

// 本地「已授权」的存储：偏好全开 + granted 全 true → shouldShowDialog 应返回 false
const AUTHORIZED_PREFS = {
  [PREFS_KEY]: {
    commentNew: true,
    commentReply: true,
    grantedCommentNew: true,
    grantedCommentReply: true
  }
}

async function run() {
  // A. fetchQuota 解出扁平表
  await checkAsync(async () => {
    const { mod } = loadRealSubscribe({ quotaResponse: { quota: { commentNew: 2, commentReply: 2 } } })
    const quota = await mod.fetchQuota()
    assert.strictEqual(quota.commentNew, 2, '必须解出 commentNew（而不是返回 { quota: {...} } 外层）')
    assert.strictEqual(quota.commentReply, 2)
    assert.strictEqual(quota.quota, undefined, '不得残留 quota 外层包装')
  }, 'A. fetchQuota 解出扁平额度表（剥掉服务端 quota 外层）')

  // B. 本地已授权 + 额度充足 → 入口隐藏
  await checkAsync(async () => {
    const { mod } = loadRealSubscribe({
      quotaResponse: { quota: { commentNew: 2, commentReply: 2 } },
      storage: AUTHORIZED_PREFS
    })
    assert.strictEqual(mod.shouldShowDialog('postPublish'), false, '前置：本地判定应为「无需引导」')
    const need = await mod.entryVisibleAsync('postPublish')
    assert.strictEqual(need, false, '额度充足时入口必须隐藏（这正是授权成功后应有的表现）')
  }, 'B. 本地已授权 + 额度充足 → 入口隐藏')

  // C. 本地已授权 + 额度为 0 → 入口重现
  await checkAsync(async () => {
    const { mod } = loadRealSubscribe({
      quotaResponse: { quota: { commentNew: 0, commentReply: 2 } },
      storage: AUTHORIZED_PREFS
    })
    const need = await mod.entryVisibleAsync('postPublish')
    assert.strictEqual(need, true, '任一模板额度为 0 时入口必须重现，给用户重新订阅的机会')
  }, 'C. 本地已授权但额度耗尽 → 入口重现')

  // D. 响应结构异常 → 退化为本地判定（关键：不能恒 true）
  await checkAsync(async () => {
    const { mod, warns } = loadRealSubscribe({
      quotaResponse: { unexpected: true },
      storage: AUTHORIZED_PREFS
    })
    const need = await mod.entryVisibleAsync('postPublish')
    assert.strictEqual(need, false, '结构异常时必须退化为本地判定（本地已授权 → 隐藏），而不是恒 true')
    assert.ok(warns.some((w) => w.indexOf('额度响应结构异常') > -1), '结构异常必须留 warn 便于定位')
  }, 'D. 额度响应结构异常 → 退化为本地判定并告警')

  // E. 请求失败（null）→ 退化为本地判定
  await checkAsync(async () => {
    const { mod } = loadRealSubscribe({ quotaResponse: null, storage: AUTHORIZED_PREFS })
    const need = await mod.entryVisibleAsync('postPublish')
    assert.strictEqual(need, false, '请求失败时应退化为本地判定，不能因为取不到额度就把入口永久显示')
  }, 'E. 额度请求失败 → 退化为本地判定')

  // F. 源码护栏
  check(() => {
    const src = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(
      /typeof res\.quota === 'object'/.test(src),
      'fetchQuota 必须显式解包服务端的 quota 字段（曾因漏解导致入口永不隐藏）'
    )
    assert.ok(
      src.indexOf("额度响应结构异常") > -1,
      'shouldShowDialogAsync 必须有结构校验兜底（防止再次静默退化为「恒为 0」）'
    )
  }, 'F. 源码护栏：fetchQuota 解包 + 结构校验兜底在位')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
