const api = require('../../utils/api')
const campusServices = require('../../utils/campus-services')
const { runPullDownRefresh } = require('../../utils/refresh')

// 校园服务六项共用一个页面，靠 id 区分内容；名字 → id 由数据源生成，避免两处手写不同步
const CAMPUS_SERVICE_IDS = campusServices.SERVICES.reduce((map, item) => {
  map[item.name] = item.id
  return map
}, {})

// 端上路由表：服务名 → 页面路径。没有落地目标的服务属于占位内容，
// 一律不在「全部服务」里展示（审核规范要求小程序内不得出现「即将上线」式空页面）。
const SERVICE_ROUTES = {
  // 教务 / 学习
  '考试安排': '/pkg-schedule/schedule-exam/index',
  '成绩查询': '/pkg-schedule/schedule-grade/index',
  '教务系统': '/pkg-schedule/schedule-home/index',
  '校历': '/pkg-schedule/schedule-calendar/index',
  '教务文档': '/pkg-schedule/schedule-home/index',
  // 校园生活
  '代拿跑腿': '/pages/errand/index',
  '课程表': '/pages/schedule/index',
  '社区论坛': '/pages/index/index',
  '广轻义修': '/pages/repair/index',
  '校园地图': '/pages/campus-map/index',
  '找驾校': '/pages/driving-school/index',
  // 校园服务六项统一走通用详情页（页面内按 id 区分内容，这里只登记入口）
  '校车时刻': '/pages/campus-service/index',
  '轻友指南': '/pages/campus-service/index',
  '校园卡': '/pages/campus-service/index',
  '速印': '/pages/campus-service/index',
  '返乡大巴': '/pages/campus-service/index',
  '特惠寄件': '/pages/campus-service/index',
  '社团&组织': '/pages/club/index',
  '广轻群聊': '/pages/group-chat/index',
  '校园活动': '/pages/activity/index',
  '校园评价': '/pages/review/index'
}

// 统一访问控制：需已登录且教务登录 / 骑手认证任一满足
const FEATURE_GUARDS = {
  '/pages/club/index': '社团&组织',
  '/pages/group-chat/index': '广轻群聊',
  '/pages/activity/index': '校园活动',
  '/pages/review/index': '校园评价'
}

// 需要 switchTab 的 tabBar 页面
const TAB_ROUTES = {
  '/pages/errand/index': true,
  '/pages/schedule/index': true,
  '/pages/index/index': true
}

// 映射到首页分类的入口（站内已有真实帖子内容）
const CATEGORY_ROUTES = {
  '失物招领': '失物寻物',
  '二手闲置': '二手闲置',
  '校园市场': '二手闲置'
}

// 图书馆：超星 H5（微信内可正常打开）
const LIBRARY_URL = 'https://mobilelib.wx.chaoxing.com/weixin/hall/showNew9?pid=529&type=9'

// 服务是否有可用的落地目标：外部小程序 / H5 链接 / 端上路由 / 分类映射任一命中即可
function isServiceAvailable(item) {
  if (!item) return false
  if (item.miniAppId) return true
  if (item.link && /^https?:\/\//i.test(item.link)) return true
  if (item.name === '图书馆') return true
  return !!(SERVICE_ROUTES[item.name] || CATEGORY_ROUTES[item.name])
}

Page({
  data: { sections: [], loading: true, loadError: false },

  onLoad() {
    this.loadServices()
  },

  loadServices() {
    this.setData({ loading: true, loadError: false })
    return api.getServiceList().then((data) => {
      const sections = (Array.isArray(data) ? data : [])
        .map((section) => Object.assign({}, section, {
          items: (section.items || []).filter(isServiceAvailable)
        }))
        .filter((section) => section.items.length)
      this.setData({ sections, loading: false })
    }).catch(() => {
      this.setData({ sections: [], loading: false, loadError: true })
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadServices())
  },

  onServiceTap(e) {
    const item = e.detail.item
    if (!item) return

    // 订水系统：微信网页授权体系，且目标站不能稳定内嵌
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

    // 自助购电：微信网页授权体系，且目标站只有 HTTP，不能稳定内嵌
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

    // 跳转到外部 H5 页面（订水系统 等）
    if (item.link && /^https?:\/\//i.test(item.link)) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(item.link) + '&title=' + encodeURIComponent(item.name)
      })
      return
    }

    // 失物招领 / 二手闲置 / 校园市场：切回首页并定位到对应分类
    const category = CATEGORY_ROUTES[item.name]
    if (category) {
      wx.vibrateShort({ type: 'light' })
      wx.setStorageSync('home_pending_category', category)
      wx.switchTab({ url: '/pages/index/index' })
      return
    }

    // 图书馆：固定超星 H5
    if (item.name === '图书馆') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(LIBRARY_URL) + '&title=' + encodeURIComponent(item.name)
      })
      return
    }

    // 校园服务六项：同一个页面按 id 渲染不同内容
    const campusServiceId = CAMPUS_SERVICE_IDS[item.name]
    if (campusServiceId) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pages/campus-service/index?id=' + campusServiceId })
      return
    }

    const url = SERVICE_ROUTES[item.name]
    if (!url) return

    wx.vibrateShort({ type: 'light' })

    // 统一访问控制：四个校园功能（社团/群聊/活动/评价）需已登录且教务登录/骑手认证任一满足
    const guardName = FEATURE_GUARDS[url]
    if (guardName) {
      const auth = require('../../utils/auth')
      auth.requireFeatureAccess(guardName, { autoBack: false }).then((ok) => {
        if (ok) wx.navigateTo({ url })
      })
      return
    }

    if (TAB_ROUTES[url]) wx.switchTab({ url })
    else wx.navigateTo({ url })
  }
})
