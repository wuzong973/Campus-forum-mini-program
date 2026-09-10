const api = require('../../utils/api')

const TABS = [
  { key: 'all', name: '全部活动' },
  { key: 'signing', name: '报名中' },
  { key: 'mine', name: '我的参与' }
]
const BADGE_TEXT = {
  signing: '报名中',
  notStarted: '报名未开始',
  ended: '已结束'
}

function pad2(n) { return (n < 10 ? '0' : '') + n }

// 'YYYY-MM-DD HH:mm[:ss]' → 'MM/DD'
function shortDate(value) {
  if (!value) return ''
  const m = String(value).match(/^\d{4}-(\d{2})-(\d{2})/)
  return m ? m[1] + '/' + m[2] : ''
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'all',
    list: [],
    loaded: false,
    page: 1,
    hasMore: false,
    loading: false
  },

  onShow() {
    // 每次进入/返回都刷新（新发布/新报名即时可见）
    this.setData({ page: 1, list: [], loaded: false })
    this.loadList(1)
  },

  onPullDownRefresh() {
    this.loadList(1, () => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadList(this.data.page + 1)
  },

  chooseTab(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeTab) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ activeTab: key, page: 1, list: [], loaded: false })
    this.loadList(1)
  },

  loadList(page, done) {
    if (this.data.loading) return
    this.setData({ loading: true })
    api.getActivities(this.data.activeTab).then((res) => {
      const list = ((res && res.list) || []).map((item) => Object.assign({}, item, {
        badgeText: BADGE_TEXT[item.badge] || '',
        dateText: shortDate(item.activityStart) || shortDate(item.signupStart) || '待定',
        placeText: item.location || item.address || '待定',
        quotaText: item.remaining === null
          ? '名额不限'
          : (item.remaining > 0 ? '仅剩' + item.remaining + '个名额' : '名额已满')
      }))
      this.setData({
        list: (page || 1) <= 1 ? list : this.data.list.concat(list),
        page: page || 1,
        hasMore: !!(res && res.hasMore),
        loaded: true,
        loading: false
      })
      if (typeof done === 'function') done()
    }).catch(() => {
      this.setData({ loaded: true, loading: false })
      if (typeof done === 'function') done()
    })
  },

  onActivityTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/activity/detail?id=' + id })
  },

  onCreate() {
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/activity/publish' })
  }
})
