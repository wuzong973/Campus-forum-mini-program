const Redis = require('ioredis')
const rateLimitExpress = require('express-rate-limit')
const redisConfig = require('../config/redis')
const { fail } = require('./auth')

let redis
try {
  redis = new Redis({ ...redisConfig, maxRetriesPerRequest: 1, retryStrategy: () => null })
  redis.on('error', () => { /* Redis 不可用，降级为内存模式 */ })
  redis.on('connect', () => { /* Redis 已连接 */ })
} catch (e) {
  redis = null
}

const memoryLimiter = rateLimitExpress({
  windowMs: 60000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => fail(res, '请求过于频繁', 429)
})

function rateLimit(options = {}) {
  const { windowMs = 60000, max = 60, keyPrefix = 'rl:' } = options
  return async (req, res, next) => {
    if (!redis) return memoryLimiter(req, res, next)
    const key = keyPrefix + (req.userId || req.ip)
    try {
      const count = await redis.incr(key)
      if (count === 1) await redis.pexpire(key, windowMs)
      if (count > max) return fail(res, '请求过于频繁', 429)
      next()
    } catch (e) {
      memoryLimiter(req, res, next)
    }
  }
}

module.exports = rateLimit
