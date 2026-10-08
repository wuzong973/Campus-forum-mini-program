const axios = require('axios')
const pool = require('../config/pool')
const { getAccessToken } = require('../utils/wechatToken')

// ===== 订阅消息模板类型 =====
// 与前端 utils/subscribe.js 的 TEMPLATE_IDS 一一对应（模板 ID 来自微信公众平台「我的模板」，
// 通过环境变量注入，未配置的类型自动降级为「只写站内信」，不影响业务主流程）。
// ⚠️ 各模板 data 字段（编号+类型）严格按《订阅消息模板分类 (2).xlsx》「数据字段」列逐字段映射，
//    请勿随意增删改字段 —— 与微信后台模板不一致会返回 47003 静默失败（留 subscribe_message_log）。
// 类型约束：thing ≤20字符；phrase ≤5字符；number/amount 为纯数字（amount 不带单位）；
//           date 格式「YYYY年MM月DD日」；time 格式「YYYY-MM-DD HH:mm」。
const TPL_TYPES = [
  'commentNew', 'commentReply',
  'withdrawSuccess', 'withdrawResult',
  'activityNew', 'activityJoined', 'activitySignupNotice',
  'activityAudit', 'activitySignupResult', 'activityStart', 'activitySignup',
  'errandAccepted', 'errandFinished', 'errandCancelled',
  'auditCert', 'audit', 'auditPass',
  'message', 'userPmNotice', 'reportResult'
]

// 模板类型 → 环境变量 → 默认落地页
const TPL_CONFIG = {
  commentNew: { envKey: 'WX_TPL_COMMENT_NEW', page: 'pages/post-detail/index', label: '新的评论提醒' },
  commentReply: { envKey: 'WX_TPL_COMMENT_REPLY', page: 'pages/post-detail/index', label: '评论回复通知' },
  withdrawSuccess: { envKey: 'WX_TPL_WITHDRAW_SUCCESS', page: 'pkg-feature/pages/wallet/index', label: '提现成功通知' },
  withdrawResult: { envKey: 'WX_TPL_WITHDRAW_RESULT', page: 'pkg-feature/pages/wallet/index', label: '提现结果通知' },
  activityNew: { envKey: 'WX_TPL_ACTIVITY_NEW', page: 'pkg-feature/pages/activity/index', label: '新活动提醒' },
  activityJoined: { envKey: 'WX_TPL_ACTIVITY_JOINED', page: 'pkg-feature/pages/activity/index', label: '活动参与成功提醒' },
  activitySignupNotice: { envKey: 'WX_TPL_ACTIVITY_SIGNUP_NOTICE', page: 'pkg-feature/pages/activity/index', label: '活动报名通知' },
  activityAudit: { envKey: 'WX_TPL_ACTIVITY_AUDIT', page: 'pkg-feature/pages/activity/detail', label: '活动审核通知' },
  activitySignupResult: { envKey: 'WX_TPL_ACTIVITY_SIGNUP_RESULT', page: 'pkg-feature/pages/activity/detail', label: '活动报名结果通知' },
  activityStart: { envKey: 'WX_TPL_ACTIVITY_START', page: 'pkg-feature/pages/activity/detail', label: '活动开始提醒' },
  activitySignup: { envKey: 'WX_TPL_ACTIVITY_SIGNUP', page: 'pkg-feature/pages/activity/detail', label: '报名成功通知' },
  errandAccepted: { envKey: 'WX_TPL_ERRAND_ACCEPTED', page: 'pages/errand-detail/index', label: '订单接单通知' },
  errandFinished: { envKey: 'WX_TPL_ERRAND_FINISHED', page: 'pages/errand-detail/index', label: '订单完成通知' },
  errandCancelled: { envKey: 'WX_TPL_ERRAND_CANCELLED', page: 'pages/errand-detail/index', label: '订单取消通知' },
  auditCert: { envKey: 'WX_TPL_AUDIT_CERT', page: 'pages/user/index', label: '认证审核通知' },
  audit: { envKey: 'WX_TPL_AUDIT', page: 'pages/user/index', label: '审核结果通知' },
  auditPass: { envKey: 'WX_TPL_AUDIT_PASS', page: 'pages/user/index', label: '审核通过提醒' },
  message: { envKey: 'WX_TPL_MESSAGE', page: 'pages/my-messages/index', label: '聊天信息提醒' },
  userPmNotice: { envKey: 'WX_TPL_USER_PM_NOTICE', page: 'pages/my-messages/index', label: '用户私信通知' },
  reportResult: { envKey: 'WX_TPL_REPORT_RESULT', page: 'pages/user/index', label: '举报结果通知' }
}

// ===== 同类消息合并窗口（毫秒）=====
// 语义：窗口内同一用户同一模板只发一条，后续消息转入待发表、过窗后补发。
//
// 当前策略（2026-09-15 起）：**全部模板不合并** —— 每收到一条消息立即独立触发一次微信提醒。
// 原策略：commentNew / commentReply / message 三个高频模板 5 分钟合并，目的是避免突发刷屏
//   把用户额度瞬间耗光；代价是窗口内后续消息只落待发表，用户实际只收到 1 条。
//
// 恢复合并：在 server/.env 设 SUBSCRIBE_MERGE_WINDOW_MS=300000（5 分钟）后重启，无需改代码。
//   0 或不设 = 不合并（当前默认）；非法值一律按不合并处理（安全兜底）。
//   仅下列三个高频模板参与合并，其余（交易/资金/审核/活动）始终逐条推送。
const MERGE_WINDOW_TYPES = ['commentNew', 'commentReply', 'message']
const MERGE_WINDOW_MS = (() => {
  const ms = Number(String(process.env.SUBSCRIBE_MERGE_WINDOW_MS || '').trim())
  if (!Number.isFinite(ms) || ms <= 0) return {}
  const map = {}
  MERGE_WINDOW_TYPES.forEach((type) => { map[type] = ms })
  return map
})()

