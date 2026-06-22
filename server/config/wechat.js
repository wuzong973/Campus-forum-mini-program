require('dotenv').config()

module.exports = {
  appId: process.env.WX_APPID || 'your_appid',
  appSecret: process.env.WX_APPSECRET || 'your_appsecret'
}
