// 校园评价模块共享配置与纯函数。
// 导航层级 / 校区 / 楼层等规则集中在这里维护（服务端 reviewController 有同一份镜像，
// 两端以本文件为展示口径、以服务端校验为最终口径）。

const { CAMPUS_GROUPS } = require('../../utils/campus')

// 三大评价分类（评价分类页三张卡）
const REVIEW_CATEGORIES = [
  { key: 'course', name: '课程评分', desc: '分享课程体验与评分', icon: '📚' },
  { key: 'canteen', name: '食堂评分', desc: '食堂美食点评社区', icon: '🍱' },
  { key: 'business', name: '商圈评分', desc: '商圈好店点评社区', icon: '🛍️' }
]

// ===== 多维度评分（食堂 / 商圈）=====
// 统一四维，权重 40/20/20/20；课程评分不启用维度（保持单一星级）。
// ⚠ 服务端 server/controllers/reviewController.js 有同一份镜像 —— 改这里必须同步改那边，
//   两端以本文件为「展示口径」、以服务端为「校验与计算口径」。
// labelByCategory 只做措辞微调（同一个 key 在不同分类下叫法不同），不改变维度本身。
const REVIEW_DIMENSIONS = [
  { key: 'taste', weight: 40, label: '口味', labelByCategory: { business: '品质' } },
  { key: 'env', weight: 20, label: '环境' },
  { key: 'service', weight: 20, label: '服务' },
  { key: 'value', weight: 20, label: '性价比', labelByCategory: { business: '价格' } }
]

// 启用多维度评分的分类（课程保持单一星级，不在内）
const REVIEW_DIMENSION_CATEGORIES = ['canteen', 'business']

// 该分类是否启用多维度评分
function supportsDimensions(category) {
  return REVIEW_DIMENSION_CATEGORIES.indexOf(String(category || '')) >= 0
}

// 某分类下的维度定义（已套用该分类的措辞）；不支持维度的分类返回 []
function dimensionsFor(category) {
  if (!supportsDimensions(category)) return []
  return REVIEW_DIMENSIONS.map((d) => ({
    key: d.key,
    weight: d.weight,
    label: (d.labelByCategory && d.labelByCategory[category]) || d.label
  }))
}

// 加权综合分：Σ(维度分 × 权重) / Σ权重，保留 2 位小数（1~5）
// 与「单一星级」的 score 语义完全一致，因此 rating_sum / rating_count / ratingAvg 无需改变口径。
function weightedScore(dims) {
  const source = dims || {}
  const weightTotal = REVIEW_DIMENSIONS.reduce((s, d) => s + Number(d.weight), 0)
  if (!weightTotal) return 0
  const sum = REVIEW_DIMENSIONS.reduce((s, d) => s + Number(source[d.key] || 0) * Number(d.weight), 0)
  return Number((sum / weightTotal).toFixed(2))
}

// 校验一组维度分：必须四维齐全且均为 1-5 的整数。返回 null 表示合法，否则返回错误文案。
function validateDims(dims) {
  const source = dims || {}
  for (const d of REVIEW_DIMENSIONS) {
    const v = Number(source[d.key])
    if (!Number.isInteger(v) || v < 1 || v > 5) return `${d.label}评分需为 1-5 星`
  }
  return null
}

// 食堂 / 商圈按校区区分（课程评价不区分校区），采用项目标准的两级校区模型：
// 一级 广州校区（新港校区 / 琶洲校区）、佛山校区（南海南校区 / 南海北校区）
const REVIEW_CAMPUS_GROUPS = CAMPUS_GROUPS
// UI（分类页校区面板 / 列表页次导航 / 发布页校区选择）一律只展示一级主校区，
// 不细分南北区；分校区入参经 parentMainOf 归入所属主校区，
// 服务端主校区过滤自动命中其全部分校区数据（campusMatchList）
const REVIEW_CAMPUS_MAIN_OPTIONS = CAMPUS_GROUPS.map((group) => group.name)