// ===== 发送重试 =====
// 只重试「重试有意义」的错误：
//   网络类：超时 / 连接被重置 / DNS 抖动 —— 下一次大概率成功
//   微信侧：-1 系统繁忙、45009 接口调用超限、43004 需要接收者关注 —— 退避后可能成功
//   凭据类：40001/42001/40014 access_token 失效 —— 换一个新 token 就能发出去（见下）
// 绝不重试：
//   43101 用户拒收（额度已清零，重试只会白发）
//   47003 模板字段不符（重试一万次也一样，属于配置/字段 bug，必须靠日志发现）
const RETRYABLE_WECHAT_CODES = [-1, 45009, 43004, 40001, 42001, 40014]

// 凭据类错误码：消息本身没问题，坏的是 access_token。
// 这类失败必须先丢弃本地缓存、向微信要一个新 token，再重发；
// 否则重试拿到的还是同一个坏 token，三次全败。
// 触发场景：多实例并发刷新 token 时，先刷新的那个会让其它实例手里的 token 立即失效
// （cgi-bin/token 的行为；现已改用 cgi-bin/stable_token，这里作为兜底自愈）。
const TOKEN_ERROR_CODES = [40001, 42001, 40014]

const RETRYABLE_NETWORK_CODES = ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK', 'ERR_BAD_RESPONSE']
const SEND_RETRY_DELAYS_MS = [400, 1200]   // 首次失败后共重试 2 次（退避）

// ===== 待发表（合并窗口 / 额度不足时不再丢内容）=====
const DEFER_RETRY_DELAY_SEC = 120        // 无额度时的重试间隔（额度恢复依赖用户重新授权）
const MAX_PENDING_RETRY = 15             // 单个槽位最多重试 15 次（约 30 分钟）后丢弃
const QUOTA_NOTICE_THROTTLE_MS = 24 * 60 * 60 * 1000   // 额度不足站内信提示的节流窗口
const BROADCAST_BATCH_SIZE = 15          // 广播分批并发大小

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableNetworkError(err) {
  if (!err) return false
  if (err.response && Number(err.response.status) >= 500) return true
  return RETRYABLE_NETWORK_CODES.indexOf(String(err.code || '')) > -1
}

function templateIdOf(tplType) {
  const config = TPL_CONFIG[tplType]
  if (!config) return ''
  return String(process.env[config.envKey] || '').trim()
}

function defaultPageOf(tplType) {
  const config = TPL_CONFIG[tplType]
  return config ? config.page : ''
}

/**
 * 模板类型 → 中文标签。
 *
 * 管理后台的「日志 → 订阅消息」要显示中文（`commentNew` → 「新的评论提醒」），
 * 标签统一以这里为唯一真源，不要在客户端另抄一份。
 * 未知类型回落为原始 key，方便排查新增模板时忘了登记。
 */
function labelOf(tplType) {
  const config = TPL_CONFIG[tplType]
  return (config && config.label) || String(tplType || '') || '未知模板'
}

// 微信订阅消息 data 字段有严格长度限制，超长会被拒（errcode 47003）。
// thing 类上限 20 字符，character_string 上限 32，amount 需为「数字」格式。
function clip(value, max) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// 微信对订阅消息 data 里的**空值字段**直接返回 47003，而该错误不可重试、只会静默失败。
// 所以对「业务上可能为空」的字段统一给兜底文案：宁可显示占位，也不要整条消息发不出去。
function clipOr(value, max, fallback) {
  return clip(value, max) || String(fallback || '无')
}

/**
 * 找出 data 中的空值字段（微信会以 47003 拒绝整条消息，且该错误不可重试）。
 *
 * 为什么需要这道护栏：各 pushXxx 的字段兜底曾长期靠人工保证，漏一处就是
 * 「这条模板 100% 发不出去、但没有任何报错」—— commentReply 的 thing20 因帖子标题选填
 * 而长期为空，历史 11 次发送全部失败、0 次成功，直到排查额度时才被发现。
 * 这里把「空值」变成 pm2 日志里可见的 warn，而不是只留一条 status=failed。
 *
 * @returns {string[]} 空值字段名列表
 */
function findEmptyFields(data) {
  return Object.keys(data || {}).filter((key) => {
    const item = data[key]
    const value = item && item.value
    return value === undefined || value === null || String(value).trim() === ''
  })
}

function warnEmptyFields(tplType, data) {
  const empties = findEmptyFields(data)
  if (empties.length) {
    console.warn(`[Subscribe] ${tplType} 存在空值字段，微信将返回 47003：${empties.join(',')}`)
  }
  return empties
}

// 微信 date 类型格式：YYYY年MM月DD日
// ⚠️ 空值会被微信以 47003 拒绝（不可重试），故入参为空时兜底为「当前时间」。
function fmtWxDate(value) {
  const text = String(value || '').trim().replace('T', ' ')
  if (!text) return fmtWxDate(nowWxTime())
  const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return clip(text, 32)
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
}

// 微信 time 类型格式：YYYY-MM-DD HH:mm
// ⚠️ 同上，入参为空时兜底为当前时间，避免空值导致整条消息 47003。
function fmtWxTime(value) {
  const text = String(value || '').trim().replace('T', ' ')
  if (!text) return nowWxTime()
  const m = text.match(/^(\d{4}-\d{1,2}-\d{1,2})[ T](\d{1,2}:\d{2})/)
  if (!m) return clip(text, 32)
  return `${m[1]} ${m[2]}`
}

