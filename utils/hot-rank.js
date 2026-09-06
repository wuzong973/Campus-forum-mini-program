const format = require('./format')

// 热榜展示模型构建：首页 TOP15 卡片与帖子详情「每日热榜」胶囊共用同一份逻辑，
// 保证两处的数据来源、字段与文案完全一致
function buildHotPosts(list) {
  return (Array.isArray(list) ? list : []).map((post) => {
    const viewCount = Number(post.viewCount || 0)
    return Object.assign({}, post, {
      rankTimeText: format.formatRelativeTime(post.createdAt) || '刚刚',
      // 与帖子卡片一致的浏览量展示（1.2万 浏览）
      rankViewText: (viewCount >= 10000 ? (viewCount / 10000).toFixed(1) + '万' : String(viewCount)) + ' 浏览',
      // 热榜单行展示：压平换行/连续空白，避免长文撑破行高
      hotText: String(post.title || post.content || '').replace(/\s+/g, ' ').trim()
    })
  })
}

function groupHotPosts(posts) {
  const list = Array.isArray(posts) ? posts.slice(0, 15) : []
  const groups = []
  for (let index = 0; index < list.length; index += 2) {
    groups.push(list.slice(index, index + 2).map((post, groupIndex) => Object.assign({}, post, {
      rank: index + groupIndex + 1
    })))
  }
  return groups
}

module.exports = {
  buildHotPosts,
  groupHotPosts
}
