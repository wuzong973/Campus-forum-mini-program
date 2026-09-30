const request = require('./request')

// 模板类型 → 模板 ID（来自微信公众平台「我的模板」，与 server/.env 的 WX_TPL_* 一一对应）。
// 旧的三槽位体系（activity/errand/interact 占位符）已废弃：前端不再请求这三类，
// 服务端发送层也已切换到下方具名模板（见 TRIGGER_GROUPS 与 server/services/subscribeService.js）。
const TEMPLATE_IDS = {
  // 评论提醒（发布帖子成功后弹窗引导授权）
  // 注意：服务端 subscribeService 已扩同键槽位，reportQuota 上报可正常记账。
  commentNew: 'kDU3pivvs0kb4EtB-rJk7OuMGhOhLkGfsrvz6ob2xj4', // 新的评论提醒
  commentReply: 'YcAwFpCDmjHoNpH8jwqyCBpgu4JUD0o61Uj4Wnqd6Y0', // 评论回复通知
  // 提现提醒（提现提交成功后弹窗引导授权），ID 来自微信公众平台「我的模板」
  withdrawSuccess: 'RB6jQZyrQUwzNdM23vq9Cbx3mSbSfKXxgcvNtYpzJuw', // 提现成功通知
  withdrawResult: 'vbvVxxEl6i-InuDE33N1GLM6-vUlfmW7LCLMiw3NfSg', // 提现结果通知
  // 活动审核提醒（活动发布成功后弹窗引导授权）
  activityAudit: 'j66trNss6jKGe35lICHMnTlErY_-r07gL72HEtIdM8I', // 活动审核通知
  // 活动订阅提醒（进入校园活动页弹窗引导授权）
  activityNew: 'EmuOFFgiPUl3_7gCSogsG7_0VsStGCnxdGKSPSq_fuc', // 新活动提醒
  activityJoined: 'yCG4T7vIa1B3vYK73K6H5ZdCNacQNObCt6kogfDL0lc', // 活动参与成功提醒
  activitySignupNotice: '_evYbFOUG9CSyjleOJWk4y2K5GTdkzRYf4OU-lCYkmk', // 活动报名通知
  // 活动结果提醒（活动详情页报名成功后弹窗引导授权）
  activitySignupResult: 'V2E--7EluSwMjtYMjTYTVArJ6XJ9N0IBIaXyAAxmhFg', // 活动报名结果通知
  activityStart: 'qmeo56-pos-SuRofXm3nePNoI4E1aOGpruLuUSmysD8', // 活动开始提醒
  activitySignup: 'Yf_W1CJr18NhxSXaUqe8V7CmWwD4AJA-mXyuD_pHI9g', // 报名成功通知
  // 跑腿订单提醒（进入发布跑腿页弹窗引导授权）
  errandAccepted: 'HFe6LGndlkjQQvOqkaeQabQ4biKRdZOAZYU3IRVNO5o', // 订单接单通知
  errandFinished: '7S5kSh68UH8bKgorfc5giQdptMfhy_0-sXi9ZfDZ24U', // 订单完成通知
  errandCancelled: 'zApVwFQd14yZ7kr610aKCtXstcl6lAJbgmJiziQxQuE', // 订单取消通知
  // 审核结果类提醒（设置页「审核结果通知」渠道子开关）
  auditCert: 'dUM_Sr4eA-7mPwoAVnrmzbXcqX5C7leRxWQfngpnDNA', // 认证审核通知
  auditPass: 'va4kRYKKXE0MSfN6M9qSnBakk2pYG2NCEzyATGf5uKk', // 审核通过提醒
  audit: 'cXkeat4hEL73QFD1T4pwwi9fnsl6zuZYIHCru8hHNbI', // 审核结果通知
  message: 'nX0DaVmHc42E2JlbnXQNTnLejJiUHDbbOsTxQP1aDl4', // 聊天信息提醒（chat 发送按钮点击触发授权）
  // 表格剩余备用模板（暂无业务触点，注册以备启用）
  userPmNotice: 'IEdA_HqyQIvS6sd1ug-EdgBbCJjrgYDADN_f5Rq35hg', // 用户私信通知
  reportResult: '9HY7g8UiOK04WcIqn2Bq1V3IS3GahOdweVx9YJIjTwY' // 举报结果通知
}

const VALID_TYPES = ['commentNew', 'commentReply', 'withdrawSuccess', 'withdrawResult', 'activityAudit', 'activityNew', 'activityJoined', 'activitySignupNotice', 'activitySignupResult', 'activityStart', 'activitySignup', 'errandAccepted', 'errandFinished', 'errandCancelled', 'auditCert', 'auditPass', 'audit', 'message', 'userPmNotice', 'reportResult']

