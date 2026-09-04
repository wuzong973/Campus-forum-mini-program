const api = require('../../utils/api')
const bannerUtil = require('../../utils/banner')
const request = require('../../utils/request')
const format = require('../../utils/format')

const POSTS_CACHE_KEY = 'home_posts_cache'
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
    serviceIndicators: [0, 1, 2, 3, 4],
    serviceIndicatorCurrent: 0,
    categories: [],
    activeCategory: 0,
    isHotCategory: false,
    hotPeriod: 'today',
    hotPosts: [],
    hotLoading: false,
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
    serviceLoading: false,
    serviceLoadFailed: false,
    commentSheetEmojis: [
      '😀', '', '😍', '🥰', '😎',
      '😭', '', '👏', '🙏', '🔥',
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
    this.loadServices()
    this.loadPosts(true)
    this.loadTodaySchedule()
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(0)
    // 每次回到首页刷新课表提醒开关状态和课表数据
    const app = getApp()
    const reminderEnabled = !!(app.globalData.scheduleConfig || {}).reminder
    if (reminderEnabled !== this.data.reminderEnabled) {
      this.setData({ reminderEnabled })
    }
    this.loadTodaySchedule()
    this.consumePendingPost()
    if (this.data.isHotCategory) this.loadHotPosts()
  },

  consumePendingPost() {
    const post = wx.getStorageSync(PENDING_POST_KEY)
    if (!post || !post.id) return
    wx.removeStorageSync(PENDING_POST_KEY)
    const exists = this.data.posts.some((item) => item.id === post.id)
    const normalizedPost = api.normalizePost(post)
    const posts = exists ? this.data.posts : [normalizedPost].concat(this.data.posts)
    this.setData({ posts, skeleton: false })
    this.updateBanners()
  },

  // 加载当天课程
  loadTodaySchedule() {
    const app = getApp()
    // 课程表属于个人数据。首页对游客保持可浏览，不能因后台课表请求
    // 返回 401 而跳转到登录页。
    if (!app.globalData.token) {
      this.setData({
        scheduleCourses: [],
        todayCourses: [],
        scheduleEmpty: true,
        scheduleRemainText: ''
      })
      this.updateBanners()
      return
    }

    api.getScheduleList({ silent: true }).then((courses) => {
      this.setData({ scheduleCourses: courses || [] })
      this.renderTodaySchedule(courses || [])
      this.updateBanners()
    }).catch(() => {
      // A stale login only hides personal schedule data on the public home page.
      this.setData({ scheduleCourses: [], todayCourses: [], scheduleEmpty: true })
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
    this.setData({
      services: [],
      allServices: [],
      serviceIndicatorCurrent: 0,
      categories: ['最新', '最热', '日常话题', '表白交友', '二手闲置', '失物寻物', '树洞吐槽', '组队拼车'],
      banners: bannerUtil.buildHomeBanners({ services: [] })
    })
  },

  loadServices() {
    this.setData({ serviceLoading: true, serviceLoadFailed: false })
    api.getServiceList().then((sections) => {
      const normalized = Array.isArray(sections) ? sections : []
      const allServices = normalized.reduce((items, section) => items.concat(section.items || []), [])
      const campusServices = (normalized.find((section) => section.title === '校园服务') || {}).items || allServices
      const uniqueServices = this.uniqueServices(allServices)
      this.setData({
        services: campusServices,
        allServices: uniqueServices,
        serviceIndicatorCurrent: 0,
        serviceLoading: false,
        serviceLoadFailed: false
      })
      this.updateBanners()
    }).catch(() => {
      this.setData({ serviceLoading: false, serviceLoadFailed: true })
    })
  },

  uniqueServices(services) {
    const unique = []
    const seen = {}
    ;(services || []).forEach((item) => {
      const key = String(item.id || item.name || unique.length)
      if (seen[key]) return
      seen[key] = true
      unique.push(item)
    })
    return unique
  },

  onServiceScroll(e) {
    const detail = e.detail || {}
    const scrollLeft = Number(detail.scrollLeft) || 0
    const scrollWidth = Number(detail.scrollWidth) || 0
    const clientWidth = Number(detail.clientWidth) || 0
    const indicatorCount = this.data.serviceIndicators.length

    // Scroll events expose the content and viewport widths in the mini-program
    // runtime. Fall back to the visible item width when running in older tools.
    const windowWidth = (wx.getSystemInfoSync().windowWidth || 375)
    const rpx = windowWidth / 750
    const columnCount = Math.ceil(this.data.allServices.length / 2)
    const stripWidth = (columnCount * 126 + Math.max(0, columnCount - 1) * 16 + 8) * rpx
    const viewportWidth = Math.max(0, windowWidth - 84 * rpx)
    const fallbackMaxScroll = Math.max(0, stripWidth - viewportWidth)
    const measuredMaxScroll = scrollWidth > clientWidth && clientWidth > 0
      ? scrollWidth - clientWidth
      : fallbackMaxScroll
    const maxScroll = Math.max(1, measuredMaxScroll)
    const current = Math.min(
      indicatorCount - 1,
      Math.round((scrollLeft / maxScroll) * (indicatorCount - 1))
    )

    if (current !== this.data.serviceIndicatorCurrent) {
      this.setData({ serviceIndicatorCurrent: current })
    }
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
    // Derived home data is never used as an authority. Clear old fixture/cache
    // data and render only the current response from the backend.
    if (reset) wx.removeStorageSync(POSTS_CACHE_KEY)
    this.fetchPosts(1, true, false)
  },

  fetchPosts(page, reset, silent) {
    const category = this.data.activeCategory > 0
      ? this.data.categories[this.data.activeCategory]
      : ''
    if (!silent) this.setData({ loading: true })
    api.getPostList({ page, pageSize: this.data.pageSize, category }).then((res) => {
      const normalizedList = (res.list || []).map((item) => api.normalizePost(item))
      const list = reset ? normalizedList : this.data.posts.concat(normalizedList)
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
    const isAtTop = scrollTop < 8
    const showFloatBtns = scrollTop > 80
    if (isAtTop !== this.data.isAtTop || showFloatBtns !== this.data.showFloatBtns) {
      this.setData({ isAtTop, showFloatBtns })
    }
  },

  // Enhanced scroll-view can delay scroll events in developer tools, so show the control on the first swipe as well.
  onContentTouchMove() {
    if (!this.data.showFloatBtns) {
      this.setData({ isAtTop: false, showFloatBtns: true })
    }
  },

  onContentScrollToUpper() {
    this._lastScrollTop = 0
    this.setData({ isAtTop: true, showFloatBtns: false })
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
    if (this.data.isHotCategory) this.loadHotPosts()
    else this.fetchPosts(1, true, true)
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
    // 代拿跑腿：跳转到内部跑腿页面
    if (item.name === '代拿跑腿') {
      wx.switchTab({ url: '/pages/errand/index' })
      return
    }
    // 图书馆：跳转至超星图书馆H5页面
    if (item.name === '图书馆') {
      wx.navigateTo({ url: '/pages/webview/index?url=' + encodeURIComponent('https://mobilelib.wx.chaoxing.com/weixin/hall/showNew9?pid=529&type=9') + '&title=图书馆' })
      return
    }
    if (item.name === '广轻维修') {
      wx.navigateTo({ url: '/pages/repair/index' })
      return
    }
    if (item.name === '校园地图') {
      wx.navigateTo({ url: '/pages/campus-map/index' })
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
      if (!/^https:\/\//i.test(item.link)) {
        wx.showToast({ title: '该服务链接暂不可用', icon: 'none' })
        return
      }
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
    const isHotCategory = this.data.categories[index] === '最热'
    this.setData({ activeCategory: index, page: 1, skeleton: !isHotCategory, isHotCategory })
    if (isHotCategory) this.loadHotPosts()
    else this.fetchPosts(1, true, false)
  },

  onHotPeriodTap(e) {
    const hotPeriod = e.currentTarget.dataset.period
    if (!hotPeriod || hotPeriod === this.data.hotPeriod) return
    this.setData({ hotPeriod })
    this.loadHotPosts()
  },

  loadHotPosts() {
    this.setData({ hotLoading: true })
    api.getHotPostRank(this.data.hotPeriod).then((res) => {
      const hotPosts = (res.list || []).map((post) => Object.assign({}, post, {
        rankTimeText: format.formatRelativeTime(post.createdAt) || '刚刚'
      }))
      this.setData({ hotPosts, hotLoading: false, skeleton: false })
    }).catch(() => this.setData({ hotLoading: false, skeleton: false }))
  },

  onHotPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/post-detail/index?id=' + id })
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

  onPostReviewNote(e) {
    const { postId, reviewNote } = e.detail || {}
    if (!postId) return
    const posts = this.data.posts.map((item) => item.id === postId
      ? Object.assign({}, item, { reviewNote })
      : item)
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
      timeText: c.timeText || format.formatDateTime(c.created_at || c.createdAt || new Date()),
      createdAt: c.created_at || c.createdAt,
      likeCount: c.like_count || c.likeCount || 0,
      isLiked: !!(c.is_liked || c.isLiked)
    }
  },

  onCommentAvatarTap(e) {
    const userId = e.currentTarget.dataset.userid
    if (userId) wx.navigateTo({ url: '/pages/profile/index?id=' + userId })
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
    if (this.data.isHotCategory) return
    if (!this.data.hasMore || this.data.loading) return
    this.fetchPosts(this.data.page + 1, false, false)
  }
})
