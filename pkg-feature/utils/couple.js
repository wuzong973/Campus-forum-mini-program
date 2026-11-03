// 一周CP 端上共享常量与格式化工具

const TAGS = ['音乐', '电影', '夜跑', '摄影', '旅行', '美食', '游戏', '阅读', '健身', '二次元', '宠物', '手工']

const MBTI = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP']

const GRADES = ['大一', '大二', '大三', '大四', '研究生']

const HEIGHT_OPTIONS = [{ value: 0, label: '不填' }]
for (let cm = 140; cm <= 220; cm += 5) HEIGHT_OPTIONS.push({ value: cm, label: cm + 'cm' })

const EXPECT_HEIGHT_OPTIONS = []
for (let cm = 150; cm <= 200; cm += 5) EXPECT_HEIGHT_OPTIONS.push({ value: cm, label: cm + 'cm' })

const DEFAULT_EXPECT_MIN = 165
const DEFAULT_EXPECT_MAX = 175

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatRemain(endAt) {
  const remain = Math.max((Number(endAt) || 0) - Date.now(), 0)
  const total = Math.floor(remain / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds)
}

function formatClock(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value).replace(/-/g, '/'))
  if (Number.isNaN(date.getTime())) return ''
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
}

function formatDate(value) {
  if (!value) return ''
  const match = String(value).match(/^\d{4}-(\d{2})-(\d{2})/)
  return match ? match[1] + '/' + match[2] : ''
}

function indexOfValue(options, value) {
  const index = (options || []).findIndex((item) => String(item.value) === String(value))
  return index > -1 ? index : 0
}

module.exports = {
  TAGS,
  MBTI,
  GRADES,
  HEIGHT_OPTIONS,
  EXPECT_HEIGHT_OPTIONS,
  DEFAULT_EXPECT_MIN,
  DEFAULT_EXPECT_MAX,
  formatRemain,
  formatClock,
  formatDate,
  indexOfValue
}
