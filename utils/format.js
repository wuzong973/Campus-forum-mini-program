function formatTime(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return y + '-' + m + '-' + day + ' ' + h + ':' + min
}

function formatDateTime(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return y + '年' + m + '月' + day + '日 ' + h + ':' + min
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return ''
  const now = Date.now()
  const t = new Date(dateStr).getTime()
  const diff = now - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + '分钟前'
  const hour = Math.floor(min / 60)
  if (hour < 24) return hour + '小时前'
  const day = Math.floor(hour / 24)
  if (day < 30) return day + '天前'
  return formatTime(dateStr).slice(0, 10)
}

function formatPrice(price) {
  return '¥' + Number(price).toFixed(2)
}

function truncate(str, len) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

// 去掉评论/消息末尾的「[图片]/[视频]」占位后缀：
// 有真实媒体时展示媒体本身，不再显示占位文字（兼容历史数据，发送端仍以占位符入库满足非空校验）
function stripMediaPlaceholder(str) {
  return String(str || '').replace(/\s*\[(?:图片|视频)\]\s*$/, '').trim()
}

// 论坛帖的显示标题。
//
// ⚠ `title` **绝大多数是空的**（2026-10-08 实测：forum_post 353 行里 352 行 title 为空），
// 论坛帖的主字段是 `content`。所以这里优先取 title，没有就截正文摘要 ——
// 曾经后台「选帖子」只读 title，结果一屏全是「（无标题）」，根本认不出是哪条。
//
// 正文要先剥掉末尾的「[图片]/[视频]」占位、把换行与连续空白压成单个空格，
// 否则列表里会出现大段空白或换行撑高行高。
function postTitle(row, max) {
  const r = row || {}
  const limit = Number(max) > 0 ? Number(max) : 40
  const title = String(r.title || '').trim()
  if (title) return truncate(title, limit)
  const body = stripMediaPlaceholder(String(r.content || '')).replace(/\s+/g, ' ').trim()
  return truncate(body, limit)
}

module.exports = { formatTime, formatDateTime, formatRelativeTime, formatPrice, truncate, stripMediaPlaceholder, postTitle }
