// H1 回归：教务系统账号校验失败必须返回业务码 400，绝不能是 HTTP 401。
// 背景：小程序 utils/request.js 对任何 401 一律清空 token/userInfo（视为登录过期），
// 教务绑定输错密码若返回 401 会把整个 App 会话踢下线。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'jwScheduleSyncService.js'), 'utf8')

// normalizeSyncError 内「登录失败/账号/密码」分支不得再出现 status = 401
const block = src.slice(src.indexOf('function normalizeSyncError'))
const credBranch = block.slice(block.indexOf('登录失败|账号|密码|请先登录系统'))
const firstBranch = credBranch.slice(0, credBranch.indexOf('}'))
assert.ok(/result\.status = 400/.test(firstBranch), '教务账号校验失败应归一化为 400')
assert.ok(!/result\.status = 401/.test(firstBranch), '教务账号校验失败不得返回 401')

// 全服务里 normalizeSyncError / normalizeVerifyError 都不应把教务登录失败映射为 401
assert.ok(!/status\s*=\s*401/.test(src), '教务同步服务不应再出现 401 状态码')

console.log('JW sync auth-status test passed.')
