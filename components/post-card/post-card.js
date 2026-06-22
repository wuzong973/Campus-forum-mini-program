const format = require('../../utils/format')
const auth = require('../../utils/auth')
const request = require('../../utils/request')

Component({
  properties: {
    post: { type: Object, value: {} }
  },
  data: { timeText: '' },
  observers: {
    'post.createdAt': function (val) {
      this.setData({ timeText: format.formatRelativeTime(val) })
    }
  },
  lifetimes: {
    attached() {
      const post = this.data.post
      if (post && post.createdAt) {
        this.setData({ timeText: format.formatRelativeTime(post.createdAt) })
      }
    }
  },
  methods: {
    onTap() {
      wx.navigateTo({ url: '/pages/post-detail/index?id=' + this.data.post.id })
    },
    onLike() {
      if (!auth.requireLogin('点赞需要先登录')) return
      const post = Object.assign({}, this.data.post)
      post.isLiked = !post.isLiked
      post.likeCount = (post.likeCount || 0) + (post.isLiked ? 1 : -1)
      this.setData({ post })
      this.triggerEvent('like', { post })
      if (!request.USE_MOCK) {
        request.post('/post/' + post.id + '/like', {}, true, { silent: true }).catch(() => {})
      }
    },
    onComment() {
      wx.navigateTo({ url: '/pages/post-detail/index?id=' + this.data.post.id })
    },
    onShare() {
      wx.showShareMenu({ withShareTicket: true })
    }
  }
})
