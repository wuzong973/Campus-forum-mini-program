const assert = require('assert')
const { hasPermission, permissionsFor, requireAdmin } = require('../middleware/auth')

assert.deepStrictEqual(permissionsFor('user'), [])
assert.strictEqual(hasPermission('super_admin', 'role.assign'), true)
assert.strictEqual(hasPermission('content_admin', 'content.manage'), true)
assert.strictEqual(hasPermission('content_admin', 'user.manage'), false)
assert.strictEqual(hasPermission('user_admin', 'user.manage'), true)
assert.strictEqual(hasPermission('operator', 'item.manage'), true)

let called = false
let denied = null
const res = {
  locals: {},
  status(code) { this.statusCode = code; return this },
  json(body) { denied = body }
}
requireAdmin('content.manage')({ user: { role: 'user' } }, res, () => { called = true })
assert.strictEqual(called, false)
assert.strictEqual(res.statusCode, 403)
assert.strictEqual(denied.code, 403)
called = false
requireAdmin('content.manage')({ user: { role: 'content_admin' } }, res, () => { called = true })
assert.strictEqual(called, true)

console.log('Admin permission tests passed.')
