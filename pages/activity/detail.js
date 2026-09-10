const api = require('../../utils/api')
const auth = require('../../utils/auth')

const BADGE_TEXT = {
  signing: '报名中',
  notStarted: '报名未开始',
  ended: '已结束'
}

function pad2(n) { return (n < 10 ? '0' : '') + n }

// 'YYYY-MM-DD HH:mm[:ss]' → 'MM-DD HH:mm'
function fmtTime(value) {
  if (!value) return '待定'
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return String(value)
  return m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]
}

Page({
  data: {
    loading: true,
    activity: null,
    signupStartText: '',
    signupEndText: '',
    activityStartText: '',
    activityEndText: '',
    quotaText: '',
    signupDisabled: false,
    signupBtnText: '',
    signing: false
  },

  onLoad(options) {
    this.activityId = Number((options && options.id) || 0)
    this.loadDetail()
  },

  loadDetail() {
    if (!this.activityId) return this.failBack()
    api.getActivityDetail(this.activityId).then((res) => {
      const activity = (res && res.activity) || null
      if (!activity) return this.failBack()
      const quotaText = activity.remaining === null
        ? '名额不限 · 已报 ' + activity.signupCount + ' 人'
        : (activity.remaining > 0 ? '仅剩 ' + activity.remaining + ' 个名额' : '名额已满')
      let signupDisabled = true
      let signupBtnText = activity.signupTitle || '立即报名'
      if (activity.joined) {
        signupBtnText = '已报名'
      } else if (activity.badge === 'ended') {
        signupBtnText = '报名已结束'
      } else if (activity.badge === 'notStarted') {
        signupBtnText = '报名未开始'
      } else if (activity.remaining !== null && activity.remaining <= 0) {
        signupBtnText = '名额已满'
      } else {
        signupDisabled = false
      }
      this.setData({
        loading: false,
        activity,
        signupStartText: fmtTime(activity.signupStart),
        signupEndText: fmtTime(activity.signupEnd),
        activityStartText: fmtTime(activity.activityStart),
        activityEndText: fmtTime(activity.activityEnd),
        quotaText,
        signupDisabled,
        signupBtnText,
        badgeText: BADGE_TEXT[activity.badge] || ''
      })
    }).catch(() => this.failBack())
  },

  failBack() {
    wx.showToast({ title: '活动不存在或已下架', icon: 'none' })
    setTimeout(() => wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/activity/index' })
    }), 900)
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/activity/index' })
    })
  },

  onPreviewCover() {
    const url = this.data.activity && this.data.activity.coverUrl
    if (url) wx.previewImage({ urls: [url] })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const images = this.data.activity.images || []
    wx.previewImage({ urls: images.length ? images : [url], current: url })
  },

  onPreviewSignupImage() {
    const url = this.data.activity && this.data.activity.signupImage
    if (url) wx.previewImage({ urls: [url] })
  },

  // 报名
  onSignup() {
    if (this.data.signing || this.data.signupDisabled) return
    if (!auth.isLoggedIn()) {
      auth.requireLogin('报名需要先登录')
      return
    }
    const activity = this.data.activity || {}
    this.setData({ signing: true })
    api.signupActivity(activity.id).then((res) => {
      wx.showToast({ title: '报名成功', icon: 'success' })
      if (activity.signupContent) {
        setTimeout(() => wx.showModal({
          title: activity.signupTitle || '报名成功',
          content: activity.signupContent,
          showCancel: false,
          confirmText: '知道了'
        }), 600)
      }
      this.setData({ signing: false })
      this.loadDetail()
    }).catch((err) => {
      this.setData({ signing: false })
      wx.showToast({ title: (err && err.message) || '报名失败，请重试', icon: 'none' })
    })
  }
})