// 模板类型 → 中文名。**必须与 server/services/subscribeService.js 的 TPL_CONFIG.label 一字不差**
// （护栏：tests/subscribe-binding-audit.test.js 会逐项比对）。
// 用途：给用户「是**哪一项**没允许」这类可操作的提示 —— 只说「部分未开启」，用户根本不知道该补哪一项。
const TPL_LABELS = {
  commentNew: '新的评论提醒',
  commentReply: '评论回复通知',
  withdrawSuccess: '提现成功通知',
  withdrawResult: '提现结果通知',
  activityNew: '新活动提醒',
  activityJoined: '活动参与成功提醒',
  activitySignupNotice: '活动报名通知',
  activityAudit: '活动审核通知',
  activitySignupResult: '活动报名结果通知',
  activityStart: '活动开始提醒',
  activitySignup: '报名成功通知',
  errandAccepted: '订单接单通知',
  errandFinished: '订单完成通知',
  errandCancelled: '订单取消通知',
  auditCert: '认证审核通知',
  audit: '审核结果通知',
  auditPass: '审核通过提醒',
  message: '聊天信息提醒',
  userPmNotice: '用户私信通知',
  reportResult: '举报结果通知'
}

// ===== 弹窗触发规则 =====
// 每个触发点关联一组订阅开关；仅当组内全部开关均为开启（=== true）时不再弹出，
// 任一未开启（false 或从未选择 undefined）则弹出。每次交互只会有一个弹窗：
// 每个触发点归属唯一页面/动作，页面各自的弹窗组件由 wx:if 单实例渲染，天然互斥。
const TRIGGER_GROUPS = {
  // 发布帖子成功后（pages/post-publish）。grantedKeys 与各业务页写入的授权结果字段一一对应
  postPublish: { prefsKey: 'subscribe_comment_prefs', keys: ['commentNew', 'commentReply'], grantedKeys: ['grantedCommentNew', 'grantedCommentReply'] },
  // 提现提交成功后（pages/wallet）
  withdraw: { prefsKey: 'notify_channel_prefs', keys: ['withdrawSuccess', 'withdrawResult'], grantedKeys: ['grantedWithdrawSuccess', 'grantedWithdrawResult'] },
  // 进入校园活动页（pages/activity/index）
  activityIndex: { prefsKey: 'notify_channel_prefs', keys: ['activityNew', 'activityJoined', 'activitySignupNotice'], grantedKeys: ['grantedActivityNew', 'grantedActivityJoined', 'grantedActivitySignupNotice'] },
  // 发布活动成功后（pages/activity/publish）
  activityPublish: { prefsKey: 'notify_channel_prefs', keys: ['activityAudit'], grantedKeys: ['grantedActivityAudit'] },
  // 报名活动成功后（pages/activity/detail）
  activitySignup: { prefsKey: 'notify_channel_prefs', keys: ['activitySignupResult', 'activityStart', 'activitySignup'], grantedKeys: ['grantedActivitySignupResult', 'grantedActivityStart', 'grantedActivitySignup'] },
  // 进入骑手认证页（提交认证/立即验证点击触发）
  riderVerify: { prefsKey: 'notify_channel_prefs', keys: ['auditCert', 'audit', 'auditPass'], grantedKeys: ['grantedAuditCert', 'grantedAudit', 'grantedAuditPass'] },
  // 进入发布跑腿页（pages/errand-publish）
  errandPublish: { prefsKey: 'notify_channel_prefs', keys: ['errandAccepted', 'errandFinished', 'errandCancelled'], grantedKeys: ['grantedErrandAccepted', 'grantedErrandFinished', 'grantedErrandCancelled'] },
  // 私信聊天（pages/chat 发送按钮点击触发，服务端非匿名私信时下发）
  message: { prefsKey: 'notify_channel_prefs', keys: ['message'], grantedKeys: ['grantedMessage'] }
}

// 触发点 → 设置页「通知渠道」名称（页面顶部入口在微信侧「总是拒绝」时的引导文案 + 节流键）。
// 刻意单独成表而不塞进 TRIGGER_GROUPS：那七条结构被 tests/settings-notify-channels.test.js
// 用行级正则逐字解析（还断言 keys/grantedKeys 的完整字面量），往里加字段会连带打挂护栏。
// throttleKey 与既有页面（如 chat onSend）所用的键保持一致，避免同一引导被节流两次/两次都不节流。
const TRIGGER_CHANNEL = {
  postPublish: { label: '评论通知', throttleKey: 'subscribe_reopen_guide_post_publish' },
  withdraw: { label: '提现结果通知', throttleKey: 'subscribe_reopen_guide_withdraw' },
  activityIndex: { label: '活动订阅', throttleKey: 'subscribe_reopen_guide_activity_index' },
  activityPublish: { label: '活动审核通知', throttleKey: 'subscribe_reopen_guide_activity_publish' },
  activitySignup: { label: '活动结果通知', throttleKey: 'subscribe_reopen_guide_activity_signup' },
  riderVerify: { label: '审核结果通知', throttleKey: 'subscribe_reopen_guide_rider_verify' },
  errandPublish: { label: '代拿/跑腿通知', throttleKey: 'subscribe_reopen_guide_errand_publish' },
  message: { label: '私信通知', throttleKey: 'subscribe_reopen_guide_chat' }
}

