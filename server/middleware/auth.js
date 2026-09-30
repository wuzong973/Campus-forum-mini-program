const jwt = require('jsonwebtoken')
const jwtConfig = require('../config/jwt')
const pool = require('../config/pool')
const { normalizeLegacyAvatarUrl } = require('../utils/defaultProfile')

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  content_admin: ['content.manage', 'config.manage', 'stats.view'],
  user_admin: ['user.manage', 'stats.view'],
  operator: ['item.manage', 'config.manage', 'stats.view', 'payment.manage']
}

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || []
}

function hasPermission(role, permission) {
  const permissions = permissionsFor(role)
  return permissions.includes('*') || permissions.includes(permission)
}

// 递归修正响应体里的旧头像路径（/assets/avatar2/1%20(9).jpg → avatar_09.jpg）。
// 放在 success() 里统一处理：头像字段散落在帖子、评论、通知、聊天、社团、活动等
// 十几个控制器中，逐处修改容易遗漏，且历史数据会持续被读出来。
//
// 注意：必须同时覆盖驼峰与下划线两种命名。控制器返回的原始行数据来自 MySQL
// （forum_comment 等直接返回 avatar_url），而帖子流经 mapPost 后是 avatarUrl。
// 早期只列了驼峰键，导致评论区头像（avatar_url）从未被修正，真机显示灰色空圆。
const AVATAR_KEYS = [
  'avatarUrl', 'avatar_url', 'avatar',
  'actorAvatar', 'actor_avatar',
  'anonAvatar', 'anon_avatar',
  'fallbackAvatar', 'fallback_avatar'
]
function normalizeAvatars(value, depth) {
  if (!value || typeof value !== 'object' || (depth || 0) > 6) return value
  if (Array.isArray(value)) {
    value.forEach((item) => normalizeAvatars(item, (depth || 0) + 1))
    return value
  }
  Object.keys(value).forEach((key) => {
    const current = value[key]
    if (typeof current === 'string') {
      if (AVATAR_KEYS.indexOf(key) > -1) value[key] = normalizeLegacyAvatarUrl(current)
    } else if (current && typeof current === 'object') {
      normalizeAvatars(current, (depth || 0) + 1)
    }
  })
  return value
}

function success(res, data, message = 'success') {
  const payload = (data && typeof data === 'object') ? normalizeAvatars(data, 0) : data
  res.json({ code: 200, message, data: payload, requestId: (res.locals || {}).requestId || '' })
}

// data 为可选的结构化附加信息（如失败原因码与处置指引），默认 null 保持既有契约不变
function fail(res, message, code = 400, data = null) {
  const status = code >= 400 && code < 600 ? code : 400
  res.status(status).json({ code: status, message, data, requestId: (res.locals || {}).requestId || '' })
}

async function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return fail(res, 'Not logged in', 401)
  let decoded
  try {
    decoded = jwt.verify(header.slice(7), jwtConfig.secret)
  } catch (e) {
    return fail(res, 'Token invalid', 401)
  }
  try {
    const [users] = await pool.query(
      'SELECT id, openid, nick_name, role, status FROM sys_user WHERE id = ? LIMIT 1',
      [decoded.userId]
    )
    if (!users.length || Number(users[0].status) !== 1) return fail(res, 'Account is unavailable', 403)
    req.userId = users[0].id
    req.user = users[0]
    next()
  } catch (e) {
    return fail(res, 'Authentication service unavailable', 500)
  }
}

function requireAdmin(permission) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user.role, permission)) return fail(res, 'Administrator permission required', 403)
    next()
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try { req.userId = jwt.verify(header.slice(7), jwtConfig.secret).userId } catch (e) { /* optional */ }
  }
  next()
}

module.exports = { success, fail, auth, optionalAuth, requireAdmin, permissionsFor, hasPermission, ROLE_PERMISSIONS }
