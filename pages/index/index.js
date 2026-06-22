const api = require('../../utils/api')

const POSTS_CACHE_KEY = 'home_posts_cache'
const POSTS_CACHE_TTL = 5 * 60 * 1000 // 5 分钟缓存

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    banners: [],
    notice: '课程表智能识别功能，校园地图，社区聊天，常见小',
    services: [],
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
    showFloatBtns: false
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.loadStaticData()
    this.loadPosts(true)
  },

  // 静态数据立即渲染，提升首屏速度
  loadStaticData() {
    const mock = require('../../utils/mock')
    this.setData({
      banners: mock.banners,
      services: mock.homeServices,
      categories: mock.categories
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
    if (link.indexOf('errand') > -1) {
      wx.switchTab({ url: '/pages/errand/index' })
    } else if (link.indexOf('schedule') > -1) {
      wx.switchTab({ url: '/pages/schedule/index' })
    }
  },

  goServiceAll() {
    wx.navigateTo({ url: '/pages/service-all/index' })
  },

  onServiceTap(e) {
    const item = e.detail.item
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
    if (!auth.requireLogin('发帖需要先登录')) return
    wx.navigateTo({ url: '/pages/post-publish/index' })
  },

  onCategoryTap(e) {
    const index = e.currentTarget.dataset.index
    if (index === this.data.activeCategory) return
    this.setData({ activeCategory: index, page: 1, skeleton: true })
    this.fetchPosts(1, true, false)
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
