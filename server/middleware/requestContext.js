const crypto = require('crypto')

function requestContext(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '')
  const requestId = /^[a-zA-Z0-9_-]{8,64}$/.test(incoming)
    ? incoming
    : crypto.randomUUID()
  req.requestId = requestId
  res.locals.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  next()
}

module.exports = requestContext