function nowWxTime() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// amount 类型：纯数字（最多两位小数），不得带「元」等单位；入参为分
function amountText(amountFen) {
  const fen = Number(amountFen || 0)
  return (fen / 100).toFixed(2)
}

/**
 * 累加订阅额度（用户在前端点了「允许」后上报）
 * @param {number} userId
 * @param {string[]} tplTypes 本次授权的模板类型
 * @returns {Promise<Object>} 各模板累计后的剩余额度
 */
async function grantQuota(userId, tplTypes) {
  const types = (Array.isArray(tplTypes) ? tplTypes : [tplTypes])
    .filter((t) => TPL_TYPES.includes(t))
    .filter((t, index, list) => list.indexOf(t) === index)
  if (!userId || !types.length) return {}
  for (const tplType of types) {
    await pool.query(
      `INSERT INTO user_subscribe_quota (user_id, tpl_type, remain, total_granted)
       VALUES (?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE remain = remain + 1, total_granted = total_granted + 1`,
      [userId, tplType]
    )
  }
  return quotaOf(userId)
}

/**
 * 查询用户在某模板上的剩余额度
 */
async function quotaOf(userId, tplType) {
  if (tplType) {
    const [rows] = await pool.query(
      'SELECT tpl_type, remain, total_granted, total_sent FROM user_subscribe_quota WHERE user_id = ? AND tpl_type = ?',
      [userId, tplType]
    )
    return rows.length ? { remain: Number(rows[0].remain) } : { remain: 0 }
  }
  const [rows] = await pool.query(
    'SELECT tpl_type, remain, total_granted, total_sent FROM user_subscribe_quota WHERE user_id = ?',
    [userId]
  )
  const result = {}
  TPL_TYPES.forEach((t) => { result[t] = 0 })
  rows.forEach((row) => { result[row.tpl_type] = Number(row.remain) })
  return result
}

/**
 * 领取发送许可：在合并窗口内若已发过同类消息则拒绝本次发送。
 * 用 subscribe_message_log 做轻量判断，不额外引入 Redis 依赖。
 *
 * 当前 MERGE_WINDOW_MS 为空（不合并），因此对所有模板都会在第一步直接放行 ——
 * 每条消息独立成一次微信推送，不做任何同类去重。
 */
async function allowByMergeWindow(userId, tplType) {
  const windowMs = MERGE_WINDOW_MS[tplType] || 0
  if (!windowMs) return true
  const [rows] = await pool.query(
    `SELECT id FROM subscribe_message_log
     WHERE user_id = ? AND tpl_type = ? AND status = 'sent'
       AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
     LIMIT 1`,
    [userId, tplType, Math.floor(windowMs / 1000)]
  )
  return !rows.length
}

