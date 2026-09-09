// 广轻群聊：分类预设与渲染辅助
// 九大分类与设计稿一一对应（名称/图标字符/主题色/副标题），数组顺序即页面展示顺序
const { themeFromColor } = require('./club-data')

const CATEGORY_META = [
  { name: '学院群', char: '学', color: '#2E6BFF', intro: '各学院群聊' },
  { name: '线下桌游群', char: '线', color: '#8B5CF6', intro: '狼人杀、三国杀等' },
  { name: '飞梦', char: '飞', color: '#38BDF8', intro: '飞扬与梦' },
  { name: '体育运动群', char: '体', color: '#F97B2F', intro: '羽毛球、乒乓球等运动群' },
  { name: '老乡群', char: '老', color: '#A78BFA', intro: '跨越山海，共叙乡情' },
  { name: '学习竞赛', char: '学', color: '#F5A70A', intro: '学科学习和竞赛交流群' },
  { name: '交易群', char: '交', color: '#16B364', intro: '二手书、物品交易群' },
  { name: '游戏群', char: '游', color: '#EAB308', intro: '组队开黑，快乐翻倍' },
  { name: '新生群', char: '新', color: '#F04438', intro: '各届广轻工学生新生群' }
]

const FALLBACK_COLORS = ['#2E6BFF', '#F97B2F', '#16B364', '#8B5CF6', '#F04438', '#0EA5E9', '#EC4899', '#14B8A6', '#F5A70A', '#64748B']

// 宫格卡片数据：九大分类固定常驻（含暂无群聊的分类），遗留自定义分类有群时追加在末尾
function buildCategories(groups) {
  const counts = {}
  for (const group of groups || []) {
    const key = group.category || '其他'
    counts[key] = (counts[key] || 0) + 1
  }
  const cards = CATEGORY_META.map((meta) => ({
    id: meta.name,
    name: meta.name,
    char: meta.char,
    intro: meta.intro,
    count: counts[meta.name] || 0,
    theme: themeFromColor(meta.color)
  }))
  for (const key of Object.keys(counts)) {
    if (CATEGORY_META.some((meta) => meta.name === key)) continue
    cards.push({
      id: key,
      name: key,
      char: (key || '群').charAt(0),
      intro: counts[key] + ' 个群聊等你加入',
      count: counts[key],
      theme: themeFromColor(FALLBACK_COLORS[cards.length % FALLBACK_COLORS.length])
    })
  }
  return cards
}

// 某个分类的头像兜底底色（分类主色的浅色渐变）
function categoryTheme(name) {
  const known = CATEGORY_META.find((meta) => meta.name === name)
  const color = known ? known.color : FALLBACK_COLORS[0]
  return themeFromColor(color)
}

module.exports = { CATEGORY_META, FALLBACK_COLORS, buildCategories, categoryTheme }
