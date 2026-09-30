const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const axios = require('axios')
const pool = require('../config/pool')
const { getAccessToken } = require('../utils/wechatToken')
const { deleteObject } = require('../config/cos')

/**
 * 媒体内容安全异步检测（微信 wxa/media_check_async）。
 *
 * 为什么需要它：
 * - 同步接口 wxa/img_sec_check 只支持图片且单张 ≤1MB；服务器缺少 sharp 时大图无法压到限制内。
 * - 官方给大图/音频的兜底方案就是「异步检测 + 小程序消息推送回调」：传 URL 给微信，
 *   微信检测完把结果推到我们的回调地址，违规内容再由本服务下线。
 *
 * 启用条件（缺一则整体降级为「照常放行 + 只记日志」，不影响小程序正常运行）：
 * - WX_MESSAGE_TOKEN：微信公众平台「开发 → 消息推送」里配置的 Token，用于校验回调来源。
 *   未配置时不提交异步任务（没有可验签的回调通道，结果永远回不来）。
 *
 * 官方限制：media_check_async 只支持图片(media_type=2)与音频(1)，**不支持视频**。
 * 视频因此走「真实文件类型校验 + 上传频次限制 + 举报/后台下架」的组合策略。
 */
const SCENE_PROFILE = 1
const SCENE_COMMENT = 2
const SCENE_FORUM = 3
const SCENE_SOCIAL = 4
// 回调违规状态集合：这些地址在读取出口统一过滤
const BLOCKED_STATUSES = ['review', 'risky', 'removed', 'failed']
// 违规地址集合的刷新间隔：回调即时更新内存，定时刷新兜住多实例部署
const BLOCKED_REFRESH_MS = 5 * 60 * 1000

let warnedNoToken = false
let blockedUrls = new Set()
let refreshTimer = null

function pushToken() {
  return String(process.env.WX_MESSAGE_TOKEN || '').trim()
}

// 异步检测链路是否可用（必须能验签回调，否则检测结果不可信）
function available() {
  return !!pushToken()
}

function warnOnce() {
  if (warnedNoToken) return
  warnedNoToken = true
  console.warn('[MediaCheck] 未配置 WX_MESSAGE_TOKEN，异步媒体检测未启用（上传仍正常放行）')
}

/**
 * 提交异步检测。任何失败都不抛出：检测不可用时不能阻断用户发布。
 * @param {{userId:number, mediaUrl:string, mediaType?:'image'|'audio', objectKey?:string, openid?:string, scene?:number}} params
 * @returns {Promise<{submitted:boolean, reason?:string, traceId?:string}>}
 */
