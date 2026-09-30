const format = require('./format')

// ===== 「显示每日热榜」按用户维度的偏好 =====
// 每个已登录用户独立保存（键为用户 id），未登录回退到 guest（设备级）；
// 未记录过的用户默认开启。设置页写入，各热榜展示场景（首页/详情页/搜索页/热榜页）读取。
const DAILY_HOT_PREF_KEY = 'dailyHot_by_user'

function currentPrefUserId() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    const userInfo = (app && app.globalData && app.globalData.userInfo) || null
    return (userInfo && userInfo.id) || 'guest'
  } catch (e) {
    return 'guest'
  }
}

function isDailyHotVisible() {
  const map = wx.getStorageSync(DAILY_HOT_PREF_KEY) || {}
  // 未记录过的用户默认开启；一旦用户手动切换，则严格遵循已保存的选择。
  return map[currentPrefUserId()] === undefined ? true : !!map[currentPrefUserId()]
}

function setDailyHotVisible(visible) {
  const map = wx.getStorageSync(DAILY_HOT_PREF_KEY) || {}
  map[currentPrefUserId()] = !!visible
  wx.setStorageSync(DAILY_HOT_PREF_KEY, map)
}

// ===== 「已删除帖子」本地广播 =====
// 详情页发现帖子已不存在（服务端返回 404）或用户主动删除成功时写入；
// 各热榜展示场景在构建列表时统一过滤掉这些 id。
//
// 解决什么：删除成功后到「下一次拉取热榜」之间存在窗口期，这段时间页面仍持有旧列表，
// 已删除的帖子会短暂残留（用户看到的就是「帖子已删，却还在每日热榜上」）。
// 有了广播，即便列表还没重新拉取，渲染前也会把这些帖子剔除。
//
// 带 TTL（10 分钟）：既避免本地键无限增长，也避免长期误伤 —— 若某 id 之后被复用或
// 帖子被恢复，过期后即可正常展示。
const REMOVED_POSTS_KEY = 'hot_removed_post_ids'
const REMOVED_POSTS_TTL_MS = 10 * 60 * 1000

function readRemovedPostIds() {
  let map = {}
  try { map = wx.getStorageSync(REMOVED_POSTS_KEY) || {} } catch (e) { map = {} }
  const now = Date.now()
  const alive = {}
  Object.keys(map || {}).forEach((key) => {
    if (now - Number((map || {})[key] || 0) <= REMOVED_POSTS_TTL_MS) alive[key] = map[key]
  })
  return alive
}

/** 标记某帖子已被删除（详情页拿到 404 或删除成功时调用） */
function markPostRemoved(postId) {
  const id = Number(postId)
  if (!id) return
  const alive = readRemovedPostIds()
  alive[String(id)] = Date.now()
  try { wx.setStorageSync(REMOVED_POSTS_KEY, alive) } catch (e) { /* 存储失败不影响主流程 */ }
}

/** 过滤掉本地已标记为「已删除」的帖子（各热榜列表渲染前统一调用） */
function filterRemovedPosts(list) {
  const arr = Array.isArray(list) ? list : []
  const alive = readRemovedPostIds()
  const deadIds = Object.keys(alive)
  if (!deadIds.length) return arr
  const dead = {}
  deadIds.forEach((id) => { dead[id] = true })
  return arr.filter((post) => !dead[String(post && post.id)])
}

// 热榜展示模型构建：首页 TOP15 卡片与帖子详情「每日热榜」胶囊共用同一份逻辑，
// 保证两处的数据来源、字段与文案完全一致。
// 入口处统一过滤「已删除」帖子，因此首页/详情页/搜索页三处天然一致。
function buildHotPosts(list) {
  return filterRemovedPosts(list).map((post) => {
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
  groupHotPosts,
  isDailyHotVisible,
  setDailyHotVisible,
  // 「已删除帖子」本地广播：详情页写入，热榜各展示场景过滤
  markPostRemoved,
  filterRemovedPosts,
  REMOVED_POSTS_KEY,
  REMOVED_POSTS_TTL_MS
}