// 授权键统一推导规则：granted + 首字母大写。
// 所有 grantedKeys 都必须符合这条规则（tests/subscribe-binding-audit.test.js 的 B 组断言锁死），
// 否则设置页/业务页会各写一个键名，表现为「授权了但入口不消失」。
function grantedKeyOf(key) {
  return 'granted' + String(key || '').charAt(0).toUpperCase() + String(key || '').slice(1)
}

// ===== 弹窗触发节流层 =====
// 目的：同一个触发组在「用户未勾选总是允许」时，一天最多弹 3 次原生授权弹窗，
// 用满后当天不再弹，避免反复打扰。
//
// 为什么计数必须放本地存储（而不是服务端）：
// 微信要求 wx.requestSubscribeMessage 必须在用户点击手势的**同步调用链**内调用，
// 因此「今天还能不能弹」必须在 tap 里同步判定完 —— 来不及等服务端接口返回。
// 只能用 wx.getStorageSync / setStorageSync 这对同步 API。
const THROTTLE_KEY = 'subscribe_popup_throttle'
// 微信侧「总是」选择的本地缓存：{ [模板类型]: 'accept' | 'reject' | 'ban', updatedAt }
// 同样是因为 tap 内不能 await wx.getSetting（异步），只能读缓存、由非 tap 路径刷新。
const ALWAYS_CHOICE_KEY = 'subscribe_always_choice'
const THROTTLE_DAILY_LIMIT = 3

/** 本地自然日 YYYY-MM-DD。刻意用本地时区而非 UTC —— 用 UTC 会让东八区到早上 8 点才换天。 */
function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/**
 * 读取节流状态，跨天时**惰性重置**。
 *
 * 为什么不写定时器：小程序没有可靠的常驻定时器（用户可能整天不打开、进程随时被回收）。
 * 惰性判定天然覆盖「整天没打开 → 第二天首次触发」的场景，语义等价于每天 00:00 清零。
 *
 * @returns {{day:string, groups:Object}} 形如 { day: '2026-09-16', groups: { postPublish: 2 } }
 */
function readThrottle() {
  const today = todayKey()
  let raw = null
  try { raw = wx.getStorageSync(THROTTLE_KEY) } catch (e) { raw = null }
  if (!raw || typeof raw !== 'object' || raw.day !== today) {
    return { day: today, groups: {} }
  }
  const groups = (raw.groups && typeof raw.groups === 'object') ? raw.groups : {}
  return { day: today, groups }
}

function writeThrottle(state) {
  try {
    wx.setStorageSync(THROTTLE_KEY, state)
  } catch (e) {
    // 存储写失败（超限/被系统清理）时退化为「本次不节流」：
    // 宁可多弹一次，也不要因为存储异常让用户彻底看不到授权入口 —— 那会直接掐断额度来源。
    try { console.warn('[subscribe] 节流计数写入失败，本次不节流：', e && e.message) } catch (e2) {}
  }
}

/** 今天该触发组已经弹过几次 */
function throttleUsed(trigger) {
  return Number(readThrottle().groups[trigger] || 0)
}

/** 今天该触发组是否已用满次数 */
function throttleReached(trigger) {
  return throttleUsed(trigger) >= THROTTLE_DAILY_LIMIT
}

/**
 * 组内模板是否**全部**被微信记为「总是允许」。
 *
 * 读的是本地缓存（tap 内不能 await wx.getSetting），缓存由 refreshAlwaysChoice 维护。
 * 口径与 shouldShowDialog 一致：组内每个模板都满足才算。
 * 微信侧 `itemSettings` 里**键不存在 = 用户没做过「总是」选择**，因此缓存里没有该键即视为未勾选。
 */
function hasAlwaysAllow(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  if (!rule) return false
  let cache = null
  try { cache = wx.getStorageSync(ALWAYS_CHOICE_KEY) } catch (e) { cache = null }
  if (!cache || typeof cache !== 'object') return false
  return rule.keys.every((key) => cache[key] === 'accept')
}

/**
 * 刷新「总是」选择缓存。**异步，不可在 tap 同步链内调用。**
 *
 * 必须在这两个时机跑：
 *   ① app onShow（用户可能刚在小程序设置页改过）；
 *   ② 每次 requestSubscribeMessage 回调之后（用户可能就是在这一次勾上了「总是保持以上选择」）。
 *
 * @param {string[]} [types] 要刷新的模板类型；不传则刷新全部 20 个
 * @returns {Promise<Object|null>} 刷新后的缓存；失败返回 null（调用方按「未勾选」处理，即走节流）
 */
function refreshAlwaysChoice(types) {
  const source = (types && types.length) ? types : Object.keys(TEMPLATE_IDS)
  const list = Array.from(new Set(source.filter((t) => VALID_TYPES.includes(t))))
  if (!list.length || typeof wx.getSetting !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    wx.getSetting({
      withSubscriptions: true,
      success(res) {
        const itemSettings = ((res && res.subscriptionsSetting) || {}).itemSettings || {}
        let cache = null
        try { cache = wx.getStorageSync(ALWAYS_CHOICE_KEY) } catch (e) { cache = null }
        if (!cache || typeof cache !== 'object') cache = {}
        list.forEach((t) => {
          const state = itemSettings[TEMPLATE_IDS[t]]
          if (state === 'accept' || state === 'reject' || state === 'ban') cache[t] = state
          // 键消失 = 用户取消了「总是」选择（改回「每次询问」）→ 必须删掉缓存，
          // 否则会被永久判为「已勾选总是允许」而一直跳过节流。
          else delete cache[t]
        })
        cache.updatedAt = Date.now()
        try { wx.setStorageSync(ALWAYS_CHOICE_KEY, cache) } catch (e) {}
        resolve(cache)
      },
      fail() { resolve(null) }
    })
  })
}

