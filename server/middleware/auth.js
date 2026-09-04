const jwt = require('jsonwebtoken')
const jwtConfig = require('../config/jwt')
const pool = require('../config/pool')

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

function success(res, data, message = 'success') {
  res.json({ code: 200, message, data, requestId: (res.locals || {}).requestId || '' })
}

function fail(res, message, code = 400) {
  const status = code >= 400 && code < 600 ? code : 400
  res.status(status).json({ code: status, message, data: null, requestId: (res.locals || {}).requestId || '' })
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
