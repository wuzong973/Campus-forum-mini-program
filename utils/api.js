const request = require('./request')
const mock = require('./mock')
const scheduleUtils = require('./schedule')

// 通用本地缓存：减少首屏请求，缓存命中时先返回再静默刷新
function cacheGet(key, ttl) {
  try {
    const v = wx.getStorageSync(key)
    if (v && v.ts && Date.now() - v.ts < ttl) return v.data
  } catch (e) {}
  return null
}

function cacheSet(key, data) {
  try {
    wx.setStorageSync(key, { data, ts: Date.now() })
  } catch (e) {}
}

const SERVICE_CACHE_KEY = 'service_list_cache'
const SERVICE_CACHE_TTL = 30 * 60 * 1000 // 30 分钟

function withMock(apiCall, mockData) {
  if (request.USE_MOCK) {
    return Promise.resolve(typeof mockData === 'function' ? mockData() : mockData)
  }
  return apiCall().then((data) => {
    if (data !== null && data !== undefined) return data
    return typeof mockData === 'function' ? mockData() : mockData
  }).catch(() => (typeof mockData === 'function' ? mockData() : mockData))
}

function parseImages(images) {
  if (!images) return []
  if (Array.isArray(images)) {
    return images
      .map((item) => typeof item === 'string' ? item : (item.type === 'video' ? '' : item.url || item.path || ''))
      .filter(Boolean)
  }
  if (typeof images === 'string') {
    try { return parseImages(JSON.parse(images)) } catch (e) { return [] }
  }
  return []
}

function mapPost(r) {
  return {
    id: r.id,
    userId: r.userId || r.user_id,
    nickName: r.nickName || r.nick_name,
    avatarUrl: r.avatarUrl || r.avatar_url || '',
    title: r.title || '',
    gender: r.gender,
    category: r.category,
    content: r.content,
    images: parseImages(r.images),
    viewCount: r.viewCount || r.view_count || 0,
    likeCount: r.likeCount || r.like_count || 0,
    commentCount: r.commentCount || r.comment_count || 0,
    favoriteCount: r.favoriteCount || r.favorite_count || 0,
    shareCount: r.shareCount || r.share_count || 0,
    verified: !!(r.verified || r.isVerified || r.is_verified),
    followerCount: r.followerCount || r.follower_count || 0,
    postCount: r.postCount || r.post_count || 0,
    isFollowed: !!r.isFollowed,
    isHot: !!r.isHot,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    createdAt: r.createdAt || r.created_at
  }
}

function getFollowIds() {
  return wx.getStorageSync('follow_user_ids') || []
}

function setFollowIds(ids) {
  wx.setStorageSync('follow_user_ids', ids)
}

function applyMockFollowState(post) {
  const followIds = getFollowIds()
  return Object.assign({}, post, { isFollowed: followIds.indexOf(post.userId) > -1 || !!post.isFollowed })
}

function mapMockPost(post) {
  const mapped = mapPost(post)
  return applyMockFollowState(mapped)
}

function buildMockProfile(userId) {
  const uid = Number(userId)
  const profile = mock.users.find((item) => item.id === uid) || mock.users[0]
  const followIds = getFollowIds()
  const userPosts = mock.posts.filter((item) => item.userId === profile.id).map(mapMockPost)
  return Object.assign({}, profile, {
    postCount: userPosts.length,
    followingCount: profile.followingCount || 0,
    followerCount: (profile.followerCount || 0) + (followIds.indexOf(profile.id) > -1 ? 1 : 0),
    likeReceived: userPosts.reduce((sum, item) => sum + (item.likeCount || 0), 0),
    isFollowed: followIds.indexOf(profile.id) > -1,
    posts: userPosts
  })
}

function getPostList(params) {
  const page = params.page || 1
  const pageSize = params.pageSize || 10
  const category = params.category || ''
  return withMock(
    () => request.get('/post/list', { page, pageSize, category }, false).then((d) => {
      if (!d) return null
      return { list: (d.list || []).map(mapPost), total: d.total, hasMore: d.hasMore }
    }),
    () => {
      let list = mock.posts
      if (category && category !== '全部帖子') {
        list = mock.posts.filter((p) => p.category === category)
      }
      const start = (page - 1) * pageSize
      const slice = list.slice(start, start + pageSize)
      return { list: slice.map(mapMockPost), total: list.length, hasMore: start + pageSize < list.length }
    }
  )
}

function getPostDetail(id) {
  return withMock(
    () => request.get('/post/' + id, {}, false).then((d) => d ? mapPost(d) : null),
    () => mapMockPost(mock.posts.find((p) => p.id === Number(id)) || mock.posts[0])
  )
}

function getServiceList() {
  return withMock(
    () => request.get('/service/list', {}, false).then((d) => {
      const data = d || mock.allServiceSections
      cacheSet(SERVICE_CACHE_KEY, data)
      return data
    }),
    () => {
      const cached = cacheGet(SERVICE_CACHE_KEY, SERVICE_CACHE_TTL)
      return cached || mock.allServiceSections
    }
  )
}

