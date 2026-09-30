/**
 * 页面顶部「通知设置入口」全量测试（无需数据库 / 无需真机）
 *
 * 覆盖 8 处入口：钱包(withdraw)、校园活动(activityIndex)、发布活动(activityPublish)、
 * 活动详情(activitySignup)、骑手认证(riderVerify)、发布跑腿(errandPublish)、
 * 私信聊天(message)、发布帖子(postPublish)。
 *
 * 为什么这样切分测试：
 * - 8 个入口的行为逻辑**只有一份**（utils/subscribe.js 的 requestEntryByTap / entryVisible），
 *   页面只是薄薄一层接线。所以「行为」在这里对 8 个触发点全量跑真实模块；
 *   「接线」逐页做静态护栏。避免把同一套逻辑在 8 个测试文件里各抄一遍桩。
 * - 真实模块加载（vm + 假 wx）保证测的不是自己写的桩；模板 ID 也是真的。
 *
 * 覆盖：
 *   A. 每个触发组：未订阅可见 → 点击拉起原生弹窗（模板 ID 与该组 keys 一一对应）
 *   B. 全部允许 → 偏好键与 granted 键双写 → 入口隐藏
 *   C. 全部拒绝 → 不写偏好、入口保留，并节流引导去设置页（同一节流窗口内只引导一次）
 *   D. 只允许部分 → 入口保留（提示补齐）
 *   E. 设置页关闭渠道（偏好键置 false）→ 入口重新出现
 *   F. 未知触发点 / 模板 ID 缺失时不炸、不误调原生 API
  *   G. 八页接线护栏（聊天详情页入口已移除，见 G2）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')
const fs = require('fs')

const ROOT = path.join(__dirname, '..', '..')

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

function plain(value) { return JSON.parse(JSON.stringify(value)) }
function countOf(source, sub) { return source.split(sub).length - 1 }

// 八个触发点的预期配置（与 utils/subscribe.js 的 TRIGGER_GROUPS 对应）
const TRIGGERS = [
  { trigger: 'postPublish', prefsKey: 'subscribe_comment_prefs', keys: ['commentNew', 'commentReply'] },
  { trigger: 'withdraw', prefsKey: 'notify_channel_prefs', keys: ['withdrawSuccess', 'withdrawResult'] },
  { trigger: 'activityIndex', prefsKey: 'notify_channel_prefs', keys: ['activityNew', 'activityJoined', 'activitySignupNotice'] },
  { trigger: 'activityPublish', prefsKey: 'notify_channel_prefs', keys: ['activityAudit'] },
  { trigger: 'activitySignup', prefsKey: 'notify_channel_prefs', keys: ['activitySignupResult', 'activityStart', 'activitySignup'] },
  { trigger: 'riderVerify', prefsKey: 'notify_channel_prefs', keys: ['auditCert', 'audit', 'auditPass'] },
  { trigger: 'errandPublish', prefsKey: 'notify_channel_prefs', keys: ['errandAccepted', 'errandFinished', 'errandCancelled'] },
  { trigger: 'message', prefsKey: 'notify_channel_prefs', keys: ['message'] }
]

// 页面接线清单：入口结构 + 原有触发点必须仍在
const PAGE_WIRING = [
  { page: '钱包页', file: 'pages/wallet/index', trigger: 'withdraw', visibleKey: 'showWithdrawSubscribeEntry', checkedKey: 'withdrawSubscribeChecked', tap: 'onWithdrawSubscribeTap', refresh: 'refreshWithdrawSubscribeEntry', title: '订阅提现结果提醒', legacy: "subscribe.requestTriggerByTap('withdraw')", legacyCount: 1 },
  { page: '校园活动页', file: 'pages/activity/index', trigger: 'activityIndex', visibleKey: 'showActivityIndexSubscribeEntry', checkedKey: 'activityIndexSubscribeChecked', tap: 'onActivityIndexSubscribeTap', refresh: 'refreshActivityIndexSubscribeEntry', title: '订阅活动消息提醒', legacy: "subscribe.requestTriggerByTap('activityIndex')", legacyCount: 2 },
  { page: '发布活动页', file: 'pages/activity/publish', trigger: 'activityPublish', visibleKey: 'showActivityPublishSubscribeEntry', checkedKey: 'activityPublishSubscribeChecked', tap: 'onActivityPublishSubscribeTap', refresh: 'refreshActivityPublishSubscribeEntry', title: '订阅活动审核提醒', legacy: "subscribe.requestTriggerByTap('activityPublish')", legacyCount: 1 },
  { page: '活动详情页', file: 'pages/activity/detail', trigger: 'activitySignup', visibleKey: 'showActivitySignupSubscribeEntry', checkedKey: 'activitySignupSubscribeChecked', tap: 'onActivitySignupSubscribeTap', refresh: 'refreshActivitySignupSubscribeEntry', title: '订阅活动结果提醒', legacy: "subscribe.requestTriggerByTap('activitySignup')", legacyCount: 1 },
  { page: '骑手认证页', file: 'pages/rider-verify/index', trigger: 'riderVerify', visibleKey: 'showRiderVerifySubscribeEntry', checkedKey: 'riderVerifySubscribeChecked', tap: 'onRiderVerifySubscribeTap', refresh: 'refreshRiderVerifySubscribeEntry', title: '订阅审核结果提醒', legacy: "subscribe.requestTriggerByTap('riderVerify')", legacyCount: 2 },
  { page: '发布跑腿页', file: 'pages/errand-publish/index', trigger: 'errandPublish', visibleKey: 'showErrandPublishSubscribeEntry', checkedKey: 'errandPublishSubscribeChecked', tap: 'onErrandPublishSubscribeTap', refresh: 'refreshErrandPublishSubscribeEntry', title: '订阅跑腿订单提醒', legacy: "subscribe.requestTriggerByTap('errandPublish')", legacyCount: 1 },
  { page: '消息列表页', file: 'pages/my-messages/index', trigger: 'message', visibleKey: 'showMessageSubscribeEntry', checkedKey: 'messageSubscribeChecked', tap: 'onMessageSubscribeTap', refresh: 'refreshMessageSubscribeEntry', title: '订阅私信消息提醒', keepJs: ['loadConversations()', 'loadInteractMessages(', 'messageStore.syncUnreadCount()', 'TAB_INDEX_SQUAT'], keepWxml: ['bindtap="onTab"', 'bindtap="onOpenChat"', 'class="conv-list"'] },
  { page: '发布帖子页', file: 'pages/post-publish/index', trigger: 'postPublish', visibleKey: 'showCommentSubscribeEntry', checkedKey: 'commentSubscribeChecked', tap: 'onTapCommentSubscribe', refresh: 'refreshCommentSubscribeEntry', title: '订阅评论消息提醒', legacy: "subscribe.requestTriggerByTap('postPublish')", legacyCount: 1 }
]

function buildWxStub(state) {
  return {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showModal: (opt) => { state.modals.push(opt && opt.title) },
    openSetting: () => { state.openSettings++ },
    showToast: (opt) => { state.toasts.push(opt && opt.title) },
    // guideReopen 依赖：state.wechatRejected=true 表示微信侧已「总是拒绝」（弹窗不再出现）
    getSetting: (opt) => {
      const itemSettings = {}
      if (state.wechatRejected !== false) {
        Object.keys(state.templateIds).forEach((k) => { itemSettings[state.templateIds[k]] = 'reject' })
      }
      opt && opt.success && opt.success({ subscriptionsSetting: { mainSwitch: true, itemSettings } })
    },
    // 原生订阅弹窗：按 state.subMode 决定每项 accept / reject；state.subFail=true 模拟接口失败
    requestSubscribeMessage: (opt) => {
      const ids = (opt.tmplIds || []).slice()
      state.tmplIdCalls.push(ids)
      if (state.subFail) {
        opt && opt.fail && opt.fail({ errMsg: state.subFail })
        return
      }
      const mode = state.subMode
      const res = {}
      ids.forEach((id) => {
        if (mode === 'accept') res[id] = 'accept'
        else if (mode === 'reject') res[id] = 'reject'
        else res[id] = mode.indexOf(id) > -1 ? 'accept' : 'reject'
      })
      opt && opt.success && opt.success(res)
    }
  }
}

function loadRealSubscribe(wxStub, state) {
  const source = fs.readFileSync(path.join(ROOT, 'utils', 'subscribe.js'), 'utf8')
  const sandbox = {
    wx: wxStub,
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/utils\/request$|^\.\/request$/.test(norm)) return { post: () => Promise.resolve(null), get: () => Promise.resolve(state.quotaResponse || null) }
      throw new Error('subscribe.js 出现未预期依赖：' + modulePath)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(source, sandbox, { filename: 'utils/subscribe.js' })
  const mod = sandbox.module.exports
  assert.ok(mod && typeof mod.requestEntryByTap === 'function', '真实 subscribe.js 未导出 requestEntryByTap')
  state.templateIds = mod.TEMPLATE_IDS
  return mod
}

async function run() {
  const state = { storage: {}, tmplIdCalls: [], modals: [], toasts: [], openSettings: 0, subMode: 'accept', templateIds: {}, quotaResponse: null, wechatRejected: true, subFail: '' }
  const wxStub = buildWxStub(state)
  const sub = loadRealSubscribe(wxStub, state)
  const idsOf = (keys) => keys.map((k) => sub.TEMPLATE_IDS[k])

  const reset = (mode) => {
    state.storage = {}
    state.tmplIdCalls = []
    state.modals = []
    state.toasts = []
    state.openSettings = 0
    state.subMode = mode || 'accept'
    state.quotaResponse = null
    state.wechatRejected = true
    state.subFail = ''
  }
  const grantKeysOf = (trigger) => sub.TRIGGER_GROUPS[trigger].grantedKeys

  // A + B + C + D + E：对八个触发点逐一跑完整生命周期
  for (const cfg of TRIGGERS) {
    await checkAsync(async () => {
      const { trigger, prefsKey, keys } = cfg
      const grantedKeys = grantKeysOf(trigger)

      // A. 未订阅 → 可见
      reset('accept')
      assert.strictEqual(sub.entryVisible(trigger), true, trigger + '：未订阅时入口必须可见')

      // A. 点击 → 拉起原生弹窗，模板 ID 与该组 keys 一一对应
      await sub.requestEntryByTap(trigger)
      assert.strictEqual(state.tmplIdCalls.length, 1, trigger + '：必须拉起一次原生订阅弹窗')
      assert.deepStrictEqual(plain(state.tmplIdCalls[0]), idsOf(keys), trigger + '：模板 ID 必须与该触发组 keys 一一对应')

      // B. 全部允许 → 偏好 + granted 双写 → 隐藏
      const prefs = state.storage[prefsKey]
      keys.forEach((k) => assert.strictEqual(prefs[k], true, trigger + '：允许后必须写偏好 ' + k))
      grantedKeys.forEach((g) => assert.strictEqual(prefs[g], true, trigger + '：授权结果必须落库 ' + g))
      assert.strictEqual(sub.entryVisible(trigger), false, trigger + '：订阅生效后入口必须隐藏')

      // E. 设置页关闭该渠道（偏好键置 false）→ 重新出现
      const off = Object.assign({}, prefs)
      keys.forEach((k) => { off[k] = false })
      state.storage[prefsKey] = off
      assert.strictEqual(sub.entryVisible(trigger), true, trigger + '：关闭订阅后入口必须重新显示')

      // C. 全部拒绝 → 不写偏好、入口保留、节流引导去设置页
      reset('reject')
      await sub.requestEntryByTap(trigger)
      const afterReject = state.storage[prefsKey] || {}
      keys.forEach((k) => {
        assert.strictEqual(afterReject[k] === true, false, trigger + '：被拒时不得把偏好 ' + k + ' 写成开启')
      })
      assert.strictEqual(sub.entryVisible(trigger), true, trigger + '：拒绝后入口必须保留')
      assert.strictEqual(state.modals.length, 1, trigger + '：被拒且微信侧「总是拒绝」时必须引导去设置页')
      // 主动点击**刻意不节流**：用户自己点订阅入口却什么都看不到，就会被理解成「开关坏了/自动关闭」。
      // 节流只用于被动触达（如聊天页发送时顺带引导）。
      await sub.requestEntryByTap(trigger)
      assert.strictEqual(state.modals.length, 2, trigger + '：主动点击入口不得被节流，每次都要给出引导')

      // D. 只允许其中一个 → 入口保留（单键触发组无「部分」概念，跳过）
      if (keys.length > 1) {
        reset([idsOf(keys)[0]])
        await sub.requestEntryByTap(trigger)
        assert.strictEqual(sub.entryVisible(trigger), true, trigger + '：只允许部分模板时入口必须保留')
        const partial = state.storage[prefsKey]
        assert.strictEqual(partial[keys[0]], true, trigger + '：允许的项要写偏好')
        assert.strictEqual(partial[keys[1]] === true, false, trigger + '：未允许的项不得写偏好')
      }
    }, 'A–E. ' + cfg.trigger + '：可见 → 弹原生窗 → 允许后隐藏 → 关闭后恢复 → 拒绝不写偏好')
  }

  // F. 异常输入不炸、不误调原生 API
  await checkAsync(async () => {
    reset('accept')
    const before = state.tmplIdCalls.length
    const res = await sub.requestEntryByTap('notARealTrigger')
    assert.deepStrictEqual(plain(res), { accepted: [], rejected: [], guided: false }, '未知触发点必须返回空结果')
    assert.strictEqual(state.tmplIdCalls.length, before, '未知触发点不得调用原生 API')
    assert.strictEqual(sub.entryVisible('notARealTrigger'), false, '未知触发点入口必须不显示')
  }, 'F. 未知触发点：不炸、不调用原生 API、入口不显示')

  // F2. 额度耗尽后入口必须重新出现（只做本地判定会漏掉这种情况）
  await checkAsync(async () => {
    const trigger = 'withdraw'
    const keys = ['withdrawSuccess', 'withdrawResult']
    const rule = sub.TRIGGER_GROUPS[trigger]
    reset('accept')
    // 本地：偏好开启 + 已授权 → 纯本地判定认为「已订阅」，入口隐藏
    const prefs = {}
    keys.forEach((k) => { prefs[k] = true })
    rule.grantedKeys.forEach((g) => { prefs[g] = true })
    state.storage[rule.prefsKey] = prefs
    assert.strictEqual(sub.entryVisible(trigger), false, '前置：本地判定认为已订阅')

    // 服务端额度已耗尽 → 入口必须重新出现，否则用户无从知道要重新订阅
    state.quotaResponse = { withdrawSuccess: 0, withdrawResult: 0 }
    assert.strictEqual(await sub.entryVisibleAsync(trigger), true, '额度耗尽后入口必须重新显示')

    // 额度充足 → 保持隐藏
    state.quotaResponse = { withdrawSuccess: 3, withdrawResult: 2 }
    assert.strictEqual(await sub.entryVisibleAsync(trigger), false, '额度充足时入口保持隐藏')

    // 组内任一项没额度都发不出去 → 也要重新引导
    state.quotaResponse = { withdrawSuccess: 3, withdrawResult: 0 }
    assert.strictEqual(await sub.entryVisibleAsync(trigger), true, '组内任一项额度为 0 就应重新引导')

    // 额度接口异常（返回 null）时回落本地判定，不能误显示
    state.quotaResponse = null
    assert.strictEqual(await sub.entryVisibleAsync(trigger), false, '额度接口异常时回落本地判定，不误显示')
  }, 'F2. 额度耗尽后 entryVisibleAsync 让入口重新出现（额度充足/接口异常均正确处理）')

  // F3. 「点了没反应 / 开关自动弹回」的三种成因都必须有可见反馈
  await checkAsync(async () => {
    const trigger = 'postPublish'
    const requested = sub.TRIGGER_GROUPS[trigger].keys.length

    // 成因①：微信侧已「总是拒绝」，原生弹窗不再出现，静默返回 reject
    reset('reject')
    state.wechatRejected = true
    let res = await sub.requestEntryByTap(trigger)
    assert.strictEqual(res.guided, true, '微信侧「总是拒绝」时必须弹引导弹窗')
    assert.strictEqual(state.modals.length, 1, '必须出现引导弹窗，而不是静默回弹')
    assert.strictEqual(state.toasts.length, 0, '已弹引导时不再叠加 toast')

    // 成因②：微信侧正常，但用户本次在弹窗里没勾全 → 必须给出**可操作**的提示
    reset('reject')
    state.wechatRejected = false
    res = await sub.requestEntryByTap(trigger)
    assert.strictEqual(res.guided, false, '微信侧未被禁时不该弹引导')
    assert.strictEqual(state.modals.length, 0)
    assert.strictEqual(state.toasts.length, 1, '用户本次没勾全必须给出可见反馈')
    // 全部未勾：提示要讲清"进弹窗后逐项勾上"，否则用户只会反复点、反复失败
    assert.strictEqual(state.toasts[0], '未勾选，再点一次逐项勾上')
    assert.ok(state.toasts[0].indexOf('逐项勾上') > -1, '提示必须教用户怎么做，不能只说「部分未开启」')

    // 成因③：接口失败（如 20004 总开关关闭）→ 走 requestSubscribe 的 toast，且不再叠加引导弹窗
    reset('reject')
    state.subFail = 'requestSubscribeMessage:fail 20004'
    res = await sub.requestEntryByTap(trigger)
    assert.strictEqual(res.failed, true, '失败必须如实标记，避免调用方重复提示')
    assert.strictEqual(state.toasts.length, 1, '失败时给出一次提示')
    assert.strictEqual(state.modals.length, 0, '失败时不得再叠加一层引导弹窗')

    // 全部允许：不打扰（入口会整体隐藏）
    reset('accept')
    res = await sub.requestEntryByTap(trigger)
    assert.strictEqual(res.rejected.length, 0)
    assert.strictEqual(state.modals.length + state.toasts.length, 0, '全部允许时不应有任何提示')

    // 部分允许：入口保留，提示必须**点名是哪一项**没勾上（截图里那句「部分未开启」就是反例）
    reset([sub.TEMPLATE_IDS[sub.TRIGGER_GROUPS[trigger].keys[0]]])
    state.wechatRejected = false
    res = await sub.requestEntryByTap(trigger)
    assert.strictEqual(res.rejected.length, requested - 1)
    assert.strictEqual(state.toasts.length, 1, '部分允许要给「再点一次勾上」的提示')
    const missingType = res.rejected[0]
    assert.ok(
      state.toasts[0].indexOf(sub.TPL_LABELS[missingType]) > -1,
      '提示必须点名漏掉的那一项（' + sub.TPL_LABELS[missingType] + '），实际文案：' + state.toasts[0]
    )
    assert.ok(state.toasts[0].indexOf('未勾选') > -1, '要说清是"未勾选"，而不是含糊的"部分未开启"')
  }, 'F3. 静默回弹的三种成因都有可见反馈（引导弹窗 / 点名式 toast / 不重复叠加）')

  // F4. 补齐时「弹窗里只出现缺的那一项」（本需求的核心验收点）
  await checkAsync(async () => {
    const trigger = 'postPublish'
    const rule = sub.TRIGGER_GROUPS[trigger]
    // ⚠️ rule.keys 来自 vm 沙箱，其 Array 原型与外层不同，deepStrictEqual 会因原型不一致而失败；
    // 一律先过 plain() 转成本层数组再比较。
    const keys = plain(rule.keys)                // ['commentNew', 'commentReply']
    const ids = keys.map((k) => sub.TEMPLATE_IDS[k])

    // 第 1 次点击：两项都还没允许 → 弹窗要展示整组；用户只勾了第 1 项
    reset([ids[0]])
    state.wechatRejected = false
    await sub.requestEntryByTap(trigger)
    assert.strictEqual(state.tmplIdCalls.length, 1, '第一次点击应弹出一次原生弹窗')
    assert.deepStrictEqual(plain(state.tmplIdCalls[0]), ids, '第一次应展示整组（此时两项都还没允许）')
    assert.strictEqual(state.storage[rule.prefsKey].grantedCommentNew, true, '已勾选的那项要落库')

    // 第 2 次点击：**只申请缺的那一项** → 弹窗里只剩它，用户不可能再漏
    await sub.requestEntryByTap(trigger)
    assert.strictEqual(state.tmplIdCalls.length, 2, '第二次点击必须再次弹出原生弹窗')
    assert.deepStrictEqual(
      plain(state.tmplIdCalls[1]), [ids[1]],
      '第二次弹窗只应包含「未勾选」的那一项（当前实现是整组塞进去导致反复漏勾）'
    )

    // 勾上后入口隐藏（两项都已允许）
    state.subMode = 'accept'
    await sub.requestEntryByTap(trigger)
    assert.deepStrictEqual(plain(state.tmplIdCalls[2]), [ids[1]], '补齐仍只申请缺的项')
    assert.strictEqual(sub.entryVisible(trigger), false, '两项都允许后入口应隐藏')

    // 特例：整组已授权、入口因「额度耗尽」重现 → 应申请整组，让用户重新攒额度
    const grantedPrefs = {}
    keys.forEach((k) => { grantedPrefs[k] = true })
    rule.grantedKeys.forEach((g) => { grantedPrefs[g] = true })
    state.storage[rule.prefsKey] = grantedPrefs
    assert.deepStrictEqual(
      plain(sub.pendingTypesFor(trigger)), keys,
      '整组已授权时没有「缺的项」，应回退为申请整组（额度耗尽后重新订阅）'
    )
  }, 'F4. 补齐时弹窗只包含未勾选的那一项；额度耗尽场景回退为整组')

  // G. 八页接线护栏
  check(() => {
    assert.strictEqual(PAGE_WIRING.length, 8, '八个页面入口必须齐备（聊天详情页已按要求移除，改用消息列表页）')
    PAGE_WIRING.forEach((cfg) => {
      const wxml = fs.readFileSync(path.join(ROOT, cfg.file + '.wxml'), 'utf8')
      const js = fs.readFileSync(path.join(ROOT, cfg.file + '.js'), 'utf8')
      const label = cfg.page + '(' + cfg.file + ')'

      // 允许 wx:if 里带附加条件（如消息列表页限定在「私信」tab 下显示），只要由该键控制显隐即可
      assert.ok(
        new RegExp('wx:if="\\{\\{[^"]*' + cfg.visibleKey + '[^"]*\\}\\}"').test(wxml),
        label + '：入口必须由 ' + cfg.visibleKey + ' 控制显隐'
      )
      assert.ok(wxml.indexOf('bindtap="' + cfg.tap + '"') > -1, label + '：入口文字区必须绑定 ' + cfg.tap)
      assert.ok(wxml.indexOf('bindchange="' + cfg.tap + '"') > -1, label + '：开关必须绑定 ' + cfg.tap)
      assert.ok(wxml.indexOf('class="sub-notice-card"') > -1, label + '：必须使用共用的 sub-notice-card 样式')
      assert.ok(wxml.indexOf(cfg.title) > -1, label + '：入口文案必须存在（' + cfg.title + '）')

      assert.ok(js.indexOf(cfg.visibleKey + ': false') > -1, label + '：data 必须声明 ' + cfg.visibleKey)
      assert.ok(js.indexOf(cfg.checkedKey + ': false') > -1, label + '：data 必须声明 ' + cfg.checkedKey)
      assert.ok(js.indexOf(cfg.refresh + '()') > -1, label + '：必须定义 ' + cfg.refresh)
      assert.ok(js.indexOf('onShow()') > -1 && js.indexOf(cfg.refresh + '()') > -1, label + '：onShow 必须刷新入口显隐')
      assert.ok(js.indexOf('refresh' + cfg.refresh.slice('refresh'.length) + '()') > -1 || js.indexOf(cfg.refresh + '()') > -1, label + '：刷新方法名一致')
      assert.ok(js.indexOf(cfg.tap + '(e)') > -1, label + '：必须定义处理器 ' + cfg.tap)
      assert.ok(js.indexOf("entryVisible('" + cfg.trigger + "')") > -1, label + '：显隐口径必须复用 entryVisible(' + cfg.trigger + ')')
      assert.ok(js.indexOf("entryVisibleAsync('" + cfg.trigger + "')") > -1, label + '：必须用 entryVisibleAsync(' + cfg.trigger + ') 复核服务端额度（额度耗尽后入口要能回来）')
      assert.ok(js.indexOf("requestEntryByTap('" + cfg.trigger + "')") > -1, label + '：点击必须复用 requestEntryByTap(' + cfg.trigger + ')')

      // 原有逻辑一个都不能删
      // 原有订阅触发点必须一个不少（仅对本来就有触发点的页面断言）
      if (cfg.legacy) {
        const legacyHits = countOf(js, cfg.legacy)
        assert.strictEqual(legacyHits, cfg.legacyCount, label + '：原有触发点 ' + cfg.legacy + ' 必须保留 ' + cfg.legacyCount + ' 处（实际 ' + legacyHits + '）')
      }
      // 该页原有的 JS / WXML 接线也必须原封不动（要求「保留原有逻辑，不要删除既有代码」）
      ;(cfg.keepJs || []).forEach((marker) => {
        assert.ok(js.indexOf(marker) > -1, label + '：既有 JS 逻辑不得删除 → ' + marker)
      })
      ;(cfg.keepWxml || []).forEach((marker) => {
        assert.ok(wxml.indexOf(marker) > -1, label + '：既有 WXML 接线不得删除 → ' + marker)
      })
    })
  }, 'G. 八页接线护栏（入口结构在位 + 既有逻辑一个未删）')

  // G2. 聊天详情页的顶部入口已按要求移除，但原有「发送」时的授权触发必须保留
  check(() => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages', 'chat', 'index.wxml'), 'utf8')
    const js = fs.readFileSync(path.join(ROOT, 'pages', 'chat', 'index.js'), 'utf8')
    const wxss = fs.readFileSync(path.join(ROOT, 'pages', 'chat', 'index.wxss'), 'utf8')
    assert.strictEqual(wxml.indexOf('sub-notice-card'), -1, '聊天详情页不应再有通知设置入口（已挪到消息列表页）')
    assert.strictEqual(js.indexOf('showMessageSubscribeEntry'), -1, '入口的 data 字段应与入口一并移除，不留死代码')
    assert.strictEqual(js.indexOf('onMessageSubscribeTap'), -1, '入口的点击处理函数应与入口一并移除，不留死代码')
    assert.strictEqual(wxss.indexOf('sub-notice-card'), -1, '该页为入口写的样式覆盖也应清掉')
    // 关键：原有 onSend 里的授权触发属于既有逻辑，绝不能被顺手删掉
    assert.strictEqual(
      countOf(js, "subscribe.requestTriggerByTap('message')"), 1,
      '原有「发送」时的 requestTriggerByTap(\'message\') 必须保留'
    )
    assert.strictEqual(
      countOf(js, "subscribe.guideReopen(['message']"), 1,
      '原有发送被拒时的引导逻辑（带节流键）必须保留'
    )
  }, 'G2. 聊天详情页入口已移除且无死代码；原有 onSend 授权触发与引导逻辑保留')

  // H. 渠道名表齐备（被拒引导的文案与节流键都依赖它）
  check(() => {
    TRIGGERS.forEach((cfg) => {
      const meta = sub.TRIGGER_CHANNEL[cfg.trigger]
      assert.ok(meta, 'TRIGGER_CHANNEL 必须覆盖 ' + cfg.trigger)
      assert.ok(meta.label, cfg.trigger + ' 必须有渠道名（guideReopen 文案）')
      assert.ok(meta.throttleKey, cfg.trigger + ' 必须有节流键')
    })
    const throttleKeys = TRIGGERS.map((c) => sub.TRIGGER_CHANNEL[c.trigger].throttleKey)
    assert.strictEqual(new Set(throttleKeys).size, TRIGGERS.length, '节流键必须互不相同，否则两个渠道会互相压制引导')
  }, 'H. TRIGGER_CHANNEL 八个触发点的渠道名与节流键齐备且互不冲突')

  // I. TRIGGER_CHANNEL 的渠道名必须与设置页真实渠道名一致（两侧漂移会让引导文案指向错误的开关）
  check(() => {
    const channels = loadSettingsChannels()
    TRIGGERS.forEach((cfg) => {
      const subKeys = sub.TRIGGER_GROUPS[cfg.trigger].keys
      const channel = channels.find((ch) => subKeys.every((k) => ch.subKeys.indexOf(k) > -1))
      assert.ok(channel, cfg.trigger + ' 的开关必须能在设置页找到归属渠道')
      assert.strictEqual(sub.TRIGGER_CHANNEL[cfg.trigger].label, channel.name, cfg.trigger + ' 的引导文案渠道名必须与设置页渠道名一致（设置页为「' + channel.name + '」）')
    })
  }, 'I. TRIGGER_CHANNEL 渠道名与设置页渠道名一一对齐')
}

// 加载设置页，取出真实的通知渠道结构（名称 + 子开关），用于与 TRIGGER_CHANNEL 对齐
function loadSettingsChannels() {
  const source = fs.readFileSync(path.join(ROOT, 'pages', 'settings', 'index.js'), 'utf8')
  const state = { storage: {} }
  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] }
  }
  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    wx: wxStub,
    require: (modulePath) => {
      const norm = String(modulePath).split(path.sep).join('/')
      if (/utils\/hot-rank$/.test(norm)) return { isDailyHotVisible: () => true, setDailyHotVisible: () => {} }
      if (/utils\/subscribe$/.test(norm)) return { requestSubscribe: () => Promise.resolve({ accepted: [], rejected: [] }) }
      // 卡片动效开关与订阅无关，桩里返回默认开启（settings 页 onLoad 会读）
      if (/utils\/motion$/.test(norm)) return { isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false, isLowEndDevice: () => false, getBenchmarkLevel: () => -1 }
      // 本测试只做接线护栏断言，不实际发请求
      if (/utils\/request$/.test(norm)) return { get: () => Promise.resolve(null), post: () => Promise.resolve(null) }
      throw new Error('设置页出现未预期依赖：' + modulePath)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'pages/settings/index.js' })
  assert.ok(pageConfig && pageConfig.data && Array.isArray(pageConfig.data.notifyChannels), '设置页必须定义 notifyChannels')
  // subs 是 { key, name } 结构，这里统一归一成 channel.name + channel.subKeys
  return pageConfig.data.notifyChannels.map((ch) => ({ name: ch.name, subKeys: (ch.subs || []).map((s) => s.key) }))
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