const ALL_REVIEW_CAMPUSES = REVIEW_CAMPUS_GROUPS.reduce(
  (arr, group) => arr.concat([group.name], group.subs),
  []
)

// 校区取值是否合法（主校区或分校区）
function isValidReviewCampus(campus) {
  return ALL_REVIEW_CAMPUSES.indexOf(String(campus || '')) >= 0
}

// 分校区 → 所属主校区；主校区 → 自身；非法值 → ''
function parentMainOf(campus) {
  const target = String(campus || '')
  const group = REVIEW_CAMPUS_GROUPS.find((item) => item.name === target || item.subs.indexOf(target) >= 0)
  return group ? group.name : ''
}

// 服务端过滤用：主校区命中自身 + 全部分校区；分校区精确命中
function campusMatchList(campus) {
  const target = String(campus || '')
  const group = REVIEW_CAMPUS_GROUPS.find((item) => item.name === target)
  if (group) return [group.name].concat(group.subs)
  return isValidReviewCampus(target) ? [target] : []
}

// 兼容旧版扁平取值（广州校区/南海南/南海北）：映射到标准两级模型
function normalizeLegacyReviewCampus(campus) {
  const value = String(campus || '').trim()
  if (value === '南海南') return '南海南校区'
  if (value === '南海北') return '南海北校区'
  return value
}

// 学历层次：决定课程评分页的次导航
const REVIEW_LEVELS = ['专科', '本科', '专升本']

// 次导航规则：
//   专科：大一、大二、大三
//   本科：大一、大二、大三、大四
//   专升本：本科一年级、本科二年级
// 通识课为选修课，同时适用于专科 / 本科 / 专升本三类，因此恒在首位
const COURSE_LEVEL_TABS = {
  '专科': ['大一', '大二', '大三'],
  '本科': ['大一', '大二', '大三', '大四'],
  '专升本': ['本科一年级', '本科二年级']
}

const GENERAL_COURSE_TAB = '通识课'

// 课程评分页次导航：通识课 + 当前学历层次对应的年级
function getCourseTabs(level) {
  const grades = COURSE_LEVEL_TABS[level] || COURSE_LEVEL_TABS['本科']
  return [GENERAL_COURSE_TAB].concat(grades)
}

// 年级 → 适用学历层次（发布课程时反填 levels；查询时按此过滤）
const GRADE_LEVEL_MAP = (function () {
  const map = {}
  Object.keys(COURSE_LEVEL_TABS).forEach((level) => {
    ;(COURSE_LEVEL_TABS[level] || []).forEach((grade) => {
      if (!map[grade]) map[grade] = []
      if (map[grade].indexOf(level) < 0) map[grade].push(level)
    })
  })
  return map
})()

function levelsForGrade(grade) {
  if (grade === GENERAL_COURSE_TAB) return REVIEW_LEVELS.slice()
  return (GRADE_LEVEL_MAP[grade] || []).slice()
}

// 食堂 / 商圈楼层：最多六层（与服务端 reviewController.FLOORS 镜像）
const REVIEW_FLOORS = ['1层', '2层', '3层', '4层', '5层', '6层']

// 排序方式（列表页 / 评价列表共用）
const SORT_OPTIONS = [
  { key: 'all', label: '综合排序' },
  { key: 'rating', label: '评分最高' },
  { key: 'hot', label: '评价最多' }
]

// 头像色板：无图对象按名称首字渲染彩色字块（与图片中的彩色方块一致）
const AVATAR_PALETTE = [
  { bg: '#E8F7EE', color: '#2BA471' },
  { bg: '#FFF1E5', color: '#E0862C' },
  { bg: '#FDEBEB', color: '#E34D4D' },
  { bg: '#FFF9E0', color: '#D9A400' },
  { bg: '#F1EBFF', color: '#7C5CE0' },
  { bg: '#E7F0FF', color: '#3D6FE0' },
  { bg: '#E6F7F5', color: '#12B8A6' },
  { bg: '#FFEBF3', color: '#E05C8F' }
]

