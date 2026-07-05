const api = require('../../utils/api')
const bannerUtil = require('../../utils/banner')
const request = require('../../utils/request')
const format = require('../../utils/format')

const POSTS_CACHE_KEY = 'home_posts_cache'
const POSTS_CACHE_TTL = 5 * 60 * 1000 // 5 分钟缓存
const PENDING_POST_KEY = 'home_pending_post'

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    banners: [],
    bannerCurrent: 0,
    bannerInterval: 4200,
    bannerDuration: 520,
    notice: '课表 AI 识别、社区私信链路和校园服务导航已完成新一轮优化升级',
    services: [],
    allServices: [],
    categories: [],
    activeCategory: 0,
    posts: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    skeleton: true,
    scrollTop: 0,
    isAtTop: true,
    showFloatBtns: false,
    scheduleCourses: [],
    // 课表提醒
    reminderEnabled: false,
    todayCourses: [],
    scheduleWeekText: '',
    scheduleRemainText: '',
    scheduleEmpty: false,
    commentSheetVisible: false,
    commentSheetPost: null,
    commentSheetComments: [],
    commentSheetText: '',
    commentSheetImages: [],
    commentSheetLoading: false,
    commentSheetEmojiVisible: false,
    commentSheetFocus: false,
    commentSheetEmojis: [
      '😀', '😂', '😍', '🥰', '😎',
      '😭', '👍', '👏', '🙏', '🔥',
      '❤️', '🎉', '🥹', '😊', '😴',
      '💪', '✨', '📚', '🏃', '☕'
    ]
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      reminderEnabled: !!(app.globalData.scheduleConfig || {}).reminder
    })
    this.loadStaticData()
    this.loadPosts(true)
    this.loadTodaySchedule()
  },

  onShow() {
    // 每次回到首页刷新课表提醒开关状态和课表数据
    const app = getApp()
    const reminderEnabled = !!(app.globalData.scheduleConfig || {}).reminder
    if (reminderEnabled !== this.data.reminderEnabled) {
      this.setData({ reminderEnabled })
    }
    this.loadTodaySchedule()
    this.consumePendingPost()
  },

  consumePendingPost() {
    const post = wx.getStorageSync(PENDING_POST_KEY)
    if (!post || !post.id) return
    wx.removeStorageSync(PENDING_POST_KEY)
    const exists = this.data.posts.some((item) => item.id === post.id)
    const posts = exists ? this.data.posts : [post].concat(this.data.posts)
    this.setData({ posts, skeleton: false })
    this.updateBanners()
  },

  // 加载当天课程
  loadTodaySchedule() {
    api.getScheduleList().then((courses) => {
      this.setData({ scheduleCourses: courses || [] })
      this.renderTodaySchedule(courses || [])
      this.updateBanners()
    })
  },

  renderTodaySchedule(courses) {
    const app = getApp()
    const config = app.globalData.scheduleConfig || {}
    const startDate = new Date(config.startDate || '2026-03-02')
    const now = new Date()
    const diffDays = Math.floor((now - startDate) / 86400000)
    const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1)
    const weekDay = now.getDay() === 0 ? 7 : now.getDay() // 周日=7
    const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const weekText = '第' + currentWeek + '周 ' + weekDayNames[now.getDay()]

    const matchWeekType = (course) => {
      if (!course.weekType || course.weekType === 'all') return true
      if (course.weekType === 'odd') return currentWeek % 2 === 1
      if (course.weekType === 'even') return currentWeek % 2 === 0
      return true
    }
    const matchWeek = (course) => {
      return (!course.startWeek || course.startWeek <= currentWeek) && (!course.endWeek || course.endWeek >= currentWeek)
    }
    const matchWeekDay = (course) => course.weekDay === weekDay

    // 过滤出今天的课程（优先按周数 + 星期；若导入课表和当前周次不一致，则用星期兜底）
    let todayCourses = courses.filter((c) => {
      const matchWeekDay = c.weekDay === weekDay
      return matchWeekDay && matchWeek(c) && matchWeekType(c)
    })
    if (!todayCourses.length) {
      todayCourses = courses.filter((c) => matchWeekDay(c) && matchWeekType(c))
    }

    // 按开始时间排序
    todayCourses.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))

    // 判断剩余课程（未结束的）
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const remainCourses = todayCourses.filter((c) => {
      if (!c.endTime) return true
      const [eh, em] = c.endTime.split(':').map(Number)
      return eh * 60 + em > nowMinutes
    })

    this.setData({
      todayCourses,
      scheduleWeekText: weekText,
      scheduleRemainText: '今日剩余' + remainCourses.length + '节课',
      scheduleEmpty: todayCourses.length === 0
    })
  },

  // 静态数据立即渲染，提升首屏速度
  loadStaticData() {
    const mock = require('../../utils/mock')
    // 合并所有服务为一维数组
    const allServices = mock.allServiceSections.reduce((acc, section) => {
      return acc.concat(section.items || [])
    }, [])
    this.setData({
      services: mock.homeServices,
      allServices,
      categories: mock.categories,
      banners: bannerUtil.buildHomeBanners({ services: mock.homeServices })
    })
  },

  updateBanners() {
    this.setData({
      banners: bannerUtil.buildHomeBanners({
        courses: this.data.scheduleCourses,
        posts: this.data.posts,
        services: this.data.services
      })
    })
  },

  // 优先读取本地缓存秒开，再后台静默刷新
  loadPosts(reset) {
    if (reset) {
      const cached = wx.getStorageSync(POSTS_CACHE_KEY)
      if (cached && cached.list && Date.now() - cached.ts < POSTS_CACHE_TTL) {
        this.setData({
          posts: cached.list,
          page: 1,
          hasMore: true,
          skeleton: false
        })
        this.updateBanners()
        // 静默刷新，不显示骨架屏
        this.fetchPosts(1, true, true)
        return
      }
    }
    this.fetchPosts(1, true, false)
  },

  fetchPosts(page, reset, silent) {
    const category = this.data.activeCategory > 0
      ? this.data.categories[this.data.activeCategory]
      : ''
    if (!silent) this.setData({ loading: true })
    api.getPostList({ page, pageSize: this.data.pageSize, category }).then((res) => {
      const list = reset ? res.list : this.data.posts.concat(res.list)
      this.setData({
        posts: list,
        page,
        hasMore: res.hasMore,
        loading: false,
        skeleton: false
      })
      this.updateBanners()
      // 首页数据写入本地缓存
      if (reset && category === '') {
        wx.setStorageSync(POSTS_CACHE_KEY, { list, ts: Date.now() })
      }
    }).catch(() => {
      this.setData({ loading: false, skeleton: false })
    })
  },

  // scroll-view 的 bindscroll 事件，节流降频降低 setData 次数
  onContentScroll(e) {
    if (!e || !e.detail) return
    const scrollTop = e.detail.scrollTop || 0
    const now = Date.now()
    if (this._scrollTick && now - this._scrollTick < 80) return
    this._scrollTick = now
    if (scrollTop === this._lastScrollTop) return
    this._lastScrollTop = scrollTop
    const isAtTop = scrollTop < 100
    const showFloatBtns = scrollTop > 400
    if (isAtTop !== this.data.isAtTop || showFloatBtns !== this.data.showFloatBtns) {
      this.setData({ isAtTop, showFloatBtns })
    }
  },

  onScrollToTop() {
    this._lastScrollTop = 0
    this.setData({ scrollTop: 0, isAtTop: true, showFloatBtns: false })
  },

  onSearchAction() {
    if (this.data.isAtTop) {
      this.onRefresh()
    } else {
      this.onScrollToTop()
    }
  },

  onRefresh() {
    this.fetchPosts(1, true, true)
    wx.showToast({ title: '已刷新', icon: 'success' })
  },

  onBannerTap(e) {
    const link = e.currentTarget.dataset.link || ''
    wx.vibrateShort({ type: 'light' })
    if (link.indexOf('/pages/post-detail/') === 0) {
      wx.navigateTo({ url: link })
    } else if (link.indexOf('errand') > -1) {
      wx.switchTab({ url: '/pages/errand/index' })
    } else if (link.indexOf('schedule') > -1) {
      wx.switchTab({ url: '/pages/schedule/index' })
    } else if (link.indexOf('index') > -1) {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  onBannerChange(e) {
    this.setData({ bannerCurrent: e.detail.current || 0 })
  },

  goServiceAll() {
    wx.navigateTo({ url: '/pages/service-all/index' })
  },

  goSchedule() {
    wx.switchTab({ url: '/pages/schedule/index' })
  },

  onServiceTap(e) {
    const item = (e.detail && e.detail.item) || (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.item)
    if (!item) return
    // 代拿跑腿：跳转到外部小程序「递至·校园代拿」
    if (item.name === '代拿跑腿') {
      this.openErrandMini()
      return
    }
    // 跳转到外部小程序（乘车码 / 食堂菜单 等）
    if (item.miniAppId) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateToMiniProgram({
        appId: item.miniAppId,
        envVersion: 'release',
        success() { console.log('[' + item.name + '] 跳转成功') },
        fail(err) {
          console.error('[' + item.name + '] 跳转失败', err)
          wx.showModal({
            title: '跳转失败',
            content: '错误信息：' + (err && err.errMsg ? err.errMsg : JSON.stringify(err)),
            showCancel: false
          })
        }
      })
      return
    }
    // 跳转到外部 H5 页面（订水系统 / 教务系统 等）
    if (item.link) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(item.link) + '&title=' + encodeURIComponent(item.name)
      })
      return
    }
    const routes = {
      '课程表': '/pages/schedule/index',
      '社区论坛': '/pages/index/index'
    }
    const url = routes[item.name]
    if (url) {
      if (url.indexOf('index/index') > -1 || url.indexOf('schedule') > -1) {
        wx.switchTab({ url })
      } else {
        wx.navigateTo({ url })
      }
    } else {
      wx.showToast({ title: item.name + ' 即将上线', icon: 'none' })
    }
  },

  // 跳转到「递至·校园代拿」小程序
  // 注意：wx.navigateToMiniProgram 必须提供目标小程序的 appId
  openErrandMini() {
    const ERRAND_APP_ID = 'wx4f4f74eaf4b7d100' // 「递至·校园代拿」小程序
    const ERRAND_PATH = ''  // 可选：目标小程序的落地页路径，留空进默认首页
    console.log('[代拿跑腿] 点击触发，准备跳转 appId=', ERRAND_APP_ID)
    wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '正在跳转...', mask: true })
    wx.navigateToMiniProgram({
      appId: ERRAND_APP_ID,
      path: ERRAND_PATH || undefined,
      envVersion: 'release',
      success() {
        console.log('[代拿跑腿] 跳转成功')
        wx.hideLoading()
      },
      fail(err) {
        console.error('[代拿跑腿] 跳转失败', err)
        wx.hideLoading()
        wx.showModal({
          title: '跳转失败',
          content: '错误信息：' + (err && err.errMsg ? err.errMsg : JSON.stringify(err)) + '\n\n可能原因：\n1. 目标小程序未发布上线\n2. 开发者工具需真机预览\n3. app.json 改动后需完整重新编译',
          showCancel: false
        })
      }
    })
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' })
  },

  goPublish() {
    const auth = require('../../utils/auth')
    if (!auth.requirePublishReady()) return
    wx.navigateTo({ url: '/pages/post-publish/index' })
  },

  onCategoryTap(e) {
    const index = e.currentTarget.dataset.index
    if (index === this.data.activeCategory) return
    this.setData({ activeCategory: index, page: 1, skeleton: true })
    this.fetchPosts(1, true, false)
  },

  onPostLike(e) {
    const post = e.detail.post
    if (!post) return
    const posts = this.data.posts.map((item) => item.id === post.id ? Object.assign({}, item, {
      isLiked: post.isLiked,
      likeCount: post.likeCount
    }) : item)
    this.setData({ posts })
  },

  onPostFavorite(e) {
    const post = e.detail.post
    if (!post) return
    const posts = this.data.posts.map((item) => item.id === post.id ? Object.assign({}, item, {
      isFavorited: post.isFavorited,
      favoriteCount: post.favoriteCount
    }) : item)
    this.setData({ posts })
  },

  onPostPin(e) {
    const postId = e.detail.postId
    if (!postId) return
    const posts = this.data.posts.slice()
    const index = posts.findIndex((item) => item.id === postId)
    if (index < 0) return
    if (index === 0) {
      wx.showToast({ title: '已经在一楼', icon: 'none' })
      return
    }
    const pinned = Object.assign({}, posts[index], { isPinnedLocal: true })
    posts.splice(index, 1)
    posts.unshift(pinned)
    this.setData({ posts, scrollTop: 0, isAtTop: true })
    wx.setStorageSync(POSTS_CACHE_KEY, { list: posts, ts: Date.now() })
    wx.vibrateShort({ type: 'light' })
    wx.showToast({ title: '已置顶到一楼', icon: 'success' })
  },

  noop() {},

  mapCommentItem(c) {
    return {
      id: c.id,
      userId: c.user_id || c.userId,
      nickName: c.nick_name || c.nickName || '校园用户',
      avatarUrl: c.avatar_url || c.avatarUrl || '',
      content: c.content || '',
      images: c.images || [],
      parentNickName: c.parent_nick_name || c.parentNickName || '',
      timeText: c.timeText || format.formatRelativeTime(c.created_at || c.createdAt || new Date()),
      createdAt: c.created_at || c.createdAt,
      likeCount: c.like_count || c.likeCount || 0,
      isLiked: !!(c.is_liked || c.isLiked)
    }
  },

  onPostComment(e) {
    const post = e.detail.post
    if (!post || !post.id) return
    wx.vibrateShort({ type: 'light' })
    this.setData({
      commentSheetVisible: true,
      commentSheetPost: post,
      commentSheetComments: [],
      commentSheetText: '',
      commentSheetImages: [],
      commentSheetEmojiVisible: false,
      commentSheetFocus: true
    })
    this.loadCommentSheet(post.id)
  },

  loadCommentSheet(postId) {
    this.setData({ commentSheetLoading: true })
    api.getCommentList(postId).then((res) => {
      const list = (res.list || []).map((item) => this.mapCommentItem(item))
      this.setData({
        commentSheetComments: list,
        commentSheetLoading: false
      })
    }).catch(() => {
      this.setData({ commentSheetLoading: false })
      wx.showToast({ title: '评论加载失败', icon: 'none' })
    })
  },

  closeCommentSheet() {
    this.setData({
      commentSheetVisible: false,
      commentSheetEmojiVisible: false,
      commentSheetFocus: false,
      commentSheetText: '',
      commentSheetImages: []
    })
  },

  onSheetCommentInput(e) {
    this.setData({ commentSheetText: e.detail.value })
  },

  toggleSheetEmojiPanel() {
    this.setData({
      commentSheetEmojiVisible: !this.data.commentSheetEmojiVisible,
      commentSheetFocus: false
    })
  },

  onSheetEmojiTap(e) {
    const emoji = e.currentTarget.dataset.emoji || ''
    this.setData({ commentSheetText: this.data.commentSheetText + emoji })
  },

  onSheetChooseImage() {
    wx.chooseMedia({
      count: Math.max(1, 3 - this.data.commentSheetImages.length),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map((item) => item.tempFilePath)
        this.setData({
          commentSheetImages: this.data.commentSheetImages.concat(files).slice(0, 3),
          commentSheetEmojiVisible: false
        })
      }
    })
  },

  onSheetRemoveImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.commentSheetImages.slice()
    images.splice(index, 1)
    this.setData({ commentSheetImages: images })
  },

  updatePostCommentCount(postId, delta) {
    let updatedPost = null
    const posts = this.data.posts.map((item) => {
      if (item.id !== postId) return item
      updatedPost = Object.assign({}, item, {
        commentCount: Math.max(0, (item.commentCount || 0) + delta)
      })
      return updatedPost
    })
    const patch = { posts }
    if (updatedPost && this.data.commentSheetPost && this.data.commentSheetPost.id === postId) {
      patch.commentSheetPost = updatedPost
    }
    this.setData(patch)
    wx.setStorageSync(POSTS_CACHE_KEY, { list: posts, ts: Date.now() })
  },

  onSheetSendComment() {
    const auth = require('../../utils/auth')
    if (!auth.requireLogin('评论需要先登录')) return
    const post = this.data.commentSheetPost
    if (!post || !post.id) return
    const text = (this.data.commentSheetText || '').trim()
    const images = this.data.commentSheetImages.slice()
    if (!text && !images.length) return

    const postId = post.id
    const content = text || '[图片]'
    wx.showLoading({ title: '发送中...', mask: true })

    const finish = (rawComment) => {
      const comment = this.mapCommentItem(rawComment)
      this.setData({
        commentSheetComments: this.data.commentSheetComments.concat([comment]),
        commentSheetText: '',
        commentSheetImages: [],
        commentSheetEmojiVisible: false,
        commentSheetFocus: false
      })
      this.updatePostCommentCount(postId, 1)
      wx.hideLoading()
      wx.showToast({ title: '评论成功', icon: 'success' })
    }

    if (request.USE_MOCK) {
      const user = (getApp().globalData || {}).userInfo || {}
      const rawComment = {
        id: Date.now(),
        user_id: user.id || 0,
        nick_name: user.nickName || '我',
        avatar_url: user.avatarUrl || '',
        content,
        images,
        created_at: new Date().toISOString(),
        like_count: 0
      }
      const key = 'comments_' + postId
      const stored = wx.getStorageSync(key) || []
      stored.push(rawComment)
      wx.setStorageSync(key, stored)
      finish(rawComment)
      return
    }

    request.post('/comment', { postId, content, parentId: 0, images }, true).then((res) => {
      finish(res && res.data ? res.data : {
        id: Date.now(),
        user_id: ((getApp().globalData || {}).userInfo || {}).id || 0,
        nick_name: ((getApp().globalData || {}).userInfo || {}).nickName || '我',
        avatar_url: ((getApp().globalData || {}).userInfo || {}).avatarUrl || '',
        content,
        images,
        created_at: new Date().toISOString()
      })
    }).catch((err) => {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '评论失败', icon: 'none' })
    })
  },

  onPostClose(e) {
    const postId = e.detail.postId
    this.setData({ posts: this.data.posts.filter((item) => item.id !== postId) })
  },

  onPullDownRefresh() {
    this.fetchPosts(1, true, true)
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.fetchPosts(this.data.page + 1, false, false)
  }
})