async function writeLog({ userId, tplType, templateId = '', page = '', summary = '', status, errcode = null, errmsg = '' }) {
  try {
    await pool.query(
      `INSERT INTO subscribe_message_log (user_id, tpl_type, template_id, page, summary, status, errcode, errmsg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, tplType, templateId, page, clip(summary, 250), status, errcode, clip(errmsg, 250)]
    )
  } catch (e) {
    console.error('[SubscribeLog]', e.message)
  }
}

/**
 * 记录一次「命中弹窗节流」。
 *
 * 这是**唯一由客户端主动写入**的日志类型：节流判定必须发生在 wx.requestSubscribeMessage
 * 的同步调用链内（微信硬性要求），服务端无法感知「这次点击被本地节流拦下了」，只能靠上报。
 *
 * tpl_type 取该触发组的**首个模板类型** —— 触发组是客户端概念，服务端只认模板类型；
 * 渠道文案（如「评论通知」）与次数放在 summary / errmsg 里，便于管理后台「命中节流」直接阅读。
 *
 * @param {number} userId
 * @param {string} tplType 该触发组的首个模板类型（已在 controller 校验）
 * @param {{label?:string, used?:number, limit?:number}} options
 */
async function logThrottleHit(userId, tplType, options = {}) {
  const label = clip(options.label || '', 40)
  const used = Number(options.used || 0)
  const limit = Number(options.limit || 0)
  await writeLog({
    userId,
    tplType,
    // summary 只放渠道文案（如「评论通知」），管理后台单独一行展示，也便于关键词搜索
    summary: label || tplType,
    status: 'throttled',
    errmsg: '今日已弹 ' + used + ' 次，上限 ' + limit + ' 次，本次不再弹窗'
  })
}

async function consumeQuota(userId, tplType) {
  await pool.query(
    'UPDATE user_subscribe_quota SET remain = GREATEST(0, remain - 1), total_sent = total_sent + 1 WHERE user_id = ? AND tpl_type = ?',
    [userId, tplType]
  )
}

async function clearQuota(userId, tplType) {
  await pool.query(
    'UPDATE user_subscribe_quota SET remain = 0 WHERE user_id = ? AND tpl_type = ?',
    [userId, tplType]
  )
}

/**
 * 调一次微信订阅消息发送接口。
 * @returns {Promise<Object>} 微信响应体（正常或带 errcode）
 * @throws 网络/超时/5xx 等异常交给调用方判断是否重试
 */
async function postToWechat(openid, templateId, page, data, options = {}) {
  // 上一轮撞到 40001/42001 时，这里跳过本地缓存、直接向微信要一个新 token 再发
  const token = options.forceTokenRefresh
    ? await getAccessToken({ forceRefresh: true })
    : await getAccessToken()
  const { data: response } = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { touser: openid, template_id: templateId, page, data },
    { timeout: 8000 }
  )
  return response
}

/**
 * 带退避重试的发送：最多 1 + SEND_RETRY_DELAYS_MS.length 次。
 * 可重试错误（网络抖动、微信 -1 系统繁忙 / 45009 限流、40001 凭据失效）会退避后重试；
 * 不可重试错误（43101 拒收、47003 字段不符）第一次就返回，交给上层记录。
 *
 * 为什么不重试 43101/47003：前者额度已清零、重试必然再失败；
 * 后者是模板字段与微信后台不一致的配置问题，重试不会自愈，只会浪费调用量并掩盖问题。
 *
 * 40001/42001 为什么要专门处理：那是 access_token 坏了、不是消息坏了，
 * 只要换一个新 token 就能发出去 —— 属于可自愈错误，绝不能就此记 failed。
 */
async function callWechatSend(openid, templateId, page, data) {
  const maxAttempts = SEND_RETRY_DELAYS_MS.length + 1
  let lastResponse = null
  let lastError = null
  let forceTokenRefresh = false
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const useFreshToken = forceTokenRefresh
    forceTokenRefresh = false
    try {
      const response = await postToWechat(openid, templateId, page, data, { forceTokenRefresh: useFreshToken })
      if (!response || !response.errcode) return response
      lastResponse = response
      const code = Number(response.errcode)
      // 凭据失效：标记下一轮换新 token（该码也在 RETRYABLE 里，所以不会被提前 return 掉）
      if (TOKEN_ERROR_CODES.indexOf(code) > -1) forceTokenRefresh = true
      // 微信返回了业务错误码：不可重试的直接返回，可重试的继续下一轮
      if (RETRYABLE_WECHAT_CODES.indexOf(code) < 0) return response
      console.error(`[Subscribe] ${templateId} 第 ${attempt + 1} 次失败 ${response.errcode}: ${response.errmsg}`)
    } catch (err) {
      lastError = err
      if (!isRetryableNetworkError(err)) throw err
      console.error(`[Subscribe] ${templateId} 第 ${attempt + 1} 次网络异常 ${err.code || err.message}`)
    }
    if (attempt < maxAttempts - 1) await sleep(SEND_RETRY_DELAYS_MS[attempt])
  }
  if (lastResponse) return lastResponse
  throw lastError || new Error('发送失败')
}

/**
 * 把「本该发但没发出去」的消息写进待发表 —— 命中合并窗口或额度不足时不再直接丢内容。
 *
 * 槽位语义：每个 (user_id, tpl_type) 只保留**最近一条**。
 * 窗口内来 10 条评论最终只补发 1 条（内容取最新），既不会刷屏，也保证「至少有一条能到」。
 * `created_at` 每次 defer 都刷新，便于排查看「最后一次待发是什么时候」。
 * `notice_sent_at` 刻意不刷新（站内信节流依赖它）。
 *
 * @param {string} reason 'merged' | 'no_quota'
 */
async function deferMessage(userId, tplType, data, options = {}) {
  try {
    const windowMs = MERGE_WINDOW_MS[tplType] || 0
    const delaySec = options.reason === 'merged' && windowMs
      ? Math.ceil(windowMs / 1000)
      : DEFER_RETRY_DELAY_SEC
    await pool.query(
      `INSERT INTO subscribe_pending_message
         (user_id, tpl_type, data_json, page, summary, reason, status, retry_count, next_retry_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, DATE_ADD(NOW(), INTERVAL ? SECOND), NOW())
       ON DUPLICATE KEY UPDATE
         data_json = VALUES(data_json), page = VALUES(page), summary = VALUES(summary),
         reason = VALUES(reason), status = 'pending', retry_count = 0,
         next_retry_at = VALUES(next_retry_at), created_at = NOW()`,
      [
        userId, tplType, JSON.stringify(data || {}),
        clip(options.page || '', 128), clip(options.summary || '', 255),
        options.reason === 'no_quota' ? 'no_quota' : 'merged', delaySec
      ]
    )
  } catch (e) {
    console.error('[SubscribeDefer]', e.message)
  }
}

async function markPendingSent(id) {
  await pool.query("UPDATE subscribe_pending_message SET status = 'sent' WHERE id = ?", [id])
}

async function dropPending(id) {
  await pool.query("UPDATE subscribe_pending_message SET status = 'dropped' WHERE id = ?", [id])
}

/**
 * 额度用尽时给用户一条**站内信**：微信推送发不出去，站内信至少让用户知道要重新订阅。
 * 按 (user, tpl_type) 24 小时节流，避免高频场景反复打扰。
 */
async function notifyQuotaExhausted(userId, tplType) {
  try {
    const [rows] = await pool.query(
      'SELECT id, notice_sent_at FROM subscribe_pending_message WHERE user_id = ? AND tpl_type = ? LIMIT 1',
      [userId, tplType]
    )
    const row = rows[0]
    if (!row) return
    if (row.notice_sent_at && Date.now() - new Date(row.notice_sent_at).getTime() < QUOTA_NOTICE_THROTTLE_MS) return
    // 先占位再发，避免并发下重复打扰
    await pool.query('UPDATE subscribe_pending_message SET notice_sent_at = NOW() WHERE id = ?', [row.id])
    const label = labelOf(tplType)
    // 惰性 require：notificationService 依赖本模块，模块级 require 会构成循环依赖
    const { createNotification } = require('./notificationService')
    await createNotification({
      userId,
      type: 'system',
      title: '微信提醒次数已用尽',
      content: `「${label}」的微信订阅提醒次数已用完，需要重新订阅才能继续收到微信通知。可回到对应页面点击顶部的订阅入口，或在「设置 → 通知渠道」中重新开启。`
    })
  } catch (e) {
    console.error('[SubscribeQuotaNotice]', e.message)
  }
}

/**
 * 补发扫描：把到期的待发消息重新尝试发送。
 * - 多实例安全：先把自己这条的 next_retry_at 推后来「抢占」，抢不到说明另一实例在处理
 * - 重试超限（MAX_PENDING_RETRY）或遇永久性失败（拒收/字段不符）→ 置 dropped，不再纠缠
 * - 仍然没额度/仍在窗口内 → 留在 pending，等下轮
 *
 * @returns {Promise<{scanned:number, sent:number, pending:number, dropped:number}>}
 */
async function flushPending(limit = 50) {
  const result = { scanned: 0, sent: 0, pending: 0, dropped: 0 }
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, tpl_type, data_json, page, summary, retry_count
       FROM subscribe_pending_message
       WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY id ASC LIMIT ?`,
      [limit]
    )
    result.scanned = rows.length
    for (const row of rows) {
      const [claimed] = await pool.query(
        `UPDATE subscribe_pending_message
            SET next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND), retry_count = retry_count + 1
          WHERE id = ? AND status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW())`,
        [DEFER_RETRY_DELAY_SEC, row.id]
      )
      if (!claimed.affectedRows) continue

      if (Number(row.retry_count) + 1 > MAX_PENDING_RETRY) {
        await dropPending(row.id)
        result.dropped++
        continue
      }

      let data = {}
      try { data = JSON.parse(row.data_json || '{}') } catch (e) { data = {} }
      const res = await push(row.user_id, row.tpl_type, data, {
        page: row.page, summary: row.summary, fromPending: true
      })
      if (res.sent) { await markPendingSent(row.id); result.sent++ }
      else if (res.reason === 'no_quota' || res.reason === 'merged') result.pending++
      else { await dropPending(row.id); result.dropped++ }
    }
  } catch (e) {
    console.error('[SubscribeRetry]', e.message)
  }
  if (result.sent || result.dropped) {
    console.log(`[SubscribeRetry] 补发 sent=${result.sent} dropped=${result.dropped} pending=${result.pending} scanned=${result.scanned}`)
  }
  return result
}