/** 调试/测试用：读取某触发组的节流快照 */
function getThrottleState(trigger) {
  const used = throttleUsed(trigger)
  return {
    day: readThrottle().day,
    used,
    limit: THROTTLE_DAILY_LIMIT,
    reached: used >= THROTTLE_DAILY_LIMIT,
    alwaysAllow: hasAlwaysAllow(trigger)
  }
}

/** 调试/测试用：清空节流计数（传 trigger 只清该组，不传清全部） */
function clearThrottle(trigger) {
  const state = readThrottle()
  if (trigger) delete state.groups[trigger]
  else state.groups = {}
  writeThrottle(state)
}

/**
 * 上报一次「命中弹窗节流」到服务端，写一行 status='throttled' 的日志。
 *
 * 这是**唯一由客户端上报**的订阅日志类型：节流判定发生在 tap 的同步调用链内，
 * 服务端完全无从感知「这次点击被本地拦下了」，只能靠上报。
 *
 * 刻意做成 fire-and-forget：**不 await、不阻塞、不抛错** ——
 * 它是在 tap 同步链里发出的，任何阻塞都会拖慢弹窗判定；日志丢了也不影响节流本身。
 */
function reportThrottleHit(trigger, used) {
  const types = typesForTrigger(trigger)
  if (!types.length) return Promise.resolve(null)
  return request
    .post('/subscribe/throttled', {
      // 触发组是客户端概念，服务端只认模板类型 → 取组内首个模板类型落 tpl_type
      tplType: types[0],
      triggerLabel: (TRIGGER_CHANNEL[trigger] || {}).label || '',
      used: Number(used || 0),
      limit: THROTTLE_DAILY_LIMIT
    }, true, { silent: true })
    .catch(() => null)
}

// 历史遗留键名兼容：早期「新的评论提醒」偏好键叫 newComment，授权键随之叫 grantedNewComment；
// 统一为 grantedCommentNew 后，读取时仍认旧键，避免老用户被要求重新授权一次。
const LEGACY_GRANTED_ALIAS = { grantedCommentNew: 'grantedNewComment' }
function isGranted(prefs, grantedKey) {
  if (!grantedKey) return true
  if (prefs[grantedKey] === true) return true
  const legacy = LEGACY_GRANTED_ALIAS[grantedKey]
  return !!(legacy && prefs[legacy] === true)
}

/**
 * 判断某触发点是否应弹出订阅弹窗。
 * 静默条件（全部满足才不弹）：组内每个开关的偏好已开启（=== true）
 * 且对应微信授权已成功（grantedXxx === true）。
 * 任一不满足 → 弹出：偏好未开则引导开启；偏好已开但从未授权/授权被拒，
 * 则再次给出 wx.requestSubscribeMessage 授权入口（否则用户永远收不到推送）。
 */
function shouldShowDialog(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  if (!rule) return false
  const prefs = wx.getStorageSync(rule.prefsKey) || {}
  const grantedKeys = rule.grantedKeys || []
  return !rule.keys.every((key, index) => {
    if (prefs[key] !== true) return false
    return isGranted(prefs, grantedKeys[index])
  })
}

/** 查询触发点关联的开关组（设置页/调试用） */
function getTriggerGroup(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  return rule ? { prefsKey: rule.prefsKey, keys: rule.keys.slice() } : null
}

function validIds(types) {
  return (types || [])
    .filter((t) => VALID_TYPES.includes(t))
    .map((t) => TEMPLATE_IDS[t])
    .filter((id) => id && id.indexOf('请填入') !== 0)
}

/**
 * 申请订阅授权并上报服务端。
 *
 * 微信约束（务必遵守，否则接口直接失败）：
 * 1. 必须在用户点击事件的同步调用链里触发，不能在 onLoad / setTimeout 中调用；
 * 2. 一次最多请求 3 个模板 ID；
 * 3. 用户勾选「允许」只增加 1 条可发送额度，因此要在高频动作点重复引导。
 *
 * @param {string[]} types 需要授权的模板类型，如 ['errand']
 * @param {Object} [options]
 * @param {boolean} [options.silent] 用户拒绝时不弹提示（用于自动引导场景）
 * @returns {Promise<{accepted:string[], rejected:string[]}>} 已授权 / 被拒绝的模板类型
 */
