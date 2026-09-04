const { fail } = require('./auth')

function errorHandler(err, req, res, next) {
  console.error('[Error]', req.requestId || '-', err.stack || err.message)
  const status = err.status >= 400 && err.status < 500 ? err.status : 500
  const message = status < 500 && err.expose ? err.message : '服务器内部错误'
  fail(res, message, status)
}

module.exports = errorHandler
