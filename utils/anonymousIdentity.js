// 匿名身份生成：昵称取自 assets/avatar2/name.txt，头像取自 assets/avatar1/ 素材池。
// 小程序无法在运行时读取包内文本文件，所以两份清单都以常量形式内置。
// 素材池统一放在 utils/avatar.js（底层模块，避免 avatar ↔ anonymousIdentity 循环依赖），
// 与小程序包内 assets/avatar1/ 和服务端 utils/defaultProfile.js 三处必须同步。
const {
  getRandomAnonymousName,
  DEFAULT_NAMES: names,
  ANONYMOUS_AVATARS: avatars,
} = require('./avatar')

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

// 昵称走 getRandomAnonymousName（精选 134 + 组合池约 1.75 万），
// 不再只从 134 个里抽 —— 那是线上大面积撞名的根因。
function generate() {
  return { nickName: getRandomAnonymousName(), avatarUrl: pick(avatars) }
}

module.exports = { generate, avatars, names }
