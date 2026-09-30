// Keep the bundled defaults in one place so login and profile editing use the
// same asset set. Filenames are plain ASCII on purpose: real devices resolve
// spaces and parentheses in bundled asset paths inconsistently, which made
// avatars silently fail to render (see avatar_01.jpg ... avatar_55.jpg).
//
// NOTE: assets/avatar2/ 曾混入非头像图片（校历.jpg，291KB 零引用，已于 2026-09-12 移除）。
// 管理员微信.png). This list is an explicit allowlist on purpose — never
// enumerate the directory, or those files get handed out as user avatars.
const DEFAULT_AVATARS = (function () {
  const list = []
  for (let i = 1; i <= 55; i += 1) {
    list.push('avatar_' + String(i).padStart(2, '0') + '.jpg')
  }
  list.push('1.jpg')
  return list
})()

// Bundled from assets/avatar2/name.txt because mini-program code cannot read files
// from the project directory at runtime.
const DEFAULT_NAMES = [
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
  '摇曳的芦苇', '苍劲的古松', '翠绿的青竹', '火红的枫叶', '金黄的银杏',
  '回暖的初春', '酷热的盛夏', '凉爽的深秋', '严寒的隆冬', '破晓的黎明',
  '金色的黄昏', '寂静的深夜', '微凉的清晨', '多雨的梅季', '干燥的秋季',
  '多风的早春', '短昼的冬至', '长夜的夏至', '飞流的瀑布', '水帘的后面',
  '深幽的洞穴', '轰鸣的水潭', '溅起的水花', '彩虹的水雾', '攀爬的苔藓',
  '栖息的蝙蝠', '滴水的岩壁', '回声的空洞', '透光的石缝', '黄昏的海边',
  '初雪的街口', '樱花的坡道', '雨夜的屋檐', '晚霞的天台', '星空的山顶',
  '晨光的窗台', '落叶的小径', '薄雾的渡口', '萤火的夏夜', '月光的小巷',
  '春风的巷口', '落日的码头', '雨后的彩虹', '雪夜的路灯', '花田的尽头',
  '海风的街角', '秋叶的长椅', '春水的桥头', '冬阳的窗边', '清晨的森林',
  '午后的茶园', '傍晚的湖面', '深夜的山谷', '雨后的竹林', '雪后的村庄',
  '春日的田野', '夏日的荷塘', '秋日的果园', '冬日的壁炉', '雾中的远山',
  '风中的芦苇', '云中的山峰', '水中的倒影', '光中的尘埃', '影中的老树',
  '声中的溪流', '色中的晚霞', '味中的炊烟', '触中的微风'
]

const DEFAULT_PROFILE_KEY = 'default_guest_profile'

// Legacy avatars were stored as `/assets/avatar2/1%20(9).jpg` (space encoded,
// parentheses left raw). Real devices failed to render those paths, so the
// files were renamed to `avatar_09.jpg`. This maps the old URLs that are still
// persisted in sys_user.avatar_url / local storage onto the new filenames.
function normalizeLegacyAvatar(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  const match = url.match(/^\/assets\/avatar2\/(?:1|1)[\s%20]*\((\d+)\)\.jpg$/i)
  if (match) return '/assets/avatar2/avatar_' + String(Number(match[1])).padStart(2, '0') + '.jpg'
  if (/^\/assets\/avatar2\/1\.jpg$/i.test(url)) return '/assets/avatar2/1.jpg'
  // 匿名形象（avatar1）同样有旧名存量：`考拉 (2).jpg` 这类含空格与半角括号的
  // 路径在真机上渲染失败，文件已重命名为 `考拉2.jpg`。
  if (url.indexOf('/assets/avatar1/') === 0) return normalizeAnonymousAvatar(url)
  return url
}

// 匿名形象素材池：与小程序包内 assets/avatar1/ 逐一对齐，并与服务端
// utils/defaultProfile.js 的 ANONYMOUS_AVATARS 同源，三处必须同步。
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
  '/assets/avatar1/乌龟.jpg', '/assets/avatar1/七星瓢虫.jpg'
]

// 匿名形象旧名 → 新名：`/assets/avatar1/考拉 (2).jpg`（含 %20 形式）→ `/assets/avatar1/考拉2.jpg`
function normalizeAnonymousAvatar(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  const match = url.match(/^\/assets\/avatar1\/(.+?)[\s%20]*\((\d+)\)\.(jpg|jpeg|png)$/i)
  if (match) {
    const renamed = '/assets/avatar1/' + match[1].trim() + String(Number(match[2])) + '.' + match[3]
    if (ANONYMOUS_AVATARS.indexOf(renamed) > -1) return renamed
  }
  return url
}

function isAnonymousAvatar(value) {
  return ANONYMOUS_AVATARS.indexOf(String(value || '').trim()) > -1
}

// 未知匿名路径 → 稳定映射到池内素材（与服务端 pickAnonymousAvatar 同算法）。
// 用种子（通常是昵称）保证同一身份每次映射到同一形象，避免"每次刷新换一张脸"。
function pickAnonymousAvatar(seed) {
  const text = String(seed || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000
  }
  return ANONYMOUS_AVATARS[hash % ANONYMOUS_AVATARS.length]
}

// 是否「匿名形象」路径（含历史脏数据）：用于判断能否展示对方真实主页 ——
// 只要头像是匿名素材池里的形象，无论会话是否标记为匿名，都不应提供主页入口
function looksAnonymousAvatar(value) {
  const url = String(value || '').trim()
  if (!url) return false
  return url.indexOf('/assets/avatar1/') === 0 || isAnonymousAvatar(url)
}

function getRandomAvatar() {
  const filename = DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)]
  // Filenames are plain ASCII now, so no URL encoding is needed (and encoding
  // is what used to leave raw parentheses in the path on real devices).
  return '/assets/avatar2/' + filename
}

function getRandomName() {
  return DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)]
}

function getDefaultProfile() {
  const cached = wx.getStorageSync(DEFAULT_PROFILE_KEY)
  if (cached && cached.avatarUrl && cached.nickName) {
    // Heal profiles cached before the avatar files were renamed.
    const fixed = normalizeLegacyAvatar(cached.avatarUrl)
    if (fixed !== cached.avatarUrl) {
      cached.avatarUrl = fixed
      wx.setStorageSync(DEFAULT_PROFILE_KEY, cached)
    }
    return cached
  }
  const profile = { avatarUrl: getRandomAvatar(), nickName: getRandomName() }
  wx.setStorageSync(DEFAULT_PROFILE_KEY, profile)
  return profile
}

function isDefaultName(value) {
  return !String(value || '').trim() || value === '校园用户' || value === '微信用户' || value === '用户'
}

function isTemporaryAvatar(value) {
  const url = String(value || '').trim()
  return !!url && !isStoredAvatar(url)
}

function isStoredAvatar(value) {
  const url = String(value || '').trim()
  // Bundled default avatars now live under /assets/ (avatar1/avatar2 included);
  // uploaded avatars are https URLs.
  return /^https:\/\//i.test(url) || url.indexOf('/assets/') === 0
}

module.exports = {
  DEFAULT_AVATARS,
  DEFAULT_NAMES,
  ANONYMOUS_AVATARS,
  getRandomAvatar,
  getRandomName,
  getDefaultProfile,
  isDefaultName,
  isTemporaryAvatar,
  isStoredAvatar,
  normalizeLegacyAvatar,
  normalizeAnonymousAvatar,
  isAnonymousAvatar,
  looksAnonymousAvatar,
  pickAnonymousAvatar,
}
