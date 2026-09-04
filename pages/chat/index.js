const messageStore = require('../../utils/messageStore')
const wechat = require('../../utils/wechat')
const request = require('../../utils/request')

function formatTime(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

Page({
  data: {
    peerId: 0,
    otherUser: {},
    messages: [],
    inputValue: '',
    activePanel: '',
    voiceMode: false,
    inputFocus: false,
    scrollToView: '',
    loadingMore: false,
    hasMore: false,
    page: 1,
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
    const otherUser = {
      nickname: options.nick || legacyUser.nickname || '维修人员',
      avatar: options.avatar || legacyUser.avatar || '/assets/icons/repair-logo.jpg'
    }
    if (!peerId) {
      wx.showToast({ title: '未找到聊天对象', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    this.setData({ peerId, otherUser })
    wx.setNavigationBarTitle({ title: otherUser.nickname })
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload.type === 'message' && payload.peerId === peerId) this.appendMessage(payload.data)
    })
    this.loadMessages()
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  toViewMessage(message) {
    const currentUser = (getApp().globalData.userInfo || {}).id || 0
    const isSelf = Number(message.senderId) === Number(currentUser) || message.isMine === true
    return {
      id: message.id,
      type: message.msgType || message.type || 'text',
      content: message.content,
      isSelf,
      nickname: isSelf ? '我' : (message.senderNick || this.data.otherUser.nickname),
      avatar: isSelf
        ? ((getApp().globalData.userInfo || {}).avatarUrl || '/assets/icons/avatar.png')
        : (message.senderAvatar || this.data.otherUser.avatar),
      timeText: formatTime(message.createdAt)
    }
  },

  async loadMessages(page = 1) {
    try {
      const result = await messageStore.getHistory(this.data.peerId, page, 30)
      const list = (result.list || []).map((item) => this.toViewMessage(item))
      const messages = page === 1 ? list : list.concat(this.data.messages)
      this.setData({ messages, page, hasMore: !!result.hasMore })
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
    this.setData({ messages: this.data.messages.concat(viewMessage) })
    this.scrollToBottom()
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
    const result = await messageStore.sendMessage(this.data.peerId, content, msgType)
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
    this.setData({ inputValue: '', activePanel: '' })
    try {
      await this.sendContent(content)
    } catch (e) {
      this.setData({ inputValue: content })
      wx.showToast({ title: '消息发送失败，请重试', icon: 'none' })
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
          if (!request.USE_MOCK && urls.some((url) => !/^https?:\/\//.test(url))) {
            throw new Error('图片上传失败')
          }
          for (const url of urls) await this.sendContent(url, 'image')
        } catch (e) {
          wx.showToast({ title: '图片发送失败，请重试', icon: 'none' })
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
  }
})