/**
 * 下发一条订阅消息。
 *
 * 调用约定：业务代码只管把「这次要告诉用户什么」传进来，
 * 额度、模板、页面、频控、日志全部在此处理，业务侧无需感知。
 *
 * @returns {Promise<{sent:boolean, reason?:string}>} 永不抛错——通知失败不得回滚业务
 */
async function push(userId, tplType, data, options = {}) {
  try {
    if (!userId || !TPL_TYPES.includes(tplType)) return { sent: false, reason: 'bad_param' }

    const templateId = templateIdOf(tplType)
    // 未配置模板 ID：静默降级，只留站内信
    if (!templateId) return { sent: false, reason: 'template_not_configured' }

    const page = options.page || defaultPageOf(tplType)
    const summary = options.summary || ''
    // 补发路径（flushPending 调进来）不再二次落待发表，也不会重复发站内信
    const fromPending = !!options.fromPending

    // 1) 额度检查：没额度直接放弃，避免无谓调用微信接口
    const { remain } = await quotaOf(userId, tplType)
    if (remain <= 0) {
      // 不再把内容丢掉：落进待发表，等用户重新订阅、额度恢复后补发
      if (!fromPending) await deferMessage(userId, tplType, data, { reason: 'no_quota', page, summary })
      await writeLog({ userId, tplType, templateId, page, summary, status: 'skipped', errmsg: '额度不足' })
      // 微信推不出去，至少让用户在站内知道要重新订阅（24 小时节流）
      if (!fromPending) await notifyQuotaExhausted(userId, tplType)
      return { sent: false, reason: 'no_quota' }
    }

    // 2) 频控：合并窗口内已发过同类消息 → 本次内容落待发表，过窗后补发（原先直接丢弃）。
    //    当前 MERGE_WINDOW_MS 为空（不合并），本分支恒不命中；保留以支持用环境变量恢复合并。
    if (!(await allowByMergeWindow(userId, tplType))) {
      if (!fromPending) await deferMessage(userId, tplType, data, { reason: 'merged', page, summary })
      await writeLog({ userId, tplType, templateId, page, summary, status: 'merged', errmsg: '窗口内已发送，已转入待发补发' })
      return { sent: false, reason: 'merged' }
    }

    // 3) 取 openid
    const [users] = await pool.query('SELECT openid FROM sys_user WHERE id = ? AND status = 1 LIMIT 1', [userId])
    if (!users.length || !users[0].openid) {
      await writeLog({ userId, tplType, templateId, page, summary, status: 'failed', errmsg: '用户无 openid' })
      return { sent: false, reason: 'no_openid' }
    }

    // 4) 空值字段预检（只告警不阻断）→ 再发送（带退避重试；43101/47003 不重试）
    warnEmptyFields(tplType, data)
    const response = await callWechatSend(users[0].openid, templateId, page, data)

    if (response.errcode) {
      const errcode = Number(response.errcode)
      // 43101：用户拒收/未订阅 → 额度已无意义，清零避免持续重试
      if (errcode === 43101) await clearQuota(userId, tplType)
      await writeLog({
        userId, tplType, templateId, page, summary, status: 'failed',
        errcode, errmsg: response.errmsg || ''
      })
      console.error(`[Subscribe] ${tplType} 发送失败 ${errcode}: ${response.errmsg}`)
      return { sent: false, reason: `errcode_${errcode}` }
    }

    // 5) 发送成功才扣额度
    await consumeQuota(userId, tplType)
    await writeLog({ userId, tplType, templateId, page, summary, status: 'sent' })
    return { sent: true }
  } catch (e) {
    // 任何异常都吞掉：订阅消息是增强能力，绝不能影响评论/下单等主流程
    console.error('[Subscribe]', e.message)
    return { sent: false, reason: 'exception' }
  }
}

// ===== 各业务场景的便捷封装 =====
// data 字段（编号+类型）严格按《订阅消息模板分类 (2).xlsx》「数据字段」列逐字段映射。
// 标注「备用」的模板暂无业务发送点，函数已按表格字段写好，接入时直接调用即可。

