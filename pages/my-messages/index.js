const messageStore = require('../../utils/messageStore')
const request = require('../../utils/request')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    activeTab: 0,
    tabs: ['私信', '评论', '点赞', '系统'],
    messages: [],
    allMessages: [],
    conversations: []
  },

  onLoad() {
    this.loadInteractMessages()
    this.loadConversations()
    // 注册实时消息回调
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload.type === 'new_message' || payload.type === 'message') {
        this.loadConversations()
      }
      if (payload.type === 'notification') this.loadInteractMessages()
    })
  },

  onShow() {
    // 每次显示刷新会话列表
    this.loadConversations()
    this.loadInteractMessages()
    messageStore.syncUnreadCount()
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  loadInteractMessages() {
    if (request.USE_MOCK) {
      const stored = wx.getStorageSync('user_messages') || []
      this.setInteractionMessages(stored)
      return
    }
    request.get('/notification', { page: 1, pageSize: 50 }, true, { silent: true }).then((res) => {
      this.setInteractionMessages((res.list || []).map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        content: item.content,
        read: !!item.isRead,
        time: format.formatRelativeTime(item.createdAt)
      })))
    }).catch(() => {})
  },

  loadConversations() {
    // 先用本地缓存
    const cached = messageStore.loadConversations()
    if (cached.length) {
      this.setData({ conversations: this.formatConv(cached) })
    }
    if (request.USE_MOCK) return
    messageStore.getConversations().then((res) => {
      const list = res.list || []
      messageStore.saveConversations(list)
      this.setData({ conversations: this.formatConv(list) })
    }).catch(() => {})
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, [() => this.loadInteractMessages(), () => this.loadConversations()])
  },

  formatConv(list) {
    return list.map((c) => ({
      peerId: c.peerId,
      peerNick: c.peerNick || '用户',
      peerAvatar: c.peerAvatar || '/assets/icons/avatar.png',
      isAnonymous: !!c.isAnonymous,
      unreadCount: c.unreadCount || 0,
      lastMessage: c.lastMessage || '',
      timeText: c.lastTime ? format.formatRelativeTime(c.lastTime) : ''
    }))
  },

  onTab(e) {
    this.setData({ activeTab: parseInt(e.currentTarget.dataset.tab, 10) }, () => this.filterInteractionMessages())
  },

  onOpenChat(e) {
    const peerId = e.currentTarget.dataset.peer
    const nick = e.currentTarget.dataset.nick
    const avatar = e.currentTarget.dataset.avatar
    const anonymous = !!e.currentTarget.dataset.anonymous
    wx.navigateTo({
      url: '/pages/chat/index?peerId=' + peerId +
        '&nick=' + encodeURIComponent(nick) +
        '&avatar=' + encodeURIComponent(avatar) +
        '&anonymous=' + (anonymous ? '1' : '0')
    })
  },

  onReadAll() {
    const done = () => {
      const messages = this.data.allMessages.map((m) => Object.assign({}, m, { read: true }))
      this.setInteractionMessages(messages)
      wx.showToast({ title: '已全部标记为已读', icon: 'success' })
    }
    if (request.USE_MOCK) {
      wx.setStorageSync('user_messages', this.data.allMessages.map((m) => Object.assign({}, m, { read: true })))
      done()
      return
    }
    request.put('/notification/read-all', {}, true).then(done).catch(() => {})
  },

  onOpenNotification(e) {
    const id = e.currentTarget.dataset.id
    const messages = this.data.allMessages.map((item) => Number(item.id) === Number(id) ? Object.assign({}, item, { read: true }) : item)
    this.setInteractionMessages(messages)
    if (!request.USE_MOCK) request.put('/notification/' + id + '/read', {}, true, { silent: true }).catch(() => {})
  },

  setInteractionMessages(messages) {
    this.setData({ allMessages: messages }, () => this.filterInteractionMessages())
  },

  filterInteractionMessages() {
    const types = [null, 'comment', 'like', 'system']
    const type = types[this.data.activeTab]
    const messages = !type ? this.data.allMessages : this.data.allMessages.filter((item) => type === 'system' ? ['system', 'errand', 'repair'].includes(item.type) : item.type === type)
    this.setData({ messages })
  }
})
