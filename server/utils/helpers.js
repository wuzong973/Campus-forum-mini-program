function parseImages(images) {
  if (!images) return []
  if (Array.isArray(images)) return images
  if (typeof images === 'object') return images
  try { return JSON.parse(images) } catch (e) { return [] }
}

// parseImages 的逆操作：把要从 JS 值写回 JSON 列的参数序列化成字符串。
// 必须序列化的原因：mysql2 会把 JSON 列的取值解析成 JS 数组/对象，而数组直接当 `?`
// 参数用会被 mysql2 转义成「逗号分隔的多个值」，一个占位符撑成 N 个值，报
// ER_WRONG_VALUE_COUNT_ON_ROW（Column count doesn't match value count at row 1）。
// 凡是「从库里读出来的 JSON 列」再写回 SQL 的地方，都要先过这个函数。
function toJsonColumn(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function clampPageSize(pageSize, max) {
  const n = parseInt(pageSize, 10) || 10
  return Math.min(Math.max(n, 1), max || 50)
}

function safeMessage(err) {
  if (!err || !err.message) return '服务器内部错误'
  if (err.code && String(err.code).startsWith('ER_')) return '数据库操作失败'
  return err.message
}

module.exports = { parseImages, toJsonColumn, clampPageSize, safeMessage }
