/**
 * 活动详情页报名订阅授权测试（无需数据库 / 无需真机）
 *
 * 需求：点击「报名」时在用户手势同步链内直接申请「活动报名结果通知」「活动开始提醒」
 * 「报名成功通知」三个模板的微信原生订阅授权（不再有自定义弹窗）；授权结果持久化并上报；
 * 无论允许还是拒绝，报名流程与报名提示 modal 都不被打断。
 *
 * 覆盖：
 *   A. 点击报名：同步发起授权（先于报名请求）→ 全部允许 → 授权结果落库 → 报名成功提示
 *   B. 全部拒绝：报名流程不阻塞
 *   C. 部分允许：逐键记录 grantedXxx
 *   D. 发起人配置了报名提示内容：报名成功后弹出提示 modal
 *   E. utils/subscribe.js 三个真实模板 ID、白名单与 activitySignup 触发组（源码断言）
 *   F. wxml/js 接线护栏（报名按钮触发点在位、旧弹窗结构已移除）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_DIR = path.join(MINI_PROGRAM_ROOT, 'pages', 'activity')

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
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// 订阅桩：与 utils/subscribe.js 的「requestTriggerByTap → requestSubscribe → persistAccepted」语义保持同源
function buildSubscribeStub(state) {
  const TRIGGER_TEST_GROUPS = {
    postPublish: { prefsKey: 'subscribe_comment_prefs', keys: ['commentNew', 'commentReply'], grantedKeys: ['grantedCommentNew', 'grantedCommentReply'] },
    withdraw: { prefsKey: 'notify_channel_prefs', keys: ['withdrawSuccess', 'withdrawResult'], grantedKeys: ['grantedWithdrawSuccess', 'grantedWithdrawResult'] },
    activityIndex: { prefsKey: 'notify_channel_prefs', keys: ['activityNew', 'activityJoined', 'activitySignupNotice'], grantedKeys: ['grantedActivityNew', 'grantedActivityJoined', 'grantedActivitySignupNotice'] },
    activityPublish: { prefsKey: 'notify_channel_prefs', keys: ['activityAudit'], grantedKeys: ['grantedActivityAudit'] },
    activitySignup: { prefsKey: 'notify_channel_prefs', keys: ['activitySignupResult', 'activityStart', 'activitySignup'], grantedKeys: ['grantedActivitySignupResult', 'grantedActivityStart', 'grantedActivitySignup'] },
    riderVerify: { prefsKey: 'notify_channel_prefs', keys: ['auditCert', 'audit', 'auditPass'], grantedKeys: ['grantedAuditCert', 'grantedAudit', 'grantedAuditPass'] },
    errandPublish: { prefsKey: 'notify_channel_prefs', keys: ['errandAccepted', 'errandFinished', 'errandCancelled'], grantedKeys: ['grantedErrandAccepted', 'grantedErrandFinished', 'grantedErrandCancelled'] },
    message: { prefsKey: 'notify_channel_prefs', keys: ['message'], grantedKeys: ['grantedMessage'] }
  }
  const stub = {
    requestSubscribe: (types) => {
      state.order.push('sub')
      state.subCalls.push(types)
      const r = state.subResult.shift()
      return Promise.resolve(r === undefined ? { accepted: [], rejected: [] } : r)
    },
    requestSubscribeByTap(types) { return stub.requestSubscribe(types) },
    typesForTrigger(trigger) {
      const r = TRIGGER_TEST_GROUPS[trigger]
      return r ? r.keys.slice() : []
    },
    persistAccepted(acceptedTypes, requestedTypes) {
      const accepted = new Set(acceptedTypes || [])
      const requested = Array.from(new Set(requestedTypes || acceptedTypes || []))
      Object.keys(TRIGGER_TEST_GROUPS).forEach((trigger) => {
        const rule = TRIGGER_TEST_GROUPS[trigger]
        const prefs = state.storage[rule.prefsKey] || {}
        let changed = false
        rule.keys.forEach((key, index) => {
          if (requested.indexOf(key) < 0) return
          const grantedKey = rule.grantedKeys && rule.grantedKeys[index]
          if (grantedKey) { prefs[grantedKey] = accepted.has(key); changed = true }
        })
        if (changed) state.storage[rule.prefsKey] = prefs
      })
    },
    requestTriggerByTap(trigger) {
      state.triggerCalls.push(trigger)
      const types = stub.typesForTrigger(trigger)
      if (!types.length) return Promise.resolve({ accepted: [], rejected: [] })
      return stub.requestSubscribe(types).then((res) => {
        stub.persistAccepted(res.accepted, types)
        return res
      })
    },
    resumePending: () => Promise.resolve(null),
    shouldShowDialog: () => false,
    getTriggerGroup(trigger) {
      const r = TRIGGER_TEST_GROUPS[trigger]
      return r ? { prefsKey: r.prefsKey, keys: r.keys.slice() } : null
    },
    TRIGGER_GROUPS: TRIGGER_TEST_GROUPS,
    reportQuota: () => Promise.resolve(null),
    fetchQuota: () => Promise.resolve(null),
    TEMPLATE_IDS: {}
  }
  return stub
}

function loadPage() {
  const source = require('fs').readFileSync(path.join(PAGE_DIR, 'detail.js'), 'utf8')
  const state = {
    storage: {},
    subCalls: [],
    subResult: [],
    triggerCalls: [],
    order: [],
    toasts: [],
    modals: [],
    reloads: 0
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    showModal: (opt) => { state.modals.push(opt && opt.title) },
    navigateBack: () => {},
    redirectTo: () => {},
    previewImage: () => {}
  }

  const subscribeStub = buildSubscribeStub(state)

  const activityStub = {
    id: 7,
    title: '校园歌手大赛',
    remaining: 3,
    signupCount: 5,
    joined: false,
    badge: 'signing',
    auditStatus: 'approved',
    isOwner: false,
    signupTitle: '报名成功',
    signupContent: ''
  }

  const requireStub = (modulePath) => {
    const p = String(modulePath).split('\\').join('/')
    if (p.endsWith('utils/api')) {
      return {
        getActivityDetail: () => Promise.resolve({ activity: plain(activityStub) }),
        signupActivity: () => {
          state.order.push('signup')
          return Promise.resolve({})
        }
      }
    }
    if (p.endsWith('utils/auth')) return { isLoggedIn: () => true, requireLogin: () => true }
    if (p.endsWith('utils/subscribe')) return subscribeStub
    throw new Error('unexpected require in test: ' + modulePath)
  }

  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    wx: wxStub,
    require: requireStub,
    setTimeout: (fn) => { fn(); return 0 }, // 同步执行：modal/toast 断言不依赖真实定时
    clearTimeout: () => {},
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'activity/detail.js' })
  assert.ok(pageConfig, 'Page() 未被调用')

  function makeInstance() {
    const inst = Object.assign({}, pageConfig, { data: plain(pageConfig.data) })
    inst.activityId = 7
    inst.loadDetail = function () {
      // 直接套用真实 loadDetail 的产物（避免再起 promise 链）：activity 已就位
      inst.data.activity = plain(activityStub)
      inst.data.signupDisabled = false
      inst.data.signupBtnText = '立即报名'
      inst.data.loading = false
    }
    inst.setData = function setData(patch, callback) {
      const apply = (target, keyPath, value) => {
        const keys = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.')
        let node = target
        for (let i = 0; i < keys.length - 1; i++) {
          if (node[keys[i]] === undefined) node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}
          node = node[keys[i]]
        }
        node[keys[keys.length - 1]] = value
      }
      Object.keys(patch).forEach((key) => apply(inst.data, key, patch[key]))
      if (typeof callback === 'function') callback()
    }
    return inst
  }
  return { makeInstance, state }
}

async function run() {
  const { makeInstance, state } = loadPage()
  const reset = () => {
    state.storage = {}
    state.subCalls = []
    state.subResult = []
    state.triggerCalls = []
    state.order = []
    state.toasts = []
    state.modals = []
    state.reloads = 0
  }
  const drain = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {}).then(() => {})

  // A. 点击报名：授权在报名请求前同步发起；全部允许 → 授权落库 → 报名成功提示
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['activitySignupResult', 'activityStart', 'activitySignup'], rejected: [] }]
    const inst = makeInstance()
    inst.loadDetail()
    await inst.onSignup()
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['activitySignup'], '必须以 activitySignup 触发点申请授权')
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(state.subCalls)),
      [['activitySignupResult', 'activityStart', 'activitySignup']]
    )
    assert.ok(state.order.indexOf('sub') < state.order.indexOf('signup'), '授权必须先于报名请求（tap 同步链）')
    assert.strictEqual(inst.data.signing, false)
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivitySignupResult, true)
    assert.strictEqual(prefs.grantedActivityStart, true)
    assert.strictEqual(prefs.grantedActivitySignup, true)
    assert.ok(state.toasts.indexOf('报名成功') > -1)
  }, 'A. 点击报名同步申请授权（全部允许）→ 授权落库 → 报名成功提示')

  // B. 全部拒绝：报名流程不阻塞
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: [], rejected: ['activitySignupResult', 'activityStart', 'activitySignup'] }]
    const inst = makeInstance()
    inst.loadDetail()
    await inst.onSignup()
    await drain()
    assert.strictEqual(inst.data.signing, false)
    assert.ok(state.toasts.indexOf('报名成功') > -1, '拒绝授权也不阻塞报名')
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivitySignupResult, false)
    assert.strictEqual(prefs.grantedActivityStart, false)
    assert.strictEqual(prefs.grantedActivitySignup, false)
  }, 'B. 用户全部拒绝：报名流程不阻塞，授权结果如实记录')

  // C. 部分允许：只允许其中一个
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['activityStart'], rejected: ['activitySignupResult', 'activitySignup'] }]
    const inst = makeInstance()
    inst.loadDetail()
    await inst.onSignup()
    await drain()
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivityStart, true)
    assert.strictEqual(prefs.grantedActivitySignupResult, false)
    assert.strictEqual(prefs.grantedActivitySignup, false)
  }, 'C. 用户只允许部分模板时如实记录、流程不阻塞')

  // D. 发起人配置了报名提示内容：报名成功后弹出提示 modal
  await checkAsync(async () => {
    reset()
    const inst = makeInstance()
    inst.loadDetail()
    inst.data.activity.signupContent = '请准时到现场签到'
    // onSignup 成功后会再次 loadDetail（用干净数据覆盖 activity），这里换成保留型桩
    inst.loadDetail = function () {
      inst.data.signupDisabled = false
      inst.data.signupBtnText = '立即报名'
      inst.data.loading = false
    }
    await inst.onSignup()
    await drain()
    assert.deepStrictEqual(state.modals, ['报名成功'], '报名提示 modal 正常展示')
    assert.deepStrictEqual(state.triggerCalls, ['activitySignup'])
  }, 'D. 带报名提示内容时，报名成功后展示提示 modal')

  // E. utils/subscribe.js 三个真实模板 ID、白名单与 activitySignup 触发组（源码断言）
  check(() => {
    const src = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(src.indexOf("activitySignupResult: 'V2E--7EluSwMjtYMjTYTVArJ6XJ9N0IBIaXyAAxmhFg'") > -1, 'activitySignupResult 必须是「活动报名结果通知」真实 ID')
    assert.ok(src.indexOf("activityStart: 'qmeo56-pos-SuRofXm3nePNoI4E1aOGpruLuUSmysD8'") > -1, 'activityStart 必须是「活动开始提醒」真实 ID')
    assert.ok(src.indexOf("activitySignup: 'Yf_W1CJr18NhxSXaUqe8V7CmWwD4AJA-mXyuD_pHI9g'") > -1, 'activitySignup 必须是「报名成功通知」真实 ID')
    assert.ok(/VALID_TYPES = \[[^\]]*'activitySignupResult'/.test(src), 'VALID_TYPES 必须包含 activitySignupResult')
    assert.ok(/VALID_TYPES = \[[^\]]*'activityStart'/.test(src), 'VALID_TYPES 必须包含 activityStart')
    assert.ok(/VALID_TYPES = \[[^\]]*'activitySignup'/.test(src), 'VALID_TYPES 必须包含 activitySignup')
    assert.ok(src.indexOf("activitySignup: { prefsKey: 'notify_channel_prefs', keys: ['activitySignupResult', 'activityStart', 'activitySignup'], grantedKeys: ['grantedActivitySignupResult', 'grantedActivityStart', 'grantedActivitySignup'] }") > -1, 'TRIGGER_GROUPS 必须定义 activitySignup 组')
  }, 'E. subscribe.js 注册了三个真实模板 ID、白名单与 activitySignup 触发组')

  // F. wxml/js 接线护栏（报名按钮触发点在位、旧自定义弹窗已移除）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(PAGE_DIR, 'detail.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="onSignup"') > -1, '报名按钮必须绑定 onSignup')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义订阅弹窗结构必须已移除')
    const js = require('fs').readFileSync(path.join(PAGE_DIR, 'detail.js'), 'utf8')
    assert.ok(js.indexOf("subscribe.requestTriggerByTap('activitySignup')") > -1, 'onSignup 必须在 tap 同步链内调用 requestTriggerByTap')
    assert.ok(js.indexOf('showSubscribeDialog') === -1, '旧弹窗状态必须已移除')
    assert.ok(js.indexOf("requestSubscribe(['activity']") === -1, '更早的静默整包订阅请求不得回归')
  }, 'F. wxml/js 接线护栏（报名按钮触发点在位、旧弹窗结构已移除）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
