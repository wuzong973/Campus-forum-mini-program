const jwt = require('jsonwebtoken')
const jwtConfig = require('../config/jwt')

function success(res, data, message = 'success') {
  res.json({ code: 200, message, data })
}

function fail(res, message, code = 400) {
  res.status(code >= 400 && code < 600 ? code : 400).json({ code, message, data: null })
}

function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return fail(res, '未登录', 401)
  }
  try {
    const token = header.slice(7)
    const decoded = jwt.verify(token, jwtConfig.secret)
    req.userId = decoded.userId
    next()
  } catch (e) {
    return fail(res, 'Token无效', 401)
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.slice(7), jwtConfig.secret)
      req.userId = decoded.userId
    } catch (e) { /* ignore */ }
  }
  next()
}

module.exports = { success, fail, auth, optionalAuth }