function getErrandList(params) {
  return withMock(
    () => request.get('/errand/list', params, false).then((d) => d || { list: [], total: 0, hasMore: false }),
    () => {
      let list = mock.errandOrders
      if (params.type) list = list.filter((o) => o.type === params.type)
      if (params.campus) list = list.filter((o) => o.campus === params.campus)
      return { list, total: list.length, hasMore: false }
    }
  )
}

function getScheduleList() {
  return withMock(
    () => request.get('/schedule/list', {}, true).then((d) => (d || []).map((item, index) => scheduleUtils.normalizeCourse(item, index))),
    () => (wx.getStorageSync('schedule_courses') || []).map((item, index) => scheduleUtils.normalizeCourse(item, index))
  )
}

function syncSchedule(username, password) {
  return request.post('/schedule/sync', { username, password }, true)
}

function clearSchedule() {
  return request.post('/schedule/clear', {}, true)
}

function getScheduleConfig() {
  return withMock(
    () => request.get('/schedule/config', {}, true),
    () => {
      const app = getApp()
      return app.globalData.scheduleConfig
    }
  )
}

function getCommentList(postId) {
  return withMock(
    () => request.get('/comment/list', { postId, page: 1, pageSize: 50 }, false),
    () => ({
      list: wx.getStorageSync('comments_' + postId) || [
        { id: 1, nick_name: '校友', content: '同感+1', created_at: '2026-06-17T10:00:00' }
      ],
      total: 1,
      hasMore: false
    })
  )
}

function getUserProfile(userId) {
  return withMock(
    () => request.get('/user/profile/' + userId, {}, false),
    () => buildMockProfile(userId)
  )
}

function getUserPosts(userId) {
  return withMock(
    () => request.get('/user/profile/' + userId + '/posts', {}, false).then((d) => (d.list || []).map(mapPost)),
    () => buildMockProfile(userId).posts
  )
}

function followUser(userId) {
  return withMock(
    () => request.post('/user/follow/' + userId, {}, true),
    () => {
      const ids = getFollowIds()
      if (ids.indexOf(Number(userId)) === -1) ids.push(Number(userId))
      setFollowIds(ids)
      return { followed: true }
    }
  )
}

function unfollowUser(userId) {
  return withMock(
    () => request.del('/user/follow/' + userId, {}, true),
    () => {
      const ids = getFollowIds().filter((id) => id !== Number(userId))
      setFollowIds(ids)
      return { followed: false }
    }
  )
}

function favoritePost(postId) {
  return withMock(
    () => request.post('/post/' + postId + '/favorite', {}, true),
    () => ({ favorited: true })
  )
}

function getMyInteractionStats() {
  return withMock(
    () => request.get('/user/interactions/stats', {}, true),
    () => {
      const posts = mock.posts || []
      const comments = wx.getStorageSync('my_comment_records') || []
      return {
        liked: posts.filter((item) => item.isLiked).length || posts.filter((item) => (item.likeCount || 0) > 0).slice(0, 3).length,
        shared: wx.getStorageSync('my_share_records') ? (wx.getStorageSync('my_share_records') || []).length : posts.filter((item) => (item.shareCount || 0) > 0).slice(0, 2).length,
        commented: comments.length || posts.filter((item) => (item.commentCount || 0) > 0).slice(0, 4).length,
        favorited: posts.filter((item) => item.isFavorited).length || posts.filter((item) => (item.favoriteCount || 0) > 0).slice(0, 3).length,
        followed: (wx.getStorageSync('follow_user_ids') || []).length
      }
    }
  )
}

function getMyInteractionList(type) {
  return withMock(
    () => request.get('/user/interactions/' + type, { page: 1, pageSize: 50 }, true),
    () => {
      const posts = mock.posts || []
      const followIds = wx.getStorageSync('follow_user_ids') || []
      if (type === 'followed') {
        return {
          list: mock.users.filter((item) => followIds.indexOf(item.id) > -1),
          total: followIds.length
        }
      }
      const countMap = {
        liked: 'likeCount',
        shared: 'shareCount',
        commented: 'commentCount',
        favorited: 'favoriteCount'
      }
      const flagMap = {
        liked: 'isLiked',
        favorited: 'isFavorited'
      }
      const countKey = countMap[type]
      const flagKey = flagMap[type]
      const list = posts.filter((item) => {
        if (flagKey && item[flagKey]) return true
        return countKey ? (item[countKey] || 0) > 0 : false
      })
      return { list, total: list.length }
    }
  )
}

function createShare(postId, content, parentShareId) {
  return request.post('/share', { postId, content, parentShareId }, true)
}

function getShareList(postId) {
  return request.get('/share/' + postId, { page: 1, pageSize: 20 }, false)
}

module.exports = {
  withMock,
  mapPost,
  getPostList,
  getPostDetail,
  getServiceList,
  getErrandList,
  getScheduleList,
  syncSchedule,
  clearSchedule,
  getScheduleConfig,
  getCommentList,
  getUserProfile,
  getUserPosts,
  followUser,
  unfollowUser,
  favoritePost,
  getMyInteractionStats,
  getMyInteractionList,
  createShare,
  getShareList
}
