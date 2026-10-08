const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const subscribe = require('../../../utils/subscribe')

const BADGE_TEXT = {
  signing: '报名中',
  notStarted: '报名未开始',
  ended: '已结束'
}

const AUDIT_TIP = {
  pending: '活动正在审核中，审核通过后其他同学才能看到',
  approved: '活动已审核通过',
  rejected: '活动未通过审核，请修改后重新发布'
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
    signupImages: [],
    initiator: null,
    initiatorChar: '友',
    auditTip: '',
    auditNote: '',
    signupDisabled: false,
    signupBtnText: '',
    signing: false,
    // 顶部「订阅活动结果提醒」入口：订阅生效（偏好开 + 微信侧已授权）后隐藏，
    // 在设置页关闭「活动结果通知」后重新出现（见 refreshActivitySignupSubscribeEntry）
    showActivitySignupSubscribeEntry: false,
    activitySignupSubscribeChecked: false
  },

  onLoad(options) {
    this.activityId = Number((options && options.id) || 0)
    this.loadDetail()
  },

  onShow() {
    this.refreshActivitySignupSubscribeEntry()
  },

  // ===== 顶部「订阅活动结果提醒」入口 =====
  // 与原「报名」按钮走同一个 activitySignup 触发组（activitySignupResult + activityStart +
  // activitySignup），逻辑复用 utils/subscribe.js 的统一封装，原有逻辑一概不动。
  // 显隐口径 entryVisible('activitySignup')：偏好已开且微信侧已授权才隐藏，
  // 因此在设置页关闭「活动结果通知」后入口会自动重新出现。
  refreshActivitySignupSubscribeEntry() {
    // 本地判定为「需要引导」时直接显示（不发额外请求）；
    // 本地认为「已订阅」时再复核一次服务端额度 —— 额度是「点一次允许发一条」，
    // 高频场景（评论/私信）极易用尽；用尽后必须让入口重新出现，否则用户无从重新订阅。
    if (typeof subscribe.entryVisibleAsync === 'function') {
      subscribe.entryVisibleAsync('activitySignup')
        .then((need) => this.setData({ showActivitySignupSubscribeEntry: !!need, activitySignupSubscribeChecked: false }))
        .catch(() => {})
      return
    }
    const visible = typeof subscribe.entryVisible === 'function' ? subscribe.entryVisible('activitySignup') : false
    this.setData({ showActivitySignupSubscribeEntry: !!visible, activitySignupSubscribeChecked: false })
  },
  // 点击整行（左半区）与拨动开关走同一条路径
  onActivitySignupSubscribeTap(e) {
    // 开关被拨到「关」时不申请授权，只回正视觉状态（入口在订阅生效后本就会整体隐藏）
    if (e && e.detail && e.detail.value === false) { this.setData({ activitySignupSubscribeChecked: false }); return }
    this.setData({ activitySignupSubscribeChecked: true })
    if (typeof subscribe.requestEntryByTap !== 'function') { this.refreshActivitySignupSubscribeEntry(); return }
    // 必须在 tap 同步链内进入原生 API；requestEntryByTap = requestTriggerByTap + 允许后写偏好
    subscribe.requestEntryByTap('activitySignup')
      .then(() => this.refreshActivitySignupSubscribeEntry())
      .catch(() => this.refreshActivitySignupSubscribeEntry())
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
        signupImages: (activity.signupImages && activity.signupImages.length)
          ? activity.signupImages
          : (activity.signupImage ? [activity.signupImage] : []),
        signupStartText: fmtTime(activity.signupStart),
        signupEndText: fmtTime(activity.signupEnd),
        activityStartText: fmtTime(activity.activityStart),
        activityEndText: fmtTime(activity.activityEnd),
        quotaText,
        signupDisabled,
        signupBtnText,
        badgeText: BADGE_TEXT[activity.badge] || '',
        auditTip: activity.isOwner ? (AUDIT_TIP[activity.auditStatus] || '') : '',
        auditNote: (activity.isOwner && activity.auditStatus === 'rejected' && activity.auditNote) ? activity.auditNote : ''
      })
    }).catch(() => this.failBack())
  },

  failBack() {
    wx.showToast({ title: '活动不存在或已下架', icon: 'none' })
    setTimeout(() => wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/activity/index' })
    }), 900)
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/activity/index' })
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

  onPreviewSignupImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const images = this.data.signupImages.length ? this.data.signupImages : [url]
    wx.previewImage({ urls: images, current: url })
  },

  // 报名
  onSignup() {
    if (this.data.signing || this.data.signupDisabled) return
    if (!auth.isLoggedIn()) {
      auth.requireLogin('报名需要先登录')
      return
    }
    const activity = this.data.activity || {}
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('activitySignup')
    this.setData({ signing: true })
    api.signupActivity(activity.id).then(() => {
      this.setData({ signing: false })
      this.loadDetail()
      this.finishSignup()
    }).catch((err) => {
      this.setData({ signing: false })
      wx.showToast({ title: (err && err.message) || '报名失败，请重试', icon: 'none' })
    })
  },

  // 报名按钮点击（onSignup）是活动订阅授权的真实用户手势入口

  finishSignup() {
    const activity = this.data.activity || {}
    wx.showToast({ title: '报名成功', icon: 'success' })
    if (activity.signupContent) {
      setTimeout(() => wx.showModal({
        title: activity.signupTitle || '报名成功',
        content: activity.signupContent,
        showCancel: false,
        confirmText: '知道了'
      }), 600)
    }
  }
})