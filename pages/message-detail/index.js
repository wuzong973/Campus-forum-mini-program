const request = require('../../utils/request')
const format = require('../../utils/format')
const api = require('../../utils/api')
const qr = require('../../utils/qr')

Page({
  data: {
    postId: '',
    actorNick: '',
    actorAvatar: '',
    actorUserId: 0,
    canViewProfile: false,
    content: '',
    mediaItems: [],
    time: '',
    actionTitle: '',
    postTitle: '',
    post: null,
    postTimeText: '',
    loading: true
  },

  onLoad(options) {
    // 消息列表页经 globalData 交接展示数据（评论内容可能较长，避免 URL 传参截断）
    const app = getApp()
    const payload = app.__messageDetail || {}
    app.__messageDetail = null
    const nick = payload.nick || ''
    const title = payload.title || ''
    // 标题形如「xxx 评论了你的帖子」，昵称已单独展示，副标题去掉昵称避免重复
    const actionTitle = nick && title.indexOf(nick) === 0 ? title.slice(nick.length).trim() : title
    // 评论图片/视频：有媒体时内容去掉「[图片]/[视频]」占位后缀，改为展示真实媒体
    const rawImages = Array.isArray(payload.commentImages) ? payload.commentImages : []
    const mediaItems = rawImages.map((url) => ({
      url,
      video: /\.(mp4|mov|m4v|avi|mkv|webm)(\?|$)/i.test(String(url))
    }))
    const content = String(payload.content || '').replace(/\s*\[(图片|视频)\]\s*$/, '').trim()
    // actorUserId>0 才是真实用户：头像可进入其主页；匿名形象与占位用户不可点击
    const actorUserId = Number(payload.actorUserId) || 0
    this.setData({
      postId: options.id || '',
      actorNick: nick,
      actorAvatar: payload.avatar || '',
      actorUserId,
      canViewProfile: actorUserId > 0,
      content,
      mediaItems,
      // 图片 URL 列表：长按识别菜单里"预览大图"使用
      mediaUrls: mediaItems.filter((m) => !m.video).map((m) => m.url),
      time: payload.time || '',
      actionTitle,
      postTitle: payload.postTitle || ''
    })
    this.loadPost()
  },

  onActorProfile() {
    if (!this.data.canViewProfile) return
    wx.navigateTo({ url: '/pages/profile/index?id=' + this.data.actorUserId })
  },

  onPreviewMedia(e) {
    const url = e.currentTarget.dataset.url
    const urls = this.data.mediaItems.filter((m) => !m.video).map((m) => m.url)
    if (!url || !urls.length) return
    wx.previewImage({ current: url, urls })
  },

  // 长按评论图片：统一二维码识别菜单（识别 / 预览）
  onImageQrScan(e) {
    const { url, urls } = e.currentTarget.dataset
    qr.recognize(url, urls)
  },

  loadPost() {
    if (!this.data.postId) {
      this.setData({ loading: false })
      return
    }
    api.getPostDetail(this.data.postId).then((post) => {
      this.setData({
        post,
        postTimeText: format.formatRelativeTime(post.createdAt) || '刚刚',
        loading: false
      })
    }).catch(() => this.setData({ loading: false }))
  },

  viewOriginalPost() {
    if (!this.data.postId) return
    wx.navigateTo({ url: '/pages/post-detail/index?id=' + this.data.postId })
  }
})
