// ===== 找驾校：校区分类 + 筛选/排序纯函数 =====
//
// 数据已从本文件的静态示例迁移到服务端 driving_school 表，
// 由管理后台「找驾校内容管理」维护（新增/编辑/排序/启停/封面上传）；
// 本文件只保留展示口径：校区选项、卡片字段补全、筛选与排序纯函数（作用于传入的列表）。

const { CAMPUS_GROUPS } = require('./campus')

// 校区分类：仅保留两个主校区（广州校区 / 佛山校区），旧的区级分类已移除
const CAMPUS_OPTIONS = CAMPUS_GROUPS.map((group) => group.name)

// 服务保障标签：筛选面板与驾校卡片共用同一份，保证文案一致
const SERVICE_TAGS = [
  '免费试驾',
  '包考试费',
  '包补考费',
  '包补训费',
  '包接送',
  '学时打卡费',
  '五次不过退学',
  '驾驶模拟器'
]

// 筛选面板：通过率下限（单选）与推荐等级（多选，命中任一即可）
const PASS_RATE_FILTERS = [
  { key: 'any', label: '不限', min: 0 },
  { key: '80', label: '80% 以上', min: 80 },
  { key: '90', label: '90% 以上', min: 90 }
]
const LEVEL_FILTERS = ['S', 'A', 'B']

// 列表页顶部横幅的兜底文案：后台未配置（或已下线）时使用，避免运营位空白期页面缺内容
const DEFAULT_PROMO = {
  title: '校园圈学车',
  sub: '找驾校 · 比价格 · 看口碑',
  btnText: '帮我找驾校',
  tags: ['离校近', '价格低', '拿本快'],
  image: ''
}

// 排序方式（详情见 sortSchools）
const SORT_OPTIONS = [
  { key: 'default', label: '综合排序' },
  { key: 'distance', label: '离校最近' },
  { key: 'passRate', label: '通过率最高' },
  { key: 'level', label: '推荐等级' }
]

// 报名流程：详情页顶部 5 步进度条（对应设计稿「选驾校 → 预报名 → 签合同 → 缴学费 → 体检/面签」）
const ENROLL_STEPS = ['选驾校', '预报名', '签合同', '缴学费', '体检/面签']

// 无实拍图时的封面兜底配色，按 id 轮换，避免卡片出现空白块
const COVER_THEMES = [
  'linear-gradient(135deg, #5B8DEF 0%, #2E6BFF 100%)',
  'linear-gradient(135deg, #34C6A6 0%, #12A88C 100%)',
  'linear-gradient(135deg, #F5A70A 0%, #F97B2F 100%)',
  'linear-gradient(135deg, #8B5CF6 0%, #6D3FE0 100%)',
  'linear-gradient(135deg, #F04438 0%, #D9483B 100%)'
]

const LEVEL_ORDER = { S: 3, A: 2, B: 1 }

function toNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

// 补全展示字段：距离文案、等级、封面兜底、标签列表、首字、价格/班型/地址/联系方式
function buildSchoolCard(school, index) {
  const item = Object.assign({}, school)
  item.distanceText = toNumber(school.distanceKm, 0).toFixed(1) + 'km'
  item.levelText = school.level || 'A'
  item.firstChar = String(school.name || '驾').charAt(0)
  item.coverTheme = COVER_THEMES[(index >= 0 ? index : 0) % COVER_THEMES.length]
  item.tagList = (school.tags || []).slice(0, 5)
  // 列表卡片只放前 3 个标签，剩下的收成 +N，避免五个长标签把卡片撑成三行
  item.cardTags = (school.tags || []).slice(0, 3)
  item.cardTagMore = Math.max(0, (school.tags || []).length - 3)
  item.passRateText = toNumber(school.passRate, 0) + '%'
  item.carTypesText = String(school.carTypes || '').trim()
  item.priceText = String(school.price || '').trim()
  item.addressText = String(school.address || '').trim()
  item.phoneText = String(school.phone || '').trim()
  return item
}

// 排序：综合=sortOrder；离校最近=距离升序；通过率最高=通过率降序；推荐等级=S>A>B
function sortSchools(list, sortKey) {
  const sorted = (list || []).slice()
  if (sortKey === 'distance') return sorted.sort((a, b) => toNumber(a.distanceKm, 0) - toNumber(b.distanceKm, 0))
  if (sortKey === 'passRate') return sorted.sort((a, b) => toNumber(b.passRate, 0) - toNumber(a.passRate, 0))
  if (sortKey === 'level') {
    return sorted.sort((a, b) => (LEVEL_ORDER[b.level] || 0) - (LEVEL_ORDER[a.level] || 0))
  }
  return sorted.sort((a, b) => toNumber(a.sortOrder, 0) - toNumber(b.sortOrder, 0))
}

// 列表筛选（纯函数，作用于服务端下发的驾校列表）：校区 + 关键词（名称/区域/简介/地址/标签）
// + 服务标签（需全部命中）+ 通过率下限 + 推荐等级（命中任一即可）
function filterSchools(list, options) {
  const opts = options || {}
  const campus = opts.campus || ''
  const keyword = String(opts.keyword || '').trim().toLowerCase()
  const tags = opts.tags || []
  const minPassRate = toNumber(opts.minPassRate, 0)
  const levels = opts.levels || []
  const filtered = (list || []).filter((school) => {
    if (campus && school.campus !== campus) return false
    if (tags.length && !tags.every((tag) => (school.tags || []).indexOf(tag) >= 0)) return false
    if (minPassRate && toNumber(school.passRate, 0) < minPassRate) return false
    if (levels.length && levels.indexOf(school.level || 'A') < 0) return false
    if (keyword) {
      const haystack = [school.name, school.campus, school.region, school.intro, school.address].concat(school.tags || []).join(' ').toLowerCase()
      if (haystack.indexOf(keyword) < 0) return false
    }
    return true
  })
  return sortSchools(filtered, opts.sortKey).map((school, index) => buildSchoolCard(school, index))
}

module.exports = {
  CAMPUS_OPTIONS,
  SERVICE_TAGS,
  PASS_RATE_FILTERS,
  LEVEL_FILTERS,
  DEFAULT_PROMO,
  SORT_OPTIONS,
  ENROLL_STEPS,
  COVER_THEMES,
  buildSchoolCard,
  sortSchools,
  filterSchools
}
