/**
 * 后端冒烟测试 - 运行: npm test
 * 无需数据库连接，仅验证模块加载与工具函数
 */
const assert = require('assert')
const { parseImages, clampPageSize, safeMessage } = require('../utils/helpers')

assert.deepStrictEqual(parseImages('[]'), [])
assert.deepStrictEqual(parseImages([1, 2]), [1, 2])
assert.strictEqual(clampPageSize(100), 50)
assert.strictEqual(clampPageSize(10), 10)
assert.ok(safeMessage({ code: 'ER_PARSE_ERROR', message: 'syntax' }).indexOf('数据库') >= 0)

const auth = require('../middleware/auth')
const { normalizeImages } = require('../controllers/feedbackController')
let statusCode = 0
let body = null
const mockRes = {
  json(d) { body = d },
  status(c) { statusCode = c; return this }
}
auth.success(mockRes, { ok: true })
assert.strictEqual(body.code, 200)
assert.deepStrictEqual(body.data, { ok: true })

assert.deepStrictEqual(normalizeImages(['https://example.com/a.jpg']), ['https://example.com/a.jpg'])
assert.strictEqual(normalizeImages(['wxfile://temporary-image']), null)

console.log('All smoke tests passed.')
