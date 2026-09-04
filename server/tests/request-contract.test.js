const assert = require('assert')
const fs = require('fs')
const path = require('path')

const migration = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
const errandRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'errandRoutes.js'), 'utf8')
const errandController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'errandController.js'), 'utf8')
const publishPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'errand-publish', 'index.js'), 'utf8')

assert.match(migration, /ensureColumn\('errand_order', 'is_large_item'/)
assert.match(migration, /ensureColumn\('errand_order', 'is_urgent'/)
assert.match(migration, /ensureColumn\('errand_order', 'payment_status'/)
assert.match(errandRoutes, /router\.post\('\/:id\/pay', auth, idempotency, paymentController\.createErrandPayment\)/)
assert.match(errandRoutes, /router\.get\('\/:id\/payment-status', auth, paymentController\.queryErrandPaymentStatus\)/)
assert.match(errandController, /WHERE e\.payment_status = 'SUCCESS'/)
assert.match(publishPage, /wx\.requestPayment/)
assert.match(publishPage, /\/errand\/'.*'\/pay'/)

global.getApp = () => ({ globalData: { token: '' } })
const { sanitizeQuery } = require('../../utils/request')

assert.deepStrictEqual(
  sanitizeQuery({ type: '', campus: undefined, minPrice: null, page: 1, enabled: false, count: 0 }),
  { page: 1, enabled: false, count: 0 },
)

console.log('Request schema migration checks passed.')