function requestSubscribe(types, options = {}) {
  const allList = Array.from(new Set((types || []).filter((t) => VALID_TYPES.includes(t))))
  const list = allList.slice(0, 3)
  const overflow = allList.slice(3)
  const ids = validIds(list)
  if (!ids.length) {
    // 本来要申请模板，却一个可用的模板 ID 都没有（未配置/仍是占位符）→ 属于构建或配置问题。
    // 这条路径**不会弹原生窗、也不会走 fail 回调**，是「点了没反应」的隐形来源之一，必须留痕。
    if (allList.length) {
      try { console.warn('[subscribe] 无可用模板 ID，已跳过授权申请：', allList.join(',')) } catch (e) {}
      if (!options.silent) wx.showToast({ title: '订阅模板暂不可用', icon: 'none' })
      return Promise.resolve({ accepted: [], rejected: allList, failed: true })
    }
    return Promise.resolve({ accepted: [], rejected: allList, failed: false })
  }

  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success(res) {
        const accepted = []
        const rejected = []
        list.forEach((type) => {
          const id = TEMPLATE_IDS[type]
          // accept = 本次允许；其余（reject / ban / filter）均视为未授权
          if (res[id] === 'accept') accepted.push(type)
          else rejected.push(type)
        })
        if (accepted.length) reportQuota(accepted)
        // 用户可能就是在这一次勾上了「总是保持以上选择」→ 立刻刷新缓存，
        // 下次业务触发即可跳过节流（微信侧已不会再弹窗，节流已无意义）。
        refreshAlwaysChoice(list)
        // 用户拒绝时只记录结果，不再叠加自定义引导弹窗；用户可在设置页再次开启。
        if (overflow.length) wx.setStorageSync('subscribe_pending_types', overflow)
        resolve({ accepted, rejected: rejected.concat(overflow), failed: false })
      },
      fail(err) {
        // 常见错误：20004 用户关闭了订阅消息总开关；20001 模板 ID 不合法
        // 授权失败不阻断业务流程，但保留错误码，便于定位“没有弹窗”的原因。
        try { console.warn('[subscribe] wx.requestSubscribeMessage failed', err && err.errMsg ? err.errMsg : err) } catch (e) {}
        if (!options.silent) {
          const message = String((err && err.errMsg) || '')
          if (message.indexOf('20004') > -1) wx.showToast({ title: '请在微信设置中开启订阅消息', icon: 'none' })
          else if (message.indexOf('20001') > -1) wx.showToast({ title: '订阅模板暂不可用', icon: 'none' })
        }
        refreshAlwaysChoice(list)
        if (overflow.length) wx.setStorageSync('subscribe_pending_types', overflow)
        // failed=true：上面已经给过可见提示，调用方不要再叠加一层引导弹窗
        resolve({ accepted: [], rejected: allList, failed: true })
      }
    })
  })
}

function shouldShowDialogAsync(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  if (!rule) return Promise.resolve(false)
  const prefs = wx.getStorageSync(rule.prefsKey) || {}
  const enabled = typesForTrigger(trigger)
  if (!enabled.length) return Promise.resolve(false)
  return fetchQuota().then((quota) => {
    if (!quota || typeof quota !== 'object') return shouldShowDialog(trigger)
    // 服务端 quotaOf 会为全部 20 个模板补 0，因此正常的额度表必然含本次要判断的键。
    // 一个都取不到 = 响应结构与预期不符（曾因 fetchQuota 漏解一层 quota 导致），
    // 此时退化为本地判定并留 warn —— 否则会「永远读到 0 → 入口永不消失」且无人察觉。
    if (!enabled.some((key) => quota[key] !== undefined)) {
      try { console.warn('[subscribe] 额度响应结构异常，退化为本地判定：', JSON.stringify(quota).slice(0, 120)) } catch (e) {}
      return shouldShowDialog(trigger)
    }
    return enabled.some((key, index) => {
      const grantKey = rule.grantedKeys && rule.grantedKeys[rule.keys.indexOf(key)]
      return !isGranted(prefs, grantKey) || Number(quota[key] || 0) <= 0
    })
  })
}

function typesForTrigger(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  if (!rule) return []
  // 原生弹窗应展示该业务通道的完整模板组；用户在微信弹窗中逐项选择。
  return rule.keys.slice()
}

/**
 * 顶部入口点击时**应当申请的**模板清单（只申请还差的那几项）。
 *
 * 为什么不总是申请整组：微信原生弹窗里每个模板默认都是**未勾选**，如果每次都把整组塞进弹窗，
 * 用户很容易只勾其中一项就点「允许」，于是陷入「部分未授权 → 再点一次 → 又只勾一项」的循环。
 * 改成只申请缺的项之后，**弹窗里就只剩那一项**，勾上即完成，不会再漏。
 *
 * 特例：整组都已授权、入口却因为**额度耗尽**重新出现（用户需要重新攒额度）时，
 * 没有"未授权项"可申请，返回整组。
 *
 * 注：受微信限制，无法在原生弹窗返回后自动再弹一次（见 requestEntryByTap 注释），
 * 因此这里的作用是「让**下一次**点击弹出的弹窗里只剩缺的那一项」。
 *
 * @returns {string[]} 本次应申请的模板类型
 */
