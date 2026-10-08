// 广轻群聊：分类预设与渲染辅助
// 九大分类与设计稿一一对应（名称/图标字符/主题色/副标题），数组顺序即页面展示顺序
const { themeFromColor } = require('./club-data')

const CATEGORY_META = [
  { name: '学院群', char: '学', color: '#2E6BFF', intro: '各学院群聊' },
  { name: '线下桌游群', char: '线', color: '#8B5CF6', intro: '狼人杀、三国杀等' },
  { name: '体育运动群', char: '体', color: '#F97B2F', intro: '羽毛球、乒乓球等运动群' },
  { name: '老乡群', char: '老', color: '#A78BFA', intro: '跨越山海，共叙乡情' },
  { name: '学习竞赛', char: '学', color: '#F5A70A', intro: '学科学习和竞赛交流群' },
  { name: '互助群', char: '互', color: '#16B364', intro: '二手书、物品交易群' },
  { name: '游戏群', char: '游', color: '#EAB308', intro: '组队开黑，快乐翻倍' },
  { name: '新生群', char: '新', color: '#F04438', intro: '各届广轻工学生新生群' }
]

const FALLBACK_COLORS = ['#2E6BFF', '#F97B2F', '#16B364', '#8B5CF6', '#F04438', '#0EA5E9', '#EC4899', '#14B8A6', '#F5A70A', '#64748B']

// 宫格卡片数据：优先使用服务端类别（管理后台「群聊类别编辑」维护），
// 服务端不可用/为空时回退到内置九大分类；遗留自定义分类有群时追加在末尾
function buildCategories(groups, serverCategories) {
  const counts = {}
  for (const group of groups || []) {
    const key = group.category || '其他'
    counts[key] = (counts[key] || 0) + 1
  }
  const serverList = (serverCategories || []).filter((c) => c && c.name && c.status !== 0)
  if (serverList.length) {
    const cards = serverList.map((c, i) => ({
      id: 'cat-' + c.id,
      name: c.name,
      char: (c.name || '群').charAt(0),
      // 有群时优先展示数量（用户能直观看到审核通过的群已上架），无群时展示类别描述
      intro: (counts[c.name] || 0) > 0
        ? counts[c.name] + ' 个群聊等你加入'
        : (c.description || '暂无群聊'),
      count: counts[c.name] || 0,
      theme: themeFromColor(FALLBACK_COLORS[i % FALLBACK_COLORS.length])
    }))
    for (const key of Object.keys(counts)) {
      if (cards.some((card) => card.name === key)) continue
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
  const cards = CATEGORY_META.map((meta) => ({
    id: meta.name,
    name: meta.name,
    char: meta.char,
    // 有群时优先展示数量，无群时展示预设文案
    intro: (counts[meta.name] || 0) > 0 ? counts[meta.name] + ' 个群聊等你加入' : meta.intro,
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

// 群聊头像动态生成：取群名首字符 + 按字符编码稳定映射底色。
// 渲染时实时计算，群名首字符变化（如管理员改名）后头像立即跟随更新。
function charAvatar(name) {
  const char = (name || '群').charAt(0) || '群'
  const code = char.charCodeAt(0) || 0
  const theme = themeFromColor(FALLBACK_COLORS[code % FALLBACK_COLORS.length])
  return { char, theme }
}

module.exports = { CATEGORY_META, FALLBACK_COLORS, buildCategories, categoryTheme, charAvatar }
