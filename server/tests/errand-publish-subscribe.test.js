/**
 * 发布跑腿页订阅消息授权测试（无需数据库 / 无需真机）
 *
 * 需求：点击「支付发布」时在用户手势同步链内直接申请「订单接单通知」「订单完成通知」
 * 「订单取消通知」三个模板的微信原生订阅授权（不再有自定义弹窗）；授权结果持久化并上报；
 * 无论允许还是拒绝，发布/支付流程不被打断。
 *
 * 覆盖：
 *   A. 点击发布：同步发起授权（先于建单请求）→ 全部允许 → 授权结果落库 → 发布成功
 *   B. 全部拒绝：发布流程不阻塞
 *   C. 部分允许：逐键记录 grantedXxx
 *   D. utils/subscribe.js 三个真实模板 ID、白名单与 errandPublish 触发组（源码断言）
 *   E. wxml/js 接线护栏（发布按钮触发点在位、旧弹窗结构已移除）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_DIR = path.join(MINI_PROGRAM_ROOT, 'pages', 'errand-publish')

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
    subCalls: [],
    subResult: [],
    triggerCalls: [],
    order: [],
    posts: [],
    toasts: []
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    navigateBack: () => {},
    vibrateShort: () => {},
    chooseMedia: (opt) => { if (opt && opt.fail) opt.fail({}) },
    previewImage: () => {}
  }

  const subscribeStub = buildSubscribeStub(state)

  const requireStub = (modulePath) => {
    const p = String(modulePath).split('\\').join('/')
    if (p.endsWith('utils/auth')) return { requireLogin: () => true, isLoggedIn: () => true }
    if (p.endsWith('utils/request')) {
      return {
        get: () => Promise.resolve(null),
        post: (url) => {
          state.order.push('post:' + url)
          state.posts.push(url)
          return Promise.resolve({ id: 1 })
        },
        put: () => Promise.resolve({})
      }
    }
    if (p.endsWith('utils/api')) return { getHomeConfig: () => Promise.resolve({}) }
    if (p.endsWith('utils/wechat')) {
      return {
        uploadImages: (list) => Promise.resolve(list),
        uploadVideo: (p2) => Promise.resolve(p2),
        checkContent: () => Promise.resolve()
      }
    }
    if (p.endsWith('utils/refresh')) return { runPullDownRefresh: () => {} }
    if (p.endsWith('utils/subscribe')) return subscribeStub
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
  vm.runInNewContext(source, sandbox, { filename: 'errand-publish/index.js' })
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
    state.subCalls = []
    state.subResult = []
    state.triggerCalls = []
    state.order = []
    state.posts = []
    state.toasts = []
  }
  // 建单 → 支付桩 → 成功提示链条较深，需要更多微任务轮次排空
  const drain = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {}).then(() => {}).then(() => {}).then(() => {}).then(() => {}).then(() => {})
  const fillValidForm = (inst) => {
    inst.data.agreed = true
    inst.data.title = '代拿快递'
    inst.data.remark = '帮我拿一下快递'
    inst.data.baseAmount = '5'
    inst.data.wechatId = 'wx_helper'
    inst.data.receiverPhone = ''
    inst.data.activeGenderRestriction = 0
    inst.data.activeCampus = 0
    inst.data.subCampuses = []
    inst.data.campusGroups = [{ name: '广州校区', subs: [] }]
    inst.data.images = []
    // 支付拉起不在本测试范围：桩掉支付流程，只保留建单请求
    inst._payFlow = () => Promise.resolve()
  }

  // A. 点击发布：授权在建单请求前同步发起；全部允许 → 授权落库 → 发布成功
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['errandAccepted', 'errandFinished', 'errandCancelled'], rejected: [] }]
    const inst = makeInstance()
    fillValidForm(inst)
    inst.onSubmit()
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['errandPublish'], '必须以 errandPublish 触发点申请授权')
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(state.subCalls)),
      [['errandAccepted', 'errandFinished', 'errandCancelled']]
    )
    assert.ok(state.order.indexOf('sub') < state.order.indexOf('post:/errand'), '授权必须先于建单请求（tap 同步链）')
    assert.strictEqual(state.posts[0], '/errand')
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedErrandAccepted, true)
    assert.strictEqual(prefs.grantedErrandFinished, true)
    assert.strictEqual(prefs.grantedErrandCancelled, true)
    assert.ok(state.toasts.indexOf('发布成功') > -1)
  }, 'A. 点击发布同步申请授权（全部允许）→ 授权落库 → 发布成功')

  // B. 全部拒绝：发布流程不阻塞
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: [], rejected: ['errandAccepted', 'errandFinished', 'errandCancelled'] }]
    const inst = makeInstance()
    fillValidForm(inst)
    inst.onSubmit()
    await drain()
    assert.strictEqual(state.posts[0], '/errand', '拒绝授权也不阻塞发布')
    assert.ok(state.toasts.indexOf('发布成功') > -1)
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedErrandAccepted, false)
    assert.strictEqual(prefs.grantedErrandFinished, false)
    assert.strictEqual(prefs.grantedErrandCancelled, false)
  }, 'B. 用户全部拒绝：发布流程不阻塞，授权结果如实记录')

  // C. 部分允许：只允许其中一个
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['errandAccepted'], rejected: ['errandFinished', 'errandCancelled'] }]
    const inst = makeInstance()
    fillValidForm(inst)
    inst.onSubmit()
    await drain()
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedErrandAccepted, true)
    assert.strictEqual(prefs.grantedErrandFinished, false)
    assert.strictEqual(prefs.grantedErrandCancelled, false)
  }, 'C. 用户只允许部分模板时如实记录、流程不阻塞')

  // D. utils/subscribe.js 三个真实模板 ID、白名单与 errandPublish 触发组（源码断言）
  check(() => {
    const src = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(src.indexOf("errandAccepted: 'HFe6LGndlkjQQvOqkaeQabQ4biKRdZOAZYU3IRVNO5o'") > -1, 'errandAccepted 必须是「订单接单通知」真实 ID')
    assert.ok(src.indexOf("errandFinished: '7S5kSh68UH8bKgorfc5giQdptMfhy_0-sXi9ZfDZ24U'") > -1, 'errandFinished 必须是「订单完成通知」真实 ID')
    assert.ok(src.indexOf("errandCancelled: 'zApVwFQd14yZ7kr610aKCtXstcl6lAJbgmJiziQxQuE'") > -1, 'errandCancelled 必须是「订单取消通知」真实 ID')
    assert.ok(/VALID_TYPES = \[[^\]]*'errandAccepted'/.test(src), 'VALID_TYPES 必须包含 errandAccepted')
    assert.ok(/VALID_TYPES = \[[^\]]*'errandFinished'/.test(src), 'VALID_TYPES 必须包含 errandFinished')
    assert.ok(/VALID_TYPES = \[[^\]]*'errandCancelled'/.test(src), 'VALID_TYPES 必须包含 errandCancelled')
    assert.ok(src.indexOf("errandPublish: { prefsKey: 'notify_channel_prefs', keys: ['errandAccepted', 'errandFinished', 'errandCancelled'], grantedKeys: ['grantedErrandAccepted', 'grantedErrandFinished', 'grantedErrandCancelled'] }") > -1, 'TRIGGER_GROUPS 必须定义 errandPublish 组')
  }, 'D. subscribe.js 注册了三个跑腿真实模板 ID、白名单与 errandPublish 触发组')

  // E. wxml/js 接线护栏（发布按钮触发点在位、旧自定义弹窗已移除）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="onSubmit"') > -1, '支付发布按钮必须绑定 onSubmit')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义订阅弹窗结构必须已移除')
    const js = require('fs').readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')
    assert.ok(js.indexOf("subscribe.requestTriggerByTap('errandPublish')") > -1, 'onSubmit 必须在 tap 同步链内调用 requestTriggerByTap')
    assert.ok(js.indexOf('showSubscribeDialog') === -1 && js.indexOf('maybeShowSubscribeDialog') === -1, '旧弹窗状态与进入触发必须已移除')
  }, 'E. wxml/js 接线护栏（发布按钮触发点在位、旧弹窗结构已移除）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
