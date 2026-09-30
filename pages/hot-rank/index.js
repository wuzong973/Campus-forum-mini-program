const api = require('../../utils/api')
const { isDailyHotVisible, filterRemovedPosts } = require('../../utils/hot-rank')
// 卡片动效降级开关（低端机 / 设置页关闭），样式见 styles/card-fx.wxss
const motion = require('../../utils/motion')

const PERIODS = [
  { key: 'today', label: '今日热帖' },
  { key: 'week', label: '本周热帖' },
  { key: 'month', label: '本月热帖' },
  { key: 'halfyear', label: '半年热帖' },
  { key: 'year', label: '本年热帖' },
  { key: 'history', label: '历史热帖' }
]

Page({
  data: {
    statusBarHeight: 20,
    periods: PERIODS,
    periodIndex: 0,
    currentLabel: PERIODS[0].label,
    menuVisible: false,
    posts: [],
    loading: true,
    // 顶部海报动效降级：true 时卡片挂 fx-off，只停自转、静态描边保留
    fxOff: false
  },

  onLoad() {
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadPosts()
    // 标记「本页首次加载已发过请求」，避免紧随其后的 onShow 再重复拉一次
    this._loadedOnce = true
  },

  onShow() {
    // 动效降级每次回到本页都同步：设置页刚关掉要立即生效，低端机判定结果不会变但成本极低（照首页写法）。
    // 放在最前面：下面「每日热榜已关闭」的分支会直接 return，不能让它跳过同步。
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    // 用户关闭「显示每日热榜」偏好时，深链/分享进入本页直接退出
    if (!isDailyHotVisible()) {
      wx.showToast({ title: '每日热榜已在设置中关闭', icon: 'none' })
      setTimeout(() => wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/index/index' })
      }), 900)
      return
    }
    // 本页会留在导航栈里（点进帖子详情再返回时 onShow 触发、onLoad 不会重跑）。
    // 若不在 onShow 重拉，作者/管理员在别处删除的帖子会一直留在榜单上。
    if (this._loadedOnce) this.loadPosts()
  },

  onPullDownRefresh() {
    this.loadPosts().then(() => wx.stopPullDownRefresh())
  },

  loadPosts() {
    const period = this.data.periods[this.data.periodIndex]
    this.setData({ loading: true })
    return api.getHotPostRank(period.key, 15).then((res) => {
      // 兜底过滤：即便服务端已不再返回该帖，本页也可能因请求失败/时序问题拿到旧列表
      this.setData({ posts: filterRemovedPosts((res && res.list) || []), loading: false })
    }).catch(() => this.setData({ posts: [], loading: false }))
  },

  toggleMenu() {
    this.setData({ menuVisible: !this.data.menuVisible })
  },

  closeMenu() {
    this.setData({ menuVisible: false })
  },

  onPeriodTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.periodIndex) {
      this.setData({ menuVisible: false })
      return
    }
    this.setData({
      periodIndex: index,
      currentLabel: this.data.periods[index].label,
      menuVisible: false,
      posts: []
    })
    this.loadPosts()
  },

  onCancelMenu() {
    this.setData({ menuVisible: false })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  }
})