function pendingTypesFor(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  if (!rule) return []
  const prefs = wx.getStorageSync(rule.prefsKey) || {}
  const grantedKeys = rule.grantedKeys || []
  const missing = rule.keys.filter((key, index) => {
    if (prefs[key] !== true) return true
    return !isGranted(prefs, grantedKeys[index])
  })
  return missing.length ? missing : rule.keys.slice()
}

/**
 * 在当前 tap 调用栈内申请指定模板，并把授权结果落库。
 * 供「顶部入口点击」与「业务触发点」复用，避免两处各写一遍落库逻辑。
 */
function requestTypesByTap(types) {
  const list = Array.from(new Set(types || []))
  if (!list.length) return Promise.resolve({ accepted: [], rejected: [], failed: false })
  return requestSubscribe(list).then((res) => {
    persistAccepted(res.accepted, list)
    return res
  })
}

function persistAccepted(acceptedTypes, requestedTypes) {
  const accepted = new Set(acceptedTypes || [])
  const requested = Array.from(new Set(requestedTypes || acceptedTypes || []))
  Object.keys(TRIGGER_GROUPS).forEach((trigger) => {
    const rule = TRIGGER_GROUPS[trigger]
    // 整段包 try/catch：本函数是在 .then 里被调用的，一旦 getStorageSync / setStorageSync
    // 抛错（存储超限、被系统清理），异常会冒泡成**未处理的 promise rejection**
    // —— 调用方写的是 `subscribe.requestTriggerByTap('x')`，根本没有接 catch。
    // 授权结果写不进去只影响后续的静默判定，绝不能因此影响主流程。
    try {
      const prefs = wx.getStorageSync(rule.prefsKey) || {}
      let changed = false
      rule.keys.forEach((key, index) => {
        if (requested.indexOf(key) < 0) return
        const grantedKey = rule.grantedKeys && rule.grantedKeys[index]
        if (grantedKey) { prefs[grantedKey] = accepted.has(key); changed = true }
      })
      if (changed) { prefs.updatedAt = Date.now(); wx.setStorageSync(rule.prefsKey, prefs) }
    } catch (e) {
      try { console.warn('[subscribe] 授权结果落库失败（不影响主流程）：', rule.prefsKey, e && e.message) } catch (e2) {}
    }
  })
}

function resumePending() {
  const pending = wx.getStorageSync('subscribe_pending_types')
  if (!Array.isArray(pending) || !pending.length) return Promise.resolve(null)
  wx.removeStorageSync('subscribe_pending_types')
  return requestSubscribe(pending, { silent: true }).then((res) => {
    persistAccepted(res.accepted, pending)
    return res
  })
}

function requestSubscribeByTap(types, options = {}) {
  const list = Array.from(new Set(types || []))
  if (!list.length) return Promise.resolve({ accepted: [], rejected: [] })
  // 必须由业务页面的 bindtap 处理函数直接调用；不再插入 wx.showModal，
  // 否则原始用户手势链会被异步回调打断，导致 requestSubscribeMessage 偶发无弹窗。
  return requestSubscribe(list, options)
}

// 业务按钮点击时使用：同步进入 requestSubscribeMessage，结果统一写入本地授权状态。
//
// 这里挂了**弹窗触发节流层**（见文件顶部该节）：
//   · 用户已勾选「总是允许」→ **跳过节流**。微信本来就不会再弹窗，但每次调用仍会
//     **静默 +1 条额度**，停掉调用等于主动掐断额度来源（本项目额度覆盖率本就是瓶颈）；
//   · 否则一天最多弹 THROTTLE_DAILY_LIMIT 次，用满后当天直接返回、不调用微信。
//
// 计数在**调用微信之前** +1（乐观计数）：宁可少弹，也不要在回调里补记而漏记。
// 注意：顶部入口 requestEntryByTap 走的是 requestTypesByTap，**不经过这里**，因此不受节流
// —— 那是用户主动点订阅入口，被拦会变成「点了没反应」（本项目修过的老问题）。
function requestTriggerByTap(trigger) {
  const types = typesForTrigger(trigger)
  // 这是用户明确点击后的入口，不能被本地 granted 缓存或服务端额度状态短路。
  // 必须在当前 tap 调用栈内直接进入原生 API；是否需要展示由微信客户端判定。
  if (!types.length) return Promise.resolve({ accepted: [], rejected: [], failed: false })

  if (!hasAlwaysAllow(trigger)) {
    const state = readThrottle()
    const used = Number(state.groups[trigger] || 0)
    if (used >= THROTTLE_DAILY_LIMIT) {
      // 静默跳过，**不弹任何提示** —— 每天提示「今天不能再弹了」本身就是另一种打扰。
      // 上报一行「命中节流」日志（fire-and-forget，绝不 await），供管理后台「命中节流」查看。
      try { reportThrottleHit(trigger, used) } catch (e) {}
      // 返回 throttled 便于测试断言与线上排查。
      return Promise.resolve({
        accepted: [], rejected: [], failed: false,
        throttled: true, used, limit: THROTTLE_DAILY_LIMIT
      })
    }
    state.groups[trigger] = used + 1
    writeThrottle(state)
  }

  return requestTypesByTap(types)
}

