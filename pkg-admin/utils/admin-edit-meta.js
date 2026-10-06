// 后台编辑页共享元数据与纯函数
// 从 pkg-admin/admin/index.js 抽出，供「抽屉 → 独立编辑页」改造后的新页面复用，
// 避免两端各写一份常量造成口径分叉（例如群成员上限、进群方式文案）。
//
// 注意：本模块只放**纯数据 + 纯函数**，不放页面实例方法。

// ===== 校区维度（与用户端 utils/campus.js 一致；'' = 全部校区，所有校区可见） =====
const CAMPUS_SELECT_OPTIONS = [
  { label: '全部校区', value: '' },
  { label: '广州校区', value: '广州校区' },
  { label: '佛山校区', value: '佛山校区' }
]

// ===== 群聊进群方式（与服务端 groupChatController 的 JOIN_MODES 及用户端
//       pages/group-chat/detail 的文案保持一致） =====
const JOIN_MODE_OPTIONS = [
  { label: '扫码进群', value: 'qrcode' },
  { label: '加管理员拉群', value: 'admin' },
  { label: '仅群成员邀请', value: 'invite' }
]
const JOIN_MODE_LABELS = JOIN_MODE_OPTIONS.map((item) => item.label)
const DEFAULT_JOIN_MODE = 'qrcode'
// 群成员规模展示上限（与服务端 MAX_MEMBER_COUNT 一致）
const MAX_MEMBER_COUNT = 100000

// ===== 内容配置（公告/标签/轮播/发布横幅）表单标题与操作指引 =====
const CONTENT_FORM_META = {
  notice: {
    title: '公告',
    guide: '操作指引：① 填写公告文字；② 按需配置右侧链接文字与跳转路径（默认显示"点此查看"，用户点击后跳转到所填页面路径；路径留空则弹出管理员微信二维码）；③ 按需配置尾部链接文字与链接图片；④ 可自定义背景颜色与文字颜色（实时预览）；⑤ 打开底部「启用状态」；⑥ 点击「保存并发布」，首页公告实时生效。首页公告取排序最前的启用条目。'
  },
  tag: {
    title: '标签',
    guide: '操作指引：① 填写标签名称，描述可留空；② 可自定义标签的背景颜色与文字颜色（配置列表中将按此颜色展示）；③ 打开底部「启用状态」；④ 点击「保存并发布」。'
  },
  banner: {
    title: '首页轮播',
    guide: '操作指引：① 填写主标题并上传轮播图片（建议宽高比 16:9）；② 按需填写描述、角标、跳转路径，并可点击挑选主题色（实时预览）；③ 打开底部「启用状态」；④ 点击「保存并发布」。启用中的轮播按排序展示在首页顶部，未配置时显示默认轮播。'
  },
  publish_banner: {
    title: '发布横幅',
    guide: '操作指引：① 填写横幅文字；② 选择预设配色，或点击「背景颜色 / 文字颜色」自定义颜色（实时预览，保存后在发布页生效）；③ 按需填写跳转链接（用户点击横幅后跳转，支持 /pages/... 页面路径或 https 网页）与详情标题/详情内容（横幅详情页展示）；④ 打开底部「启用状态」；⑤ 点击「保存并发布」。横幅展示在「发布帖子」「发布跑腿」页顶部，多条启用横幅按排序自动左右轮播。'
  }
}

// ===== 发布页横幅可选颜色（与小程序端 style-red/green/... 样式对应） =====
const BANNER_STYLE_VALUES = ['red', 'green', 'orange', 'blue', 'purple']
const BANNER_STYLE_NAMES = ['红色', '绿色', '橙色', '蓝色', '紫色']
const BANNER_STYLE_BG = { red: '#ffe2e2', green: '#e0f5e6', orange: '#fff1de', blue: '#e3edff', purple: '#f0e5ff' }
const BANNER_STYLE_FG = { red: '#e34d4d', green: '#3aa356', orange: '#e8930c', blue: '#3a6fe3', purple: '#8a4de0' }

// ===== 群聊类别兜底（与服务端默认九大分类顺序一致） =====
const GC_CATEGORIES = ['学院群', '线下桌游群', '体育运动群', '老乡群', '学习竞赛', '交易群', '游戏群', '新生群']

// 驾校表单下拉选项
const DRIVING_SCHOOL_CAMPUS_OPTIONS = ['广州校区', '佛山校区']
const DRIVING_SCHOOL_LEVEL_OPTIONS = ['S', 'A', 'B']

// 信息推送群配色（顺序即 picker 顺序）
const PUSH_GROUP_THEME_KEYS = ['orange', 'green', 'blue', 'purple', 'teal']
const PUSH_GROUP_THEME_OPTIONS = ['橙色', '绿色', '蓝色', '紫色', '青色']

function pad2(n) { return (n < 10 ? '0' : '') + n }

