const assert = require('assert')
const pool = require('../config/pool')
const featureFlag = require('../middleware/featureFlag')

function response() {
  return {
    locals: {},
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body }
  }
}

async function run() {
  const originalQuery = pool.query
  try {
    pool.query = async () => [[{ status: 0 }]]
    const disabledRes = response()
    let continued = false
    await featureFlag('community.enabled')({}, disabledRes, () => { continued = true })
    assert.strictEqual(continued, false)
    assert.strictEqual(disabledRes.statusCode, 503)

    pool.query = async () => [[]]
    const enabledRes = response()
    continued = false
    await featureFlag('community.enabled')({}, enabledRes, () => { continued = true })
    assert.strictEqual(continued, true)
  } finally {
    pool.query = originalQuery
  }
  console.log('Feature flag tests passed.')
}

run().catch((error) => { console.error(error); process.exit(1) })
