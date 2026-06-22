const request = require('./request')
const mock = require('./mock')

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
  if (Array.isArray(images)) return images
  if (typeof images === 'string') {
    try { return JSON.parse(images) } catch (e) { return [] }
  }
  return []
}

function mapPost(r) {
  return {
    id: r.id,
    userId: r.userId || r.user_id,
    nickName: r.nickName || r.nick_name,
    avatarUrl: r.avatarUrl || r.avatar_url || '',
    gender: r.gender,
    category: r.category,
    content: r.content,
    images: parseImages(r.images),
    viewCount: r.viewCount || r.view_count || 0,
    likeCount: r.likeCount || r.like_count || 0,
    commentCount: r.commentCount || r.comment_count || 0,
    favoriteCount: r.favoriteCount || r.favorite_count || 0,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    createdAt: r.createdAt || r.created_at
  }
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
      return { list: slice, total: list.length, hasMore: start + pageSize < list.length }
    }
  )
}

function getPostDetail(id) {
  return withMock(
    () => request.get('/post/' + id, {}, false).then((d) => d ? mapPost(d) : null),
    () => mapPost(mock.posts.find((p) => p.id === Number(id)) || mock.posts[0])
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
    () => request.get('/schedule/list', {}, true).then((d) => d || []),
    () => wx.getStorageSync('schedule_courses') || []
  )
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

module.exports = {
  withMock, mapPost, getPostList, getPostDetail, getServiceList,
  getErrandList, getScheduleList, getScheduleConfig, getCommentList
}
