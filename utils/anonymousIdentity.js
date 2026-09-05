// Source: assets/avatar1/ and assets/avatar2/name.txt. Mini programs cannot read arbitrary
// packaged text files at runtime, so the available assets are kept as a bundle list.
const avatars = [
  '/assets/avatar1/鹰.jpg', '/assets/avatar1/鳄鱼.jpg', '/assets/avatar1/鲸鱼.jpg', '/assets/avatar1/骆驼.jpg',
  '/assets/avatar1/青蛙.jpg', '/assets/avatar1/长颈鹿.jpg', '/assets/avatar1/袋鼠.jpg', '/assets/avatar1/蟾蜍.jpg',
  '/assets/avatar1/蝴蝶.jpg', '/assets/avatar1/蜜蜂.jpg', '/assets/avatar1/蛇.jpg', '/assets/avatar1/考拉.jpg',
  '/assets/avatar1/考拉 (2).jpg', '/assets/avatar1/老虎.jpg', '/assets/avatar1/老虎 (2).jpg', '/assets/avatar1/羊驼.jpg',
  '/assets/avatar1/猴子.jpg', '/assets/avatar1/猫头鹰.jpg', '/assets/avatar1/狼.jpg', '/assets/avatar1/狮子.jpg',
  '/assets/avatar1/狐狸.jpg', '/assets/avatar1/犀牛.jpg', '/assets/avatar1/熊猫.jpg', '/assets/avatar1/海豹.jpg',
  '/assets/avatar1/海狮.jpg', '/assets/avatar1/河马.jpg', '/assets/avatar1/松鼠.jpg', '/assets/avatar1/斑马.jpg',
  '/assets/avatar1/孔雀.jpg', '/assets/avatar1/大象.jpg', '/assets/avatar1/土拨鼠.jpg', '/assets/avatar1/喜鹊.jpg',
  '/assets/avatar1/北极熊.jpg', '/assets/avatar1/刺猬.jpg', '/assets/avatar1/八哥.jpg', '/assets/avatar1/兔子.jpg',
  '/assets/avatar1/乌龟.jpg', '/assets/avatar1/七星瓢虫.jpg'
]

const { DEFAULT_NAMES: names } = require('./avatar')

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function generate() {
  return { nickName: pick(names), avatarUrl: pick(avatars) }
}

module.exports = { generate, avatars, names }
