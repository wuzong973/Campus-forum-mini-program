const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

module.exports = {
  appId: process.env.WX_APPID || 'your_appid',
  appSecret: process.env.WX_APPSECRET || 'your_appsecret'
}
