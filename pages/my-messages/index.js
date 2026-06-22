Page({
  data: {
    activeTab: 0,
    tabs: ['评论', '点赞', '系统'],
    messages: []
  },

  onLoad() {
    const stored = wx.getStorageSync('user_messages') || [
      { id: 1, type: 'comment', title: '评论提醒', content: '校友 回复了你的帖子', time: '2小时前', read: false },
      { id: 2, type: 'like', title: '点赞提醒', content: '有人赞了你的帖子', time: '昨天', read: true },
      { id: 3, type: 'system', title: '系统通知', content: '课程表智能识别功能已上线', time: '3天前', read: true }
    ]
    this.setData({ messages: stored })
  },

  onTab(e) {
    this.setData({ activeTab: parseInt(e.currentTarget.dataset.tab, 10) })
  },

  onReadAll() {
    const messages = this.data.messages.map((m) => Object.assign({}, m, { read: true }))
    wx.setStorageSync('user_messages', messages)
    this.setData({ messages })
    wx.showToast({ title: '已全部标记为已读', icon: 'success' })
  },

  get filteredMessages() {
    return this.data.messages
  }
})