function hashCode(str) {
  const text = String(str || '')
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

// 评分对象卡片头像：有图用图，无图取名称首字 + 稳定配色
function decorateAvatar(item) {
  const name = String((item && item.name) || '').trim()
  const avatar = String((item && item.avatar) || '').trim()
  const palette = AVATAR_PALETTE[hashCode(name) % AVATAR_PALETTE.length]
  return {
    avatar: avatar,
    char: name ? name.slice(0, 1) : '评',
    avatarBg: palette.bg,
    avatarColor: palette.color
  }
}

// 列表卡片展示字段拼装。
// 根级食堂 / 商圈（非课程）是容器，本身不可评分：不显示分数；右侧评论数用 commentTotal
// （其全部档口 / 店铺的评论条数之和），「x人已评」用 raterTotal（全部子级评论的去重用户数，
// 服务端 fillContainerRaterTotals 下发）；课程与子级档口 / 店铺保持「分数 + x人已评」。
function decorateTarget(item) {
  const base = decorateAvatar(item)
  const container = !item.parentId && item.category !== 'course'
  if (container) {
    return Object.assign({}, item, base, {
      scoreText: '',
      countText: Number(item.commentTotal || 0),
      ratedCountText: (Number(item.raterTotal || 0)) + '人已评',
      hotComment: String(item.hotComment || '').trim()
    })
  }
  return Object.assign({}, item, base, {
    scoreText: Number(item.ratingCount || 0) > 0 ? Number(item.ratingAvg || 0).toFixed(1) : '暂无',
    countText: Number(item.commentCount || 0),
    ratedCountText: (Number(item.ratingCount || 0)) + '人已评',
    hotComment: String(item.hotComment || '').trim()
  })
}

// 我的评分星级行：1-5 星 + 文案
const STAR_LABELS = ['很差', '较差', '一般', '不错', '很棒']

// 相对时间：今天/昨天 HH:mm，其余 MM月DD日 HH:mm（与图片一致）
function formatRelativeTime(value) {
  if (!value) return ''
  let date = null
  if (value instanceof Date) date = value
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(value))) date = new Date(String(value).replace(' ', 'T').replace(/(\.\d+)?Z?$/, ''))
  if (!date || isNaN(date.getTime())) return String(value)
  const pad = (n) => (n < 10 ? '0' : '') + n
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const yesterday = new Date(now.getTime() - 86400000)
  const isYesterday = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()
  const hm = pad(date.getHours()) + ':' + pad(date.getMinutes())
  if (sameDay) return '今天 ' + hm
  if (isYesterday) return '昨天 ' + hm
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hm
}

// 课程详情副标题：通识课 / 年级（课程评价不区分校区）
// 食堂 / 商圈：校区（根级）或 父对象 · 楼层（子级）
function targetSubtitle(item) {
  if (!item) return ''
  if (item.category === 'course') return item.grade || ''
  if (item.parentName) return item.parentName + (item.floor ? ' · ' + item.floor : '')
  return item.campus || ''
}

module.exports = {
  REVIEW_CATEGORIES,
  REVIEW_DIMENSIONS,
  REVIEW_DIMENSION_CATEGORIES,
  supportsDimensions,
  dimensionsFor,
  weightedScore,
  validateDims,
  REVIEW_CAMPUS_GROUPS,
  REVIEW_CAMPUS_MAIN_OPTIONS,
  REVIEW_LEVELS,
  COURSE_LEVEL_TABS,
  GENERAL_COURSE_TAB,
  REVIEW_FLOORS,
  SORT_OPTIONS,
  STAR_LABELS,
  AVATAR_PALETTE,
  isValidReviewCampus,
  parentMainOf,
  campusMatchList,
  normalizeLegacyReviewCampus,
  getCourseTabs,
  levelsForGrade,
  decorateAvatar,
  decorateTarget,
  formatRelativeTime,
  targetSubtitle,
  hashCode
}
