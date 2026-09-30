const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const messageStore = require('../../utils/messageStore')
const image = require('../../utils/image')
const qr = require('../../utils/qr')
const auth = require('../../utils/auth')

// 跑腿订单专属聊天页：接单人与发单人的独立会话（双方真实身份，与私信完全分开）
function formatTime(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

Page({
  data: {
    orderId: 0,
    peer: null,
    order: null,
    statusText: '',
    messages: [],
    inputValue: '',
    activePanel: '',
    voiceMode: false,
    inputFocus: false,
    scrollToView: '',
    loadingMore: false,
    hasMore: false,
    page: 1,
    sending: false,
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
    this._enterOptions = options || {}
    // 未登录：弹窗引导去登录（取消则退回），登录后回到本页在 onShow 补初始化
    if (!auth.guardPage('订单沟通需要先登录')) return
    this._initialized = true
    this.initChat(this._enterOptions)
  },

  onShow() {
    // 从登录页返回时补执行初始化（首次进入已在 onLoad 完成）
    if (!this._initialized && auth.isLoggedIn()) {
      this._initialized = true
      this.initChat(this._enterOptions || {})
    }
    // 前台期间每 5 秒轮询一次，兜底 WS 未连接的场景
    this.startPolling()
  },

  initChat(options) {
    const app = getApp()
    this.setData({
      orderId: parseInt(options.orderId || options.id, 10) || 0,
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44
    })
    if (!this.data.orderId) {
      wx.showToast({ title: '未找到订单', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    // 订阅实时推送（对方在线发送时秒达；离线由轮询兜底）
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload.type === 'errand_message' && Number(payload.data.orderId) === Number(this.data.orderId)) {
        this.appendMessage(payload.data)
        api.markErrandChatRead(this.data.orderId)
      }
    })
    this.loadMessages()
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.stopPolling()
    if (this.unsubscribe) this.unsubscribe()
  },

  startPolling() {
    this.stopPolling()
    this._pollTimer = setInterval(() => this.pollNewMessages(), 5000)
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  toViewMessage(message) {
    const currentUser = (getApp().globalData.userInfo || {}).id || 0
    const isSelf = Number(message.senderId) === Number(currentUser)
    return {
      id: message.id,
      type: message.msgType || 'text',
      content: message.content,
      isSelf,
      nickname: isSelf ? '我' : (message.senderNick || (this.data.peer && this.data.peer.nick_name) || '校园用户'),
      avatar: isSelf
        ? ((getApp().globalData.userInfo || {}).avatarUrl || '/assets/icons/avatar.png')
        : (message.senderAvatar || (this.data.peer && this.data.peer.avatar_url) || '/assets/icons/avatar.png'),
      timeText: formatTime(message.createdAt)
    }
  },

  async loadMessages(page = 1) {
    try {
      const result = await api.getErrandChatMessages(this.data.orderId, page, 30)
      const list = (result.list || []).map((item) => this.toViewMessage(item))
      const messages = page === 1 ? list : list.concat(this.data.messages)
      const maxId = (result.list || []).reduce((max, item) => Math.max(max, Number(item.id) || 0), this._maxId || 0)
      this._maxId = maxId
      this.setData({
        messages,
        page,
        hasMore: !!result.hasMore,
        peer: result.peer || null,
        order: result.order ? Object.assign({}, result.order, { rewardText: Number(result.order.reward || 0).toFixed(2) }) : null,
        statusText: this.statusText((result.order || {}).status)
      })
      if (page === 1) {
        api.markErrandChatRead(this.data.orderId)
        this.scrollToBottom()
      }
    } catch (e) {
      if (page === 1) wx.showToast({ title: e.message || '聊天加载失败', icon: 'none' })
    }
  },

  statusText(status) {
    return { pending: '待接单', accepted: '进行中', finished: '已完成', cancelled: '已取消' }[status] || ''
  },

  // 轮询增量消息（首页按 id 倒序取最新 20 条，过滤出未见的）
  async pollNewMessages() {
    if (this._polling) return
    this._polling = true
    try {
      const result = await api.getErrandChatMessages(this.data.orderId, 1, 20)
      const fresh = (result.list || []).filter((item) => Number(item.id) > Number(this._maxId || 0))
      if (fresh.length) {
        fresh.forEach((item) => this.appendMessage(item))
        this._maxId = fresh.reduce((max, item) => Math.max(max, Number(item.id) || 0), this._maxId || 0)
        api.markErrandChatRead(this.data.orderId)
      }
    } catch (e) { /* 静默重试 */ } finally {
      this._polling = false
    }
  },

  appendMessage(message) {
    if (this.data.messages.some((item) => Number(item.id) === Number(message.id))) return
    this.setData({ messages: this.data.messages.concat(this.toViewMessage(message)) })
    this.scrollToBottom()
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onInputFocus() {
    this.setData({ activePanel: '' })
  },

  onToggleEmoji() {
    this.setData({ voiceMode: false, activePanel: this.data.activePanel === 'emoji' ? '' : 'emoji', inputFocus: false })
  },

  onToggleTools() {
    this.setData({ voiceMode: false, activePanel: this.data.activePanel === 'tools' ? '' : 'tools', inputFocus: false })
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

  async onSend() {
    const content = this.data.inputValue.trim()
    if (!content || this.data.sending) return
    this.setData({ inputValue: '', activePanel: '', sending: true })
    try {
      const result = await api.sendErrandMessage(this.data.orderId, content, 'text')
      this.appendMessage(Object.assign({}, result, { senderId: (getApp().globalData.userInfo || {}).id || 0, content, msgType: 'text' }))
      this._maxId = Math.max(this._maxId || 0, Number(result.id) || 0)
    } catch (e) {
      this.setData({ inputValue: content })
      wx.showToast({ title: e.message || '消息发送失败，请重试', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },

  onChooseImage() {
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
          for (const url of urls) await this.sendMedia(url, 'image')
        } catch (e) {
          wx.showToast({ title: e.message || '图片发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  onChooseVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: async (res) => {
        // maxDuration 只限制拍摄，相册长视频需按 duration 二次校验
        const raw = (res.tempFiles || [])[0]
        if (!raw || !raw.tempFilePath) return
        const { valid } = image.splitOverlongVideos([raw])
        if (!valid.length) {
          wx.showToast({ title: '视频不能超过1分钟，请重新选择', icon: 'none' })
          return
        }
        const file = raw
        this.setData({ activePanel: '' })
        wx.showLoading({ title: '发送视频...', mask: true })
        try {
          const url = await wechat.uploadVideo(file.tempFilePath)
          await this.sendMedia(url, 'video')
        } catch (e) {
          wx.showToast({ title: e.message || '视频发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  async sendMedia(url, msgType) {
    const result = await api.sendErrandMessage(this.data.orderId, url, msgType)
    this.appendMessage(Object.assign({}, result, { senderId: (getApp().globalData.userInfo || {}).id || 0, content: url, msgType }))
    this._maxId = Math.max(this._maxId || 0, Number(result.id) || 0)
  },

  onPreviewImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = this.data.messages.filter((item) => item.type === 'image').map((item) => item.content)
    wx.previewImage({ current, urls })
  },

  // 长按图片消息：统一二维码识别菜单（识别 / 预览）
  onImageQrScan(e) {
    const src = e.currentTarget.dataset.src
    const urls = this.data.messages.filter((item) => item.type === 'image').map((item) => item.content)
    qr.recognize(src, urls)
  },

  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    this.loadMessages(this.data.page + 1).finally(() => this.setData({ loadingMore: false }))
  },

  scrollToBottom() {
    setTimeout(() => {
      const last = this.data.messages[this.data.messages.length - 1]
      if (last) this.setData({ scrollToView: `msg-${last.id}` })
    }, 50)
  },

  onNavBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/errand/index' })
    })
  },

  // 顶部订单条：跳转订单详情
  openOrder() {
    if (this.data.order && this.data.order.id) {
      wx.navigateTo({ url: '/pages/errand-detail/index?id=' + this.data.order.id })
    }
  }
})
