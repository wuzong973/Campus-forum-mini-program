const assert = require('assert')
const fs = require('fs')
const path = require('path')

const migration = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
const errandRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'errandRoutes.js'), 'utf8')
const errandController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'errandController.js'), 'utf8')
const publishPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'errand-publish', 'index.js'), 'utf8')
const scheduleRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'scheduleRoutes.js'), 'utf8')
const scheduleController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scheduleController.js'), 'utf8')
const ocrPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-ocr', 'index.js'), 'utf8')

assert.match(migration, /ensureColumn\('errand_order', 'is_large_item'/)
assert.match(migration, /ensureColumn\('errand_order', 'is_urgent'/)
assert.match(migration, /ensureColumn\('errand_order', 'payment_status'/)
assert.match(errandRoutes, /router\.post\('\/:id\/pay', auth, idempotency, paymentController\.createErrandPayment\)/)
assert.match(errandRoutes, /router\.get\('\/:id\/payment-status', auth, paymentController\.queryErrandPaymentStatus\)/)
assert.match(errandController, /WHERE e\.payment_status = 'SUCCESS'/)
assert.match(publishPage, /wx\.requestPayment/)
assert.match(publishPage, /\/errand\/'.*'\/pay'/)
assert.match(scheduleRoutes, /router\.post\('\/replace', auth, idempotency, scheduleController\.replace\)/)
assert.match(scheduleController, /未能识别出有效课程，请上传清晰完整的课表截图/)
assert.doesNotMatch(scheduleController, /demo-fallback|大学英语\(下\)|机械制图|军体课/)
assert.match(ocrPage, /api\.replaceSchedule\(courses\)/)

global.getApp = () => ({ globalData: { token: '' } })
const { sanitizeQuery } = require('../../utils/request')

assert.deepStrictEqual(
  sanitizeQuery({ type: '', campus: undefined, minPrice: null, page: 1, enabled: false, count: 0 }),
  { page: 1, enabled: false, count: 0 },
)

console.log('Request schema migration checks passed.')
