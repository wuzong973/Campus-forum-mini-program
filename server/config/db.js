require('dotenv').config()

module.exports = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'your_password',
  database: process.env.DB_NAME || 'GQG_campus',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}
