function parseImages(images) {
  if (!images) return []
  if (Array.isArray(images)) return images
  if (typeof images === 'object') return images
  try { return JSON.parse(images) } catch (e) { return [] }
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

module.exports = { parseImages, clampPageSize, safeMessage }