/**
 * 页面顶部「通知设置入口」专用：点击后在 tap 同步链内申请该触发组的原生授权，
 * 并把用户**允许**的项同步写入该触发组对应的偏好开关（与设置页共用同一份存储）。
 *
 * 为什么必须连偏好一起写（这是八处入口共用的关键约定）：
 * - requestTriggerByTap 只写 grantedXxx（微信侧授权结果），不碰偏好键；
 * - shouldShowDialog 要求「偏好已开 且 微信侧已授权」两个条件同时满足才静默。
 * 因此：只授权不写偏好 → 入口永远不会隐藏；被拒也写偏好 → 设置页开关会被误显示为已开启。
 * 正确做法就是这里的样子：**只在 accepted 时、只对允许的项**写偏好。
 *
 * @param {string} trigger TRIGGER_GROUPS 的触发点键（如 'withdraw'）
 * @returns {Promise<{accepted:string[], rejected:string[]}>}
 */
function requestEntryByTap(trigger) {
  const rule = TRIGGER_GROUPS[trigger]
  if (!rule) return Promise.resolve({ accepted: [], rejected: [], guided: false })
  // 只申请「还没允许」的那几项 → 原生弹窗里就**只剩缺的那一项**，用户勾上即完成，
  // 不会再出现「整组都塞进弹窗 → 用户只勾一项 → 又缺一项」的反复。
  // （整组已授权、入口因额度耗尽重现时，pendingTypesFor 会返回整组以便重新攒额度。）
  const requested = pendingTypesFor(trigger)
  return requestTypesByTap(requested).then((res) => {
    const accepted = (res && res.accepted) || []
    const rejected = (res && res.rejected) || []
    if (accepted.length) {
      const prefs = Object.assign({}, wx.getStorageSync(rule.prefsKey) || {})
      accepted.forEach((key) => { prefs[key] = true })
      prefs.updatedAt = Date.now()
      wx.setStorageSync(rule.prefsKey, prefs)
    }
    if (!rejected.length) return Object.assign({}, res, { guided: false })
    // requestSubscribe 已经给过可见提示（总开关关闭 / 模板不可用），不再叠加引导弹窗
    if (res && res.failed) return Object.assign({}, res, { guided: false })

    // 微信侧「总是拒绝」后原生弹窗不再出现、静默返回 reject，用户无感知，
    // 只能引导到小程序设置页手动改回。
    //
    // ⚠️ 这里**刻意不传 throttleKey**：节流是给「被动触达」用的（例如聊天页发送时顺带引导，
    // 反复弹会打扰）。而用户是**自己点了订阅入口**，属于主动求助，被节流就意味着
    // 「点了之后什么都没有发生」—— 这正是「开关自动关闭」最直接的原因。
    //
    // ⚠️ 也不能在这里自动再调一次 requestSubscribeMessage：微信要求该接口必须在
    // 用户点击手势的同步调用栈内调用，从 success 回调里再调会被拒。
    // 所以「补齐」只能落到**下一次点击**上（届时弹窗里只会有缺的那几项）。
    const meta = TRIGGER_CHANNEL[trigger] || {}
    return guideReopen(rejected, meta.label || '消息通知').then((guided) => {
      if (!guided) {
        // 文案必须回答两件事：①漏了哪一项 ②接下来该做什么。
        // 「逐项勾上」是关键：微信原生弹窗里每个模板默认都是**未勾选**，
        // 只说「再点一次」会让用户把失败原样重复一遍。
        const missing = rejected.map((type) => TPL_LABELS[type] || type)
        let title
        if (missing.length >= requested.length) title = '未勾选，再点一次逐项勾上'
        else if (missing.length === 1) title = '「' + missing[0] + '」未勾选，再点一次勾上它'
        else title = '还有 ' + missing.length + ' 项未勾选，再点一次逐项勾上'
        wx.showToast({ title, icon: 'none' })
      }
      return Object.assign({}, res, { guided: !!guided, nextRequest: pendingTypesFor(trigger) })
    })
  })
}

/**
 * 页面顶部通知入口是否应显示。
 * 直接复用 shouldShowDialog 的口径（偏好已开 + 已授权才静默），
 * 因此设置页关闭对应渠道后入口会自动重新出现，无需任何额外监听。
 * @param {string} trigger TRIGGER_GROUPS 的触发点键
 * @returns {boolean}
 */
function entryVisible(trigger) {
  return !!shouldShowDialog(trigger)
}

/**
 * 页面顶部通知入口是否应显示（含**服务端额度**复核），页面应优先用这个。
 *
 * 为什么需要它：`entryVisible` 只看本地偏好与 granted，一旦用户授权过就永久隐藏入口。
 * 但额度是「点一次允许 = 一条消息」，评论/私信这类高频场景很快耗尽，
 * 耗尽后服务端 100% 记 `skipped(额度不足)`——**消息发不出去，入口却再也不出现**，
 * 用户完全无从知道需要重新订阅。这正是「订阅了却一直收不到」的主要成因。
 *
 * 请求量控制：本地判定为「需要引导」时直接返回 true（不发请求），
 * 只有本地认为「已订阅」时才查一次服务端额度。因此正常情况下零额外请求。
 *
 * @param {string} trigger TRIGGER_GROUPS 的触发点键
 * @returns {Promise<boolean>}
 */
