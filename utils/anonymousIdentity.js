// Source: avatar1/ and avatar2/name.txt. Mini programs cannot read arbitrary
// packaged text files at runtime, so the available assets are kept as a bundle list.
const avatars = [
  '/avatar1/鹰.jpg', '/avatar1/鳄鱼.jpg', '/avatar1/鲸鱼.jpg', '/avatar1/骆驼.jpg',
  '/avatar1/青蛙.jpg', '/avatar1/长颈鹿.jpg', '/avatar1/袋鼠.jpg', '/avatar1/蟾蜍.jpg',
  '/avatar1/蝴蝶.jpg', '/avatar1/蜜蜂.jpg', '/avatar1/蛇.jpg', '/avatar1/考拉.jpg',
  '/avatar1/考拉 (2).jpg', '/avatar1/老虎.jpg', '/avatar1/老虎 (2).jpg', '/avatar1/羊驼.jpg',
  '/avatar1/猴子.jpg', '/avatar1/猫头鹰.jpg', '/avatar1/狼.jpg', '/avatar1/狮子.jpg',
  '/avatar1/狐狸.jpg', '/avatar1/犀牛.jpg', '/avatar1/熊猫.jpg', '/avatar1/海豹.jpg',
  '/avatar1/海狮.jpg', '/avatar1/河马.jpg', '/avatar1/松鼠.jpg', '/avatar1/斑马.jpg',
  '/avatar1/孔雀.jpg', '/avatar1/大象.jpg', '/avatar1/土拨鼠.jpg', '/avatar1/喜鹊.jpg',
  '/avatar1/北极熊.jpg', '/avatar1/刺猬.jpg', '/avatar1/八哥.jpg', '/avatar1/兔子.jpg',
  '/avatar1/乌龟.jpg', '/avatar1/七星瓢虫.jpg'
]

const { DEFAULT_NAMES: names } = require('./avatar')

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function generate() {
  return { nickName: pick(names), avatarUrl: pick(avatars) }
}

module.exports = { generate, avatars, names }
