/**
 * 发布页顶部「订阅评论消息提醒」入口测试（无需数据库 / 无需真机）
 *
 * 需求：在发布帖子页顶部新增一个行式订阅入口（样式对齐「订阅活动消息提醒」）。
 *   1. 点击入口 → 直接拉起微信原生订阅弹窗，模板与「确认发布」完全一致（commentNew + commentReply）；
 *   2. 订阅生效（偏好开启 + 微信侧已授权）→ 入口从发布页顶部消失；
 *   3. 在设置页关闭「评论通知」→ 入口重新出现；
 *   4. 原有 onSubmit 的授权逻辑保持不变（本次只是复制一份，不删旧逻辑）。
 *
 * 实现要点：这里**加载真实的 utils/subscribe.js**（vm 沙箱 + 假 wx）当作页面依赖，
 * 因此 shouldShowDialog / requestTriggerByTap / persistAccepted 都是真实语义，
 * 而不是照抄一份可能走样的桩 —— 避免「测试只验证了自己写的桩」这种假绿。
 *
 * 覆盖：
 *   A. 未订阅时入口可见、开关为关
 *   B. 点击入口：同步链内拉起原生弹窗，模板 ID 与「确认发布」同组（commentNew + commentReply）
 *   C. 两个模板都允许 → 偏好与 granted 双写 → 入口隐藏
 *   D. 全部拒绝 → 入口保持可见，且不写入任何偏好（开关回正）
 *   E. 设置页关闭「评论通知」→ 重新进入页面时入口重新出现
 *   F. 只允许其中一个 → 仍保留入口（提示补全），不误导为已订阅
 *   G. 源码护栏：新入口接线在位 + onSubmit 原有逻辑与旧弹窗状态均未被改坏
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')
const fs = require('fs')

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
  fs.writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// 加载真实 utils/subscribe.js：只替换 wx 与 utils/request，其余逻辑原样执行
function loadRealSubscribe(wxStub) {
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
  const sandbox = {
    wx: wxStub,
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/utils\/request$|^\.\/request$/.test(norm)) {
        return { post: () => Promise.resolve(null), get: () => Promise.resolve(null) }
      }
      throw new Error('subscribe.js 出现未预期依赖：' + modulePath)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(source, sandbox, { filename: 'utils/subscribe.js' })
  const mod = sandbox.module.exports
  assert.ok(mod && typeof mod.requestTriggerByTap === 'function', '真实 subscribe.js 未正确导出')
  return mod
}

function loadPage() {
  const source = fs.readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')

  const state = {
    storage: {},
    triggerCalls: [],
    tmplIdsCalls: [],
    toasts: [],
    modals: [],
    // 原生弹窗结果：'accept' 全部允许 / 'reject' 全部拒绝 / 数组 = 只允许这些类型
    subMode: 'accept'
  }

  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showLoading: () => {},
    hideLoading: () => {},
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    showModal: (opt) => { state.modals.push(opt && opt.title) },
    openSetting: () => {},
    navigateBack: () => {},
    navigateTo: () => {},
    switchTab: () => {},
    vibrateShort: () => {},
    // guideReopen 依赖：返回「订阅总开关正常、无被拒模板」→ 不弹引导
    getSetting: (opt) => { opt && opt.success && opt.success({ subscriptionsSetting: { mainSwitch: true, itemSettings: {} } }) },
    requestSubscribeMessage: (opt) => {
      const ids = (opt.tmplIds || []).slice()
      state.tmplIdsCalls.push(ids)
      const accept = state.subMode
      const res = {}
      ids.forEach((id) => {
        if (accept === 'accept') res[id] = 'accept'
        else if (accept === 'reject') res[id] = 'reject'
        else res[id] = accept.indexOf(id) > -1 ? 'accept' : 'reject'
      })
      opt && opt.success && opt.success(res)
    }
  }

  const subscribeReal = loadRealSubscribe(wxStub)
  const TEMPLATE_IDS = subscribeReal.TEMPLATE_IDS
  // 记录触发点（不改语义，仅便于断言「点击入口走的是 postPublish 触发组」）。
  // requestEntryByTap 内部调用的是模块内的 requestTriggerByTap，所以两个都要包一层。
  const record = (trigger) => { state.triggerCalls.push(trigger) }
  const subscribeStub = Object.assign({}, subscribeReal, {
    requestTriggerByTap(trigger) { record(trigger); return subscribeReal.requestTriggerByTap(trigger) },
    requestEntryByTap(trigger) { record(trigger); return subscribeReal.requestEntryByTap(trigger) }
  })

  const requireStub = (modulePath) => {
    const p = String(modulePath).split(path.sep).join('/')
    if (p.endsWith('utils/auth')) return { requirePublishReady: () => true }
    if (p.endsWith('utils/wechat')) return { checkContent: () => Promise.resolve(), uploadImages: (l) => Promise.resolve(l), uploadVideo: () => Promise.resolve('https://cdn.example.com/v.mp4') }
    if (p.endsWith('utils/image')) return { chooseAndCompress: () => Promise.resolve([]) }
    if (p.endsWith('utils/request')) return { get: () => Promise.resolve(null), put: () => Promise.resolve({}), post: () => Promise.resolve({}) }
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
    setTimeout: (fn) => { fn(); return 0 },
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
  return { makeInstance, state, TEMPLATE_IDS }
}

const COMMENT_KEYS = ['commentNew', 'commentReply']
const GRANT_KEYS = ['grantedCommentNew', 'grantedCommentReply']
const PREFS_KEY = 'subscribe_comment_prefs'

async function run() {
  const { makeInstance, state, TEMPLATE_IDS } = loadPage()
  const COMMENT_IDS = COMMENT_KEYS.map((k) => TEMPLATE_IDS[k])

  const reset = () => {
    state.storage = {}
    state.triggerCalls = []
    state.tmplIdsCalls = []
    state.toasts = []
    state.modals = []
    state.subMode = 'accept'
  }
  // 模拟「进入发布页」：onShow 会重算入口显隐
  const enterPage = async (inst) => {
    await inst.onShow()
    return inst
  }

  // A. 未订阅：入口可见、开关为关
  await checkAsync(async () => {
    reset()
    const inst = await enterPage(makeInstance())
    assert.strictEqual(inst.data.showCommentSubscribeEntry, true, '未订阅时入口必须可见')
    assert.strictEqual(inst.data.commentSubscribeChecked, false, '未订阅时开关必须是关')
  }, 'A. 未订阅时入口可见且开关为关')

  // B. 点击入口 → 同步链内拉起原生弹窗，模板与「确认发布」同组
  await checkAsync(async () => {
    reset()
    const inst = await enterPage(makeInstance())
    await inst.applyCommentSubscribe()
    assert.deepStrictEqual(state.triggerCalls, ['postPublish'], '入口必须复用 postPublish 触发组（与确认发布一致）')
    assert.strictEqual(state.tmplIdsCalls.length, 1, '必须同步拉起一次原生订阅弹窗')
    assert.deepStrictEqual(plain(state.tmplIdsCalls[0]), COMMENT_IDS, '模板 ID 必须是评论两模板：commentNew + commentReply')
  }, 'B. 点击入口拉起原生弹窗，模板与「确认发布」一致')

  // C. 两个模板都允许 → 偏好 + granted 双写 → 入口隐藏
  await checkAsync(async () => {
    reset()
    const inst = await enterPage(makeInstance())
    state.subMode = 'accept'
    await inst.applyCommentSubscribe()
    const prefs = state.storage[PREFS_KEY]
    assert.strictEqual(prefs.commentNew, true, '允许后必须同步开启「评论通知」偏好（与设置页共用存储）')
    assert.strictEqual(prefs.commentReply, true)
    assert.strictEqual(prefs.grantedCommentNew, true, '授权结果必须落库')
    assert.strictEqual(prefs.grantedCommentReply, true)
    assert.strictEqual(inst.data.showCommentSubscribeEntry, false, '订阅生效后入口必须隐藏')
    assert.strictEqual(inst.data.commentSubscribeChecked, false, '入口隐藏后开关状态归零')
  }, 'C. 全部允许 → 偏好与授权双写 → 入口隐藏')

  // D. 全部拒绝 → 入口保持可见且不写偏好
  await checkAsync(async () => {
    reset()
    const inst = await enterPage(makeInstance())
    state.subMode = 'reject'
    await inst.applyCommentSubscribe()
    const prefs = state.storage[PREFS_KEY] || {}
    assert.strictEqual(prefs.commentNew === true, false, '被拒时不得把「评论通知」偏好写成开启')
    assert.strictEqual(prefs.commentReply === true, false)
    assert.strictEqual(prefs.grantedCommentNew, false, '被拒结果必须如实落库')
    assert.strictEqual(inst.data.showCommentSubscribeEntry, true, '拒绝后入口必须保留，给用户再次授权机会')
    assert.strictEqual(inst.data.commentSubscribeChecked, false, '被拒后开关必须回正为关')
  }, 'D. 全部拒绝 → 入口保留且不写偏好')

  // E. 设置页关闭「评论通知」→ 重新进入页面时入口重新出现
  await checkAsync(async () => {
    reset()
    const first = await enterPage(makeInstance())
    state.subMode = 'accept'
    await first.applyCommentSubscribe()
    assert.strictEqual(first.data.showCommentSubscribeEntry, false, '前置：订阅后入口已隐藏')

    // 用户在设置页关闭「评论通知」（设置页写同一份存储）
    const prefs = Object.assign({}, state.storage[PREFS_KEY])
    prefs.commentNew = false
    prefs.commentReply = false
    state.storage[PREFS_KEY] = prefs

    const second = await enterPage(makeInstance())
    assert.strictEqual(second.data.showCommentSubscribeEntry, true, '关闭订阅后重新进入页面，入口必须重新显示')
  }, 'E. 设置页关闭「评论通知」后入口重新显示')

  // F. 只允许其中一个 → 入口保留（不误导为已订阅）
  await checkAsync(async () => {
    reset()
    const inst = await enterPage(makeInstance())
    state.subMode = [COMMENT_IDS[0]]
    await inst.applyCommentSubscribe()
    const prefs = state.storage[PREFS_KEY]
    assert.strictEqual(prefs.grantedCommentNew, true, '允许的项如实落库')
    assert.strictEqual(prefs.grantedCommentReply, false)
    assert.strictEqual(prefs.commentReply === true, false, '未允许的项不得写成开启')
    assert.strictEqual(inst.data.showCommentSubscribeEntry, true, '只允许部分模板时入口必须保留（提示补齐另一项）')
  }, 'F. 部分允许时入口保留，只有两项都生效才隐藏')

  // G. 源码护栏
  check(() => {
    const wxml = fs.readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8')
    const js = fs.readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="onTapCommentSubscribe"') > -1, '入口行必须绑定 onTapCommentSubscribe')
    assert.ok(wxml.indexOf('bindchange="onTapCommentSubscribe"') > -1, '开关必须绑定 onTapCommentSubscribe（与其余 7 页同一写法）')
    assert.ok(wxml.indexOf('wx:if="{{showCommentSubscribeEntry}}"') > -1, '入口必须由 showCommentSubscribeEntry 控制显隐')
    assert.ok(js.indexOf("subscribe.entryVisible('postPublish')") > -1, '显隐口径必须复用 entryVisible(postPublish)')
    assert.ok(js.indexOf("subscribe.requestEntryByTap('postPublish')") > -1, '入口必须在 tap 同步链内调用 requestEntryByTap')
    // 原有逻辑不许被删：onSubmit 内的授权触发与发布请求都还在，且授权仍先于发布请求
    const submitAt = js.indexOf('async onSubmit()')
    assert.ok(submitAt > -1, 'onSubmit 必须存在')
    const tapAt = js.indexOf("subscribe.requestTriggerByTap('postPublish')", submitAt)
    const postAt = js.indexOf("request.post('/post', payload, true)", submitAt)
    assert.ok(tapAt > -1, 'onSubmit 原有授权触发必须保留')
    assert.ok(postAt > -1, 'onSubmit 原有发布请求必须保留')
    assert.ok(tapAt < postAt, 'onSubmit 内授权仍必须先于发布请求（tap 同步链）')
    // 入口必须在页面顶部（编辑器卡片之前）
    assert.ok(wxml.indexOf('sub-notice-card') > -1 && wxml.indexOf('sub-notice-card') < wxml.indexOf('editor-card'), '订阅入口必须位于发布页顶部（编辑器卡片之前）')
    assert.ok(wxml.indexOf('bindtap="onSubmit"') > -1, '确认发布按钮绑定未变')
    assert.ok(js.indexOf('showSubscribeDialog') === -1, '旧自定义弹窗状态名不得回归')
    assert.ok(wxml.indexOf('sub-dialog') === -1, '旧自定义弹窗结构不得回归')
  }, 'G. 源码护栏：新入口接线在位，旧逻辑未被改动')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
