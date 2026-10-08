/**
 * 订阅消息「偏好 ↔ 授权 ↔ 模板 ↔ 推送」四路绑定对账测试（无需数据库 / 无需真机）
 *
 * 背景：用户授权（granted）、偏好开关（prefs）、微信模板 ID、服务端发送点，
 * 这四者必须一一对应。任何一处错位都会表现为「订阅了却收不到通知」或「授权了入口不消失」，
 * 而且大多是静默失败（catch 吞掉 / 日志表里才看得到），所以这里做结构化对账而不是靠人眼。
 *
 * 覆盖：
 *   A. 模板 ID 三方一致：前端 TEMPLATE_IDS ↔ 服务端 TPL_TYPES/TPL_CONFIG ↔ .env(.example)
 *   B. 触发组 ↔ 偏好存储 ↔ 授权键：每个 keys[i] 的 grantedKey 必须是统一推导结果，prefsKey 必须正确分键
 *   C. 设置页授权闭环：在设置页开渠道并授权后，授权结果必须落到该触发点自己的存储，
 *      且 entryVisible 必须随之变为 false（这是曾经的 bug：设置页授权了、业务页入口不消失）
 *   D. 服务端发送点齐备：每个已注册模板都必须能从某个 controller/service 到达（备用白名单除外）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')
const fs = require('fs')

const ROOT = path.join(__dirname, '..', '..')
const SERVER = path.join(ROOT, 'server')

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
}, 10000)

function plain(v) { return JSON.parse(JSON.stringify(v)) }
function flush() { return new Promise((r) => setImmediate(r)) }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

// 评论两键的偏好落在独立存储（发布页共用键），其余渠道落在 notify_channel_prefs
const COMMENT_PREFS_KEY = 'subscribe_comment_prefs'
const CHANNEL_PREFS_KEY = 'notify_channel_prefs'
const COMMENT_KEYS = ['commentNew', 'commentReply']

function buildWxStub(state) {
  return {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showModal: (opt) => { state.modals.push(opt && opt.title) },
    openSetting: () => {},
    showToast: () => {},
    getSetting: (opt) => { opt && opt.success && opt.success({ subscriptionsSetting: { mainSwitch: true, itemSettings: {} } }) },
    // 模拟「用户全部允许」
    requestSubscribeMessage: (opt) => {
      state.tmplIdCalls.push((opt.tmplIds || []).slice())
      const res = {}
      ;(opt.tmplIds || []).forEach((id) => { res[id] = 'accept' })
      opt && opt.success && opt.success(res)
    }
  }
}

function loadRealSubscribe(wxStub, state) {
  const source = fs.readFileSync(path.join(ROOT, 'utils', 'subscribe.js'), 'utf8')
  const sandbox = {
    wx: wxStub,
    require: (p) => {
      const norm = String(p).split('\\').join('/')
      if (/utils\/request$|^\.\/request$/.test(norm)) return { post: () => Promise.resolve(null), get: () => Promise.resolve(null) }
      throw new Error('subscribe.js 未预期依赖：' + p)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(source, sandbox, { filename: 'utils/subscribe.js' })
  state.templateIds = sandbox.module.exports.TEMPLATE_IDS
  return sandbox.module.exports
}

// 加载设置页，subscribe 依赖换成真实模块（否则测不到 granted 落库路径）
function loadSettingsPage(wxStub, realSubscribe, state) {
  const source = fs.readFileSync(path.join(ROOT, 'pkg-user', 'pages', 'settings', 'index.js'), 'utf8')
  const hotRankStub = { isDailyHotVisible: () => true, setDailyHotVisible: () => {} }
  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: null } }),
    wx: wxStub,
    require: (p) => {
      const norm = String(p).split('\\').join('/')
      if (/utils\/hot-rank$/.test(norm)) return hotRankStub
      // 「卡片动效」开关与订阅无关，桩里返回默认开启
      if (/utils\/motion$/.test(norm)) return {
        isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false
      }
      if (/utils\/subscribe$/.test(norm)) return realSubscribe
      // 设置页 GET/PUT /user/info 水合「隐藏主页帖子」，本测试不断言，返回 null 让其短路
      if (/utils\/request$/.test(norm)) return {
        get: () => Promise.resolve(null), put: () => Promise.resolve({})
      }
      throw new Error('设置页未预期依赖：' + p)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'pkg-user/pages/settings/index.js' })
  assert.ok(pageConfig, 'Page() 未被调用')
  const inst = Object.assign({}, pageConfig, { data: plain(pageConfig.data) })
  inst.setData = function (patch, cb) {
    const apply = (target, keyPath, value) => {
      const keys = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.')
      let node = target
      for (let i = 0; i < keys.length - 1; i++) {
        if (node[keys[i]] === undefined) node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}
        node = node[keys[i]]
      }
      node[keys[keys.length - 1]] = value
    }
    Object.keys(patch).forEach((k) => apply(inst.data, k, patch[k]))
    if (typeof cb === 'function') cb()
  }
  return inst
}

function readEnvFile(file) {
  const map = {}
  if (!fs.existsSync(file)) return map
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) map[m[1]] = m[2].trim()
  })
  return map
}

async function run() {
  const state = { storage: {}, tmplIdCalls: [], modals: [], templateIds: {} }
  const wxStub = buildWxStub(state)
  const sub = loadRealSubscribe(wxStub, state)
  const FE_IDS = sub.TEMPLATE_IDS

  // ===== A. 模板 ID 三方一致 =====
  check(() => {
    const svcSrc = fs.readFileSync(path.join(SERVER, 'services', 'subscribeService.js'), 'utf8')
    const typesBlock = svcSrc.match(/const TPL_TYPES = \[([\s\S]*?)\]/)[1]
    const beTypes = (typesBlock.match(/'([A-Za-z]+)'/g) || []).map((s) => s.replace(/'/g, ''))
    const cfgBlock = svcSrc.match(/const TPL_CONFIG = \{([\s\S]*?)\n\}/)[1]
    const beEnv = {}
    cfgBlock.split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Za-z]+): \{ envKey: '([^']+)'/)
      if (m) beEnv[m[1]] = m[2]
    })
    const feKeys = Object.keys(FE_IDS).sort()
    const beKeys = beTypes.slice().sort()
    assert.deepStrictEqual(feKeys, beKeys, '前端 TEMPLATE_IDS 与服务端 TPL_TYPES 必须完全一致（多一个少一个都会导致授权/发送错位）')
    feKeys.forEach((k) => assert.ok(beEnv[k], '服务端 TPL_CONFIG 必须为 ' + k + ' 声明 envKey'))

    // .env.example 必须声明全部 envKey（值可留空），否则新环境部署后所有推送静默降级为「只写站内信」
    const example = readEnvFile(path.join(SERVER, '.env.example'))
    const missingInExample = feKeys.filter((k) => !(beEnv[k] in example))
    assert.deepStrictEqual(missingInExample, [], '.env.example 必须声明全部模板 envKey，缺失：' + missingInExample.join(','))

    // 本地 .env 若存在，值与前端 ID 必须逐一相同（存在即校验）
    const env = readEnvFile(path.join(SERVER, '.env'))
    if (Object.keys(env).length) {
      const mismatched = feKeys.filter((k) => env[beEnv[k]] && env[beEnv[k]] !== FE_IDS[k])
      assert.deepStrictEqual(mismatched, [], 'server/.env 的模板 ID 必须与前端硬编码 ID 完全相同，不一致：' + mismatched.join(','))
    }
  }, 'A. 模板 ID 三方一致（前端 / 服务端配置 / .env.example，本地 .env 存在则逐值校验）')

  // ===== B. 触发组 ↔ 偏好存储 ↔ 授权键 =====
  check(() => {
    const groups = sub.TRIGGER_GROUPS
    Object.keys(groups).forEach((trigger) => {
      const rule = groups[trigger]
      assert.strictEqual(rule.keys.length, rule.grantedKeys.length, trigger + '：keys 与 grantedKeys 长度必须一一对应')
      rule.keys.forEach((key, index) => {
        // 授权键必须能用统一规则推导出来；否则设置页/业务页两边会各写一个键
        assert.strictEqual(rule.grantedKeys[index], 'granted' + cap(key), trigger + '：' + key + ' 的授权键必须是 granted' + cap(key) + '（实际 ' + rule.grantedKeys[index] + '）')
      })
      // 偏好存储分键：评论两键走发布页共用键，其余走渠道键
      const expected = rule.keys.every((k) => COMMENT_KEYS.indexOf(k) > -1) ? COMMENT_PREFS_KEY : CHANNEL_PREFS_KEY
      assert.strictEqual(rule.prefsKey, expected, trigger + '：偏好存储分键错误，应为 ' + expected)
    })
  }, 'B. 触发组的授权键可用统一规则推导、偏好存储分键正确')

  // ===== C. 设置页授权闭环（真实模块）=====
  const settingsCases = [
    { channelKey: 'comment', label: '评论通知', prefsKey: COMMENT_PREFS_KEY, keys: ['commentNew', 'commentReply'], trigger: 'postPublish' },
    { channelKey: 'withdraw', label: '提现结果通知', prefsKey: CHANNEL_PREFS_KEY, keys: ['withdrawSuccess', 'withdrawResult'], trigger: 'withdraw' },
    { channelKey: 'message', label: '私信通知', prefsKey: CHANNEL_PREFS_KEY, keys: ['message'], trigger: 'message' },
    { channelKey: 'errand', label: '代拿/跑腿通知', prefsKey: CHANNEL_PREFS_KEY, keys: ['errandAccepted', 'errandFinished', 'errandCancelled'], trigger: 'errandPublish' },
    { channelKey: 'activitySub', label: '活动订阅', prefsKey: CHANNEL_PREFS_KEY, keys: ['activityNew', 'activityJoined', 'activitySignupNotice'], trigger: 'activityIndex' },
    { channelKey: 'activityAudit', label: '活动审核通知', prefsKey: CHANNEL_PREFS_KEY, keys: ['activityAudit'], trigger: 'activityPublish' },
    { channelKey: 'activity', label: '活动结果通知', prefsKey: CHANNEL_PREFS_KEY, keys: ['activitySignupResult', 'activityStart', 'activitySignup'], trigger: 'activitySignup' },
    { channelKey: 'audit', label: '审核结果通知', prefsKey: CHANNEL_PREFS_KEY, keys: ['auditCert', 'audit', 'auditPass'], trigger: 'riderVerify' }
  ]

  for (const c of settingsCases) {
    await checkAsync(async () => {
      state.storage = {}
      state.tmplIdCalls = []
      const inst = loadSettingsPage(wxStub, sub, state)
      inst.onLoad()
      // 从设置页开启该渠道主开关（会同步发起订阅授权）
      inst.onChannelMainChange({ currentTarget: { dataset: { key: c.channelKey } }, detail: { value: true } })
      await flush()
      await flush()

      const prefs = state.storage[c.prefsKey] || {}
      c.keys.forEach((k) => {
        assert.strictEqual(prefs[k], true, c.label + '：偏好键 ' + k + ' 必须写入 ' + c.prefsKey)
        assert.strictEqual(prefs['granted' + cap(k)], true, c.label + '：授权键 granted' + cap(k) + ' 必须写入 ' + c.prefsKey)
      })
      // 关键：设置页授权后，对应业务页顶部入口必须消失
      assert.strictEqual(sub.entryVisible(c.trigger), false, c.label + '：设置页完成授权后，' + c.trigger + ' 入口必须隐藏')

      // 反向：关闭该渠道 → 入口重新出现
      inst.onChannelMainChange({ currentTarget: { dataset: { key: c.channelKey } }, detail: { value: false } })
      assert.strictEqual(sub.entryVisible(c.trigger), true, c.label + '：设置页关闭后，' + c.trigger + ' 入口必须重新显示')
    }, 'C. ' + c.label + '：设置页开渠道→授权键落对存储→业务页入口隐藏；关闭后恢复')
  }

  // ===== D. 服务端发送点齐备 =====
  check(() => {
    // 声明为「备用」的模板暂无业务触点（见 subscribeService.js 注释）
    // audit 已于 2026-09-14 接入「跑腿订单异议裁决」，不再属于备用
    const STANDBY = ['userPmNotice', 'reportResult']
    const svcSrc = fs.readFileSync(path.join(SERVER, 'services', 'subscribeService.js'), 'utf8')

    // ① 从源码解析「模板类型 → 便捷函数名」（函数体内 push(userId, '<type>'）。
    //    不能假设函数名等于 push+类型名：commentNew 的封装叫 pushComment、audit 的叫 pushAuditResult。
    const wrapperOf = {}
    svcSrc.split(/(?=\nfunction push)/).forEach((chunk) => {
      const fn = (chunk.match(/^\s*function (push[A-Za-z]+)\s*\(/m) || [])[1]
      if (!fn) return
      const hit = chunk.match(/push\(userId,\s*'([A-Za-z]+)'/)
      if (hit) wrapperOf[hit[1]] = fn
    })
    assert.ok(Object.keys(wrapperOf).length >= 15, '至少应解析出 15 个推送封装（实际 ' + Object.keys(wrapperOf).length + '），说明解析逻辑失效')
    // 每个非备用模板都必须有专属封装，否则推送时无从下手
    const noWrapper = Object.keys(FE_IDS).filter((t) => STANDBY.indexOf(t) < 0 && !wrapperOf[t])
    assert.deepStrictEqual(noWrapper, [], '以下模板缺少专属 push 封装函数：' + noWrapper.join(','))

    // ② 业务侧（controllers/services，排除 subscribeService 自身与 tests）必须真的调用它
    const files = []
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'uploads') return
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js') && entry.name !== 'subscribeService.js') files.push(full)
      })
    }
    walk(path.join(SERVER, 'controllers'))
    walk(path.join(SERVER, 'services'))
    walk(path.join(SERVER, 'utils'))
    const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

    const unreachable = Object.keys(FE_IDS)
      .filter((type) => STANDBY.indexOf(type) < 0)
      .filter((type) => {
        const wrapper = wrapperOf[type] || ''
        // 直接调用封装函数（含 `subscribeService.pushXxx` 与 `let pushFn = subscribeService.pushXxx` 两种写法）
        const direct = wrapper ? new RegExp(wrapper + '(?![A-Za-z])').test(text) : false
        // 或被公告广播覆盖：pushBroadcast('activityNew', ...)
        const broadcast = new RegExp("pushBroadcast\\(\\s*'" + type + "'").test(text)
        return !direct && !broadcast
      })
    assert.deepStrictEqual(unreachable, [], '以下模板既没有业务侧调用点也没有被广播覆盖（用户授权了却永远不会收到）：' + unreachable.join(','))
  }, 'D. 每个已注册模板都有服务端发送点（备用白名单除外）')
  // ===== E. 授权键改名的向后兼容 =====
  check(() => {
    // 老用户本地可能残留旧键 grantedNewComment（历史命名），读取时必须仍然认它，
    // 否则改名的瞬间所有已授权用户都会被要求重新授权一次。
    state.storage = {}
    state.storage[COMMENT_PREFS_KEY] = { commentNew: true, commentReply: true, grantedNewComment: true, grantedCommentReply: true, updatedAt: 1 }
    assert.strictEqual(sub.entryVisible('postPublish'), false, '旧键 grantedNewComment 必须仍被识别为已授权')
    // 只有一项旧键、另一项未授权 → 仍需引导
    state.storage[COMMENT_PREFS_KEY] = { commentNew: true, commentReply: true, grantedNewComment: true }
    assert.strictEqual(sub.entryVisible('postPublish'), true, '仅部分授权时入口仍应显示')
  }, 'E. 授权键改名后旧键 grantedNewComment 仍被识别（不强制老用户重新授权）')

  // ===== F. 统一推导函数可被复用 =====
  check(() => {
    assert.strictEqual(typeof sub.grantedKeyOf, 'function', '必须导出 grantedKeyOf，供设置页等复用同一套推导')
    Object.keys(FE_IDS).length && Object.keys(sub.TRIGGER_GROUPS).forEach((trigger) => {
      const rule = sub.TRIGGER_GROUPS[trigger]
      rule.keys.forEach((key, index) => {
        assert.strictEqual(sub.grantedKeyOf(key), rule.grantedKeys[index], trigger + '：grantedKeyOf(' + key + ') 必须等于触发组声明的授权键')
      })
    })
  }, 'F. grantedKeyOf 与触发组声明的授权键完全一致（单一真源）')

  // ===== G. 模板中文名两侧一致（提示文案要能点名「哪一项没勾上」）=====
  check(() => {
    assert.ok(sub.TPL_LABELS && typeof sub.TPL_LABELS === 'object', '前端必须导出 TPL_LABELS')
    const svcSrc = fs.readFileSync(path.join(SERVER, 'services', 'subscribeService.js'), 'utf8')
    const cfgBlock = svcSrc.match(/const TPL_CONFIG = \{([\s\S]*?)\n\}/)[1]
    const beLabels = {}
    cfgBlock.split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Za-z]+): \{[^}]*label: '([^']+)'/)
      if (m) beLabels[m[1]] = m[2]
    })
    assert.ok(Object.keys(beLabels).length >= 18, '应解析出服务端 18+ 个模板中文名（实际 ' + Object.keys(beLabels).length + '）')
    Object.keys(FE_IDS).forEach((type) => {
      assert.ok(sub.TPL_LABELS[type], '前端 TPL_LABELS 缺 ' + type)
      assert.strictEqual(
        sub.TPL_LABELS[type], beLabels[type],
        type + ' 的中文名前后端必须一字不差（前端提示要给用户点名，服务端日志也用这个名）：前端「' + sub.TPL_LABELS[type] + '」服务端「' + beLabels[type] + '」'
      )
    })
  }, 'G. TPL_LABELS 与服务端 TPL_CONFIG.label 逐项一致（提示点名不会说错名字）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
