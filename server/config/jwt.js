require('dotenv').config()

module.exports = {
  secret: process.env.JWT_SECRET || 'GQG_campus_jwt_secret_change_me',
  expiresIn: process.env.JWT_EXPIRES || '7d'
}