/** 新的评论提醒（thing17 来自频道 / thing6 帖子内容 / thing2 评论内容 / number8 评论人数 / time3 评论时间） */
function pushComment(userId, { channelText, postDigest, commentDigest, timeText, postId, commentId }) {
  return push(userId, 'commentNew', {
    thing17: { value: clip(channelText || '校园论坛', 20) },
    thing6: { value: clip(postDigest || '查看帖子详情', 20) },
    thing2: { value: clip(commentDigest || '新评论', 20) },
    number8: { value: '1' },
    time3: { value: clip(timeText || nowWxTime(), 32) }
  }, {
    // 携带评论 id：从「服务通知」点进来直接定位到该条评论
    page: `pages/post-detail/index?id=${postId}${commentId ? '&commentId=' + commentId : ''}`,
    summary: `新评论：${commentDigest}`
  })
}

/**
 * 评论回复通知（thing20 原文内容 / time9 评论时间 / thing6 评论用户 / thing8 评论内容）
 *
 * ⚠️ 三个 thing 字段一律用 clipOr 兜底：微信对空值字段直接返回 47003（不可重试、只留 failed 日志）。
 * 本函数曾用 `clip(x || '', 20)`，而帖子的 title 是选填（大量帖子没有标题），
 * 导致 thing20 长期为空 —— 历史统计 11 次发送 100% 失败、0 次成功。
 */
function pushCommentReply(userId, { postDigest, actorNick, commentDigest, timeText, postId, commentId }) {
  return push(userId, 'commentReply', {
    thing20: { value: clipOr(postDigest, 20, '你发布的帖子') },
    time9: { value: clip(timeText || nowWxTime(), 32) },
    thing6: { value: clipOr(actorNick, 20, '有同学') },
    thing8: { value: clipOr(commentDigest, 20, '回复了你的评论') }
  }, {
    page: `pages/post-detail/index?id=${postId}${commentId ? '&commentId=' + commentId : ''}`,
    summary: `评论回复：${commentDigest}`
  })
}

/** 聊天信息提醒（thing2 温馨提示 / thing5 聊天信息 / thing1 发送人 / time3 发送时间） */
function pushMessage(userId, { senderNick, digest, timeText }) {
  return push(userId, 'message', {
    thing2: { value: clip('您有新的聊天消息，请及时回复', 20) },
    thing5: { value: clipOr(digest, 20, '你有一条新消息') },
    thing1: { value: clip(senderNick || '有同学', 20) },
    time3: { value: clip(timeText || nowWxTime(), 32) }
  }, {
    page: 'pages/my-messages/index',
    summary: `${senderNick} 发来私信`
  })
}

/** 用户私信通知（备用：thing2 私信内容 / date3 私信时间 / thing5 私信用户 / thing6 备注） */
function pushUserPmNotice(userId, { senderNick, digest, timeText }) {
  return push(userId, 'userPmNotice', {
    thing2: { value: clipOr(digest, 20, '你有一条新私信') },
    date3: { value: fmtWxDate(timeText || nowWxTime()) },
    thing5: { value: clipOr(senderNick, 20, '有同学') },
    thing6: { value: clip('请前往消息中心回复', 20) }
  }, {
    page: 'pages/my-messages/index',
    summary: `${senderNick} 发来私信`
  })
}

// 跑腿订单落地页构造
function errandOptions(orderId, summary) {
  return { page: `pages/errand-detail/index?id=${orderId}`, summary: summary || `订单 #${orderId}` }
}

// 跑腿订单：接单（character_string1 订单号 / thing12 任务名称 / amount2 订单金额 / thing13 接单人员 / time14 接单时间）
function pushErrandAccepted(userId, { orderNo, taskName, amountFen, acceptorNick, orderId }) {
  return push(userId, 'errandAccepted', {
    character_string1: { value: clip(orderNo || String(orderId), 32) },
    thing12: { value: clip(taskName || '跑腿代拿', 20) },
    amount2: { value: amountText(amountFen) },
    thing13: { value: clip(acceptorNick || '同学', 20) },
    time14: { value: nowWxTime() }
  }, errandOptions(orderId, `订单已被接单：${taskName}`))
}

// 跑腿订单：完成（thing5 订单类型 / time3 完成时间 / thing4 订单备注 / amount2 订单金额）
function pushErrandFinished(userId, { orderType, note, amountFen, orderId, summary }) {
  return push(userId, 'errandFinished', {
    thing5: { value: clip(orderType || '跑腿代拿', 20) },
    time3: { value: nowWxTime() },
    thing4: { value: clipOr(note, 20, '无') },
    amount2: { value: amountText(amountFen) }
  }, errandOptions(orderId, summary || '订单已完成'))
}

// 跑腿订单：取消（character_string1 订单号 / thing14 订单名称 / amount2 订单金额 / thing9 取消原因 / thing4 订单备注）
function pushErrandCancelled(userId, { orderNo, orderName, amountFen, reason, note, orderId, summary }) {
  return push(userId, 'errandCancelled', {
    character_string1: { value: clip(orderNo || String(orderId), 32) },
    thing14: { value: clip(orderName || '跑腿订单', 20) },
    amount2: { value: amountText(amountFen) },
    thing9: { value: clip(reason || '订单取消', 20) },
    thing4: { value: clipOr(note, 20, '无') }
  }, errandOptions(orderId, summary || '订单已取消'))
}

