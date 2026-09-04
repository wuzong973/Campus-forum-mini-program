const crypto = require('crypto')

const TTL_MS = 10 * 60 * 1000
const cache = new Map()

function prune(now) {
  cache.forEach((value, key) => {
    if (value.expiresAt <= now) cache.delete(key)
  })
}

function idempotency(req, res, next) {
  const key = String(req.headers['x-idempotency-key'] || '')
  if (!key) return next()
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) return res.status(400).json({ code: 400, message: '幂等键格式无效', data: null, requestId: req.requestId })

  const now = Date.now()
  prune(now)
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ method: req.method, url: req.originalUrl, userId: req.userId, body: req.body })).digest('hex')
  const cached = cache.get(key)
  if (cached) {
    if (cached.fingerprint !== fingerprint) return res.status(409).json({ code: 409, message: '幂等键已用于其他请求', data: null, requestId: req.requestId })
    return res.status(cached.status).json(cached.body)
  }

  const originalJson = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      cache.set(key, { fingerprint, status: res.statusCode, body, expiresAt: Date.now() + TTL_MS })
    }
    return originalJson(body)
  }
  next()
}

module.exports = idempotency
