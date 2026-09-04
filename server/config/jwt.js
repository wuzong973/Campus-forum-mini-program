const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

module.exports = {
  secret: process.env.JWT_SECRET || 'GQG_campus_jwt_secret_change_me',
  expiresIn: process.env.JWT_EXPIRES || '7d'
}
