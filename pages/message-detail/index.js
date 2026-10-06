const request = require('../../utils/request')
const format = require('../../utils/format')
const api = require('../../utils/api')
const avatar = require('../../utils/avatar')
const qr = require('../../utils/qr')

Page({
  data: {
    postId: '',
    actorNick: '',
    actorAvatar: '',
    // 头像加载失败标记：防止兜底后的路径再次报错时陷入「失败→替换→失败」循环
    actorAvatarFailed: false,
    content: '',
    mediaItems: [],
    time: '',
    actionTitle: '',
    postTitle: '',
    post: null,
    postTimeText: '',
    loading: true,
    // 原帖不可用（被删除/下架/加载失败）：用于给出准确文案并禁用「查看原帖」入口
    postMissing: false,
    postMissingText: ''
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
    this.setData({
      postId: options.id || '',
      actorNick: nick,
      actorAvatar: payload.avatar || '',
      content,
      mediaItems,
      // 图片 URL 列表：长按识别菜单里"预览大图"使用
      mediaUrls: mediaItems.filter((m) => !m.video).map((m) => m.url),
      time: payload.time || '',
      actionTitle,
      postTitle: payload.postTitle || '',
      // 来源评论 id：查看原帖时直接定位到该条评论/回复
      commentId: Number(payload.sourceCommentId) || 0
    })
    this.loadPost()
  },

  // 头像加载失败兜底：通知快照里的历史脏路径（不存在的内置素材名）会让渲染层
  // 反复报「Failed to load image」并留下空白头像，这里就地换成可用头像
  onAvatarError() {
    if (this.data.actorAvatarFailed) return
    const broken = String(this.data.actorAvatar || '')
    // 匿名形象换成素材池内的稳定形象，其余换默认头像
    const fallback = avatar.looksAnonymousAvatar(broken)
      ? avatar.pickAnonymousAvatar(this.data.actorNick || broken)
      : '/assets/icons/avatar.png'
    if (!fallback || fallback === broken) return
    this.setData({ actorAvatarFailed: true, actorAvatar: fallback })
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
      this.setData({ loading: false, postMissing: true, postMissingText: '原帖信息不可用' })
      return
    }
    api.getPostDetail(this.data.postId).then((post) => {
      this.setData({
        post,
        postTimeText: format.formatRelativeTime(post.createdAt) || '刚刚',
        loading: false,
        postMissing: false,
        postMissingText: ''
      })
    }).catch((err) => {
      // 帖子可能已被作者删除或审核下架（详情接口 404）。此前只关掉 loading：
      // 页面停在「暂无法查看」，而「查看原帖」仍然可点 —— 点进去又是一个 404，
      // 用户白屏一次后仍不知道发生了什么（截图里的 /post/34、/post/44 404 就是这个）。
      // 这里区分「不存在」与「加载失败」，并禁用入口。
      const notFound = Number(err && err.statusCode) === 404
      this.setData({
        loading: false,
        postMissing: true,
        postMissingText: notFound ? '原帖已被删除或下架' : '原帖加载失败，请稍后重试'
      })
    })
  },

  viewOriginalPost() {
    if (!this.data.postId) {
      wx.showToast({ title: this.data.postMissingText || '原帖信息不可用', icon: 'none' })
      return
    }
    // 已确认原帖不存在时不再跳转：目标页同样会 404，只会再多一次空白
    if (this.data.postMissing) {
      wx.showToast({ title: this.data.postMissingText || '原帖已不存在', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/post-detail/index?id=' + this.data.postId +
        (this.data.commentId ? '&commentId=' + this.data.commentId : ''),
      fail: () => wx.showToast({ title: '打开原帖失败，请稍后重试', icon: 'none' })
    })
  }
})
