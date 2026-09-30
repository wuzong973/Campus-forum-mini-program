// 新用户默认资料（头像 + 昵称）
//
// 头像文件名必须是纯 ASCII，且与小程序包内 assets/avatar2/ 的资源一一对应。
// 旧版使用 "1 (9).jpg" 这类含空格和半角括号的名字，encodeURIComponent 只编码
// 空格、不编码括号，生成的 /assets/avatar2/1%20(9).jpg 在真机上解析失败，
// 头像渲染为空白。文件已重命名为 avatar_01.jpg ... avatar_55.jpg。

const DEFAULT_AVATAR_COUNT = 55

const DEFAULT_NICK_NAMES = [
  '蜿蜒的小溪', '平静的湖面', '汹涌的海浪', '清澈的泉水', '浑浊的黄河',
  '冰封的河面', '退潮的沙滩', '涨水的池塘', '干涸的河床', '冒泡的温泉',
  '深幽的碧潭', '初升的朝阳', '西沉的落日', '皎洁的明月', '闪烁的繁星',
  '划过的流星', '朦胧的月晕', '刺眼的烈日', '温柔的月光', '密集的星群',
  '孤独的晨星', '残缺的月牙', '圆满的满月', '暗淡的星光', '燃烧的太阳',
  '沉睡的夜空', '璀璨的银河', '神秘的星云', '旋转的北斗', '火红的晚霞',
  '呼啸的狂风', '轻柔的微风', '漂泊的白云', '阴沉的乌云', '淅沥的小雨',
  '倾盆的暴雨', '纷飞的大雪', '细碎的雪花', '轰隆的雷声', '划破的闪电',
  '弥漫的大雾', '凝结的白霜', '冰冷的冰雹', '潮湿的露水', '旋转的龙卷',
  '刺骨的寒风', '和煦的春风', '闷热的夏风', '凉爽的秋风', '凛冽的冬风',
  '茂密的森林', '稀疏的树林', '高大的松柏', '低矮的灌木', '翠绿的草地',
  '枯黄的落叶', '挺拔的白杨', '婆娑的柳树', '盘根的老树', '新生的嫩芽',
  '盛开的野花', '凋零的花瓣', '缠绕的藤蔓', '带刺的荆棘', '漂浮的浮萍',
  '摇曳的芦苇', '苍劲的古松', '翠绿的青竹', '火红的枫叶', '金黄的银杏'
]

// 历史默认昵称：这些值代表"用户从未设置过昵称"
const DEFAULT_NAME_VALUES = ['校园用户', '微信用户', '用户']

function isDefaultName(value) {
  const name = String(value || '').trim()
  return !name || DEFAULT_NAME_VALUES.includes(name)
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function getRandomAvatar() {
  const index = Math.floor(Math.random() * DEFAULT_AVATAR_COUNT) + 1
  return '/assets/avatar2/avatar_' + String(index).padStart(2, '0') + '.jpg'
}

function getRandomName() {
  return pickRandom(DEFAULT_NICK_NAMES)
}

// 生成一套默认资料，用于新用户注册或历史脏数据修复
function buildDefaultProfile() {
  return { avatarUrl: getRandomAvatar(), nickName: getRandomName() }
}

// 旧头像路径 → 新文件名：/assets/avatar2/1%20(9).jpg → /assets/avatar2/avatar_09.jpg
// 同时兜住匿名素材（avatar1）的旧名（见 normalizeAnonymousAvatarUrl）：
// 这里是全站头像的主要出口（用户资料、帖子/评论、通知快照都过它），
// 把两种历史脏路径一起纠正，聊天页/评论区才不会渲染出图裂的空白头像。
function normalizeLegacyAvatarUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  const match = url.match(/^\/assets\/avatar2\/1[\s%20]*\((\d+)\)\.jpg$/i)
  if (match) {
    return '/assets/avatar2/avatar_' + String(Number(match[1])).padStart(2, '0') + '.jpg'
  }
  if (url.indexOf('/assets/avatar1/') === 0) {
    return normalizeAnonymousAvatarUrl(url)
  }
  return url
}

