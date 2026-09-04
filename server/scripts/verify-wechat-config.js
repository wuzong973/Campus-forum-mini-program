const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const axios = require('axios')

function configured(name) {
  return Boolean(String(process.env[name] || '').trim())
}

async function main() {
  const missing = ['WX_APPID', 'WX_APPSECRET'].filter((name) => !configured(name))
  if (missing.length) {
    console.error(`WeChat configuration is incomplete: ${missing.join(', ')}`)
    process.exitCode = 1
    return
  }

  try {
    const { data } = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid: process.env.WX_APPID,
        secret: process.env.WX_APPSECRET,
      },
      timeout: 10000,
    })

    if (!data.access_token) {
      console.error(`WeChat credential check failed: ${data.errcode || 'unknown'} ${data.errmsg || 'unknown error'}`)
      process.exitCode = 1
      return
    }

    console.log('WeChat credential check passed.')
  } catch (error) {
    console.error(`WeChat credential check could not complete: ${error.code || error.message}`)
    process.exitCode = 1
  }
}

main()
