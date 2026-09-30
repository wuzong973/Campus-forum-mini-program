/**
 * 发布页订阅消息授权测试（无需数据库 / 无需真机）
 *
 * 需求：点击「确认发布」时在用户手势同步链内直接申请「新的评论提醒」「评论回复通知」
 * 两个模板的微信原生订阅授权（不再有自定义弹窗）；授权结果持久化并上报服务端；
 * 无论用户允许还是拒绝，发布流程都不被打断。
 *
 * 覆盖：
 *   A. 点击发布：同步发起授权（先于发布请求）→ 全部允许 → 授权结果落库 → 发布成功返回
 *   B. 全部拒绝：流程不阻塞，授权结果如实记录
 *   C. 部分允许：逐键记录 grantedXxx
 *   D. utils/subscribe.js 真实模板 ID、白名单与 postPublish 触发组（源码断言）
 *   E. wxml/js 接线护栏（点击触发点在位、旧弹窗结构已移除）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_DIR = path.join(MINI_PROGRAM_ROOT, 'pages', 'post-publish')

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
    postCalls: [],
    subCalls: [],
    subResult: [],
    triggerCalls: [],
    order: [],
    toasts: [],
    backs: [],
    loadings: []
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showLoading: (opt) => { state.loadings.push(opt && opt.title) },
    hideLoading: () => { state.loadings.push('hidden') },
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    navigateBack: () => { state.backs.push('back') },
    navigateTo: () => {},
    switchTab: () => {},
    vibrateShort: () => {}
  }

  const subscribeStub = buildSubscribeStub(state)

  const requireStub = (modulePath) => {
    const p = String(modulePath).split(path.sep).join('/')
    if (p.endsWith('utils/auth')) return { requirePublishReady: () => true }
    if (p.endsWith('utils/wechat')) {
      return {
        checkContent: () => Promise.resolve(),
        uploadImages: (list) => Promise.resolve(list),
        uploadVideo: (p2) => Promise.resolve('https://cdn.example.com/' + String(p2).replace(/[^a-z0-9]/gi, '_') + '.mp4')
      }
    }
    if (p.endsWith('utils/image')) return { chooseAndCompress: () => Promise.resolve([]) }
    if (p.endsWith('utils/request')) {
      return {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve({}),
        post: (url) => {
          state.order.push('post:' + url)
          state.postCalls.push(url)
          return Promise.resolve({})
        }
      }
    }
    if (p.endsWith('utils/api')) return { getHomeConfig: () => Promise.resolve({}) }
    if (p.endsWith('utils/anonymousIdentity')) return require(path.join(MINI_PROGRAM_ROOT, 'utils', 'anonymousIdentity.js'))
    if (p.endsWith('utils/refresh')) return { runPullDownRefresh: () => {} }
    if (p.endsWith('utils/subscribe')) return subscribeStub
    throw new Error('unexpected require in test: ' + modulePath)
  }

  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: null } }),
    wx: wxStub,
    require: requireStub,
    setTimeout: (fn) => { fn(); return 0 }, // 同步执行：保证 navigateBack 可同步断言
    clearTimeout: () => {},
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'post-publish/index.js' })
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

// =====================================================================
async function run() {
  const { makeInstance, state } = loadPage()
  const reset = () => {
    state.storage = {}
    state.postCalls = []
    state.subCalls = []
    state.subResult = []
    state.triggerCalls = []
    state.order = []
    state.toasts = []
    state.backs = []
    state.loadings = []
  }
  const fillValidForm = (inst) => {
    inst.data.content = '订阅授权测试帖'
    inst.data.categoryIndex = 0
    inst.data.canSubmit = true
  }

  // A. 点击发布：授权在发布请求前同步发起；全部允许 → 授权落库 → 发布成功返回
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['commentNew', 'commentReply'], rejected: [] }]
    const inst = makeInstance()
    fillValidForm(inst)
    await inst.onSubmit()
    assert.deepStrictEqual(state.triggerCalls, ['postPublish'], '必须以 postPublish 触发点申请授权')
    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.subCalls)), [['commentNew', 'commentReply']])
    assert.ok(state.order.indexOf('sub') < state.order.indexOf('post:/post'), '授权必须先于发布请求（tap 同步链）')
    assert.deepStrictEqual(state.postCalls, ['/post'])
    const prefs = state.storage.subscribe_comment_prefs
    assert.strictEqual(prefs.grantedCommentNew, true)
    assert.strictEqual(prefs.grantedCommentReply, true)
    assert.ok(state.toasts.indexOf('发布成功') > -1)
    assert.strictEqual(state.backs.length, 1, '发布成功后返回上一页')
  }, 'A. 点击发布同步申请授权（全部允许）→ 授权落库 → 发布成功')

  // B. 全部拒绝：发布流程不阻塞，授权结果如实记录
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: [], rejected: ['commentNew', 'commentReply'] }]
    const inst = makeInstance()
    fillValidForm(inst)
    await inst.onSubmit()
    assert.deepStrictEqual(state.postCalls, ['/post'])
    const prefs = state.storage.subscribe_comment_prefs
    assert.strictEqual(prefs.grantedCommentNew, false)
    assert.strictEqual(prefs.grantedCommentReply, false)
    assert.ok(state.toasts.indexOf('发布成功') > -1)
    assert.strictEqual(state.backs.length, 1)
  }, 'B. 用户全部拒绝：发布流程不阻塞，授权结果如实记录')

  // C. 部分允许：只允许其中一个
  await checkAsync(async () => {
    reset()
    state.subResult = [{ accepted: ['commentNew'], rejected: ['commentReply'] }]
    const inst = makeInstance()
    fillValidForm(inst)
    await inst.onSubmit()
    const prefs = state.storage.subscribe_comment_prefs
    assert.strictEqual(prefs.grantedCommentNew, true)
    assert.strictEqual(prefs.grantedCommentReply, false)
    assert.strictEqual(state.backs.length, 1, '拒绝部分模板也不阻塞发布流程')
  }, 'C. 用户只允许其中一个模板时如实记录、流程不阻塞')

  // D. utils/subscribe.js 真实模板 ID、白名单与 postPublish 触发组（源码断言）
  check(() => {
    const src = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    assert.ok(src.indexOf("commentNew: 'kDU3pivvs0kb4EtB-rJk7OuMGhOhLkGfsrvz6ob2xj4'") > -1, 'commentNew 模板 ID 必须是「新的评论提醒」真实 ID')
    assert.ok(src.indexOf("commentReply: 'YcAwFpCDmjHoNpH8jwqyCBpgu4JUD0o61Uj4Wnqd6Y0'") > -1, 'commentReply 模板 ID 必须是「评论回复通知」真实 ID')
    assert.ok(/VALID_TYPES = \[[^\]]*'commentNew'/.test(src), 'VALID_TYPES 必须包含 commentNew')
    assert.ok(/VALID_TYPES = \[[^\]]*'commentReply'/.test(src), 'VALID_TYPES 必须包含 commentReply')
    assert.ok(src.indexOf("postPublish: { prefsKey: 'subscribe_comment_prefs', keys: ['commentNew', 'commentReply'], grantedKeys: ['grantedCommentNew', 'grantedCommentReply'] }") > -1, 'TRIGGER_GROUPS 必须定义 postPublish 组（评论两键、共用键、授权映射）')
    assert.ok(src.indexOf('function requestTriggerByTap') > -1, 'requestTriggerByTap 必须存在（点击同步授权入口）')
  }, 'D. subscribe.js 注册了两个真实评论模板 ID、白名单与 postPublish 触发组')

  // E. wxml/js 接线护栏（点击触发点在位、旧自定义弹窗已移除）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="onSubmit"') > -1, '确认发布按钮必须绑定 onSubmit')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义订阅弹窗结构必须已移除')
    const js = require('fs').readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')
    assert.ok(js.indexOf("subscribe.requestTriggerByTap('postPublish')") > -1, 'onSubmit 必须在 tap 同步链内调用 requestTriggerByTap')
    assert.ok(js.indexOf('showSubscribeDialog') === -1, '旧弹窗状态必须已移除')
    assert.ok(js.indexOf("request.post('/post', payload, true)") > -1)
  }, 'E. wxml/js 接线护栏（点击触发点在位、旧弹窗结构已移除）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
