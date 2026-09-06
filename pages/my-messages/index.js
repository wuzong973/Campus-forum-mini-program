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

  onLoad(options) {
    const tab = Number(options && options.tab)
    if (Number.isInteger(tab) && tab >= 0 && tab < this.data.tabs.length) {
      this.setData({ activeTab: tab })
    }
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
      this.setInteractionMessages((res.list || []).map((item) => {
        // 有操作者昵称时标题带昵称：xxx 评论了你的帖子 / xxx 点赞了你的评论|帖子
        const nick = item.actorNick || ''
        let displayTitle = item.title
        if (nick) {
          if (item.type === 'comment') displayTitle = nick + ' 评论了你的帖子'
          else if (item.type === 'like') displayTitle = nick + (String(item.title || '').indexOf('评论') > -1 ? ' 点赞了你的评论' : ' 点赞了你的帖子')
        }
        return {
          id: item.id,
          type: item.type,
          title: displayTitle,
          content: item.content,
          actorNick: nick,
          actorAvatar: item.actorAvatar || '',
          actorUserId: item.actorUserId || 0,
          postTitle: item.postTitle || '',
          commentImages: item.commentImages || [],
          postId: ['comment', 'like'].indexOf(item.type) > -1 ? item.relatedId : '',
          read: !!item.isRead,
          time: format.formatRelativeTime(item.createdAt)
        }
      }))
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
    const target = this.data.allMessages.find((item) => Number(item.id) === Number(id))
    const messages = this.data.allMessages.map((item) => Number(item.id) === Number(id) ? Object.assign({}, item, { read: true }) : item)
    this.setInteractionMessages(messages)
    if (!request.USE_MOCK) request.put('/notification/' + id + '/read', {}, true, { silent: true }).catch(() => {})
    // 评论/点赞通知进入消息详情页（展示评论者、评论内容与原帖完整信息），详情页内可跳转原帖
    // 评论内容可能较长，经 globalData 交接避免 URL 传参截断
    if (target && target.postId) {
      const app = getApp()
      app.__messageDetail = {
        nick: target.actorNick || '',
        avatar: target.actorAvatar || '',
        // actorUserId>0 为真实用户（头像可进主页）；匿名形象/占位用户为 0（不可点击）
        actorUserId: target.actorUserId || 0,
        content: target.content || '',
        time: target.time || '',
        title: target.title || '',
        postTitle: target.postTitle || '',
        commentImages: target.commentImages || []
      }
      wx.navigateTo({ url: '/pages/message-detail/index?id=' + target.postId })
    }
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
