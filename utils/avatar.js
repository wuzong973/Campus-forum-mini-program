// Keep the bundled defaults in one place so login and profile editing use the
// same asset set. The filenames are URL encoded because several contain spaces.
const DEFAULT_AVATARS = [
  '1 (1).jpg', '1 (2).jpg', '1 (3).jpg', '1 (4).jpg', '1 (5).jpg',
  '1 (6).jpg', '1 (7).jpg', '1 (8).jpg', '1 (9).jpg', '1 (10).jpg',
  '1 (11).jpg', '1 (12).jpg', '1 (13).jpg', '1 (14).jpg', '1 (15).jpg',
  '1 (16).jpg', '1 (17).jpg', '1 (18).jpg', '1 (19).jpg', '1 (20).jpg',
  '1 (21).jpg', '1 (22).jpg', '1 (23).jpg', '1 (24).jpg', '1 (25).jpg',
  '1 (26).jpg', '1 (27).jpg', '1 (28).jpg', '1 (29).jpg', '1 (30).jpg',
  '1 (31).jpg', '1 (32).jpg', '1 (33).jpg', '1 (34).jpg', '1 (35).jpg',
  '1 (36).jpg', '1 (37).jpg', '1 (38).jpg', '1 (39).jpg', '1 (40).jpg',
  '1 (41).jpg', '1 (42).jpg', '1 (43).jpg', '1 (44).jpg', '1 (45).jpg',
  '1 (46).jpg', '1 (47).jpg', '1 (48).jpg', '1 (49).jpg', '1 (50).jpg',
  '1 (51).jpg', '1 (52).jpg', '1 (53).jpg', '1 (54).jpg', '1 (55).jpg',
  '1.jpg'
]

// Bundled from avatar2/name.txt because mini-program code cannot read files
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

function getRandomAvatar() {
  const filename = DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)]
  return '/avatar2/' + encodeURIComponent(filename)
}

function getRandomName() {
  return DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)]
}

function getDefaultProfile() {
  const cached = wx.getStorageSync(DEFAULT_PROFILE_KEY)
  if (cached && cached.avatarUrl && cached.nickName) return cached
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
  return /^https:\/\//i.test(url) || url.indexOf('/avatar1/') === 0 || url.indexOf('/avatar2/') === 0 || url.indexOf('/assets/') === 0
}

module.exports = { DEFAULT_AVATARS, DEFAULT_NAMES, getRandomAvatar, getRandomName, getDefaultProfile, isDefaultName, isTemporaryAvatar, isStoredAvatar }
