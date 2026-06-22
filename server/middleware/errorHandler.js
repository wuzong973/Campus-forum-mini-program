const { fail } = require('./auth')

function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message)
  fail(res, err.message || '服务器内部错误', err.status || 500)
}

module.exports = errorHandler
