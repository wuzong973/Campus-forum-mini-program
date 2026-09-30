const SETTINGS_KEY = 'system_settings'
// 评论提醒偏好与发布页弹窗共用同一份存储，两处开关状态天然同步
const COMMENT_PREFS_KEY = 'subscribe_comment_prefs'
// 其余通知渠道的子开关偏好
const CHANNEL_PREFS_KEY = 'notify_channel_prefs'
// 「显示每日热榜」为按用户维度偏好，读写走 utils/hot-rank（键内按用户 id 隔离）
const hotRank = require('../../utils/hot-rank')
// 卡片动效开关：读写走 utils/motion（低端机会强制关闭，不受此开关影响）
const motion = require('../../utils/motion')
const request = require('../../utils/request')
// 订阅授权：开启开关时同步发起 wx.requestSubscribeMessage（用户点击事件内，合规）
const subscribe = require('../../utils/subscribe')

const DEFAULT_SETTINGS = {
  postAnonymous: false,
  commentPublic: false,
  anonymousMessage: false,
  hideProfilePosts: false
}

// 各渠道子开关默认全关（需求：默认关闭，由用户手动开启；用户开启后持久化，刷新/重进保持）
const DEFAULT_CHANNEL_PREFS = {
  commentNew: false,
  commentReply: false,
  message: false,
  audit: false,
  // 审核结果渠道子开关（活动审核通知单独作为父开关展示）
  auditCert: false,
  auditPass: false,
  // 活动审核子开关与活动发布页弹窗共用 notify_channel_prefs
  activityAudit: false,
  errandAccepted: false,
  errandFinished: false,
  errandCancelled: false,
  activitySignup: false,
  activityStart: false,
  // 活动报名结果通知与活动详情页报名弹窗共用 notify_channel_prefs
  activitySignupResult: false,
  // 活动订阅三键与校园活动页弹窗共用 notify_channel_prefs
  activityNew: false,
  activityJoined: false,
  activitySignupNotice: false,
  // 提现渠道两个子开关与钱包页提现弹窗共用 notify_channel_prefs
  withdrawSuccess: false,
  withdrawResult: false
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    settings: DEFAULT_SETTINGS,
    groups: [
      {
        title: '发布',
        items: [
          { key: 'postAnonymous', icon: '/assets/icons/avatar.png', name: '发帖默认开启分身' },
          { key: 'commentPublic', icon: '/assets/icons/comment.png', name: '评论默认不开启分身' },
          { key: 'anonymousMessage', icon: '/assets/icons/message.png', name: '默认允许分身私信' }
        ]
      },
      {
        title: '隐私',
        items: [
          { key: 'hideProfilePosts', icon: '/assets/icons/privacy.png', name: '隐藏主页帖子' }
        ]
      }
    ],
    // 「显示」独立成数组而不是 groups 的一项：它要渲染在通知区块之后，
    // 而 groups 数组整体渲染在通知之前
    displayItems: [
      { key: 'cardFx', icon: '/assets/icons/star.png', name: '卡片动效' }
    ],
    notifyItems: [
      { key: 'dailyHot', icon: '/assets/icons/heart.png', name: '显示每日热榜' }
    ],
    // 通知渠道：主开关 + 可展开子开关。open 是纯 UI 状态（展开/收起不重置选择，不持久化）；
    // on 由「是否存在任一开启的子开关」推导：任一子开=父开，全部子关=父开关联动关闭；开父=全子开，关父=全部子关。
    notifyChannels: [
      {
        key: 'comment', icon: '/assets/icons/comment.png', name: '评论通知', open: false, on: false,
        subs: [
          { key: 'commentNew', name: '新的评论提醒' },
          { key: 'commentReply', name: '评论回复通知' }
        ]
      },
      {
        key: 'message', icon: '/assets/icons/message.png', name: '私信通知', open: false, on: false,
        subs: [
          { key: 'message', name: '聊天信息提醒' }
        ]
      },
      {
        key: 'audit', icon: '/assets/icons/notice.png', name: '审核结果通知', open: false, on: false,
        subs: [
          { key: 'auditCert', name: '认证审核通知' },
          { key: 'audit', name: '审核结果通知' },
          { key: 'auditPass', name: '审核通过' }
        ]
      },
      {
        key: 'activityAudit', icon: '/assets/icons/notice.png', name: '活动审核通知', open: false, on: false,
        subs: [{ key: 'activityAudit', name: '活动审核结果' }]
      },
      {
        key: 'errand', icon: '/assets/icons/rider.png', name: '代拿/跑腿通知', open: false, on: false,
        subs: [
          { key: 'errandAccepted', name: '订单接单通知' },
          { key: 'errandFinished', name: '订单完成通知' },
          { key: 'errandCancelled', name: '订单取消通知' }
        ]
      },
      {
        key: 'activity', icon: '/assets/icons/star.png', name: '活动结果通知', open: false, on: false,
        subs: [
          { key: 'activitySignupResult', name: '活动报名结果通知' },
          { key: 'activityStart', name: '活动开始提醒' },
          { key: 'activitySignup', name: '报名成功通知' }
        ]
      },
      {
        key: 'activitySub', icon: '/assets/icons/star.png', name: '活动订阅', open: false, on: false,
        subs: [
          { key: 'activityNew', name: '新活动提醒' },
          { key: 'activityJoined', name: '活动参与成功提醒' },
          { key: 'activitySignupNotice', name: '活动报名通知' }
        ]
      },
      {
        key: 'withdraw', icon: '/assets/icons/order.png', name: '提现结果通知', open: false, on: false,
        subs: [
          { key: 'withdrawSuccess', name: '提现成功通知' },
          { key: 'withdrawResult', name: '提现结果通知' }
        ]
      }
    ],
    channelPrefs: Object.assign({}, DEFAULT_CHANNEL_PREFS),
    // 每日热榜：按用户维度的偏好（默认开启，各用户独立）
    dailyHotVisible: true,
    // 卡片动效：独立存储，不经 system_settings（低端机另有强制关闭，见 utils/motion）
    cardFxEnabled: true,
    // 开关显示的是「用户偏好」，低端机强制关闭时偏好仍是 true，
    // 不提示就会让用户以为动效开着
    fxAutoOff: false
  },

  onLoad() {
    const app = getApp()
    // 评论子开关读发布页共用的存储，其余读渠道偏好存储；缺失的键回落「默认开启」
    const commentPrefs = wx.getStorageSync(COMMENT_PREFS_KEY) || {}
    const channelPrefs = Object.assign({}, DEFAULT_CHANNEL_PREFS, wx.getStorageSync(CHANNEL_PREFS_KEY) || {})
    // 评论键缺失（用户从未选择）回落默认关闭，与全站「默认关闭、手动开启」语义一致
    channelPrefs.commentNew = commentPrefs.commentNew === undefined ? false : !!commentPrefs.commentNew
    channelPrefs.commentReply = commentPrefs.commentReply === undefined ? false : !!commentPrefs.commentReply
    const notifyChannels = this.data.notifyChannels.map((channel) => Object.assign({}, channel, {
      // 父开关显示语义：任一子开关开启即视为开启（全部关闭才自动关闭）
      on: channel.subs.some((sub) => !!channelPrefs[sub.key])
    }))
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      settings: Object.assign({}, DEFAULT_SETTINGS, wx.getStorageSync(SETTINGS_KEY) || {}),
      notifyChannels,
      channelPrefs,
      dailyHotVisible: hotRank.isDailyHotVisible(),
      cardFxEnabled: motion.isCardFxPreferred(),
      // 实际关着、但用户偏好是开的 ⇒ 只可能是低端机强制关闭触发的。
      // 这里刻意不调 isLowEndDevice()：它是 utils/motion 的导出之一，
      // 而多个用 vm 桩加载本页面的测试只实现了 isCardFxOff / isCardFxPreferred，
      // 新增一个调用就会让那批桩集体抛「未预期依赖」。
      fxAutoOff: motion.isCardFxOff() && motion.isCardFxPreferred()
    })
    // 「隐藏主页帖子」以服务端为准：跨设备一致，且访客侧过滤由服务端值驱动
    request.get('/user/info', {}, true, { silent: true }).then((info) => {
      if (!info || info.hideProfilePosts === undefined) return
      const settings = Object.assign({}, this.data.settings, { hideProfilePosts: !!info.hideProfilePosts })
      wx.setStorageSync(SETTINGS_KEY, settings)
      this.setData({ settings })
    }).catch(() => {})
  },

  onShow() {
  },

  goBack() { wx.navigateBack() },

  onSettingChange(e) {
    const key = e.currentTarget.dataset.key
    const value = !!e.detail.value
    // 每日热榜是按用户维度的偏好，独立存储（不经 system_settings）
    if (key === 'dailyHot') {
      hotRank.setDailyHotVisible(value)
      this.setData({ dailyHotVisible: value })
      return
    }
    // 卡片动效同样按用户维度独立存储；页面靠 data.fxOff 决定是否挂 .fx-off
    if (key === 'cardFx') {
      motion.setCardFxPreferred(value)
      this.setData({ cardFxEnabled: value, fxAutoOff: motion.isCardFxOff() && value })
      return
    }
    const previous = this.data.settings
    const settings = Object.assign({}, this.data.settings, { [key]: value })
    wx.setStorageSync(SETTINGS_KEY, settings)
    this.setData({ settings })
    // 「隐藏主页帖子」必须落到服务端才会对其他用户生效（访客主页帖子列表由服务端过滤）
    if (key === 'hideProfilePosts') {
      request.put('/user/info', { hideProfilePosts: value ? 1 : 0 }, true, { silent: true }).catch(() => {
        wx.setStorageSync(SETTINGS_KEY, previous)
        this.setData({ settings: previous })
        wx.showToast({ title: '设置失败，请重试', icon: 'none' })
      })
    }
  },

  // ===== 通知渠道：展开/收起 + 主开关 + 子开关 =====
  indexOfChannel(key) {
    return this.data.notifyChannels.findIndex((channel) => channel.key === key)
  },

  // 展开箭头：只切换可见性，不改动任何开关状态（再次展开保留之前的选择）
  onToggleChannelOpen(e) {
    const index = this.indexOfChannel(e.currentTarget.dataset.key)
    if (index < 0) return
    this.setData({ ['notifyChannels[' + index + '].open']: !this.data.notifyChannels[index].open })
  },

  // 主开关：开启=全部子项同步开启；关闭=全部子项同步关闭（部分开启时父开关保持开启）。
  onChannelMainChange(e) {
    const index = this.indexOfChannel(e.currentTarget.dataset.key)
    if (index < 0) return
    const on = !!e.detail.value
    const channel = this.data.notifyChannels[index]
    const channelPrefs = Object.assign({}, this.data.channelPrefs)
    channel.subs.forEach((sub) => { channelPrefs[sub.key] = on })
    this.setData({ channelPrefs, ['notifyChannels[' + index + '].on']: on })
    this.persistChannelPrefs()
    // 开启渠道时同步发起该渠道全部子项的微信订阅授权（开关状态 ≠ 授权，授权才有推送额度）
    if (on && channel.subs && channel.subs.length) {
      this.requestChannelSubscribe(channel.key, channel.subs.map((sub) => sub.key))
    }
  },

  // 子开关：独立切换，不影响其他子开关；父开关随「是否存在任一开启」联动。
  // 交互冲突防护：每次事件都以 this.data 的最新值为基础做函数式合并（后到事件覆盖先到），
  // switch 的 checked 由数据驱动渲染，连续快速点击时按事件到达顺序依次收敛，不会出现状态错乱。
  onChannelSubChange(e) {
    const subKey = e.currentTarget.dataset.key
    const index = this.indexOfChannel(e.currentTarget.dataset.channel)
    if (index < 0 || !(subKey in this.data.channelPrefs)) return
    const turningOn = !!e.detail.value
    const channelPrefs = Object.assign({}, this.data.channelPrefs, { [subKey]: turningOn })
    const anyOn = this.data.notifyChannels[index].subs.some((sub) => !!channelPrefs[sub.key])
    this.setData({ channelPrefs, ['notifyChannels[' + index + '].on']: anyOn })
    this.persistChannelPrefs()
    // 开启子开关时同步发起该项的微信订阅授权
    if (turningOn) this.requestChannelSubscribe(e.currentTarget.dataset.channel, [subKey])
  },

  // 发起订阅授权并把结果写回各触发点自己的存储（与业务页同为 utils/subscribe.js 的映射）。
  // requestSubscribe 返回 promise（内部已处理 reportQuota 上报）；静默失败不影响开关状态。
  requestChannelSubscribe(channelKey, subKeys) {
    subscribe.requestSubscribe(subKeys).then((res) => {
      const accepted = (res && res.accepted) || []
      // 授权结果必须交给统一映射落库：grantedKey 由触发组决定（授权键是 granted+首字母大写），
      // 存储也随之分键（评论两键 → subscribe_comment_prefs，其余 → notify_channel_prefs）。
      // 早前这里手写 'granted'+Cap(key) 并统一塞进 channelPrefs，导致 commentNew 的授权键
      // 写成 grantedCommentNew（应为 grantedNewComment）且落到了 notify_channel_prefs，
      // 表现为「设置页授权了、发布页顶部入口却不消失」。
      if (typeof subscribe.persistAccepted === 'function') subscribe.persistAccepted(accepted, subKeys)
      this.persistChannelPrefs()
      // 用户刚主动开开关却被静默拒绝（微信侧「总是拒绝」不再弹窗）时，即时引导去设置页重开
      const rejected = (res && res.rejected) || []
      if (rejected.length && typeof subscribe.guideReopen === 'function') {
        const channel = this.data.notifyChannels.find((c) => c.key === channelKey)
        subscribe.guideReopen(rejected, (channel && channel.name) || '消息通知')
      }
    })
  },

  persistChannelPrefs() {
    const prefs = this.data.channelPrefs
    // 评论两个子开关写回发布页共用的存储（保留该存储里的 granted* 授权结果字段）
    const comment = wx.getStorageSync(COMMENT_PREFS_KEY) || {}
    comment.commentNew = !!prefs.commentNew
    comment.commentReply = !!prefs.commentReply
    comment.updatedAt = Date.now()
    wx.setStorageSync(COMMENT_PREFS_KEY, comment)
    // 其余子开关写入渠道偏好存储：**增量合并**而不是整体重建，
    // 否则会把 grantedXxx 等本页不负责的字段一并抹掉（那会导致各业务页入口集体复活）。
    // 授权键由 subscribe.persistAccepted 统一写，这里跳过，避免两处互相覆盖。
    const others = Object.assign({}, wx.getStorageSync(CHANNEL_PREFS_KEY) || {})
    Object.keys(prefs).forEach((key) => {
      if (key === 'commentNew' || key === 'commentReply') return
      if (key.indexOf('granted') === 0) return
      others[key] = !!prefs[key]
    })
    others.updatedAt = Date.now()
    wx.setStorageSync(CHANNEL_PREFS_KEY, others)
  }
})
