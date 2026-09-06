const messageStore = require('../../utils/messageStore')
const wechat = require('../../utils/wechat')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

// 帖子相关页面路由：从这些页面进入聊天时，顶部展示「回到帖子」按钮
const POST_PAGE_ROUTES = [
  'pages/post-detail/index', // 帖子详情页
  'pages/index/index', // 首页帖子列表
  'pages/search/index' // 搜索结果列表
]

function formatTime(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 安全解码 URL 参数（入口以 encodeURIComponent 传入；含非法 % 序列时回退原值）
function safeDecode(value) {
  try { return decodeURIComponent(value) } catch (e) { return value }
}

Page({
  data: {
    peerId: 0,
    otherUser: {},
    anonymousMode: false,
    selfAnonymous: null,
    canSend: true,
    peerBlocked: false,
    blockedByPeer: false,
    blocking: false,
    hasPeerMessage: false,
    pendingMessageId: 0,
    recalling: false,
    messages: [],
    inputValue: '',
    activePanel: '',
    voiceMode: false,
    inputFocus: false,
    scrollToView: '',
    loadingMore: false,
    hasMore: false,
    page: 1,
    showBackToPost: false,
    returning: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    emojiList: [
      '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆',
      '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗',
      '😙', '😚', '🙂', '🤗', '🤩', '🤨', '😐', '😑',
      '😶', '😏', '😣', '😮', '🤐', '😯', '😪', '😫',
      '🥱', '😴', '😛', '😜', '😝', '🤤', '😒', '😓',
      '😔', '😕', '🙃', '🤑', '😲', '☹️', '🙁', '😖'
    ]
  },

  onLoad(options) {
    let legacyUser = {}
    try { legacyUser = JSON.parse(decodeURIComponent(options.otherUser || '{}')) } catch (e) {}
    const peerId = parseInt(options.peerId || legacyUser.id, 10)
    const anonymousMode = options.anonymous === '1'
    // 匿名聊天也可携带分身昵称/头像（从分身卡片私信进入时传入），未传则用通用匿名身份
    const otherUser = anonymousMode ? {
      nickname: options.nick ? safeDecode(options.nick) : '匿名用户',
      avatar: options.avatar ? safeDecode(options.avatar) : '/assets/icons/avatar.png'
    } : {
      nickname: options.nick ? safeDecode(options.nick) : (legacyUser.nickname || '维修人员'),
      avatar: options.avatar ? safeDecode(options.avatar) : (legacyUser.avatar || '/assets/icons/repair-logo.jpg')
    }
    if (!peerId) {
      wx.showToast({ title: '未找到聊天对象', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    // 分身私信普通用户：发起方自己的分身身份（首次进入时由服务端存档）
    let selfSeedPersona = null
    if (anonymousMode && options.anonSelfNick && options.anonSelfAvatar) {
      selfSeedPersona = { nickName: safeDecode(options.anonSelfNick), avatarUrl: safeDecode(options.anonSelfAvatar) }
    }
    // 扫描页面栈找到最近的帖子页面（帖子详情/列表），计算返回层级
    // 兼容 帖子页→聊天页 (delta 1) 与 帖子页→个人主页→聊天页 (delta 2) 等路径
    const pages = getCurrentPages()
    let backToPostDelta = 0
    for (let i = pages.length - 2; i >= 0; i--) {
      if (POST_PAGE_ROUTES.indexOf(pages[i].route) > -1) { backToPostDelta = pages.length - 1 - i; break }
    }
    this._backToPostDelta = backToPostDelta
    const app = getApp()
    this.setData({
      peerId,
      otherUser,
      anonymousMode,
      // 入口是否显式指定了匿名参数（指定后以入口为准，不再被会话标记覆盖）
      anonParamExplicit: options.anonymous !== undefined,
      selfSeedPersona,
      anonSelfMode: !!selfSeedPersona,
      showBackToPost: backToPostDelta > 0,
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44
    })
    this.unsubscribe = messageStore.onMessage((payload) => {
      // 拉黑后客户端兜底过滤，正常情况下服务端已拒绝投递
      if (payload.type === 'message' && payload.peerId === peerId && !this.data.peerBlocked) this.appendMessage(payload.data)
      if (payload.type === 'message_recalled' && payload.peerId === peerId) this.removeMessage(payload.data.id)
    })
    this.loadMessages()
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  // 自定义导航栏返回按钮；无上级页面时兜底回首页
  onNavBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  },

  // 「回到帖子」：返回之前的帖子页面（页面实例保留在栈中，滚动位置与状态自动恢复）
  onBackToPost() {
    if (this.data.returning) return // 防重复点击
    const delta = this._backToPostDelta || 1
    this.setData({ returning: true })
    wx.navigateBack({
      delta,
      complete: () => this.setData({ returning: false })
    })
  },

  toViewMessage(message) {
    const currentUser = (getApp().globalData.userInfo || {}).id || 0
    const isSelf = Number(message.senderId) === Number(currentUser) || message.isMine === true
    const anonymousMode = this.data.anonymousMode || !!message.isAnonymous
    // 自己的分身身份（本会话的分身拥有者进入时由服务端下发）；普通匿名参与者没有
    const selfPersona = this.data.selfAnonymous
    return {
      id: message.id,
      type: message.msgType || message.type || 'text',
      content: message.content,
      isSelf,
      nickname: anonymousMode
        ? (isSelf ? (selfPersona ? selfPersona.nickName : '匿名用户') : this.data.otherUser.nickname)
        : (isSelf ? '我' : (message.senderNick || this.data.otherUser.nickname)),
      // 匿名聊天：不取 senderAvatar（服务端返回的是真实身份）；自己用分身头像（若有），对方固定用会话分身头像
      avatar: anonymousMode
        ? (isSelf ? (selfPersona ? selfPersona.avatarUrl : '/assets/icons/avatar.png') : this.data.otherUser.avatar)
        : (isSelf
          ? ((getApp().globalData.userInfo || {}).avatarUrl || '/assets/icons/avatar.png')
          : (message.senderAvatar || this.data.otherUser.avatar)),
      timeText: formatTime(message.createdAt),
      canRecall: isSelf && Number(message.id) === Number(this.data.pendingMessageId)
    }
  },

  async loadMessages(page = 1) {
    try {
      // 匿名会话带上分身身份参数：服务端只在首次存档，之后所有入口都返回同一份
      // anonSelfMode：分身属于发起方自己（分身私信普通用户），存档方向为 self
      const seedPersona = this.data.selfSeedPersona
        ? this.data.selfSeedPersona
        : (this.data.anonymousMode && this.data.otherUser.avatar.indexOf('/assets/avatar1/') === 0
          ? { nickName: this.data.otherUser.nickname, avatarUrl: this.data.otherUser.avatar }
          : null)
      const anonSide = this.data.selfSeedPersona ? 'self' : 'peer'
      const result = await messageStore.getHistory(this.data.peerId, page, 30, this.data.anonymousMode, seedPersona, anonSide)
      // 入口显式指定了 anonymous 参数时以入口为准，否则沿用会话的匿名标记
      const anonymousMode = this.data.anonParamExplicit
        ? this.data.anonymousMode
        : (this.data.anonymousMode || !!result.isAnonymous)
      // 服务端存档的分身身份优先于入口参数，保证整个会话期间显示同一个匿名头像
      const otherUser = result.peerAnonymous
        ? { nickname: result.peerAnonymous.nickName, avatar: result.peerAnonymous.avatarUrl }
        : this.data.otherUser
      const list = (result.list || []).map((item) => this.toViewMessage(Object.assign({}, item, { isAnonymous: anonymousMode })))
      const messages = page === 1 ? list : list.concat(this.data.messages)
      const hasPeerMessage = this.data.hasPeerMessage || list.some((item) => !item.isSelf)
      this.setData({ messages, page, hasMore: !!result.hasMore, canSend: hasPeerMessage || result.canSend !== false, hasPeerMessage, pendingMessageId: result.pendingMessageId || 0, anonymousMode: this.data.anonymousMode || !!result.isAnonymous, peerBlocked: !!result.blocked, blockedByPeer: !!result.blockedByPeer, otherUser, selfAnonymous: result.selfAnonymous || null })
      if (page === 1) {
        messageStore.saveCache(this.data.peerId, result.list || [])
        messageStore.markRead(this.data.peerId).catch(() => {})
        this.scrollToBottom()
      }
    } catch (e) {
      if (page === 1) {
        const cached = messageStore.loadCache(this.data.peerId).map((item) => this.toViewMessage(item))
        this.setData({ messages: cached })
        this.scrollToBottom()
      }
    }
  },

  appendMessage(message) {
    if (this.data.messages.some((item) => Number(item.id) === Number(message.id))) return
    const viewMessage = this.toViewMessage(message)
    messageStore.appendCache(this.data.peerId, message)
    const isSelf = viewMessage.isSelf
    const hasPeerMessage = this.data.hasPeerMessage || !isSelf
    this.setData({ messages: this.data.messages.concat(viewMessage), canSend: hasPeerMessage, hasPeerMessage, pendingMessageId: isSelf && !hasPeerMessage ? viewMessage.id : 0 })
    this.scrollToBottom()
  },

  removeMessage(messageId) {
    const messages = this.data.messages.filter((item) => Number(item.id) !== Number(messageId))
    this.setData({ messages, canSend: true, pendingMessageId: 0, recalling: false })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onInputFocus() {
    this.setData({ activePanel: '' })
  },

  onToggleEmoji() {
    this.setData({
      voiceMode: false,
      activePanel: this.data.activePanel === 'emoji' ? '' : 'emoji',
      inputFocus: false
    })
  },

  onToggleTools() {
    this.setData({
      voiceMode: false,
      activePanel: this.data.activePanel === 'tools' ? '' : 'tools',
      inputFocus: false
    })
  },

  onToggleVoice() {
    this.setData({ voiceMode: !this.data.voiceMode, activePanel: '', inputFocus: false })
  },

  onVoiceHint() {
    wx.showToast({ title: '语音功能暂未开启', icon: 'none' })
  },

  onEmojiTap(e) {
    this.setData({ inputValue: this.data.inputValue + e.currentTarget.dataset.emoji })
  },

  async sendContent(content, msgType = 'text') {
    if (!this.data.canSend) throw new Error('请等待对方回复后再发送，可长按上一条消息撤回')
    // 匿名发送时携带自己一侧的分身形象（分身拥有者用已有档案，否则服务端自动生成存档）
    const persona = this.data.selfSeedPersona || this.data.selfAnonymous || null
    const result = await messageStore.sendMessage(this.data.peerId, content, msgType, this.data.anonymousMode, persona)
    this.appendMessage({
      id: result.id,
      senderId: (getApp().globalData.userInfo || {}).id || 0,
      receiverId: this.data.peerId,
      content,
      msgType,
      status: result.status || 'sent',
      createdAt: result.createdAt || new Date().toISOString(),
      isMine: true
    })
  },

  async onSend() {
    const content = this.data.inputValue.trim()
    if (!content) return
    if (this.data.peerBlocked) { wx.showToast({ title: '已拉黑对方，请先解除拉黑', icon: 'none' }); return }
    if (this.data.blockedByPeer) { wx.showToast({ title: '对方已将你加入黑名单', icon: 'none' }); return }
    if (!this.data.canSend) { wx.showToast({ title: '请等待对方回复，可长按上一条撤回', icon: 'none' }); return }
    this.setData({ inputValue: '', activePanel: '' })
    try {
      await this.sendContent(content)
    } catch (e) {
      this.setData({ inputValue: content })
      wx.showToast({ title: e.message || '消息发送失败，请重试', icon: 'none' })
    }
  },

  onChooseImage() {
    if (this.data.peerBlocked) { wx.showToast({ title: '已拉黑对方，请先解除拉黑', icon: 'none' }); return }
    if (this.data.blockedByPeer) { wx.showToast({ title: '对方已将你加入黑名单', icon: 'none' }); return }
    if (!this.data.canSend) { wx.showToast({ title: '请等待对方回复，可长按上一条撤回', icon: 'none' }); return }
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const paths = (res.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean)
        if (!paths.length) return
        this.setData({ activePanel: '' })
        wx.showLoading({ title: '发送图片...', mask: true })
        try {
          const urls = await wechat.uploadImages(paths)
          if (!request.USE_MOCK && urls.some((url) => !/^https?:\/\//.test(url))) {
            throw new Error('图片上传失败')
          }
          for (const url of urls) await this.sendContent(url, 'image')
        } catch (e) {
          wx.showToast({ title: e.message || '图片发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 选择并发送视频（相册/拍摄，最长 60 秒）
  onChooseVideo() {
    if (this.data.peerBlocked) { wx.showToast({ title: '已拉黑对方，请先解除拉黑', icon: 'none' }); return }
    if (this.data.blockedByPeer) { wx.showToast({ title: '对方已将你加入黑名单', icon: 'none' }); return }
    if (!this.data.canSend) { wx.showToast({ title: '请等待对方回复，可长按上一条撤回', icon: 'none' }); return }
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: async (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        this.setData({ activePanel: '' })
        wx.showLoading({ title: '发送视频...', mask: true })
        try {
          const url = await wechat.uploadVideo(file.tempFilePath)
          if (!request.USE_MOCK && !/^https?:\/\//.test(url)) throw new Error('视频上传失败')
          await this.sendContent(url, 'video')
        } catch (e) {
          wx.showToast({ title: e.message || '视频发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  onPreviewImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = this.data.messages.filter((item) => item.type === 'image').map((item) => item.content)
    wx.previewImage({ current, urls })
  },

  onRecallMessage(e) {
    const messageId = e.currentTarget.dataset.id
    if (!messageId || Number(messageId) !== Number(this.data.pendingMessageId) || this.data.recalling) return
    wx.showModal({ title: '撤回消息', content: '撤回后对方将无法看到该消息，你可以重新编辑发送。', success: (res) => {
      if (!res.confirm) return
      this.setData({ recalling: true })
      messageStore.recallMessage(this.data.peerId, messageId).then(() => {
        this.removeMessage(messageId)
        wx.showToast({ title: '消息已撤回', icon: 'success' })
      }).catch((err) => { this.setData({ recalling: false }); wx.showToast({ title: err.message || '撤回失败', icon: 'none' }) })
    } })
  },

  onToggleBlock() {
    if (this.data.blocking || !this.data.peerId) return
    if (!this.data.peerBlocked) {
      wx.showModal({
        title: '拉黑确认',
        content: '拉黑后将不再接收对方发送的任何消息（文字、图片等），对方也无法再向你发送消息。确定拉黑对方吗？',
        confirmText: '确认拉黑',
        confirmColor: '#fa5151',
        success: (res) => {
          if (!res.confirm) return
          this.setData({ blocking: true })
          messageStore.blockPeer(this.data.peerId).then(() => {
            this.setData({ peerBlocked: true, canSend: false, blocking: false })
            wx.showToast({ title: '已拉黑对方', icon: 'success' })
          }).catch((err) => {
            this.setData({ blocking: false })
            wx.showToast({ title: err.message || '拉黑失败，请重试', icon: 'none' })
          })
        }
      })
    } else {
      wx.showModal({
        title: '解除拉黑',
        content: '解除后对方将可以重新向你发送消息。确定解除拉黑吗？',
        confirmText: '确认解除',
        success: (res) => {
          if (!res.confirm) return
          this.setData({ blocking: true })
          messageStore.unblockPeer(this.data.peerId).then(() => {
            this.setData({ peerBlocked: false, blocking: false })
            wx.showToast({ title: '已解除拉黑', icon: 'success' })
            this.loadMessages(1)
          }).catch((err) => {
            this.setData({ blocking: false })
            wx.showToast({ title: err.message || '解除失败，请重试', icon: 'none' })
          })
        }
      })
    }
  },

  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    this.loadMessages(this.data.page + 1).finally(() => this.setData({ loadingMore: false }))
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadMessages(1))
  },

  scrollToBottom() {
    setTimeout(() => {
      const last = this.data.messages[this.data.messages.length - 1]
      if (last) this.setData({ scrollToView: `msg-${last.id}` })
    }, 50)
  }
})
