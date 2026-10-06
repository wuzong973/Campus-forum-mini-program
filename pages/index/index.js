const api = require('../../utils/api')
const bannerUtil = require('../../utils/banner')
const request = require('../../utils/request')
const format = require('../../utils/format')
const hotRank = require('../../utils/hot-rank')
// 卡片动效降级开关（低端机 / 用户在设置里关闭）：命中时挂 .fx-off
const motion = require('../../utils/motion')
const liquidTab = require('../../utils/liquid-tab')
const wechat = require('../../utils/wechat')
const messageStore = require('../../utils/messageStore')
const campusServices = require('../../utils/campus-services')
const versionUpdate = require('../../utils/version-update')
const { runPullDownRefresh } = require('../../utils/refresh')
const subscribe = require('../../utils/subscribe')
const scheduleUtils = require('../../utils/schedule')
const avatarUtil = require('../../utils/avatar')

// 评论媒体按扩展名区分图片/视频（与 pages/post-detail 同一口径）
const COMMENT_VIDEO_RE = /\.(mp4|m4v|mov|3gp|mkv|flv|avi|wmv|webm)(\?|#|$)/i
function isVideoUrl(url) {
  return COMMENT_VIDEO_RE.test(String(url || ''))
}

// 首页宫格里的校园服务（校车时刻 / 轻友指南 / 校园卡 / 速印 / 返乡大巴 / 特惠寄件）
// 统一进入通用服务详情页。名字 → id 的映射直接由数据源生成，避免两处手写不同步。
const CAMPUS_SERVICE_IDS = campusServices.SERVICES.reduce((map, item) => {
  map[item.name] = item.id
  return map
}, {})

const POSTS_CACHE_KEY = 'home_posts_cache'
const PENDING_POST_KEY = 'home_pending_post'
const POST_VIEW_SYNC_KEY = 'post_view_sync'
const POST_STATE_SYNC_KEY = 'post_state_sync'
// 其他页面（如全部服务页）要求首页切到指定分类时，通过该存储标记传递
const PENDING_CATEGORY_KEY = 'home_pending_category'
// ===== 顶部导航栏随滚动方向显隐的阈值 =====
// 单次滚动位移超过该值才判定方向，避免像素级抖动反复触发显隐
const NAV_DIRECTION_THRESHOLD = 6
// scrollTop 小于该值视为“已在顶部”，导航栏必定展开
const NAV_AT_TOP_OFFSET = 8
// 滚动距离不足该值时（刚离开顶部的一点点位移）不收起，避免轻轻一划就收掉
const NAV_HIDE_MIN_OFFSET = 30

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    banners: [],
    bannerCurrent: 0,
    bannerInterval: 4200,
    bannerDuration: 520,
    // 轮播按压：-1 = 未受力；tiltStyle 同时承载倾斜、缩小与光斑位置
    bannerPressedIndex: -1,
    bannerTiltStyle: 'transform: perspective(720px) rotateX(0deg) rotateY(0deg) scale(1); --spot-x: 50%; --spot-y: 50%;',
    // 滚动期间挂到 banner-stage 上，暂停描边自转与背光呼吸，把合成让给滚动
    bannerFxPaused: false,
    // 动效降级：低端机或用户在「设置 → 显示 → 卡片动效」关闭时为 true，挂 .fx-off
    fxOff: false,
    notice: '如果你在使用中遇到了问题，请尽快点击联系',
    noticeLinkText: '点此查看',
    noticeLinkUrl: '',
    noticeTailText: '更新中',
    noticeTailImage: '',
    noticeStyle: '',
    services: [],
    allServices: [],
    serviceIndicators: [0, 1, 2, 3, 4],
    serviceIndicatorCurrent: 0,
    categories: [],
    activeCategory: 0,
    // 液态指示条（utils/liquid-tab.js）；横滚由用户手动，不做自动滚入
    liquidStyle: '',
    liquidPhase: '',
    isHotCategory: false,
    hotPosts: [],
    hotRankGroups: [],
    hotLoading: false,
    // 「显示每日热榜」用户偏好：关闭时隐藏热榜预览卡、浮动按钮与「最热」分类内容
    dailyHotVisible: true,
    posts: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    skeleton: true,
    scrollTop: 0,
    scrollIntoView: '',
    isAtTop: true,
    // 顶部导航栏是否展开：向下滚动收起，向上滚动/回到顶部/刷新后必定展开
    navVisible: true,
    showFloatBtns: false,
    // 「置顶」浮动按钮：随滚动方向显隐（初始隐藏）
    showTopBtn: false,
    refreshing: false,
    scrollRefreshing: false,
    // 手指落在每日热榜区域内时为 true，用于临时禁用 scroll-view 下拉刷新
    hotAreaTouching: false,
    scheduleCourses: [],
    // 课表提醒
    reminderEnabled: false,
    todayCourses: [],
    scheduleWeekText: '',
    scheduleRemainText: '',
    scheduleEmpty: false,
    // 消息未读数（私信 + 评论/点赞/蹲贴/回复/系统通知，悬浮按钮徽章实时同步）
    unreadCount: 0,
    commentSheetVisible: false,
    commentSheetPost: null,
    commentSheetComments: [],
    // 评论弹层标题计数：commentSheetComments 已线程化（长度=根评论数），
    // 「评论 N」必须显示含回复的总条数，不能再用数组长度
    commentSheetTotal: 0,
    commentSheetText: '',
    commentSheetImages: [],
    commentSheetLoading: false,
    commentSheetHasMore: false,
    commentSheetEmojiVisible: false,
    commentSheetFocus: false,
    // 评论面板的键盘高度。面板是 position:fixed + bottom:0，且输入框为
    // adjust-position="{{false}}"（页面不自动上推），因此必须自己按键盘高度上移，
    // 否则用户点输入框时键盘会盖住输入区，看不到自己在打什么。
    commentSheetKeyboardHeight: 0,
    serviceLoading: false,
    serviceLoadFailed: false,
    commentSheetEmojis: [
      '😀', '', '😍', '🥰', '😎',
      '😭', '', '👏', '🙏', '🔥',
      '❤️', '🎉', '🥹', '😊', '😴',
      '💪', '✨', '📚', '🏃', '☕'
    ],
    updateDialogVisible: false,
    updateDialogUpdating: false,
    updateLatestVersion: '',
    updateLocalVersion: ''
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      reminderEnabled: !!(app.globalData.scheduleConfig || {}).reminder
    })
    this.maybeCheckVersionUpdate()
    this.loadStaticData()
    this.loadServices()
    // 轮播/公告配置由 onShow 统一拉取（首次进入 onShow 也会触发）
    this.loadPosts(true)
    // 液态分类指示条：分类在 loadStaticData 已同步渲染，nextTick 后测量落位（无动画）
    this.liquidTab = liquidTab.create(this, {
      track: '.category-list',
      items: '.category-item',
      indicator: '.liquid-indicator'
    })
    wx.nextTick(() => this.liquidTab.snap(this.data.activeCategory))
    // 订阅未读数变化：WebSocket 新消息 / 已读同步都会触发回调，实时刷新悬浮徽章
    this._unsubscribeUnread = messageStore.onMessage(() => {
      this.setData({ unreadCount: messageStore.getUnreadTotal() })
    })
  },

  // 管理后台「配置」维护的轮播图与公告；为空时沿用本地默认
  loadHomeConfig() {
    api.getHomeConfig().then((config) => {
      const patch = {}
      if (config.banners && config.banners.length) {
        this._customBanners = true
        patch.banners = config.banners.map((item, index) => ({
          id: 'custom-' + item.id,
          tag: item.tag || '',
          title: item.title || '',
          subtitle: item.subtitle || '',
          image: item.image,
          accent: item.accent || '#4A7AFF',
          link: item.link || '',
          order: index
        }))
      }
      if (config.notice && config.notice.text) {
        patch.notice = config.notice.text
        // 右侧蓝色链接：后台可配置显示文字与跳转页面路径；未配置路径时保留原管理员微信二维码入口
        patch.noticeLinkText = config.notice.linkText || '点此查看'
        patch.noticeLinkUrl = config.notice.linkUrl || ''
        patch.noticeTailText = config.notice.tailText || ''
        patch.noticeTailImage = config.notice.tailImage || ''
        // 管理员自定义公告颜色：背景直接生效，文字色经 --banner-fg 级联到文字与链接
        patch.noticeStyle = (config.notice.bgColor ? 'background:' + config.notice.bgColor + ';' : '') + (config.notice.textColor ? '--banner-fg:' + config.notice.textColor + ';' : '')
      }
      if (Object.keys(patch).length) this.setData(patch)
    }).catch(() => {})
  },

  onNoticeTailTap() {
    if (this.data.noticeTailImage) wx.previewImage({ urls: [this.data.noticeTailImage] })
  },

  // 公告右侧链接点击：后台配置了跳转路径则跳转对应页面（自动兼容 tab 页与普通页），
  // 未配置路径时回退为弹出管理员微信二维码
  onNoticeLinkTap() {
    const url = String(this.data.noticeLinkUrl || '').trim()
    if (!url) {
      const comp = this.selectComponent('#noticeAdmin')
      if (comp && comp.openQr) comp.openQr()
      return
    }
    const path = url.charAt(0) === '/' ? url : '/' + url
    wx.navigateTo({
      url: path,
      fail: () => {
        wx.switchTab({
          url: path,
          fail: () => wx.showToast({ title: '页面路径不存在，请检查公告配置', icon: 'none' })
        })
      }
    })
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(0)
    this.maybeCheckVersionUpdate()
    // 回到首页时同步一次未读数（其他页面已读后返回，徽章立即更新）
    messageStore.syncUnreadCount()
    this.setData({ unreadCount: messageStore.getUnreadTotal() })
    // 回到首页时导航栏必定展开（从详情页返回、切 tab 回来都算“重新出现”）
    if (!this.data.navVisible) this.setData({ navVisible: true })
    // onHide 挂过暂停，这里必须唤醒：恢复原本只由滚动触发，切回来不滚动就会一直停在暂停态
    if (this.data.bannerFxPaused) this.setData({ bannerFxPaused: false })
    // 动效降级每次回到首页都同步：设置页刚关掉要立即生效，低端机判定结果不会变但成本极低
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    // 每次回到首页刷新课表提醒开关状态和课表数据
    const app = getApp()
    const reminderEnabled = !!(app.globalData.scheduleConfig || {}).reminder
    if (reminderEnabled !== this.data.reminderEnabled) {
      this.setData({ reminderEnabled })
    }
    // 每次回到首页同步「显示每日热榜」用户偏好（设置页修改后切回立即生效）
    const dailyHotVisible = hotRank.isDailyHotVisible()
    if (dailyHotVisible !== this.data.dailyHotVisible) this.setData({ dailyHotVisible })
    // 重新拉取轮播/公告配置：管理员在后台改样式后，切回首页即可生效（首页 tab 常驻，onLoad 只走一次）
    this.loadHomeConfig()
    this.loadTodaySchedule()
    this.consumePendingPost()
    this.consumePostViewSync()
    this.consumePostStateSync()
    this.consumePendingCategory()
    this.loadHotPosts()
  },

  // 切走首页时兜底复位热榜触摸状态，防止 touchend 丢失后下拉刷新被永久禁用
  onHide() {
    this.onHotAreaTouchEnd()
    // 页面不可见时常驻动画没有观众：挂暂停并撤掉恢复计时器，回来时由下一次滚动唤醒
    if (this._bannerFxTimer) {
      clearTimeout(this._bannerFxTimer)
      this._bannerFxTimer = null
    }
    this.onBannerTouchEnd()
    if (!this.data.bannerFxPaused) this.setData({ bannerFxPaused: true })
  },

  maybeCheckVersionUpdate() {
    // 登录后回到首页时再检查一次，覆盖“启动时游客、进入首页前才登录”的情况。
    if (this._versionCheckStarted || !versionUpdate.isLoggedIn()) return
    this._versionCheckStarted = true
    versionUpdate.checkForUpdate((info) => this.onVersionUpdateAvailable(info))
  },

  onVersionUpdateAvailable(info) {
    this.setData({
      updateDialogVisible: true,
      updateDialogUpdating: false,
      updateLatestVersion: info.latestVersion || 'package',
      updateLocalVersion: info.localVersion || ''
    })
  },

  onVersionUpdateConfirm() {
    if (this.data.updateDialogUpdating) return
    this.setData({ updateDialogUpdating: true })
    versionUpdate.restart()
  },

  onVersionUpdateCancel() {
    versionUpdate.markVersionDismissed(this.data.updateLatestVersion)
    this.setData({ updateDialogVisible: false, updateDialogUpdating: false })
  },

  onReady() {
    // 首次测量可能早于字体渲染完成、宽度有微差，这里重测量校正
    if (this.liquidTab) this.liquidTab.refresh(this.data.activeCategory)
  },

  onUnload() {
    if (this.liquidTab) {
      this.liquidTab.destroy()
      this.liquidTab = null
    }
    if (this._unsubscribeUnread) {
      this._unsubscribeUnread()
      this._unsubscribeUnread = null
    }
    if (this._bannerFxTimer) {
      clearTimeout(this._bannerFxTimer)
      this._bannerFxTimer = null
    }
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

  // 从详情页返回时，就地同步该帖子的最新浏览量（列表与热榜）
  consumePostViewSync() {
    const sync = wx.getStorageSync(POST_VIEW_SYNC_KEY)
    if (!sync || !sync.id) return
    wx.removeStorageSync(POST_VIEW_SYNC_KEY)
    const i = this.data.posts.findIndex((item) => Number(item.id) === Number(sync.id))
    if (i > -1) {
      this.setData({ ['posts[' + i + '].viewCount']: Number(sync.viewCount) || 0 })
    }
    const j = this.data.hotPosts.findIndex((item) => Number(item.id) === Number(sync.id))
    if (j > -1) {
      this.setData({ ['hotPosts[' + j + '].viewCount']: Number(sync.viewCount) || 0 })
    }
  },

  // 从详情页返回时，就地同步该帖子的点赞/收藏状态与计数
  consumePostStateSync() {
    const sync = wx.getStorageSync(POST_STATE_SYNC_KEY)
    if (!sync || !sync.id) return
    wx.removeStorageSync(POST_STATE_SYNC_KEY)
    const apply = (listKey, list) => {
      const index = list.findIndex((item) => Number(item.id) === Number(sync.id))
      if (index === -1) return
      this.setData({
        [listKey + '[' + index + '].isLiked']: sync.isLiked,
        [listKey + '[' + index + '].likeCount']: sync.likeCount,
        [listKey + '[' + index + '].isFavorited']: sync.isFavorited,
        [listKey + '[' + index + '].favoriteCount']: sync.favoriteCount
      })
    }
    apply('posts', this.data.posts)
    apply('hotPosts', this.data.hotPosts)
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

    return api.getScheduleList({ silent: true }).then((courses) => {
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
    // 周次与课表页共用同一套口径（utils/schedule.computeAcademicWeek）。
    // 此前这里自己算：默认值还是**上一学期**的日期，且用 new Date(字符串) 按 UTC 解析。
    // 未配置起始日的用户会被算成「第 29 周」，今天的课程全部筛不出来 —— 首页恒显示「今天没课」，
    // 而课表页正常，两边对不上。起始日为周日时同样由 computeAcademicWeek 内部锚定到周一。
    const currentWeek = scheduleUtils.computeAcademicWeek(
      config.startDate,
      scheduleUtils.DEFAULT_TOTAL_WEEKS,
    ).currentWeek
    const now = new Date()
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
    return api.getServiceList().then((sections) => {
      const normalized = Array.isArray(sections) ? sections : []
      const allServices = normalized.reduce((items, section) => items.concat(section.items || []), [])
      const campusServices = (normalized.find((section) => section.title === '校园服务') || {}).items || allServices
      const uniqueServices = this.uniqueServices(allServices)
      this.setData({
        services: campusServices,
        allServices: this.buildHomeGrid(uniqueServices),
        serviceIndicatorCurrent: 0,
        serviceLoading: false,
        serviceLoadFailed: false
      })
      this.updateBanners()
    }).catch(() => {
      this.setData({ serviceLoading: false, serviceLoadFailed: true })
    })
  },

  // 首页功能栏：两行、按列填充（第 1 项→第一行第 1 列，第 2 项→第二行第 1 列……），
  // 共 12 列 × 2 行 = 24 个入口，与设计稿的完整宫格保持一致。
  //   第一行（沿用服务端教务/生活服务）：课程表 教务系统 成绩查询 考试安排 校历 校园地图
  //           自助购电 订水系统 校车时刻 乘车码 轻友指南 教务文档
  //   第二行（端上固定目录）：校园活动 广轻群聊 社团&组织 校园评价 找驾校
  //           校园市场 广轻义修 校园卡 速印 失物招领 返乡大巴 特惠寄件
  // 说明：校车时刻 / 轻友指南 / 校园卡 / 速印 / 返乡大巴 / 特惠寄件 六项统一进入
  //       pages/campus-service（通用服务详情页），内容由 utils/campus-services.js 提供，
  //       因此 24 个入口全部有真实落地页，不会再出现「服务暂未开放」的兜底提示。
  // 第二行仅 广轻义修 / 失物招领 保留服务端跳转配置，其余清空 link / miniAppId 由端上路由接管。
  buildHomeGrid(services) {
    const byName = {}
    ;(services || []).forEach((item) => {
      if (item && item.name && !byName[item.name]) byName[item.name] = item
    })
    const row1 = [
      '课程表', '教务系统', '成绩查询', '考试安排', '校历', '校园地图',
      '自助购电', '订水系统', '校车时刻', '乘车码', '轻友指南', '教务文档'
    ]
    const row2 = [
      { name: '校园活动', iconPath: '/assets/icons/svc-activity.png' },
      { name: '广轻群聊', iconPath: '/assets/icons/svc-group.png' },
      { name: '社团&组织', iconPath: '/assets/icons/svc-club.png' },
      { name: '校园评价', iconPath: '/assets/icons/svc-review.png' },
      { name: '找驾校', iconPath: '/assets/icons/svc-driving.png' },
      { name: '校园市场', uiIcon: 'market' },
      { name: '广轻义修' },
      { name: '校园卡' },
      { name: '速印', iconPath: '/assets/icons/svc-speed-print.png' },
      { name: '失物招领' },
      { name: '返乡大巴', iconPath: '/assets/icons/svc-bus-return.png' },
      { name: '特惠寄件', iconPath: '/assets/icons/svc-express.png' }
    ]
    const row2KeepJump = { '广轻义修': true, '失物招领': true }
    const grid = []
    const columnCount = Math.max(row1.length, row2.length)
    for (let index = 0; index < columnCount; index += 1) {
      const name = row1[index]
      if (name) {
        const serverTop = byName[name]
        grid.push(serverTop || {
          id: 'home-top-' + index,
          name,
          iconPath: api.SERVICE_ICON_MAP[name] || '',
          icon: '',
          badge: '',
          link: ''
        })
      }
      const def = row2[index]
      if (!def) continue
      const serverBottom = byName[def.name]
      let bottom
      if (serverBottom) {
        bottom = Object.assign({}, serverBottom)
        bottom.iconPath = bottom.iconPath || def.iconPath || ''
        // 内置统一图标：后端没配 iconPath 时才用它（后台配置优先级更高）
        bottom.uiIcon = bottom.iconPath ? '' : (def.uiIcon || '')
        if (!row2KeepJump[def.name]) {
          delete bottom.miniAppId
          bottom.link = ''
        }
      } else {
        bottom = {
          id: 'home-bottom-' + index,
          name: def.name,
          iconPath: def.iconPath || '',
          uiIcon: def.iconPath ? '' : (def.uiIcon || ''),
          icon: '',
          badge: '',
          link: ''
        }
      }
      grid.push(bottom)
    }
    return grid
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
    // 管理后台配置了轮播时以配置为准，不回退本地默认
    if (this._customBanners) return
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
    return api.getPostList({ page, pageSize: this.data.pageSize, category }).then((res) => {
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
  // 「回到置顶」浮动按钮显隐联动：
  //   滚动超过阈值(120px) → 显示，同时整个图标组向上顶起一个图标高度
  //   滚回顶部附近 → 隐藏，图标组回落
  // 「顶部导航栏」显隐联动：
  //   向下滚动 → 收起；向上滚动 / 回到顶部 → 展开（永远以“本次滚动方向”为准，
  //   保证无论此前停在什么位置，向上滚动都能把它拉回来）
  onContentScroll(e) {
    if (!e || !e.detail) return
    const scrollTop = e.detail.scrollTop || 0
    const now = Date.now()
    if (this._scrollTick && now - this._scrollTick < 80) return
    this._scrollTick = now
    // 放在 scrollTop 未变化的早退之前：滚动条在动就要让常驻动画停手，与位置是否变化无关
    this._pauseBannerFx()
    if (scrollTop === this._lastScrollTop) return
    const delta = scrollTop - (this._lastScrollTop || 0)
    this._lastScrollTop = scrollTop

    const isAtTop = scrollTop < NAV_AT_TOP_OFFSET
    const showFloatBtns = scrollTop > 80
    const showTopBtn = scrollTop > 120
    let navVisible = this.data.navVisible
    if (isAtTop || delta <= -NAV_DIRECTION_THRESHOLD) navVisible = true
    else if (delta >= NAV_DIRECTION_THRESHOLD && scrollTop > NAV_HIDE_MIN_OFFSET) navVisible = false

    const patch = {}
    let dirty = false
    if (isAtTop !== this.data.isAtTop) { patch.isAtTop = isAtTop; dirty = true }
    if (showFloatBtns !== this.data.showFloatBtns) { patch.showFloatBtns = showFloatBtns; dirty = true }
    if (showTopBtn !== this.data.showTopBtn) { patch.showTopBtn = showTopBtn; dirty = true }
    if (navVisible !== this.data.navVisible) { patch.navVisible = navVisible; dirty = true }
    if (dirty) this.setData(patch)
  },

  // Enhanced scroll-view can delay scroll events in developer tools, so show the control on the first swipe as well.
  onContentTouchMove() {
    if (!this.data.showFloatBtns) {
      this.setData({ isAtTop: false, showFloatBtns: true })
    }
  },

  onContentScrollToUpper() {
    this._lastScrollTop = 0
    this.setData({ isAtTop: true, navVisible: true, showFloatBtns: false, showTopBtn: false })
  },

  // 强制 scroll-view 回到顶部。
  // 背景：scroll-top 只在绑定值发生变化时才触发滚动，而 data.scrollTop 始终保持 0，
  // 与真实滚动位置脱节。复现：滑到底部 → 点进帖子 → 返回 → 点右下角"置顶"浮动按钮，
  // setData({scrollTop: 0}) 因值未变化而成为空操作，页面不会回顶。
  // 解法：绑定值已是 0 时先改成微小偏移量强制产生一次变更，再在回调里归零。
  // 回到顶部同时把导航栏展开（切换分类、点「置顶」等入口都会走到这里）
  scrollContentToTop(extra = {}) {
    this._lastScrollTop = 0
    const reset = () => this.setData(Object.assign({ scrollTop: 0, navVisible: true }, extra))
    if (this.data.scrollTop > 0) {
      reset()
    } else {
      this.setData({ scrollTop: 1 }, reset)
    }
  },

  onScrollToTop() {
    this.scrollContentToTop({ isAtTop: true, navVisible: true, showFloatBtns: false, showTopBtn: false })
  },

  // 搜索栏内刷新按钮只负责刷新，不随滚动切换成回到顶部
  onRefreshAction() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true, navVisible: true })
    const job = this.data.isHotCategory
      ? Promise.resolve(this.loadHotPosts())
      : Promise.all([this.fetchPosts(1, true, true), this.loadHotPosts()])
    Promise.resolve(job).then(() => {
      this.setData({ refreshing: false })
    }).catch(() => {
      this.setData({ refreshing: false })
      wx.showToast({ title: '刷新失败，请重试', icon: 'none' })
    })
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
    // 横滑切页会打断手势，touchend 不一定来；不回正就会把上一张的倾斜带进新的一张
    this._bannerRect = null
    this.setData({
      bannerCurrent: e.detail.current || 0,
      bannerPressedIndex: -1,
      bannerTiltStyle: this.buildTiltStyle(0, 0, 50, 50, 1)
    })
  },

  // ===== 轮播按压：朝触点方向轻微 3D 倾斜并缩小，背后光斑向触点聚拢，松手弹性复原 =====
  // 倾斜量按触点相对卡片中心的偏移算，所以点右上角和点左下角的 lean 方向不同；
  // 上限 ±6deg，再大就像卡片要翻过去，反而不像"被按下去"
  onBannerTouchStart(e) {
    const touch = (e.touches || [])[0]
    const index = Number(e.currentTarget.dataset.index)
    if (!touch || Number.isNaN(index)) return
    this._bannerMoveTick = 0
    this._bannerRect = null
    // 先落按压态，描边/流光/过渡时长立刻生效，不等异步量 rect
    this.setData({ bannerPressedIndex: index })
    wx.createSelectorQuery().in(this).select('#banner-' + index).boundingClientRect((rect) => {
      this._bannerRect = rect && rect.width && rect.height ? rect : null
      this.applyBannerTilt(touch.clientX, touch.clientY, 0.965)
    }).exec()
  },

  // 用 bind 而不是 catch：这条手势同时是 swiper 的横滑切页，catch 掉轮播就划不动了
  onBannerTouchMove(e) {
    if (this.data.bannerPressedIndex < 0) return
    const touch = (e.touches || [])[0]
    if (!touch) return
    const now = Date.now()
    // 节流到约 30fps：一次 setData 是逻辑层到视图层的一趟往返，
    // 逐 touchmove 事件下发的开销比动效本身还大
    if (this._bannerMoveTick && now - this._bannerMoveTick < 32) return
    this._bannerMoveTick = now
    this.applyBannerTilt(touch.clientX, touch.clientY, 0.965)
  },

  // rect 只在 touchstart 量一次并缓存：createSelectorQuery 异步且贵，
  // 放进 touchmove 逐帧查询会直接掉帧，而一次手势内卡片尺寸不会变
  applyBannerTilt(clientX, clientY, scale) {
    const rect = this._bannerRect
    let rx = 0.5
    let ry = 0.5
    if (rect && rect.width && rect.height) {
      rx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      ry = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    }
    this.setData({
      bannerTiltStyle: this.buildTiltStyle((0.5 - ry) * 12, (rx - 0.5) * 12, rx * 100, ry * 100, scale)
    })
  },

  onBannerTouchEnd() {
    if (this.data.bannerPressedIndex < 0) return
    this._bannerRect = null
    // 回弹也要给具体数值（不能清空 style），否则从 transform 过渡到 none 在部分机型上会跳一下
    this.setData({
      bannerPressedIndex: -1,
      bannerTiltStyle: this.buildTiltStyle(0, 0, 50, 50, 1)
    })
  },

  // 常驻动画让路给滚动：滚动中挂 fx-paused，停手 420ms 后恢复
  _pauseBannerFx() {
    if (!this.data.bannerFxPaused) this.setData({ bannerFxPaused: true })
    if (this._bannerFxTimer) clearTimeout(this._bannerFxTimer)
    this._bannerFxTimer = setTimeout(() => {
      this._bannerFxTimer = null
      if (this.data.bannerFxPaused) this.setData({ bannerFxPaused: false })
    }, 420)
  },

  buildTiltStyle(tiltX, tiltY, spotX, spotY, scale) {
    const fixed = (n) => (Math.round(n * 100) / 100)
    return 'transform: perspective(720px) rotateX(' + fixed(tiltX) + 'deg) rotateY(' + fixed(tiltY)
      + 'deg) scale(' + fixed(scale) + '); --spot-x: ' + fixed(spotX) + '%; --spot-y: ' + fixed(spotY) + '%;'
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
    // 教务考试安排：进入考试安排页
    if (item.name === '考试安排') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pkg-schedule/schedule-exam/index' })
      return
    }
    // 教务成绩查询：进入成绩查询页
    if (item.name === '成绩查询') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pkg-schedule/schedule-grade/index' })
      return
    }
    // 失物招领：切换到首页"失物寻物"分类
    if (item.name === '失物招领') {
      wx.vibrateShort({ type: 'light' })
      this.applyCategoryByName('失物寻物')
      return
    }
    // 二手闲置：切换到首页"二手闲置"分类
    if (item.name === '二手闲置') {
      wx.vibrateShort({ type: 'light' })
      this.applyCategoryByName('二手闲置')
      return
    }
    // 教务系统：进入原生教务首页（服务端抓取 + 原生渲染，不再用 web-view）
    if (item.name === '教务系统') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pkg-schedule/schedule-home/index' })
      return
    }
    // 校园评价：评价分类页（课程 / 食堂 / 商圈评分；统一访问控制同其他三项）
    if (item.name === '校园评价') {
      wx.vibrateShort({ type: 'light' })
      const auth = require('../../utils/auth')
      auth.requireFeatureAccess('校园评价', { autoBack: false }).then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/review/index' })
      })
      return
    }
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
    if (item.name === '广轻义修') {
      wx.navigateTo({ url: '/pages/repair/index' })
      return
    }
    if (item.name === '校园地图') {
      wx.navigateTo({ url: '/pages/campus-map/index' })
      return
    }
    // 校园活动：进入活动列表页面（统一访问控制：已登录且教务登录/骑手认证任一满足）
    if (item.name === '校园活动') {
      wx.vibrateShort({ type: 'light' })
      const auth = require('../../utils/auth')
      auth.requireFeatureAccess('校园活动', { autoBack: false }).then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/activity/index' })
      })
      return
    }
    // 广轻群聊：进入群聊分类页面
    if (item.name === '广轻群聊') {
      wx.vibrateShort({ type: 'light' })
      const auth = require('../../utils/auth')
      auth.requireFeatureAccess('广轻群聊', { autoBack: false }).then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/group-chat/index' })
      })
      return
    }
    // 社团&组织：进入社团组织页面（六大分类）
    if (item.name === '社团&组织') {
      wx.vibrateShort({ type: 'light' })
      const auth = require('../../utils/auth')
      auth.requireFeatureAccess('社团&组织', { autoBack: false }).then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/club/index' })
      })
      return
    }
    // 校园服务六项：统一进入通用服务详情页（作用说明 / 适用场景 / 关键信息 / 使用流程 / 常见问题）
    const campusServiceId = CAMPUS_SERVICE_IDS[item.name]
    if (campusServiceId) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pages/campus-service/index?id=' + campusServiceId })
      return
    }
    // 找驾校：端上静态内容页（学车流程 / 报名材料 / 班型参考 / 常见问题），无需登录
    if (item.name === '找驾校') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pages/driving-school/index' })
      return
    }
    // 校园市场：进入市场页（租赁服务 / 校园数码 / 校园家政 / DIY电脑 四个后台可编辑分类）
    if (item.name === '校园市场') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pages/market/index' })
      return
    }
    // 跳转到外部小程序（乘车码 / 零食店 等）
    if (item.miniAppId) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateToMiniProgram({
        appId: item.miniAppId,
        envVersion: 'release',
        fail(err) {
          wx.showModal({
            title: '跳转失败',
            content: '错误信息：' + (err && err.errMsg ? err.errMsg : JSON.stringify(err)),
            showCancel: false
          })
        }
      })
      return
    }
    // 订水系统：微信网页授权体系，且目标站不能稳定内嵌 → 复制链接 + 微信内打开引导
    if (item.name === '订水系统' && item.link && /^https?:\/\//i.test(item.link)) {
      wx.vibrateShort({ type: 'light' })
      wx.setClipboardData({
        data: item.link,
        success: () => {
          wx.showModal({
            title: '订水系统',
            content: '该服务需在微信内打开，链接已复制：① 将链接发送给任意微信聊天（推荐「文件传输助手」）；② 在聊天中点击该链接即可使用。',
            confirmText: '知道了',
            showCancel: false
          })
        }
      })
      return
    }
    // 自助购电：微信网页授权体系（oauth 仅微信内有效），且目标站只有 HTTP，
    // 小程序 web-view 无法完成授权回调 → 复制链接 + 两步引导（发到微信聊天后点开）
    if (item.name === '自助购电' && item.link && /^https?:\/\//i.test(item.link)) {
      wx.vibrateShort({ type: 'light' })
      wx.setClipboardData({
        data: item.link,
        success: () => {
          wx.showModal({
            title: '自助购电',
            content: '该服务需在微信内打开，链接已复制：① 将链接发送给任意微信聊天（推荐「文件传输助手」）；② 在聊天中点击该链接即可使用。',
            confirmText: '知道了',
            showCancel: false
          })
        }
      })
      return
    }
    // 跳转到外部 H5 页面（订水系统 / 自助购电 等）
    if (item.link) {
      if (!/^https?:\/\//i.test(item.link)) {
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
      '社区论坛': '/pages/index/index',
      // 教务文档暂无独立页面，先进入教务系统首页统一承载
      '教务文档': '/pkg-schedule/schedule-home/index',
      '校历': '/pkg-schedule/schedule-calendar/index'
    }
    const url = routes[item.name]
    if (url) {
      if (url.indexOf('index/index') > -1 || url.indexOf('schedule/index') > -1) {
        wx.switchTab({ url })
      } else {
        wx.navigateTo({ url })
      }
    } else {
      // 兜底分支：首页宫格内已不存在没有落地页的入口，这里只用于防御服务端临时
      // 新增的未知条目，避免出现空白响应。
      wx.showToast({ title: item.name + ' 服务暂未开放', icon: 'none' })
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

  // 浮动按钮：私信（进入消息页并定位到「私信」标签）
  goMessages() {
    const auth = require('../../utils/auth')
    if (!auth.requireLogin('查看私信需要先登录')) return
    // 新增触发点：点击首页右下角「消息」悬浮按钮时同步申请「私信通知」订阅授权。
    // 与聊天页「发送」按钮共用 message 触发组（只含 message 一个模板）。
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('message')
    wx.navigateTo({ url: '/pages/my-messages/index?tab=0' })
  },

  // 浮动按钮：信息推送群（树洞/二手/跑腿等微信群与墙墙微信的入口页）
  goPushGroups() {
    wx.navigateTo({ url: '/pages/push-groups/index' })
  },

  onCategoryTap(e) {
    const index = e.currentTarget.dataset.index
    if (index === this.data.activeCategory) return
    this.applyCategoryByIndex(index)
  },

  applyCategoryByIndex(index) {
    if (index < 0 || index >= this.data.categories.length) return
    const isHotCategory = this.data.categories[index] === '最热'
    this.setData({ activeCategory: index, page: 1, skeleton: !isHotCategory, isHotCategory })
    this.liquidTab.moveTo(index)
    // 切分类后回到顶部（scrollTop 绑定值原本一直是 0，直接 setData 0 不会触发滚动）
    this.scrollContentToTop()
    if (isHotCategory) this.loadHotPosts()
    else this.fetchPosts(1, true, false)
  },

  // 失物招领等功能入口：切到首页"失物寻物"分类并回到顶部
  applyCategoryByName(name) {
    const index = this.data.categories.indexOf(name)
    if (index < 0) {
      wx.showToast({ title: '「' + name + '」分类暂不可用', icon: 'none' })
      return
    }
    this.applyCategoryByIndex(index)
  },

  // 其他页面设置 PENDING_CATEGORY_KEY 后切回首页，onShow 自动切到目标分类
  consumePendingCategory() {
    const name = wx.getStorageSync(PENDING_CATEGORY_KEY)
    if (!name) return
    wx.removeStorageSync(PENDING_CATEGORY_KEY)
    this.applyCategoryByName(name)
  },

  loadHotPosts() {
    this.setData({ hotLoading: true })
    api.getHotPostRank().then((res) => {
      // 与帖子详情页共用 utils/hot-rank.js 的同一份构建逻辑
      // （buildHotPosts 内部已统一过滤「本地标记为已删除」的帖子）
      const hotPosts = hotRank.buildHotPosts(res.list || [])
      const hotRankGroups = hotRank.groupHotPosts(hotPosts)
      this.setData({ hotPosts, hotRankGroups, hotLoading: false, skeleton: false })
    }).catch(() => {
      // 拉取失败时不能原样保留旧列表：其中可能含刚被删除的帖子。
      // 至少剔除本地已确认删除的条目，避免「帖子已删、热榜还在」
      const kept = hotRank.filterRemovedPosts(this.data.hotPosts)
      this.setData({
        hotPosts: kept,
        hotRankGroups: hotRank.groupHotPosts(kept),
        hotLoading: false,
        skeleton: false
      })
    })
  },

  onTodayHotTap() {
    // 偏好关闭时热榜入口已隐藏，这里兜底防误触（如手势残留）
    if (!this.data.dailyHotVisible) return
    wx.navigateTo({ url: '/pages/hot-rank/index' })
  },

  // ===== 热榜区域手势隔离 =====
  // 手指按下点在热榜卡片内时，临时禁用 scroll-view 的下拉刷新，
  // 避免"想滑动热榜/页面却在顶部误触发下拉刷新"。抬手后立即恢复。
  // 说明：触摸序列始终派发给 touchstart 命中的节点，因此以"起点是否
  // 在热榜内"判定整个手势 —— 滑动中途跨出热榜不会中途放开刷新判定，
  // 起点在热榜外（含紧贴边缘外侧）则下拉刷新完全不受影响。
  onHotAreaTouchStart() {
    // 下拉刷新已在进行中时不干预，避免打断刷新动画导致 refresher 卡住
    if (this.data.scrollRefreshing) return
    if (!this._hotTouchActive) {
      this._hotTouchActive = true
      this.setData({ hotAreaTouching: true })
    }
  },

  onHotAreaTouchEnd() {
    if (this._hotTouchActive) {
      this._hotTouchActive = false
      this.setData({ hotAreaTouching: false })
    }
  },

  onHotPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/post-detail/index?id=' + id })
  },

  onPostLike(e) {
    const post = e.detail.post
    if (!post) return
    const index = this.data.posts.findIndex((item) => item.id === post.id)
    if (index === -1) return
    this.setData({
      ['posts[' + index + '].isLiked']: post.isLiked,
      ['posts[' + index + '].likeCount']: post.likeCount
    })
  },

  onPostFavorite(e) {
    const post = e.detail.post
    if (!post) return
    const index = this.data.posts.findIndex((item) => item.id === post.id)
    if (index === -1) return
    this.setData({
      ['posts[' + index + '].isFavorited']: post.isFavorited,
      ['posts[' + index + '].favoriteCount']: post.favoriteCount
    })
  },

  onPostReviewNote(e) {
    const { postId, reviewNote } = e.detail || {}
    if (!postId) return
    const index = this.data.posts.findIndex((item) => item.id === postId)
    if (index === -1) return
    this.setData({
      ['posts[' + index + '].reviewNote']: reviewNote
    })
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
    // 置顶后回到顶部，让用户看到被置顶的帖子（复用强制回顶，避免 scrollTop 绑定值不变导致滚动失效）
    this.setData({ posts })
    this.scrollContentToTop({ isAtTop: true, showFloatBtns: false, showTopBtn: false })
    wx.vibrateShort({ type: 'light' })
    wx.showToast({ title: '已置顶到一楼', icon: 'success' })
  },

  noop() {},

  mapCommentItem(c) {
    const media = api.parseImages(c.images)
    let anonymous = c.anonymousIdentity || c.anonymous_identity
    if (typeof anonymous === 'string') { try { anonymous = JSON.parse(anonymous) } catch (e) { anonymous = null } }
    const isAnonymous = !!(c.is_anonymous || c.isAnonymous || (anonymous && anonymous.nickName && anonymous.avatarUrl))
    const createdAt = c.created_at || c.createdAt
    const rawAvatar = isAnonymous ? anonymous.avatarUrl : (c.avatar_url || c.avatarUrl || '')
    return {
      id: c.id,
      userId: c.user_id || c.userId,
      nickName: isAnonymous ? anonymous.nickName : (c.nick_name || c.nickName || '校园用户'),
      avatarUrl: avatarUtil.normalizeLegacyAvatar(rawAvatar) || '',
      isAnonymous,
      // 有图/视频时去掉「[图片]/[视频]」占位文字，直接展示媒体本身
      content: media.length ? format.stripMediaPlaceholder(c.content) : (c.content || ''),
      images: media.filter((url) => !isVideoUrl(url)),
      videos: media.filter(isVideoUrl),
      parentNickName: c.parent_nick_name || c.parentNickName || '',
      parentId: Number(c.parent_id || c.parentId || 0),
      timeText: format.formatRelativeTime(createdAt) || '刚刚',
      createdAt,
      likeCount: Number(c.like_count || c.likeCount || 0),
      isLiked: !!(c.is_liked || c.isLiked)
    }
  },

  // 评论弹层线程化：与帖子详情页 buildCommentThreads 同一套层级/回复前缀/收起展开规则，
  // 保证首页弹层与详情页评论区的结构、缩进、排版完全一致
  buildSheetThreads(rawComments) {
    const post = this.data.commentSheetPost || {}
    const authorId = Number(post.userId || 0)
    const isAnonymousPost = !!post.isAnonymous
    const expandedIds = this._sheetExpandedIds || {}
    const byId = {}
    rawComments.forEach((comment) => {
      byId[comment.id] = Object.assign({}, comment, {
        isAuthor: !isAnonymousPost && !comment.isAnonymous && authorId > 0 && Number(comment.userId) === authorId
      })
    })
    // 回复前缀规则：仅「回复回复」（嵌套回复）显示「回复 xxx:」，直接回复根评论不显示
    Object.keys(byId).forEach((id) => {
      const comment = byId[id]
      const parent = comment.parentId ? byId[comment.parentId] : null
      comment.replyToNick = parent && parent.parentId ? parent.nickName : ''
    })
    const findRoot = (comment) => {
      let current = comment
      const visited = {}
      while (current.parentId && byId[current.parentId] && !visited[current.id]) {
        visited[current.id] = true
        current = byId[current.parentId]
      }
      return current
    }
    const threadsById = {}
    const roots = []
    Object.keys(byId).forEach((id) => {
      const comment = byId[id]
      const root = findRoot(comment)
      if (root.id === comment.id) {
        threadsById[comment.id] = Object.assign({}, comment, { replies: [] })
        roots.push(threadsById[comment.id])
      }
    })
    Object.keys(byId).forEach((id) => {
      const comment = byId[id]
      const root = findRoot(comment)
      if (root.id !== comment.id && threadsById[root.id]) threadsById[root.id].replies.push(comment)
    })
    return roots.map((thread) => {
      // 子评论按时间正序，新回复落在所属评论下方
      const replies = thread.replies.slice().sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0
        const timeB = new Date(b.createdAt || 0).getTime() || 0
        return timeA - timeB || Number(a.id || 0) - Number(b.id || 0)
      })
      const expanded = !!expandedIds[thread.id]
      return Object.assign({}, thread, {
        replies,
        recentReplies: replies.slice(0, 3),
        expanded,
        hasHiddenReplies: replies.length > 3,
        hiddenReplyCount: Math.max(0, replies.length - 3)
      })
    })
  },

  // 评论弹层唯一数据出口：raw 扁平列表进、线程化列表出（乐观追加/分页/点赞都走这里）
  setSheetComments(rawList) {
    this._sheetRawComments = rawList
    this.setData({ commentSheetComments: this.buildSheetThreads(rawList) })
  },

  toggleSheetCommentReplies(e) {
    const id = e.currentTarget.dataset.id
    const expandedIds = this._sheetExpandedIds || (this._sheetExpandedIds = {})
    expandedIds[id] = !expandedIds[id]
    this.setData({ commentSheetComments: this.buildSheetThreads(this._sheetRawComments || []) })
  },

  onSheetLikeComment(e) {
    const auth = require('../../utils/auth')
    if (!auth.requireLogin('点赞需要先登录')) return
    const commentId = e.currentTarget.dataset.id
    // transform 读当前状态取反：成功/回滚共用同一逻辑（与详情页 onLikeComment 一致）
    const toggle = (comment) => Object.assign({}, comment, {
      isLiked: !comment.isLiked,
      likeCount: Math.max(0, (comment.likeCount || 0) + (!comment.isLiked ? 1 : -1))
    })
    const raw = this._sheetRawComments || []
    const index = raw.findIndex((c) => String(c.id) === String(commentId))
    if (index < 0) return
    this.setSheetComments(raw.map((c, i) => (i === index ? toggle(c) : c)))
    api.likeComment(commentId).catch(() => {
      // 服务端失败：再次取反即回滚
      this.setSheetComments((this._sheetRawComments || []).map((c, i) => (i === index ? toggle(c) : c)))
    })
  },

  onCommentAvatarTap(e) {
    const userId = e.currentTarget.dataset.userid
    if (userId) wx.navigateTo({ url: '/pages/profile/index?id=' + userId })
  },

  onPostComment(e) {
    const post = e.detail.post
    if (!post || !post.id) return
    wx.vibrateShort({ type: 'light' })
    this._sheetRawComments = []
    this._sheetExpandedIds = {}
    this.setData({
      commentSheetVisible: true,
      commentSheetPost: post,
      commentSheetComments: [],
      commentSheetTotal: 0,
      commentSheetText: '',
      commentSheetImages: [],
      commentSheetEmojiVisible: false,
      // 点评论图标 = 看评论，因此**不抢焦点**。
      // 此前这里是 true，配合 WXML 的 focus="{{commentSheetFocus}}"，
      // 导致每次打开评论面板都立刻弹出键盘、挡住评论列表（用户只是想读评论）。
      // 需要发评论时用户点底部输入框即可，届时由 onSheetKeyboardChange 把面板顶上去。
      commentSheetFocus: false,
      commentSheetKeyboardHeight: 0
    })
    this.loadCommentSheet(post.id)
  },

  loadCommentSheet(postId) {
    this._sheetCommentPage = 1
    this.setData({ commentSheetLoading: true, commentSheetHasMore: false })
    api.getCommentList(postId).then((res) => {
      this.setSheetComments((res.list || []).map((item) => this.mapCommentItem(item)))
      this.setData({
        commentSheetTotal: Number(res.total) || (res.list || []).length,
        commentSheetLoading: false,
        commentSheetHasMore: !!res.hasMore
      })
    }).catch(() => {
      this.setData({ commentSheetLoading: false })
      wx.showToast({ title: '评论加载失败', icon: 'none' })
    })
  },

  // 评论弹层上滑加载下一页
  loadMoreSheetComments() {
    const post = this.data.commentSheetPost
    if (!post || !post.id || !this.data.commentSheetHasMore || this._sheetLoadingMore) return
    this._sheetLoadingMore = true
    api.getCommentList(post.id, 'hot', (this._sheetCommentPage || 1) + 1).then((res) => {
      this._sheetCommentPage = (this._sheetCommentPage || 1) + 1
      const list = (res.list || []).map((item) => this.mapCommentItem(item))
      this.setSheetComments((this._sheetRawComments || []).concat(list))
      this.setData({
        commentSheetHasMore: !!res.hasMore
      })
    }).catch(() => {}).then(() => { this._sheetLoadingMore = false })
  },

  closeCommentSheet() {
    this.setData({
      commentSheetVisible: false,
      commentSheetEmojiVisible: false,
      commentSheetFocus: false,
      commentSheetKeyboardHeight: 0,
      commentSheetText: '',
      commentSheetImages: []
    })
  },

  // 评论面板的键盘高度跟踪：面板固定 bottom:0，需按键盘高度上移，
  // 否则输入框会被键盘遮住（输入框是 adjust-position="{{false}}"）。
  // 与 components/post-card 的 onNoteKeyboardChange 同一套写法。
  onSheetKeyboardChange(e) {
    this.setData({ commentSheetKeyboardHeight: ((e && e.detail) || {}).height || 0 })
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

  async onSheetSendComment() {
    const auth = require('../../utils/auth')
    if (!auth.requireLogin('评论需要先登录')) return
    const post = this.data.commentSheetPost
    if (!post || !post.id) return
    const text = (this.data.commentSheetText || '').trim()
    let images = this.data.commentSheetImages.slice()
    if (!text && !images.length) return
    // 新增触发点：首页评论面板提交评论时同步申请「评论通知」订阅授权。
    // 与「发帖成功」「点帖子」「点评论区」共用 postPublish 触发组；
    // 放在校验之后、任何 await 之前，保证仍在 tap 同步链内。
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('postPublish')

    const postId = post.id
    const content = text || '[图片]'
    wx.showLoading({ title: '发送中...', mask: true })

    try {
      if (images.length) {
        const imageCount = images.length
        images = await wechat.uploadImages(images)
        if (images.length !== imageCount || images.some((url) => !/^https?:\/\//i.test(url))) throw new Error('图片上传失败')
      }

      const finish = (rawComment) => {
        const comment = this.mapCommentItem(rawComment)
        this.setSheetComments((this._sheetRawComments || []).concat([comment]))
        this.setData({
          commentSheetTotal: (this.data.commentSheetTotal || 0) + 1,
          commentSheetText: '',
          commentSheetImages: [],
          commentSheetEmojiVisible: false,
          commentSheetFocus: false
        })
        this.updatePostCommentCount(postId, 1)
        wx.showToast({ title: '评论成功', icon: 'success' })
      }

      const res = await request.post('/comment', { postId, content, parentId: 0, images }, true)
      finish(res && res.data ? res.data : {
        id: Date.now(),
        user_id: ((getApp().globalData || {}).userInfo || {}).id || 0,
        nick_name: ((getApp().globalData || {}).userInfo || {}).nickName || '我',
        avatar_url: ((getApp().globalData || {}).userInfo || {}).avatarUrl || '',
        content,
        images,
        created_at: new Date().toISOString()
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '评论失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onPostClose(e) {
    const postId = e.detail.postId
    this.setData({ posts: this.data.posts.filter((item) => item.id !== postId) })
  },

  onPostRemove(e) {
    const postId = e.detail.postId
    this.setData({ posts: this.data.posts.filter((item) => item.id !== postId) })
  },

  getHomeRefreshLoaders() {
    return [
      () => this.fetchPosts(1, true, true),
      () => this.loadHotPosts(),
      () => this.loadServices(),
      () => this.loadTodaySchedule()
    ]
  },

  onContentRefresh() {
    if (this.data.scrollRefreshing || this.__pullRefreshing) return
    // 下拉刷新后导航栏必须回到展开态（此前可能因向下滚动处于收起状态）
    this.setData({ scrollRefreshing: true, navVisible: true })
    runPullDownRefresh(this, this.getHomeRefreshLoaders()).finally(() => {
      this.setData({ scrollRefreshing: false })
    })
  },

  onPullDownRefresh() {
    this.setData({ navVisible: true })
    runPullDownRefresh(this, this.getHomeRefreshLoaders())
  },

  onReachBottom() {
    if (this.data.isHotCategory) return
    if (!this.data.hasMore || this.data.loading) return
    this.fetchPosts(this.data.page + 1, false, false)
  }
})
