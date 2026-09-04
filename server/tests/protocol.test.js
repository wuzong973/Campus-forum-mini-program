const assert = require('assert')
const requestContext = require('../middleware/requestContext')
const { success, fail } = require('../middleware/auth')
const idempotency = require('../middleware/idempotency')

function response() {
  return {
    locals: {},
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

const req = { headers: {} }
const res = response()
requestContext(req, res, () => {})
success(res, { ok: true })
assert.strictEqual(res.body.code, 200)
assert.strictEqual(res.body.data.ok, true)
assert.ok(res.body.requestId)
assert.strictEqual(res.headers['X-Request-Id'], res.body.requestId)

const failed = response()
failed.locals.requestId = 'trace_1234'
fail(failed, 'bad request', 400)
assert.deepStrictEqual(failed.body, { code: 400, message: 'bad request', data: null, requestId: 'trace_1234' })

const idempotentReq = { headers: { 'x-idempotency-key': 'profile_12345678' }, method: 'PUT', originalUrl: '/api/v1/user/info', userId: 1, body: { campus: '佛山校区' }, requestId: 'request_1234' }
const first = response()
idempotency(idempotentReq, first, () => success(first, { saved: true }))
assert.strictEqual(first.body.data.saved, true)
const replay = response()
idempotency(idempotentReq, replay, () => assert.fail('duplicate request should be replayed'))
assert.deepStrictEqual(replay.body, first.body)

console.log('Protocol tests passed.')