async function submit({ userId, mediaUrl, mediaType = 'image', objectKey = '', openid, scene = SCENE_FORUM }) {
  if (!available()) {
    warnOnce()
    return { submitted: false, reason: 'token_not_configured' }
  }
  try {
    if (!mediaUrl) return { submitted: false, reason: 'no_url' }
    const numericType = mediaType === 'audio' ? 1 : 2
    const token = await getAccessToken()
    const { data } = await axios.post(
      `https://api.weixin.qq.com/wxa/media_check_async?access_token=${token}`,
      {
        media_url: mediaUrl,
        media_type: numericType,
        version: 2,
        // scene：1 资料 / 2 评论 / 3 论坛 / 4 社交日志
        scene: Number(scene) >= SCENE_PROFILE && Number(scene) <= SCENE_SOCIAL ? Number(scene) : SCENE_FORUM,
        openid: openid || undefined,
      },
      { timeout: 15000 },
    )
    const errcode = Number((data || {}).errcode || 0)
    if (errcode !== 0 || !data.trace_id) {
      console.error('[MediaCheck] 提交失败:', data && (data.errmsg || errcode))
      return { submitted: false, reason: `errcode_${errcode}` }
    }
    await pool.query(
      `INSERT INTO media_check_task
         (user_id, trace_id, media_type, object_key, media_url, scene, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        userId || 0,
        String(data.trace_id),
        mediaType === 'audio' ? 'audio' : 'image',
        String(objectKey || ''),
        String(mediaUrl),
        Number(scene) || SCENE_FORUM,
      ],
    )
    return { submitted: true, traceId: String(data.trace_id) }
  } catch (error) {
    console.error('[MediaCheck] 提交异常:', error.message)
    return { submitted: false, reason: 'exception' }
  }
}

// 回调签名校验：sha1(sort(token, timestamp, nonce))
function verifySignature(query = {}) {
  const token = pushToken()
  if (!token) return false
  const { signature, timestamp, nonce } = query
  if (!signature || !timestamp || !nonce) return false
  const expected = crypto
    .createHash('sha1')
    .update([token, String(timestamp), String(nonce)].sort().join(''))
    .digest('hex')
  return expected === String(signature)
}

/**
 * 处理微信推送的媒体检测结果（事件名 wxa_media_check）。
 * event = { Event, trace_id, errcode, result:{suggest,label}, detail }
 */
async function handleEvent(event = {}) {
  if (String(event.Event || event.event || '') !== 'wxa_media_check') return false
  const traceId = String(event.trace_id || event.TraceId || '')
  if (!traceId) return false
  const [rows] = await pool.query('SELECT * FROM media_check_task WHERE trace_id = ? LIMIT 1', [traceId])
  const task = rows[0]
  if (!task) {
    console.warn('[MediaCheck] 收到未知 trace_id 回调:', traceId)
    return false
  }
  const errcode = Number(event.errcode || 0)
  const suggest = String((event.result || {}).suggest || '').toLowerCase()
  // 检测本身失败（errcode 非 0）按「未通过」处理：宁可下线，也不把无法判定的媒体留在公开地址
  const status = errcode !== 0 ? 'failed' : (suggest === 'pass' ? 'pass' : (suggest === 'review' ? 'review' : 'risky'))
  await pool.query(
    'UPDATE media_check_task SET status = ?, label = ?, errcode = ?, level_info = ? WHERE id = ?',
    [
      status,
      Number((event.result || {}).label || 0) || null,
      errcode || null,
      JSON.stringify(event.detail || {}).slice(0, 250),
      task.id,
    ],
  )
  if (status === 'pass') return true
  const url = String(task.media_url || '')
  if (url) {
    blockedUrls.add(url)
  }
  const removed = await removeMedia(task)
  if (removed) await pool.query("UPDATE media_check_task SET status = 'removed' WHERE id = ?", [task.id])
  console.warn(`[MediaCheck] 媒体未通过检测已下线：#${task.id} ${task.media_type} suggest=${suggest || 'unknown'} 删除文件=${removed}`)
  return true
}

async function removeMedia(task) {
  const url = String(task.media_url || '')
  const key = String(task.object_key || '')
  try {
    if (key && String(process.env.UPLOAD_STORAGE_DRIVER || 'object').toLowerCase() !== 'disk') {
      await deleteObject(key)
      return true
    }
    // disk 模式：URL 形如 ${UPLOAD_PUBLIC_BASE_URL}/uploads/<file> 或 /uploads/<file>
    const match = url.match(/\/uploads\/([^/?#]+)$/)
    if (!match) return false
    const file = path.join(__dirname, '../uploads', path.basename(match[1]))
    if (!fs.existsSync(file)) return false
    fs.unlinkSync(file)
    return true
  } catch (error) {
    console.error('[MediaCheck] 删除违规媒体失败:', error.message)
    return false
  }
}

function isBlocked(url) {
  const value = String(url || '').trim()
  return !!value && blockedUrls.has(value)
}

// 读取出口统一过滤：数组元素允许是 URL 字符串或 {url}/{path} 对象
function filterBlocked(list) {
  if (!Array.isArray(list) || !blockedUrls.size) return list
  return list.filter((item) => {
    if (typeof item === 'string') return !isBlocked(item)
    const url = item && (item.url || item.path)
    return !url || !isBlocked(url)
  })
}

// 库里图片列的历史形态有三种（NULL / JSON 字符串 / 已解析数组），
// 过滤后按原形态返回，读接口契约不变；集合为空时零开销直接透传。
function filterStoredImages(value) {
  if (!blockedUrls.size || !value) return value
  if (typeof value === 'string') {
    let parsed = null
    try { parsed = JSON.parse(value) } catch (e) { return value }
    const kept = filterBlocked(parsed)
    return JSON.stringify(kept)
  }
  return filterBlocked(value)
}

async function refreshBlockedUrls() {
  try {
    const [rows] = await pool.query(
      `SELECT media_url FROM media_check_task
       WHERE status IN (${BLOCKED_STATUSES.map(() => '?').join(',')}) AND media_url <> ''`,
      BLOCKED_STATUSES,
    )
    blockedUrls = new Set(rows.map((row) => String(row.media_url)))
  } catch (error) {
    // 表还没建好（首次启动迁移前）或库不可用：保留上一次集合，不影响读路径
    console.error('[MediaCheck] 刷新违规地址失败:', error.message)
  }
}

function start() {
  if (refreshTimer) return
  refreshBlockedUrls()
  refreshTimer = setInterval(refreshBlockedUrls, BLOCKED_REFRESH_MS)
  if (refreshTimer.unref) refreshTimer.unref()
}

function stop() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

module.exports = {
  SCENE_PROFILE,
  SCENE_COMMENT,
  SCENE_FORUM,
  SCENE_SOCIAL,
  available,
  submit,
  verifySignature,
  handleEvent,
  isBlocked,
  filterBlocked,
  filterStoredImages,
  refreshBlockedUrls,
  start,
  stop,
}