/** 报名成功通知（thing1 活动名称 / date3 活动时间 / thing2 活动地址 / thing7 活动主题 / number5 报名人数） */
function pushActivitySignup(userId, { activityTitle, activityTime, activityLocation, activityCategory, signupCount, activityId }) {
  return push(userId, 'activitySignup', {
    thing1: { value: clip(activityTitle || '活动', 20) },
    date3: { value: fmtWxDate(activityTime) },
    thing2: { value: clip(activityLocation || '详见活动详情', 20) },
    thing7: { value: clip(activityCategory || '校园活动', 20) },
    number5: { value: String(Math.max(Number(signupCount || 0), 1)) }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `报名成功：${activityTitle}`
  })
}

/** 活动开始提醒（thing1 活动名称 / date2 活动时间 / date5 开始时间 / thing11 活动内容 / date6 结束时间） */
function pushActivityStart(userId, { activityTitle, activityStart, activityEnd, location, activityId }) {
  const start = String(activityStart || '').replace('T', ' ')
  const end = String(activityEnd || '').replace('T', ' ')
  const startTimeOnly = (start.match(/(\d{1,2}:\d{2})/) || [])[1] || ''
  return push(userId, 'activityStart', {
    thing1: { value: clip(activityTitle || '活动', 20) },
    date2: { value: fmtWxDate(start) },
    date5: { value: clip(startTimeOnly, 32) },
    thing11: { value: clip(location || '详见活动详情', 20) },
    date6: { value: end ? fmtWxDate(end) : fmtWxDate(start) }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `活动即将开始：${activityTitle}`
  })
}

/** 活动审核通知（thing1 活动标题 / date2 活动时间 / phrase3 审核结果 ≤5字 / thing4 备注） */
function pushActivityAudit(userId, { activityTitle, activityStart, auditResult, note, timeText, activityId }) {
  return push(userId, 'activityAudit', {
    thing1: { value: clip(activityTitle || '活动', 20) },
    date2: { value: fmtWxDate(activityStart) },
    phrase3: { value: clip(auditResult || '通过', 5) },
    thing4: { value: clipOr(note, 20, '无') }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `活动审核${auditResult}：${activityTitle}`
  })
}

/** 活动报名结果通知（备用：thing1 活动名称 / time2 时间 / number4 报名人数 / time5 活动时间 / thing6 报名结果） */
function pushActivitySignupResult(userId, { activityTitle, signupCount, activityTime, resultText, activityId }) {
  return push(userId, 'activitySignupResult', {
    thing1: { value: clip(activityTitle || '活动', 20) },
    time2: { value: nowWxTime() },
    number4: { value: String(Math.max(Number(signupCount || 0), 0)) },
    time5: { value: fmtWxTime(activityTime) },
    thing6: { value: clip(resultText || '已通过', 20) }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `报名结果：${resultText}`
  })
}

/** 活动参与成功提醒（备用：phrase1 参与状态 / date2 参与时间 / thing3 活动名称 / thing4 备注） */
function pushActivityJoined(userId, { activityTitle, activityTime, note, activityId }) {
  return push(userId, 'activityJoined', {
    phrase1: { value: clip('参与成功', 5) },
    date2: { value: fmtWxDate(activityTime || new Date().toISOString()) },
    thing3: { value: clip(activityTitle || '活动', 20) },
    thing4: { value: clipOr(note, 20, '无') }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `参与成功：${activityTitle}`
  })
}

/** 活动报名通知（备用：phrase1 活动状态 / thing2 活动名称 / time12 报名开始时间 / date6 开始时间 / thing8 活动详情） */
function pushActivitySignupNotice(userId, { activityTitle, signupStart, activityStart, detailText, activityId }) {
  return push(userId, 'activitySignupNotice', {
    phrase1: { value: clip('报名中', 5) },
    thing2: { value: clip(activityTitle || '活动', 20) },
    time12: { value: fmtWxTime(signupStart) },
    date6: { value: fmtWxDate(activityStart) },
    thing8: { value: clip(detailText || '点击查看详情', 20) }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `活动报名：${activityTitle}`
  })
}

/** 新活动提醒（备用：thing1 活动名称 / time2 活动时间 / thing5 活动简介 / thing7 活动地点 / time8 报名截止时间） */
function pushActivityNew(userId, { activityTitle, activityTime, digest, location, signupStart, activityId }) {
  return push(userId, 'activityNew', {
    thing1: { value: clip(activityTitle || '活动', 20) },
    time2: { value: fmtWxTime(activityTime) },
    thing5: { value: clipOr(digest, 20, '点击查看活动详情') },
    thing7: { value: clipOr(location, 20, '详见活动详情') },
    time8: { value: fmtWxTime(signupStart) }
  }, {
    page: `pages/activity/detail?id=${activityId}`,
    summary: `新活动：${activityTitle}`
  })
}

/**
 * 公告类广播：向某模板仍有剩余额度的用户逐个推送（新活动提醒 / 活动报名通知）。
 * push() 自带额度校验、日志与异常吞并，这里只负责圈定人群。
 *
 * 分批并发：原先串行 for-await 推 200 人，排在队尾的用户要等前面每人
 * （约 5 次 DB + 1 次微信接口）全部跑完才轮到，延迟可累积到数十秒。
 * 改为每批 BROADCAST_BATCH_SIZE 人并发，批次之间串行以控制微信接口压力。
 * 上限 200 人，调用方以「不 await」方式触发，避免阻塞业务请求。
 */
async function pushBroadcast(tplType, build) {
  try {
    const [rows] = await pool.query(
      'SELECT user_id FROM user_subscribe_quota WHERE tpl_type = ? AND remain > 0 ORDER BY user_id LIMIT 200',
      [tplType]
    )
    for (let i = 0; i < rows.length; i += BROADCAST_BATCH_SIZE) {
      const batch = rows.slice(i, i + BROADCAST_BATCH_SIZE)
      await Promise.allSettled(batch.map((row) => {
        const data = typeof build === 'function' ? build(row.user_id) : build
        return push(row.user_id, tplType, data)
      }))
    }
  } catch (e) {
    console.error('[SubscribeBroadcast]', e.message)
  }
}

