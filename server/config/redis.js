const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

module.exports = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || '',
  db: process.env.REDIS_DB || 0
}
