const pool = require('../config/pool')
const { fail } = require('./auth')

function featureFlag(configKey) {
  return async (req, res, next) => {
    try {
      const [rows] = await pool.query('SELECT status FROM feature_config WHERE config_key = ? LIMIT 1', [configKey])
      if (rows.length && Number(rows[0].status) !== 1) return fail(res, 'This feature is temporarily unavailable', 503)
      next()
    } catch (e) {
      // Existing installations without the configuration table remain available until migration completes.
      next()
    }
  }
}

module.exports = featureFlag
