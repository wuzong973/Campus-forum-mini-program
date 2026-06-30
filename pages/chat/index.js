const messageStore = require('../../utils/messageStore')
const request = require('../../utils/request')
const format = require('../../utils/format')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    peerId: 0,
    peerNick: '',
    peerAvatar: '',
    myAvatar: '',
    messages: [],
    inputText: '',
    scrollToId: '',
    hasMore: true,
    page: 1,
    loading: false,
    loadingMore: false,
    sending: false,
    showEmojiPanel: false,
    emojiList: ['😊', '😂', '❤️', '🎉', '😍', '😢', '💪', '🙏', '😎', '🥰', '😅', '😘', '👏', '🔥', '💯', '✨', '🎊', '😁', '🤣', '😜']
  },

  onLoad(options) {
    const app = getApp()
    const peerId = parseInt(options.peerId, 10)
    const peerNick = options.nick ? decodeURIComponent(options.nick) : '用户'
    const peerAvatar = options.avatar ? decodeURIComponent(options.avatar) : '/assets/icons/avatar.png'
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      peerId,
      peerNick,
      peerAvatar,
      myAvatar: (app.globalData.userInfo || {}).avatarUrl || '/assets/icons/avatar.png'
    })
    wx.setNavigationBarTitle({ title: peerNick })

    // 加载本地缓存优先展示
    const cached = messageStore.loadCache(peerId)
    if (cached.length) {
      this.setData({
        messages: this.formatMessages(cached),
        scrollToId: 'msg-' + cached[cached.length - 1].id
      })
    }

    // 从云端拉取最新
    this.loadHistory(true)
    // 标记已读
    this.markRead()
    // 注册实时消息回调
    this.unsubscribe = messageStore.onMessage((payload) => {
      if ((payload.type === 'message' || payload.type === 'private_message') && payload.peerId === peerId) {
        this.appendMessage(payload.data)
      }
    })
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  formatMessages(list) {
    return list.map((m) => ({
      id: m.id,
      content: m.content,
      isMine: m.isMine !== undefined ? m.isMine : (m.senderId === getApp().globalData.userInfo.id),
      senderId: m.senderId,
      status: m.status || 'sent',
      timeText: format.formatRelativeTime(m.createdAt) || format.formatTime(m.createdAt),
      createdAt: m.createdAt
    }))
  },

  loadHistory(reset) {
    if (this.data.loading) return
    this.setData({ loading: true })
    const page = reset ? 1 : this.data.page
    if (request.USE_MOCK) {
      // Mock 模式：使用本地缓存
      const cached = messageStore.loadCache(this.data.peerId)
      this.setData({
        messages: this.formatMessages(cached),
        loading: false,
        hasMore: false
      })
      this.scrollToBottom()
      return
    }
    messageStore.getHistory(this.data.peerId, page, 30).then((res) => {
      const list = (res.list || []).map((m) => ({
        id: m.id,
        content: m.content,
        isMine: m.senderId === getApp().globalData.userInfo.id,
        senderId: m.senderId,
        status: m.status,
        timeText: format.formatRelativeTime(m.createdAt) || format.formatTime(m.createdAt),
        createdAt: m.createdAt
      }))
      let messages
      if (reset) {
        messages = list
      } else {
        messages = list.concat(this.data.messages)
      }
      this.setData({
        messages,
        hasMore: res.hasMore,
        page: page + 1,
        loading: false,
        loadingMore: false
      })
      // 写入本地缓存
      if (reset) {
        messageStore.saveCache(this.data.peerId, list)
      }
      if (reset) this.scrollToBottom()
    }).catch(() => {
      this.setData({ loading: false, loadingMore: false })
    })
  },

  onRefresh() {
    if (this.data.hasMore) {
      this.setData({ loadingMore: true })
      this.loadHistory(false)
    } else {
      this.setData({ loadingMore: false })
    }
  },

  onLoadMore() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadHistory(false)
    }
  },

  scrollToBottom() {
    const list = this.data.messages
    if (list.length) {
      this.setData({ scrollToId: 'msg-' + list[list.length - 1].id })
    }
  },

  appendMessage(msg) {
    const item = {
      id: msg.id,
      content: msg.content,
      isMine: msg.senderId === getApp().globalData.userInfo.id,
      senderId: msg.senderId,
      status: msg.status || 'sent',
      timeText: format.formatRelativeTime(msg.createdAt) || '刚刚',
      createdAt: msg.createdAt
    }
    // 去重
    if (this.data.messages.find((m) => m.id === item.id)) return
    const messages = this.data.messages.concat([item])
    this.setData({ messages })
    this.scrollToBottom()
    if (!item.isMine) {
      this.markRead()
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  onSend() {
    if (this.data.sending) return
    const text = this.data.inputText.trim()
    if (!text) return
    const app = getApp()
    const currentUserId = (app.globalData.userInfo || {}).id || 0
    if (!currentUserId) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }

    // 创建临时消息（乐观更新）
    const tempId = 'temp_' + Date.now()
    const tempMsg = {
      id: tempId,
      content: text,
      isMine: true,
      senderId: currentUserId,
      status: 'sending',
      timeText: '刚刚',
      createdAt: new Date().toISOString()
    }
    const messages = this.data.messages.concat([tempMsg])
    this.setData({ messages, inputText: '', sending: true })
    this.scrollToBottom()

    // 写入本地缓存
    messageStore.appendCache(this.data.peerId, tempMsg)

    const doSend = () => {
      if (request.USE_MOCK) {
        // Mock：1秒后变成已发送
        setTimeout(() => {
          this.updateTempMessage(tempId, {
            id: Date.now(),
            status: 'sent'
          })
          this.setData({ sending: false })
        }, 500)
        return
      }
      messageStore.sendMessage(this.data.peerId, text).then((res) => {
        this.updateTempMessage(tempId, {
          id: res.id,
          status: 'sent'
        })
        this.setData({ sending: false })
      }).catch(() => {
        this.updateTempMessage(tempId, { status: 'failed' })
        this.setData({ sending: false })
      })
    }
    doSend()
  },

  updateTempMessage(tempId, patch) {
    const messages = this.data.messages.map((m) => {
      if (m.id === tempId) {
        return Object.assign({}, m, patch)
      }
      return m
    })
    this.setData({ messages })
    // 同步缓存
    const peerId = this.data.peerId
    const cached = messageStore.loadCache(peerId)
    const idx = cached.findIndex((m) => m.id === tempId)
    if (idx >= 0) {
      cached[idx] = Object.assign({}, cached[idx], patch)
      messageStore.saveCache(peerId, cached)
    }
  },

  onRetry(e) {
    const id = e.currentTarget.dataset.id
    const content = e.currentTarget.dataset.content
    // 重置为发送中
    this.updateTempMessage(id, { status: 'sending' })
    if (request.USE_MOCK) {
      setTimeout(() => {
        this.updateTempMessage(id, { id: Date.now(), status: 'sent' })
      }, 500)
      return
    }
    messageStore.sendMessage(this.data.peerId, content).then((res) => {
      this.updateTempMessage(id, { id: res.id, status: 'sent' })
    }).catch(() => {
      this.updateTempMessage(id, { status: 'failed' })
    })
  },

  markRead() {
    messageStore.markRead(this.data.peerId).catch(() => {})
  },

  onBack() {
    wx.navigateBack()
  },

  onEmoji() {
    this.setData({ showEmojiPanel: !this.data.showEmojiPanel })
  },

  onSelectEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji
    this.setData({
      inputText: this.data.inputText + emoji,
      showEmojiPanel: false
    })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: [url] })
  },

  onAddImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        const app = getApp()
        const currentUserId = (app.globalData.userInfo || {}).id || 0
        if (!currentUserId) {
          wx.navigateTo({ url: '/pages/login/index' })
          return
        }
        const tempId = 'temp_' + Date.now()
        const tempMsg = {
          id: tempId,
          content: '[图片]',
          imageUrl: tempFilePath,
          isMine: true,
          senderId: currentUserId,
          status: 'sent',
          timeText: '刚刚',
          createdAt: new Date().toISOString()
        }
        const messages = this.data.messages.concat([tempMsg])
        this.setData({ messages })
        this.scrollToBottom()
        messageStore.appendCache(this.data.peerId, tempMsg)
      }
    })
  }
})
