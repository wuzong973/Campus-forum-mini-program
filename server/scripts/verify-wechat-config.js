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
    // 用 cgi-bin/stable_token 而不是 cgi-bin/token：
    // 后者每调用一次都会作废上一次签发的 token，跑一次这个体检脚本
    // 就会把正在运行的服务端手里的 token 弄失效（线上表现为订阅消息 40001 失败）。
    const { data } = await axios.post('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential',
      appid: process.env.WX_APPID,
      secret: process.env.WX_APPSECRET,
      force_refresh: false,
    }, {
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
