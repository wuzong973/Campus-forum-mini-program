const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

module.exports = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'your_password',
  database: process.env.DB_NAME || 'gqg_campus',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}
