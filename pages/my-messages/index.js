const messageStore = require('../../utils/messageStore')
const request = require('../../utils/request')
const format = require('../../utils/format')

Page({
  data: {
    activeTab: 0,
    tabs: ['私信', '评论', '点赞', '系统'],
    messages: [],
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
    })
  },

  onShow() {
    // 每次显示刷新会话列表
    this.loadConversations()
    messageStore.syncUnreadCount()
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  loadInteractMessages() {
    const stored = wx.getStorageSync('user_messages') || [
      { id: 1, type: 'comment', title: '评论提醒', content: '校友 回复了你的帖子', time: '2小时前', read: false },
      { id: 2, type: 'like', title: '点赞提醒', content: '有人赞了你的帖子', time: '昨天', read: true },
      { id: 3, type: 'system', title: '系统通知', content: '课程表智能识别功能已上线', time: '3天前', read: true }
    ]
    this.setData({ messages: stored })
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

  formatConv(list) {
    return list.map((c) => ({
      peerId: c.peerId,
      peerNick: c.peerNick || '用户',
      peerAvatar: c.peerAvatar || '/assets/icons/avatar.png',
      unreadCount: c.unreadCount || 0,
      lastMessage: c.lastMessage || '',
      timeText: c.lastTime ? format.formatRelativeTime(c.lastTime) : ''
    }))
  },

  onTab(e) {
    this.setData({ activeTab: parseInt(e.currentTarget.dataset.tab, 10) })
  },

  onOpenChat(e) {
    const peerId = e.currentTarget.dataset.peer
    const nick = e.currentTarget.dataset.nick
    const avatar = e.currentTarget.dataset.avatar
    wx.navigateTo({
      url: '/pages/chat/index?peerId=' + peerId +
        '&nick=' + encodeURIComponent(nick) +
        '&avatar=' + encodeURIComponent(avatar)
    })
  },

  onReadAll() {
    const messages = this.data.messages.map((m) => Object.assign({}, m, { read: true }))
    wx.setStorageSync('user_messages', messages)
    this.setData({ messages })
    wx.showToast({ title: '已全部标记为已读', icon: 'success' })
  }
})
