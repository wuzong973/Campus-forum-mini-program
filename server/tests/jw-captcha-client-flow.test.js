// H2 回归：教务验证码流程的两个真实故障
// 1) 服务端把业务码放在 data.code，HTTP 状态码放在 code。页面若用 err.code 当业务码，
//    CAPTCHA_REQUIRED / JW_CREDENTIAL_INVALID 永远匹配不上 —— 表现是
//    「点了绑定并同步只弹一句 需要输入教务系统验证码，却不跳验证码页」。
// 2) 验证码输错被归一化成「同步失败」死路弹窗，用户拿不到新验证码。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

const requestJs = read('utils', 'request.js')
const homeJs = read('pkg-schedule', 'schedule-home', 'index.js')
const loginJs = read('pkg-schedule', 'schedule-login', 'index.js')
const apiJs = read('utils', 'api.js')
const routesJs = read('server', 'routes', 'scheduleRoutes.js')
const controllerJs = read('server', 'controllers', 'scheduleController.js')
const serviceJs = read('server', 'services', 'jwScheduleSyncService.js')

// 1. 请求层必须解析出业务码
assert.ok(/error\.bizCode = /.test(requestJs), 'utils/request.js 必须解析业务码 bizCode')

// 2. 页面必须按业务码分支，而不是拿 HTTP 状态码当业务码
for (const [name, src] of [['schedule-home', homeJs], ['schedule-login', loginJs]]) {
  const at = src.indexOf('handleSyncError(err, auto) {')
  assert.ok(at > -1, `${name} 必须有 handleSyncError(err, auto)`)
  const fn = src.slice(at)
  const head = fn.slice(0, fn.indexOf('this.setData'))
  assert.ok(/bizCode/.test(head), `${name}.handleSyncError 必须优先取业务码 bizCode`)
  assert.ok(!/const code = \(err && err\.code\) \|\| data\.code/.test(fn), `${name} 不得再用 err.code 当业务码`)
  assert.ok(/CAPTCHA_REQUIRED/.test(fn), `${name} 必须处理 CAPTCHA_REQUIRED`)
  assert.ok(/CAPTCHA_INVALID/.test(fn), `${name} 必须处理验证码输错 CAPTCHA_INVALID`)
}

// 3. 「教务系统」页遇到验证码必须跳转同步页，并把服务端挑战带过去
assert.ok(/gotoSyncPage\(data/.test(homeJs), 'schedule-home 遇 CAPTCHA_REQUIRED 必须跳转同步页并传挑战')
assert.ok(/jwCaptchaHandoff/.test(homeJs) && /jwCaptchaHandoff/.test(loginJs), '两页之间需通过 jwCaptchaHandoff 传递挑战')
assert.ok(/pendingHandoff/.test(loginJs), '带挑战进入同步页时不得再自动发起同步覆盖挑战')

// 4. 换一张验证码必须能在未绑定态使用（复用挑战内凭据）
assert.ok(/refreshScheduleCaptcha/.test(apiJs), 'utils/api.js 需提供 refreshScheduleCaptcha')
assert.ok(/refreshScheduleCaptcha/.test(loginJs), 'schedule-login 的换一张需走 refreshScheduleCaptcha')
assert.ok(/\/sync\/captcha\/refresh/.test(routesJs), '服务端需提供 /sync/captcha/refresh 路由')
assert.ok(/exports\.refreshCaptcha/.test(controllerJs), 'controller 需导出 refreshCaptcha')
assert.ok(/refreshCaptchaChallenge/.test(serviceJs), 'service 需导出 refreshCaptchaChallenge')

// 5. 服务端：验证码输错要能继续换图，账号密码错误要带业务码
assert.ok(/code = "CAPTCHA_INVALID"/.test(serviceJs), '验证码错误应归一化为 CAPTCHA_INVALID')
assert.ok(/code = "JW_CREDENTIAL_INVALID"/.test(serviceJs), '账号密码错误应带 JW_CREDENTIAL_INVALID')

console.log('JW captcha client flow test passed.')
