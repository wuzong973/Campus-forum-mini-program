// 匿名身份生成：昵称取自 assets/avatar2/name.txt，头像取自 assets/avatar1/ 素材池。
// 小程序无法在运行时读取包内文本文件，所以两份清单都以常量形式内置。
// 素材池统一放在 utils/avatar.js（底层模块，避免 avatar ↔ anonymousIdentity 循环依赖），
// 与小程序包内 assets/avatar1/ 和服务端 utils/defaultProfile.js 三处必须同步。
const { DEFAULT_NAMES: names, ANONYMOUS_AVATARS: avatars } = require('./avatar')

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function generate() {
  return { nickName: pick(names), avatarUrl: pick(avatars) }
}

module.exports = { generate, avatars, names }
