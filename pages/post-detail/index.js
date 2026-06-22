const api = require('../../utils/api')
const auth = require('../../utils/auth')
const request = require('../../utils/request')
const format = require('../../utils/format')

Page({
  data: {
    post: null,
    comments: [],
    commentText: '',
    timeText: ''
  },

  onLoad(options) {
    const id = options.id
    api.getPostDetail(id).then((post) => {
      this.setData({
        post,
        timeText: format.formatRelativeTime(post.createdAt)
      })
    })
    api.getCommentList(id).then((res) => {
      const list = (res.list || []).map((c) => ({
        id: c.id,
        nickName: c.nick_name || c.nickName || '用户',
        content: c.content,
        createdAt: c.created_at || c.createdAt
      }))
      this.setData({ comments: list })
    })
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value })
  },

  onSendComment() {
    if (!auth.requireLogin('评论需要先登录')) return
    const text = this.data.commentText.trim()
    if (!text) return
    const postId = this.data.post.id
    const newComment = {
      id: Date.now(),
      nickName: (getApp().globalData.userInfo || {}).nickName || '我',
      content: text,
      createdAt: new Date().toISOString()
    }
    if (request.USE_MOCK) {
      const key = 'comments_' + postId
      const stored = wx.getStorageSync(key) || []
      stored.push(newComment)
      wx.setStorageSync(key, stored)
      const post = Object.assign({}, this.data.post, { commentCount: (this.data.post.commentCount || 0) + 1 })
      this.setData({ comments: this.data.comments.concat(newComment), commentText: '', post })
      wx.showToast({ title: '评论成功', icon: 'success' })
      return
    }
    request.post('/comment', { postId, content: text }, true).then(() => {
      this.setData({
        comments: this.data.comments.concat(newComment),
        commentText: '',
        post: Object.assign({}, this.data.post, { commentCount: (this.data.post.commentCount || 0) + 1 })
      })
      wx.showToast({ title: '评论成功', icon: 'success' })
    })
  },

  onLike() {
    if (!auth.requireLogin('点赞需要先登录')) return
    const post = Object.assign({}, this.data.post)
    const liked = !post.isLiked
    post.isLiked = liked
    post.likeCount = (post.likeCount || 0) + (liked ? 1 : -1)
    this.setData({ post })
    if (!request.USE_MOCK) {
      request.post('/post/' + post.id + '/like', {}, true).catch(() => {})
    }
  }
})
