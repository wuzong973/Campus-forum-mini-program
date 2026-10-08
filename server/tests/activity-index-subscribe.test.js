/**
 * 校园活动页订阅消息授权测试（无需数据库 / 无需真机）
 *
 * 需求：点击「报名中」tab 时在用户手势同步链内直接申请「新活动提醒」「活动参与成功提醒」
 * 「活动报名通知」三个模板的微信原生订阅授权（不再有自定义弹窗）；授权结果持久化并上报；
 * 授权弹窗不打断 tab 切换与列表加载。
 *
 * 覆盖：
 *   A. 点击「报名中」：同步发起授权（先于列表加载）→ 全部允许 → 授权结果落库
 *   B. 已在「报名中」tab 再次点击：仍触发授权（明确的用户手势）
 *   C. 点击其他 tab：不触发授权
 *   D. 部分允许：逐键记录 grantedXxx
 *   E. utils/subscribe.js 三个真实模板 ID、白名单与 activityIndex 触发组（源码断言）
 *   F. wxml/js 接线护栏（tab 点击触发点在位、旧弹窗结构已移除）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_DIR = path.join(MINI_PROGRAM_ROOT, 'pkg-feature', 'pages', 'activity')

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
    toasts: [],
    listCalls: []
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    vibrateShort: () => {},
    navigateTo: () => {},
    stopPullDownRefresh: () => {}
  }

  const subscribeStub = buildSubscribeStub(state)

  const requireStub = (modulePath) => {
    const p = String(modulePath).split('\\').join('/')
    if (p.endsWith('utils/api')) return { getActivities: () => { state.order.push('list'); state.listCalls.push(1); return Promise.resolve({ list: [], hasMore: false }) } }
    if (p.endsWith('utils/auth')) return { requireFeatureAccess: () => Promise.resolve(true) }
    if (p.endsWith('utils/campus')) return { CAMPUS_GROUPS: [{ name: '广州校区', subs: ['新港'] }] }
    if (p.endsWith('utils/subscribe')) return subscribeStub
    // 卡片动效开关与订阅无关，桩里返回默认开启
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
  vm.runInNewContext(source, sandbox, { filename: 'activity/index.js' })
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
    state.toasts = []
    state.listCalls = []
  }
  const tapTab = (inst, key) => inst.chooseTab({ currentTarget: { dataset: { key } } })
  const drain = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {}).then(() => {})

  // A. 点击「报名中」：同步发起授权（先于列表加载）；全部允许 → 授权落库
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['activityNew', 'activityJoined', 'activitySignupNotice'], rejected: [] }]
    const inst = makeInstance()
    tapTab(inst, 'signing')
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['activityIndex'], '必须以 activityIndex 触发点申请授权')
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(state.subCalls)),
      [['activityNew', 'activityJoined', 'activitySignupNotice']]
    )
    assert.ok(state.order.indexOf('sub') < state.order.indexOf('list'), '授权必须先于列表加载（tap 同步链）')
    assert.strictEqual(state.listCalls.length, 1, 'tab 切换与列表加载不被打断')
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivityNew, true)
    assert.strictEqual(prefs.grantedActivityJoined, true)
    assert.strictEqual(prefs.grantedActivitySignupNotice, true)
  }, 'A. 点击「报名中」同步申请授权（全部允许）→ 授权落库，列表正常加载')

  // B. 已在「报名中」tab 再次点击：仍触发授权（明确的用户手势）
  await checkAsync(async () => {
    reset()
    const inst = makeInstance()
    inst.data.activeTab = 'signing'
    tapTab(inst, 'signing')
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['activityIndex'], '重复点击同一 tab 仍应申请授权')
    assert.strictEqual(state.listCalls.length, 0, '同 tab 重复点击不重新加载列表')
  }, 'B. 已在「报名中」tab 再次点击仍触发授权')

  // C. 点击其他 tab：「全部活动」/「我的参与」同步申请活动结果通知组（有意设置）
  await checkAsync(async () => {
    reset()
    const inst = makeInstance()
    tapTab(inst, 'mine')
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['activitySignup'], '「我的参与」tab 必须申请 activitySignup 触发组（与报名成功共用）')
    assert.strictEqual(state.listCalls.length, 1, 'tab 切换正常加载列表')
    assert.strictEqual(inst.data.activeTab, 'mine')
  }, 'C. 其他 tab 触发 activitySignup 组，列表正常加载')

  // D. 部分允许：只允许其中一个
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['activityJoined'], rejected: ['activityNew', 'activitySignupNotice'] }]
    const inst = makeInstance()
    tapTab(inst, 'signing')
    await drain()
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivityJoined, true)
    assert.strictEqual(prefs.grantedActivityNew, false)
    assert.strictEqual(prefs.grantedActivitySignupNotice, false)
  }, 'D. 用户只允许部分模板时如实记录')

  // E. utils/subscribe.js 三个真实模板 ID、白名单与 activityIndex 触发组（源码断言）
  check(() => {
    const src = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(src.indexOf("activityNew: 'EmuOFFgiPUl3_7gCSogsG7_0VsStGCnxdGKSPSq_fuc'") > -1, 'activityNew 必须是「新活动提醒」真实 ID')
    assert.ok(src.indexOf("activityJoined: 'yCG4T7vIa1B3vYK73K6H5ZdCNacQNObCt6kogfDL0lc'") > -1, 'activityJoined 必须是「活动参与成功提醒」真实 ID')
    assert.ok(src.indexOf("activitySignupNotice: '_evYbFOUG9CSyjleOJWk4y2K5GTdkzRYf4OU-lCYkmk'") > -1, 'activitySignupNotice 必须是「活动报名通知」真实 ID')
    assert.ok(/VALID_TYPES = \[[^\]]*'activityNew'/.test(src), 'VALID_TYPES 必须包含 activityNew')
    assert.ok(/VALID_TYPES = \[[^\]]*'activityJoined'/.test(src), 'VALID_TYPES 必须包含 activityJoined')
    assert.ok(/VALID_TYPES = \[[^\]]*'activitySignupNotice'/.test(src), 'VALID_TYPES 必须包含 activitySignupNotice')
    assert.ok(src.indexOf("activityIndex: { prefsKey: 'notify_channel_prefs', keys: ['activityNew', 'activityJoined', 'activitySignupNotice'], grantedKeys: ['grantedActivityNew', 'grantedActivityJoined', 'grantedActivitySignupNotice'] }") > -1, 'TRIGGER_GROUPS 必须定义 activityIndex 组')
  }, 'E. subscribe.js 注册了三个活动订阅真实模板 ID、白名单与 activityIndex 触发组')

  // F. wxml/js 接线护栏（tab 点击触发点在位、旧自定义弹窗已移除）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="chooseTab"') > -1, 'tab 必须绑定 chooseTab')
    assert.ok(wxml.indexOf('data-key="signing"') > -1 || /data-key="\{\{item\.key\}\}"/.test(wxml), 'tab 必须携带 data-key')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义订阅弹窗结构必须已移除')
    const js = require('fs').readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')
    assert.ok(js.indexOf("subscribe.requestTriggerByTap('activityIndex')") > -1, 'chooseTab 必须在 tap 同步链内调用 requestTriggerByTap')
    assert.ok(js.indexOf('showSubscribeDialog') === -1, '旧弹窗状态必须已移除')
  }, 'F. wxml/js 接线护栏（tab 点击触发点在位、旧弹窗结构已移除）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
