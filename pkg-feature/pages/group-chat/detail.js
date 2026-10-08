const api = require('../../../utils/api')
const { charAvatar } = require('../../utils/group-chat')

// 进群方式文案（与服务端 groupChatController 的 JOIN_MODES 保持一致）
const JOIN_MODE_TIPS = {
  qrcode: '点击二维码可放大保存 · 微信扫码进群',
  admin: '该群由管理员邀请进群，先添加上方「管理员微信」再申请入群',
  invite: '该群仅支持群内成员邀请加入，可联系群主或群内同学拉你进群'
}

// 拼接「加入方式」下方的提示：方式决定主文案，是否需要审核追加后缀。
// 返回空串时前端不渲染该区块，避免出现「只有一句提示、没有二维码」的空卡片。
function buildJoinTip(group, hasAdminQr) {
  const mode = group.joinMode || 'qrcode'
  const needAudit = !!group.needAudit
  if (mode === 'admin') {
    const tip = hasAdminQr ? JOIN_MODE_TIPS.admin : '该群由管理员邀请进群，可联系群主或管理员申请入群'
    return needAudit ? tip + ' · 进群需管理员审核' : tip
  }
  if (mode === 'invite') {
    return needAudit ? JOIN_MODE_TIPS.invite + ' · 进群需管理员审核' : JOIN_MODE_TIPS.invite
  }
  // 扫码进群：没有二维码就没有可展示的内容，交给调用方隐藏整块
  if (!group.qrcodeUrl) return ''
  return needAudit ? JOIN_MODE_TIPS.qrcode + ' · 进群后请等待管理员审核' : JOIN_MODE_TIPS.qrcode
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    group: null,
    adminQrcodeUrl: '',
    gzhQrcodeUrl: '',
    joinModeTip: '',
    images: []
  },

  onLoad(options) {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    this.groupId = Number((options && options.id) || 0)
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
    this.loadDetail()
  },

  loadDetail() {
    if (!this.groupId) return this.failBack()
    api.getGroupChatDetail(this.groupId).then((res) => {
      const group = (res && res.group) || null
      if (!group) return this.failBack()
      // 头像兜底：按群名首字符动态生成（改名后实时更新）
      const av = charAvatar(group.name)
      group.firstChar = av.char
      group.fallbackBg = av.theme.gradient
      const adminQrcodeUrl = (res && res.adminQrcodeUrl) || ''
      const gzhQrcodeUrl = (res && res.gzhQrcodeUrl) || ''
      this.setData({
        group,
        adminQrcodeUrl,
        gzhQrcodeUrl,
        joinModeTip: buildJoinTip(group, !!adminQrcodeUrl),
        images: (res && res.images) || [],
        loading: false
      })
    }).catch(() => this.failBack())
  },

  failBack() {
    wx.showToast({ title: '群聊不存在或已下架', icon: 'none' })
    setTimeout(() => wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/group-chat/index' })
    }), 900)
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/group-chat/index' })
    })
  },

  // 点击大二维码 → 放大预览（可长按保存 / 微信扫码识别）
  onPreviewQr() {
    const url = this.data.group && this.data.group.qrcodeUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onPreviewAdmin() {
    const url = this.data.adminQrcodeUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onPreviewGzh() {
    const url = this.data.gzhQrcodeUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: this.data.images.length ? this.data.images : [url], current: url })
  }
})
