/**
 * 活动发布页订阅消息授权测试（无需数据库 / 无需真机）
 *
 * 需求：点击「发布」时在用户手势同步链内直接申请「活动审核通知」模板的微信原生订阅授权
 * （不再有自定义弹窗）；授权结果持久化并上报；无论允许还是拒绝，发布流程不被打断。
 *
 * 覆盖：
 *   A. 点击发布：同步发起授权（先于建单请求）→ 允许 → 授权结果落库 → 发布成功提示
 *   B. 拒绝：发布流程不阻塞，授权结果如实记录
 *   C. utils/subscribe.js 真实模板 ID、白名单与 activityPublish 触发组（源码断言）
 *   D. wxml/js 接线护栏（发布按钮触发点在位、旧弹窗结构已移除）
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
  const source = require('fs').readFileSync(path.join(PAGE_DIR, 'publish.js'), 'utf8')
  const state = {
    storage: {},
    subCalls: [],
    subResult: [],
    triggerCalls: [],
    order: [],
    toasts: [],
    backs: [],
    redirects: []
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    navigateBack: (opt) => { state.backs.push(opt || {}) },
    redirectTo: (opt) => { state.redirects.push(opt && opt.url) },
    chooseMedia: (opt) => { if (opt && opt.fail) opt.fail({}) },
    previewImage: () => {}
  }

  const subscribeStub = buildSubscribeStub(state)

  const requireStub = (modulePath) => {
    const p = String(modulePath).split('\\').join('/')
    if (p.endsWith('utils/api')) {
      return {
        createActivity: () => {
          state.order.push('create')
          return Promise.resolve({ auditStatus: 'pending' })
        },
        getHomeConfig: () => Promise.resolve({})
      }
    }
    if (p.endsWith('utils/wechat')) return { uploadImages: (list) => Promise.resolve(list.map((p2, i) => 'https://cdn.example.com/img' + i + '.jpg')) }
    if (p.endsWith('utils/auth')) return { isLoggedIn: () => true, requireLogin: () => true }
    if (p.endsWith('utils/campus')) return { getDefaultCampus: () => '' }
    if (p.endsWith('utils/subscribe')) return subscribeStub
    throw new Error('unexpected require in test: ' + modulePath)
  }

  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    wx: wxStub,
    require: requireStub,
    setTimeout: (fn) => { fn(); return 0 }, // 同步执行：保证 navigateBack 可同步断言
    clearTimeout: () => {},
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'activity/publish.js' })
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
    state.backs = []
    state.redirects = []
  }
  const drain = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {}).then(() => {})
  const fillValidForm = (inst, title) => {
    inst.data.title = title
    inst.data.cover = 'tmp://cover.jpg'
  }

  // A. 点击发布：授权在建单请求前同步发起；允许 → 授权落库 → 发布成功提示
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['activityAudit'], rejected: [] }]
    const inst = makeInstance()
    fillValidForm(inst, '校园歌手大赛')
    inst.onSubmit() // onSubmit 内部是 .then 链，需排空微任务后再断言
    await drain()
    assert.deepStrictEqual(state.triggerCalls, ['activityPublish'], '必须以 activityPublish 触发点申请授权')
    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.subCalls)), [['activityAudit']])
    assert.ok(state.order.indexOf('sub') < state.order.indexOf('create'), '授权必须先于建单请求（tap 同步链）')
    assert.strictEqual(inst.data.submitting, false)
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivityAudit, true)
    assert.ok(state.toasts.indexOf('已提交审核') > -1)
    assert.strictEqual(state.backs.length, 1, '发布完成后返回上一页')
  }, 'A. 点击发布同步申请授权（允许）→ 授权落库 → 发布成功')

  // B. 拒绝：发布流程不阻塞，授权结果如实记录
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: [], rejected: ['activityAudit'] }]
    const inst = makeInstance()
    fillValidForm(inst, '拒绝授权也发布')
    inst.onSubmit()
    await drain()
    assert.strictEqual(inst.data.submitting, false)
    assert.ok(state.toasts.indexOf('已提交审核') > -1, '拒绝授权也不阻塞发布')
    const prefs = state.storage.notify_channel_prefs
    assert.strictEqual(prefs.grantedActivityAudit, false)
    assert.strictEqual(state.backs.length, 1)
  }, 'B. 用户拒绝：发布流程不阻塞，授权结果如实记录')

  // C. utils/subscribe.js 真实模板 ID、白名单与 activityPublish 触发组（源码断言）
  check(() => {
    const src = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(src.indexOf("activityAudit: 'j66trNss6jKGe35lICHMnTlErY_-r07gL72HEtIdM8I'") > -1, 'activityAudit 必须是「活动审核通知」真实 ID')
    assert.ok(/VALID_TYPES = \[[^\]]*'activityAudit'/.test(src), 'VALID_TYPES 必须包含 activityAudit')
    assert.ok(src.indexOf("activityPublish: { prefsKey: 'notify_channel_prefs', keys: ['activityAudit'], grantedKeys: ['grantedActivityAudit'] }") > -1, 'TRIGGER_GROUPS 必须定义 activityPublish 组')
  }, 'C. subscribe.js 注册了活动审核真实模板 ID、白名单与 activityPublish 触发组')

  // D. wxml/js 接线护栏（发布按钮触发点在位、旧自定义弹窗已移除）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(PAGE_DIR, 'publish.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="onSubmit"') > -1, '发布按钮必须绑定 onSubmit')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义订阅弹窗结构必须已移除')
    const js = require('fs').readFileSync(path.join(PAGE_DIR, 'publish.js'), 'utf8')
    assert.ok(js.indexOf("subscribe.requestTriggerByTap('activityPublish')") > -1, 'onSubmit 必须在 tap 同步链内调用 requestTriggerByTap')
    assert.ok(js.indexOf('showSubscribeDialog') === -1, '旧弹窗状态必须已移除')
  }, 'D. wxml/js 接线护栏（发布按钮触发点在位、旧弹窗结构已移除）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
