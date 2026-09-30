const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

// ⚠️ expiresIn 与前端 utils/token.js 的过期判定必须一致：
// 前端会按 token 里的 exp 判断「本地这个 token 还有没有效」，若服务端把有效期
// 调得比前端预期的长/短，都会重新出现「本地以为已登录、服务端 401」的错位。
// 2026-09-18 由 7d 调整为 30d（原 7 天太短，用户常在正常使用中被踢成僵尸登录态）。
module.exports = {
  secret: process.env.JWT_SECRET || 'GQG_campus_jwt_secret_change_me',
  expiresIn: process.env.JWT_EXPIRES || '30d'
}