// DATETIME/ISO → 本地 'YYYY-MM-DD HH:mm:ss'，空值返回 ''
function fmtDateTime(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  if (isNaN(d.getTime())) return ''
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

// 十六进制颜色校验：合法返回 #RRGGBB，否则返回空串（表示未自定义）
function normalizeHex(v) {
  const s = String(v || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s
  return ''
}

// 内容配置 body（JSON 字符串或纯文本）→ 结构化 meta
// 轮播/公告/发布横幅的 body 存 JSON；标签新格式存 JSON、旧格式存纯文本，需兼容回退
function parseContentMeta(type, body) {
  let meta = {}
  try { meta = JSON.parse(body) || {} } catch (e) {}
  if (type === 'banner') return { image: meta.image || '', subtitle: meta.subtitle || '', tag: meta.tag || '', link: meta.link || '', accent: normalizeHex(meta.accent) }
  if (type === 'notice') return { tailText: meta.tailText || '', tailImage: meta.tailImage || '', linkText: meta.linkText || '', linkUrl: meta.linkUrl || '', bgColor: normalizeHex(meta.bgColor), textColor: normalizeHex(meta.textColor) }
  if (type === 'publish_banner') {
    const styleIndex = Math.max(0, BANNER_STYLE_VALUES.indexOf(meta.style || 'red'))
    return { style: BANNER_STYLE_VALUES[styleIndex], styleIndex, icon: meta.icon || '', bgColor: normalizeHex(meta.bgColor), textColor: normalizeHex(meta.textColor), link: meta.link || '', linkText: meta.linkText || '', detailTitle: meta.detailTitle || '', detailContent: meta.detailContent || '' }
  }
  if (type === 'tag') {
    if (meta && typeof meta === 'object' && (meta.text !== undefined || meta.bgColor || meta.textColor)) {
      return { text: String(meta.text || ''), bgColor: normalizeHex(meta.bgColor), textColor: normalizeHex(meta.textColor) }
    }
    return { text: String(body || ''), bgColor: '', textColor: '' }
  }
  return null
}

// 内容配置空 meta（按 type 给出各字段默认值）
function emptyContentMeta(type) {
  if (type === 'banner') return { image: '', subtitle: '', tag: '', link: '', accent: '' }
  if (type === 'notice') return { tailText: '', tailImage: '', linkText: '', linkUrl: '', bgColor: '', textColor: '' }
  if (type === 'publish_banner') return { style: 'red', styleIndex: 0, icon: '', bgColor: '', textColor: '', link: '', linkText: '', detailTitle: '', detailContent: '' }
  if (type === 'tag') return { text: '', bgColor: '', textColor: '' }
  return null
}

// 驾校表单 → 服务端提交体（tags 支持数组或「，、空格」分隔文本）
function buildSchoolPayload(form, campusFallback) {
  const tags = Array.isArray(form.tags)
    ? form.tags
    : String(form.tags || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  return {
    name: String(form.name || '').trim(),
    campus: form.campus || campusFallback || DRIVING_SCHOOL_CAMPUS_OPTIONS[0],
    region: String(form.region || '').trim(),
    address: String(form.address || '').trim(),
    phone: String(form.phone || '').trim(),
    carTypes: String(form.carTypes || '').trim(),
    price: String(form.price || '').trim(),
    intro: String(form.intro || '').trim(),
    passRate: Number(form.passRate) || 0,
    level: form.level || 'A',
    tags,
    distanceKm: Number(form.distanceKm) || 0,
    cover: String(form.cover || '').trim(),
    contactQr: String(form.contactQr || '').trim(),
    contactName: String(form.contactName || '').trim(),
    // 坐标由「在地图上选点」得到（wx.chooseLocation）；0 = 未选点，用户端不显示地图入口。
    // 必须回传，否则编辑任一字段都会把已有坐标清零
    lat: Number(form.lat) || 0,
    lng: Number(form.lng) || 0,
    images: (form.images || []).slice(0, 9),
    detail: String(form.detail || '').trim(),
    sortOrder: Number(form.sortOrder) || 0,
    status: form.status === false || Number(form.status) === 0 ? 0 : 1
  }
}

module.exports = {
  CAMPUS_SELECT_OPTIONS,
  JOIN_MODE_OPTIONS,
  JOIN_MODE_LABELS,
  DEFAULT_JOIN_MODE,
  MAX_MEMBER_COUNT,
  CONTENT_FORM_META,
  BANNER_STYLE_VALUES,
  BANNER_STYLE_NAMES,
  BANNER_STYLE_BG,
  BANNER_STYLE_FG,
  GC_CATEGORIES,
  DRIVING_SCHOOL_CAMPUS_OPTIONS,
  DRIVING_SCHOOL_LEVEL_OPTIONS,
  PUSH_GROUP_THEME_KEYS,
  PUSH_GROUP_THEME_OPTIONS,
  fmtDateTime,
  normalizeHex,
  parseContentMeta,
  emptyContentMeta,
  buildSchoolPayload
}
