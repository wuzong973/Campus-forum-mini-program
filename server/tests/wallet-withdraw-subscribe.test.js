/**
 * 钱包提现订阅消息授权测试（无需数据库 / 无需真机）
 *
 * 需求：点击「提交」提现时在用户手势同步链内直接申请「提现成功通知」「提现结果通知」
 * 两个模板的微信原生订阅授权（不再有自定义弹窗）；授权结果持久化并上报；
 * 无论允许还是拒绝，提现流程不被打断。
 *
 * 覆盖：
 *   A. 点击提交：同步发起授权（先于提现请求）→ 全部允许 → 授权结果落库 → 已提交审核
 *   B. 全部拒绝：提现流程不阻塞
 *   C. 部分允许：逐键记录 grantedXxx
 *   D. utils/subscribe.js 真实模板 ID、白名单与 withdraw 触发组（源码断言）
 *   E. wxml/js 接线护栏（提交按钮触发点在位、旧弹窗结构已移除）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_DIR = path.join(MINI_PROGRAM_ROOT, 'pages', 'wallet')

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
  const source = require('fs').readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')
  const state = {
    storage: {},
    getCalls: [],
    postCalls: [],
    subCalls: [],
    subResult: [],
    triggerCalls: [],
    order: [],
    toasts: [],
    loadings: []
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showLoading: (opt) => { state.loadings.push(opt && opt.title) },
    hideLoading: () => { state.loadings.push('hidden') },
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    showModal: (opt) => { if (opt && opt.success) opt.success({ confirm: false }) },
    navigateTo: () => {},
    canIUse: () => true
  }

  const subscribeStub = buildSubscribeStub(state)

  const requireStub = (modulePath) => {
    const p = String(modulePath).split('\\').join('/')
    if (p.endsWith('utils/auth')) return { isLoggedIn: () => true }
    if (p.endsWith('utils/request')) {
      return {
        get: (url) => {
          state.getCalls.push(url)
          if (url === '/wallet/summary') return Promise.resolve({ available: '10.00', earned: '2.00', withdrawing: '0.00', records: [] })
          return Promise.resolve({})
        },
        post: (url) => {
          state.order.push('post:' + url)
          state.postCalls.push(url)
          return Promise.resolve({})
        },
        put: () => Promise.resolve({})
      }
    }
    if (p.endsWith('utils/refresh')) return { runPullDownRefresh: () => {} }
    if (p.endsWith('utils/subscribe')) return subscribeStub
    // 卡片动效开关与本页无关，桩里返回默认开启
    if (p.endsWith('utils/motion')) return {
      isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false,
      isLowEndDevice: () => false, getBenchmarkLevel: () => -1
    }
    throw new Error('unexpected require in test: ' + modulePath)
  }

  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    wx: wxStub,
    require: requireStub,
    setTimeout: (fn) => { fn(); return 0 },
    clearTimeout: () => {},
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'wallet/index.js' })
  assert.ok(pageConfig, 'Page() 未被调用')

  function makeInstance() {
    const inst = Object.assign({}, pageConfig, { data: plain(pageConfig.data) })
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
    state.getCalls = []
    state.postCalls = []
    state.subCalls = []
    state.subResult = []
    state.triggerCalls = []
    state.order = []
    state.toasts = []
    state.loadings = []
  }
  const drain = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {}).then(() => {})
  const prepareWithdraw = async (inst) => {
    await inst.onShow()
    inst.data.withdrawAmount = '5'
    inst.data.balance = '10.00'
  }

  // A. 点击提交：授权在提现请求前同步发起；全部允许 → 授权落库 → 已提交审核
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['withdrawSuccess', 'withdrawResult'], rejected: [] }]
    const inst = makeInstance()
    await prepareWithdraw(inst)
    await inst.submitWithdraw()
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['withdraw'], '必须以 withdraw 触发点申请授权')
    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.subCalls)), [['withdrawSuccess', 'withdrawResult']])
    assert.ok(state.order.indexOf('sub') < state.order.indexOf('post:/wallet/withdrawals'), '授权必须先于提现请求（tap 同步链）')
    assert.strictEqual(state.postCalls[0], '/wallet/withdrawals')
    assert.strictEqual(inst.data.showWithdraw, false, '提现面板应关闭')
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedWithdrawSuccess, true)
    assert.strictEqual(prefs.grantedWithdrawResult, true)
    assert.ok(state.toasts.indexOf('已提交审核') > -1)
  }, 'A. 点击提交同步申请授权（全部允许）→ 授权落库 → 已提交审核')

  // B. 全部拒绝：提现流程不阻塞
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: [], rejected: ['withdrawSuccess', 'withdrawResult'] }]
    const inst = makeInstance()
    await prepareWithdraw(inst)
    await inst.submitWithdraw()
    await drain()
    assert.strictEqual(state.postCalls[0], '/wallet/withdrawals', '拒绝授权也不阻塞提现')
    assert.ok(state.toasts.indexOf('已提交审核') > -1)
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedWithdrawSuccess, false)
    assert.strictEqual(prefs.grantedWithdrawResult, false)
  }, 'B. 用户全部拒绝：提现流程不阻塞，授权结果如实记录')

  // C. 部分允许：只允许其中一个
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['withdrawResult'], rejected: ['withdrawSuccess'] }]
    const inst = makeInstance()
    await prepareWithdraw(inst)
    await inst.submitWithdraw()
    await drain()
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedWithdrawResult, true)
    assert.strictEqual(prefs.grantedWithdrawSuccess, false)
  }, 'C. 用户只允许其中一个模板时如实记录、流程不阻塞')

  // D. utils/subscribe.js 真实模板 ID、白名单与 withdraw 触发组（源码断言）
  check(() => {
    const src = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(src.indexOf("withdrawSuccess: 'RB6jQZyrQUwzNdM23vq9Cbx3mSbSfKXxgcvNtYpzJuw'") > -1, 'withdrawSuccess 必须是「提现成功通知」真实 ID')
    assert.ok(src.indexOf("withdrawResult: 'vbvVxxEl6i-InuDE33N1GLM6-vUlfmW7LCLMiw3NfSg'") > -1, 'withdrawResult 必须是「提现结果通知」真实 ID')
    assert.ok(/VALID_TYPES = \[[^\]]*'withdrawSuccess'/.test(src), 'VALID_TYPES 必须包含 withdrawSuccess')
    assert.ok(/VALID_TYPES = \[[^\]]*'withdrawResult'/.test(src), 'VALID_TYPES 必须包含 withdrawResult')
    assert.ok(src.indexOf("withdraw: { prefsKey: 'notify_channel_prefs', keys: ['withdrawSuccess', 'withdrawResult'], grantedKeys: ['grantedWithdrawSuccess', 'grantedWithdrawResult'] }") > -1, 'TRIGGER_GROUPS 必须定义 withdraw 组')
  }, 'D. subscribe.js 注册了两个真实提现模板 ID、白名单与 withdraw 触发组')

  // E. wxml/js 接线护栏（提交按钮触发点在位、旧自定义弹窗已移除）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="submitWithdraw"') > -1, '提现提交按钮必须绑定 submitWithdraw')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义订阅弹窗结构必须已移除')
    const js = require('fs').readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')
    assert.ok(js.indexOf("subscribe.requestTriggerByTap('withdraw')") > -1, 'submitWithdraw 必须在 tap 同步链内调用 requestTriggerByTap')
    assert.ok(js.indexOf('showSubscribeDialog') === -1, '旧弹窗状态必须已移除')
  }, 'E. wxml/js 接线护栏（提交按钮触发点在位、旧弹窗结构已移除）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