// 匿名形象素材池（/assets/avatar1/）：必须与小程序包内 assets/avatar1/ 逐一对齐。
// 与客户端 utils/anonymousIdentity.js 同源，改动时两边必须同步。
const ANONYMOUS_AVATARS = [
  '/assets/avatar1/鹰.jpg', '/assets/avatar1/鳄鱼.jpg', '/assets/avatar1/鲸鱼.jpg', '/assets/avatar1/骆驼.jpg',
  '/assets/avatar1/青蛙.jpg', '/assets/avatar1/长颈鹿.jpg', '/assets/avatar1/袋鼠.jpg', '/assets/avatar1/蟾蜍.jpg',
  '/assets/avatar1/蝴蝶.jpg', '/assets/avatar1/蜜蜂.jpg', '/assets/avatar1/蛇.jpg', '/assets/avatar1/考拉.jpg',
  '/assets/avatar1/考拉2.jpg', '/assets/avatar1/老虎.jpg', '/assets/avatar1/老虎2.jpg', '/assets/avatar1/羊驼.jpg',
  '/assets/avatar1/猴子.jpg', '/assets/avatar1/猫头鹰.jpg', '/assets/avatar1/狼.jpg', '/assets/avatar1/狮子.jpg',
  '/assets/avatar1/狐狸.jpg', '/assets/avatar1/犀牛.jpg', '/assets/avatar1/熊猫.jpg', '/assets/avatar1/海豹.jpg',
  '/assets/avatar1/海狮.jpg', '/assets/avatar1/河马.jpg', '/assets/avatar1/松鼠.jpg', '/assets/avatar1/斑马.jpg',
  '/assets/avatar1/孔雀.jpg', '/assets/avatar1/大象.jpg', '/assets/avatar1/土拨鼠.jpg', '/assets/avatar1/喜鹊.jpg',
  '/assets/avatar1/北极熊.jpg', '/assets/avatar1/刺猬.jpg', '/assets/avatar1/八哥.jpg', '/assets/avatar1/兔子.jpg',
  '/assets/avatar1/乌龟.jpg', '/assets/avatar1/七星瓢虫.jpg',
]

// 匿名素材旧文件名 → 新文件名：
//   /assets/avatar1/考拉 (2).jpg、/assets/avatar1/考拉%20(2).jpg → /assets/avatar1/考拉2.jpg
// 带空格与半角括号的文件名在真机上解析失败（头像空白 + 渲染层刷「Failed to load image」），
// 文件已重命名，但库里/通知快照里仍有旧路径存量，必须在读取出口纠正。
function normalizeAnonymousAvatarUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  const match = url.match(/^\/assets\/avatar1\/(.+?)[\s%20]*\((\d+)\)\.(jpg|jpeg|png)$/i)
  if (match) {
    const renamed = '/assets/avatar1/' + match[1].trim() + String(Number(match[2])) + '.' + match[3]
    if (ANONYMOUS_AVATARS.indexOf(renamed) > -1) return renamed
  }
  return url
}

// 是否内置匿名素材（客户端传入的匿名形象必须来自素材池，不接受任意外链/不存在的路径）
function isAnonymousAvatarUrl(value) {
  return ANONYMOUS_AVATARS.indexOf(String(value || '').trim()) > -1
}

// 未知匿名路径 → 稳定映射到池内素材。
// 用「昵称」或原路径做种子，保证同一匿名身份每次渲染到同一个形象（不会每次刷新换脸），
// 同时绝不回落到真实资料 —— 那会把匿名者直接暴露给被打扰的人。
function pickAnonymousAvatar(seed) {
  const text = String(seed || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000
  }
  return ANONYMOUS_AVATARS[hash % ANONYMOUS_AVATARS.length]
}

module.exports = {
  DEFAULT_AVATAR_COUNT,
  DEFAULT_NICK_NAMES,
  DEFAULT_NAME_VALUES,
  ANONYMOUS_AVATARS,
  isDefaultName,
  getRandomAvatar,
  getRandomName,
  buildDefaultProfile,
  normalizeLegacyAvatarUrl,
  normalizeAnonymousAvatarUrl,
  isAnonymousAvatarUrl,
  pickAnonymousAvatar,
}