function entryVisibleAsync(trigger) {
  if (shouldShowDialog(trigger)) return Promise.resolve(true)
  return shouldShowDialogAsync(trigger)
}

/**
 * 把已授权的模板上报服务端累加额度
 */
function reportQuota(tplTypes) {
  if (!tplTypes || !tplTypes.length) return Promise.resolve(null)
  return request
    .post('/subscribe/report', { tplTypes }, true, { silent: true })
    .catch(() => null)
}

/**
 * 查询服务端剩余额度（模板类型 → 剩余条数 的扁平表）。
 *
 * ⚠️ 必须再解一层 `quota`：服务端契约是 `{ code, message, data: { quota: {...} } }`，
 * 而 `request.get` 已经把最外层解成 `response.data`，所以这里拿到的是 `{ quota: {...} }`。
 * 早期漏了这一层，导致 shouldShowDialogAsync 里 `quota['commentNew']` 恒为 undefined
 * → `Number(undefined || 0)` 恒为 0 → 恒判定「需要引导」→ 授权成功后入口不消失、
 * 开关回弹为灰色（用户误以为授权失败，反复点击堆积额度）。
 *
 * 兼容处理：若服务端某天直接返回扁平表，也照常可用。
 * @returns {Promise<Object|null>} 扁平额度表；请求失败返回 null
 */
function fetchQuota() {
  return request
    .get('/subscribe/quota', {}, true, { silent: true })
    .then((res) => (res && typeof res.quota === 'object' && res.quota !== null ? res.quota : res))
    .catch(() => null)
}

/**
 * 读取微信侧真实授权状态。
 * 「总是拒绝」后 wx.requestSubscribeMessage 不再弹窗、静默返回 reject，额度永远为 0，
 * 用户对此无感知，只能引导到小程序设置页（胶囊「···」→ 设置 → 订阅消息）手动改回。
 * @returns {Promise<{mainSwitch:boolean, rejectedTypes:string[]}>}
 */
function getSubscriptionState(types) {
  const list = Array.from(new Set((types || []).filter((t) => VALID_TYPES.includes(t))))
  if (!list.length || typeof wx.getSetting !== 'function') {
    return Promise.resolve({ mainSwitch: true, rejectedTypes: [] })
  }
  return new Promise((resolve) => {
    wx.getSetting({
      withSubscriptions: true,
      success(res) {
        const sub = (res && res.subscriptionsSetting) || {}
        const itemSettings = sub.itemSettings || {}
        const rejectedTypes = list.filter((t) => {
          const state = itemSettings[TEMPLATE_IDS[t]]
          return state === 'reject' || state === 'ban'
        })
        resolve({ mainSwitch: sub.mainSwitch !== false, rejectedTypes })
      },
      fail() { resolve({ mainSwitch: true, rejectedTypes: [] }) }
    })
  })
}

/**
 * 检测「总是拒绝」/订阅总开关关闭并引导去设置页重开。
 * 主动触达场景（如设置页刚点开关）直接调用；聊天页等高频触点传 throttleKey 节流。
 * @returns {Promise<boolean>} 是否弹出了引导
 */
function guideReopen(types, label, options = {}) {
  const throttleKey = options.throttleKey
  const throttleMs = options.throttleMs || 7 * 24 * 60 * 60 * 1000
  return getSubscriptionState(types).then((state) => {
    if (state.mainSwitch && !state.rejectedTypes.length) return false
    if (throttleKey) {
      const last = Number(wx.getStorageSync(throttleKey) || 0)
      if (last && Date.now() - last < throttleMs) return false
      wx.setStorageSync(throttleKey, Date.now())
    }
    wx.showModal({
      title: '微信通知已关闭',
      content: '「' + (label || '消息通知') + '」的微信通知已被关闭，开启后才能收到新消息提醒。点击「去开启」，在「订阅消息」中将对应消息设为「允许」或「每次询问」。',
      confirmText: '去开启',
      cancelText: '暂不',
      success(r) { if (r.confirm && typeof wx.openSetting === 'function') wx.openSetting({}) }
    })
    return true
  }).catch(() => false)
}

module.exports = { requestSubscribe, requestSubscribeByTap, requestTriggerByTap, requestEntryByTap, entryVisible, entryVisibleAsync, reportQuota, fetchQuota, getSubscriptionState, guideReopen, shouldShowDialog, shouldShowDialogAsync, getTriggerGroup, typesForTrigger, pendingTypesFor, persistAccepted, grantedKeyOf, resumePending, refreshAlwaysChoice, getThrottleState, clearThrottle, hasAlwaysAllow, throttleUsed, throttleReached, reportThrottleHit, TRIGGER_GROUPS, TRIGGER_CHANNEL, TEMPLATE_IDS, TPL_LABELS, THROTTLE_DAILY_LIMIT }