/** 认证审核通知（备用：number7 学号 / thing2 认证内容 / phrase1 审核结果 / thing4 备注 / time9 审核时间） */
function pushAuditCert(userId, { studentNo, certText, auditResult, note, timeText }) {
  return push(userId, 'auditCert', {
    number7: { value: String(studentNo || 0) },
    thing2: { value: clip(certText || '身份认证', 20) },
    phrase1: { value: clip(auditResult || '通过', 5) },
    thing4: { value: clipOr(note, 20, '无') },
    time9: { value: clip(timeText || nowWxTime(), 32) }
  }, { page: 'pages/user/index', summary: `认证审核${auditResult}` })
}

/**
 * 审核结果通知（thing5 审核内容 / phrase1 审核结果 / thing16 未通过原因 / thing3 审核类型 / character_string10 订单号）
 * 业务触点：客服对跑腿订单异议的裁决（adminController.reviewErrandDispute）。
 * 传 orderId 时落地页直达订单详情，否则回落到「我的」。
 */
function pushAuditResult(userId, { content, auditResult, rejectReason, auditType, orderNo, orderId }) {
  return push(userId, 'audit', {
    thing5: { value: clipOr(content, 20, '审核事项') },
    phrase1: { value: clip(auditResult || '通过', 5) },
    thing16: { value: clipOr(rejectReason, 20, '无') },
    thing3: { value: clip(auditType || '内容审核', 20) },
    character_string10: { value: clipOr(orderNo, 32, '-') }
  }, {
    page: orderId ? `pages/errand-detail/index?id=${orderId}` : 'pages/user/index',
    summary: `审核结果：${auditResult}`
  })
}

/**
 * 审核通过提醒（thing1 审核结果 / thing6 活动名称 / thing14 社群名称 / date4 通过时间 / date7 活动时间）
 *
 * ⚠️ 活动名称与社群名称在业务上互斥（活动审核通过时没有社群名，反之亦然），
 * 因此其中**必然有一个为空** —— 早期用 `clip(x || '', 20)` 会让本模板 100% 返回 47003。
 */
function pushAuditPass(userId, { activityTitle, communityName, activityTime, timeText }) {
  return push(userId, 'auditPass', {
    thing1: { value: clip('审核通过', 20) },
    thing6: { value: clipOr(activityTitle, 20, '无') },
    thing14: { value: clipOr(communityName, 20, '无') },
    date4: { value: fmtWxDate(timeText || new Date().toISOString()) },
    date7: { value: fmtWxDate(activityTime || timeText || new Date().toISOString()) }
  }, { page: 'pages/user/index', summary: '审核通过提醒' })
}

/** 举报结果通知（备用：后台未配置关键词字段，启用前先在微信后台补关键词并回填此处 data） */
function pushReportResult(userId, { digest }) {
  return push(userId, 'reportResult', {
    thing1: { value: clip(digest || '你的举报已处理', 20) }
  }, { page: 'pages/user/index', summary: '举报结果通知' })
}

// 提现结果通知（character_string1 提现单号 / amount2 提现金额 / time3 提现时间 / phrase4 审核状态 ≤5字 / thing5 备注）
function pushWithdrawResult(userId, { orderNo, amountFen, statusText, note }) {
  return push(userId, 'withdrawResult', {
    character_string1: { value: clipOr(orderNo, 32, '-') },
    amount2: { value: amountText(amountFen) },
    time3: { value: nowWxTime() },
    phrase4: { value: clip(statusText || '处理中', 5) },
    thing5: { value: clipOr(note, 20, '无') }
  }, { page: 'pkg-feature/pages/wallet/index', summary: '提现结果更新' })
}

// 提现成功通知（thing1 提现产品 / amount2 提现金额 / time3 提现时间 / time4 到账时间 / thing5 备注）
function pushWithdrawSuccess(userId, { amountFen, note }) {
  const now = nowWxTime()
  return push(userId, 'withdrawSuccess', {
    thing1: { value: clip('校园互助提现', 20) },
    amount2: { value: amountText(amountFen) },
    time3: { value: now },
    time4: { value: now },
    thing5: { value: clip(note || '已到账微信零钱', 20) }
  }, { page: 'pkg-feature/pages/wallet/index', summary: '提现成功' })
}

/**
 * 管理员批量推送（跑腿异议等场景推给所有在岗管理员）
 */
async function pushToMany(userIds, tplType, data, options = {}) {
  const list = Array.from(new Set((userIds || []).filter(Boolean)))
  const results = await Promise.allSettled(list.map((id) => push(id, tplType, data, options)))
  return results.filter((r) => r.status === 'fulfilled' && r.value.sent).length
}

module.exports = {
  TPL_TYPES,
  labelOf,
  grantQuota,
  quotaOf,
  push,
  flushPending,
  deferMessage,
  // 空值字段护栏（供测试与排障使用）
  findEmptyFields,
  pushComment,
  pushCommentReply,
  pushMessage,
  pushUserPmNotice,
  pushErrandAccepted,
  pushErrandFinished,
  pushErrandCancelled,
  pushActivitySignup,
  pushActivityStart,
  pushActivityAudit,
  pushActivitySignupResult,
  pushActivityJoined,
  pushActivitySignupNotice,
  pushActivityNew,
  pushBroadcast,
  pushAuditCert,
  pushAuditResult,
  pushAuditPass,
  pushReportResult,
  pushWithdrawSuccess,
  pushWithdrawResult,
  pushToMany,
  // 命中弹窗节流（客户端上报写入）
  logThrottleHit
}
