const auth = require('../../utils/auth')
const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')

const MOCK_KEY = 'public_feedback'

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    feedbacks: [],
    page: 1,
    hasMore: true,
    loading: false,
    scrollTop: 0,
    showForm: false,
    feedbackType: '功能建议',
    feedbackContent: '',
    contact: '',
    images: [],
    submitting: false,
    typeList: ['功能建议', 'Bug反馈', '体验优化', '其他问题'],
    isAdmin: false,
    currentUserId: 0,
    editingId: null,
    expandedId: null,
    replyDraft: '',
    editingReplyId: null,
    replySubmitting: false,
    // 用户评论编辑器：commentEditorId 为正在评论的意见 id
    commentEditorId: null,
    commentReplyTo: 0,
    commentTargetNick: '',
    commentDraft: '',
    commentSubmitting: false
  },

  onLoad() {
    const app = getApp()
    const userInfo = (app.globalData || {}).userInfo || wx.getStorageSync('userInfo') || {}
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      isAdmin: ['super_admin', 'content_admin'].indexOf(userInfo.role) > -1,
      currentUserId: Number(userInfo.id || 0)
    })
    this.loadFeedbacks(true)
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadFeedbacks(true))
  },

  onReachBottom() { this.loadFeedbacks(false) },

  onScroll(e) { this.currentScrollTop = (e.detail && e.detail.scrollTop) || 0 },

  loadFeedbacks(reset) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return Promise.resolve()
    const page = reset ? 1 : this.data.page
    this.setData({ loading: true })
    if (request.USE_MOCK) {
      const list = (wx.getStorageSync(MOCK_KEY) || []).map((item) => this.formatFeedback(item))
      this.setData({ feedbacks: list, page: 2, hasMore: false, loading: false })
      return Promise.resolve()
    }
    return request.get('/feedback', { page, pageSize: 20 }, false, { silent: true })
      .then((data) => {
        const list = (data.list || []).map((item) => this.formatFeedback(item))
        this.setData({
          feedbacks: reset ? list : this.data.feedbacks.concat(list),
          page: page + 1,
          hasMore: !!data.hasMore,
          loading: false
        })
      })
      .catch(() => this.setData({ loading: false }))
  },

  formatComment(comment) {
    return {
      id: comment.id,
      userId: comment.userId,
      nickName: comment.nickName || '校园同学',
      replyToNick: comment.replyToNick || '',
      content: comment.content || '',
      timeText: format.formatRelativeTime(comment.createdAt) || '刚刚'
    }
  },

  formatFeedback(item) {
    return Object.assign({}, item, {
      avatarUrl: item.avatarUrl || '/assets/icons/avatar.png',
      nickName: item.nickName || '校园同学',
      images: Array.isArray(item.images) ? item.images : [],
      timeText: format.formatRelativeTime(item.createdAt) || '刚刚',
      // resolved 仅由管理员显式「已解决」产生；管理员回复后未标记前为已回复
      statusText: item.status === 'resolved' ? '已解决' : item.status === 'replied' ? '已回复' : item.status === 'processing' ? '处理中' : item.status === 'closed' ? '已关闭' : '待回复',
      reply: item.reply || '',
      replyNickName: item.replyNickName || '管理员',
      replyTimeText: item.replyAt ? (format.formatRelativeTime(item.replyAt) || '') : '',
      comments: (item.comments || []).map((comment) => this.formatComment(comment)),
      commentCount: item.commentCount || (item.comments ? item.comments.length : 0),
      // 自己的意见（编辑+删除）或管理员（删除他人意见）才显示右上角菜单
      canManage: this.data.isAdmin || Number(item.userId) === Number(this.data.currentUserId),
      // 回复者本人才显示回复的编辑/删除入口
      canManageReply: this.data.isAdmin && Number(item.replyUserId) === Number(this.data.currentUserId)
    })
  },

  // ===== 意见右上角「···」菜单：已解决（管理员）/ 编辑 / 删除 =====

  onCardMore(e) {
    const id = e.currentTarget.dataset.id
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(id))
    if (!feedback) return
    const isOwn = Number(feedback.userId) === Number(this.data.currentUserId)
    const itemList = []
    const actions = []
    if (this.data.isAdmin) {
      itemList.push(feedback.status === 'resolved' ? '取消已解决' : '已解决')
      actions.push('resolved')
    }
    if (isOwn) {
      itemList.push('编辑')
      actions.push('edit')
    }
    itemList.push('删除')
    actions.push('delete')
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const action = actions[res.tapIndex]
        if (action === 'resolved') {
          this.toggleResolved(feedback)
        } else if (action === 'edit') {
          this.openEdit(feedback)
        } else if (action === 'delete') {
          this.deleteFeedback(feedback)
        }
      }
    })
  },

  // 管理员标记已解决/取消解决，卡片右上角徽标随之切换
  toggleResolved(feedback) {
    const target = feedback.status === 'resolved' ? 'pending' : 'resolved'
    const apply = () => {
      const feedbacks = this.data.feedbacks.map((item) => (
        String(item.id) === String(feedback.id)
          ? this.formatFeedback(Object.assign({}, item, { status: target }))
          : item
      ))
      this.setData({ feedbacks })
      wx.showToast({ title: target === 'resolved' ? '已标记为已解决' : '已取消解决', icon: 'success' })
    }
    if (request.USE_MOCK) {
      const list = (wx.getStorageSync(MOCK_KEY) || []).map((item) => (
        String(item.id) === String(feedback.id) ? Object.assign({}, item, { status: target }) : item
      ))
      wx.setStorageSync(MOCK_KEY, list)
      apply()
      return
    }
    request.put('/feedback/' + feedback.id + '/status', { status: target }, true, { showLoading: '处理中...' })
      .then(apply)
      .catch((error) => wx.showToast({ title: error.message || '操作失败，请稍后重试', icon: 'none' }))
  },

  openEdit(feedback) {
    this.setData({
      editingId: feedback.id,
      showForm: true,
      feedbackType: feedback.type || '功能建议',
      feedbackContent: feedback.content || '',
      images: (feedback.images || []).slice()
    })
  },

  deleteFeedback(feedback) {
    wx.showModal({
      title: '删除意见',
      content: '删除后将从意见墙移除，确认删除这条意见吗？',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        if (request.USE_MOCK) {
          wx.setStorageSync(MOCK_KEY, (wx.getStorageSync(MOCK_KEY) || []).filter((item) => String(item.id) !== String(feedback.id)))
          this.setData({ feedbacks: this.data.feedbacks.filter((item) => String(item.id) !== String(feedback.id)) })
          wx.showToast({ title: '已删除', icon: 'success' })
          return
        }
        request.del('/feedback/' + feedback.id, {}, true).then(() => {
          this.setData({ feedbacks: this.data.feedbacks.filter((item) => String(item.id) !== String(feedback.id)) })
          wx.showToast({ title: '已删除', icon: 'success' })
        }).catch((error) => {
          wx.showToast({ title: error.message || '删除失败，请稍后重试', icon: 'none' })
        })
      }
    })
  },

  // ===== 评论与回复：点击意见卡评论，点击评论/管理员回复进行回复 =====

  openCommentEditor(feedbackId, replyTo, targetNick) {
    this.setData({
      commentEditorId: feedbackId,
      commentReplyTo: replyTo || 0,
      commentTargetNick: targetNick || '',
      commentDraft: '',
      expandedId: null,
      editingReplyId: null,
      replyDraft: ''
    })
  },

  // 点击意见卡片：直接评论该意见（再次点击收起）
  onFeedbackTap(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.commentEditorId !== null && String(this.data.commentEditorId) === String(id)) {
      this.closeCommentEditor()
      return
    }
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(id))
    if (!feedback) return
    if (!auth.requireLogin('评论前请先登录')) return
    this.openCommentEditor(id, 0, '')
  },

  // 点击某条用户评论：回复该评论
  onCommentTap(e) {
    const { fid, cid, nick } = e.currentTarget.dataset
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(fid))
    if (!feedback) return
    if (!auth.requireLogin('回复前请先登录')) return
    this.openCommentEditor(fid, Number(cid) || 0, nick || '')
  },

  // 点击管理员回复框：回复管理员
  onReplyBoxTap(e) {
    const id = e.currentTarget.dataset.id
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(id))
    if (!feedback || !feedback.reply) return
    if (!auth.requireLogin('回复前请先登录')) return
    this.openCommentEditor(id, 0, feedback.replyNickName || '管理员')
  },

  // 管理员右下角「回复」按钮：展开管理员回复框（已有回复时转为编辑自己的回复）
  onAdminReplyTap(e) {
    const id = e.currentTarget.dataset.id
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(id))
    if (!feedback) return
    if (feedback.reply) {
      if (feedback.canManageReply) {
        this.openReplyEdit(feedback)
      } else {
        wx.showToast({ title: '该意见已由其他管理员回复', icon: 'none' })
      }
      return
    }
    this.setData({
      expandedId: id,
      editingReplyId: null,
      replyDraft: '',
      commentEditorId: null,
      commentReplyTo: 0,
      commentTargetNick: '',
      commentDraft: ''
    })
  },

  onCommentInput(e) { this.setData({ commentDraft: e.detail.value }) },

  closeCommentEditor() {
    this.setData({ commentEditorId: null, commentReplyTo: 0, commentTargetNick: '', commentDraft: '' })
  },

  submitComment() {
    const feedbackId = this.data.commentEditorId
    const content = this.data.commentDraft.trim()
    if (!feedbackId) return
    if (!content) {
      wx.showToast({ title: '说点什么再发送吧', icon: 'none' })
      return
    }
    if (this.data.commentSubmitting) return
    this.setData({ commentSubmitting: true })
    const replyTo = this.data.commentReplyTo || 0
    // 回复评论时昵称由服务端校准；回复管理员回复时带上目标昵称
    const payload = { content, replyTo, replyToNick: replyTo ? '' : (this.data.commentTargetNick || '') }
    const finish = (comment) => {
      const formatted = this.formatComment(comment)
      const feedbacks = this.data.feedbacks.map((item) => (
        String(item.id) === String(feedbackId)
          ? this.formatFeedback(Object.assign({}, item, { comments: (item.comments || []).concat([formatted]), commentCount: (item.commentCount || 0) + 1 }))
          : item
      ))
      this.setData({ feedbacks, commentEditorId: null, commentReplyTo: 0, commentTargetNick: '', commentDraft: '', commentSubmitting: false })
      wx.showToast({ title: '评论已发布', icon: 'success' })
    }
    if (request.USE_MOCK) {
      const user = getApp().globalData.userInfo || {}
      finish({
        id: Date.now(),
        userId: user.id,
        nickName: user.nickName || '校园同学',
        replyToNick: this.data.commentTargetNick || '',
        content,
        createdAt: new Date().toISOString()
      })
      return
    }
    request.post('/feedback/' + feedbackId + '/comments', payload, true, { showLoading: '发布中...' })
      .then(finish)
      .catch((error) => {
        this.setData({ commentSubmitting: false })
        wx.showToast({ title: error.message || '评论失败，请稍后重试', icon: 'none' })
      })
  },

  // 长按删除评论：本人或管理员
  onCommentLongPress(e) {
    const { fid, cid } = e.currentTarget.dataset
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(fid))
    const comment = feedback && (feedback.comments || []).find((item) => String(item.id) === String(cid))
    if (!comment) return
    const canDelete = this.data.isAdmin || Number(comment.userId) === Number(this.data.currentUserId)
    if (!canDelete) return
    wx.showActionSheet({
      itemList: ['删除评论'],
      success: (res) => { if (res.tapIndex === 0) this.deleteComment(feedback, comment) }
    })
  },

  deleteComment(feedback, comment) {
    wx.showModal({
      title: '删除评论',
      content: '删除后所有用户将不再看到这条评论，确认删除吗？',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        const finish = () => {
          const feedbacks = this.data.feedbacks.map((item) => (
            String(item.id) === String(feedback.id)
              ? this.formatFeedback(Object.assign({}, item, {
                  comments: (item.comments || []).filter((c) => String(c.id) !== String(comment.id)),
                  commentCount: Math.max(0, (item.commentCount || 0) - 1)
                }))
              : item
          ))
          this.setData({ feedbacks })
          wx.showToast({ title: '评论已删除', icon: 'success' })
        }
        if (request.USE_MOCK) {
          const list = (wx.getStorageSync(MOCK_KEY) || []).map((item) => (
            String(item.id) === String(feedback.id)
              ? Object.assign({}, item, { comments: (item.comments || []).filter((c) => String(c.id) !== String(comment.id)) })
              : item
          ))
          wx.setStorageSync(MOCK_KEY, list)
          finish()
          return
        }
        request.del('/feedback/comments/' + comment.id, {}, true).then(finish).catch((error) => {
          wx.showToast({ title: error.message || '删除失败，请稍后重试', icon: 'none' })
        })
      }
    })
  },

  // ===== 管理员对自己回复的编辑 / 删除 =====

  onReplyMore(e) {
    const id = e.currentTarget.dataset.id
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(id))
    if (!feedback || !feedback.reply) return
    wx.showActionSheet({
      itemList: ['编辑回复', '删除回复'],
      success: (res) => {
        if (res.tapIndex === 0) this.openReplyEdit(feedback)
        else this.deleteReply(feedback)
      }
    })
  },

  openReplyEdit(feedback) {
    this.setData({
      expandedId: feedback.id,
      editingReplyId: feedback.id,
      replyDraft: feedback.reply || ''
    })
  },

  deleteReply(feedback) {
    wx.showModal({
      title: '删除回复',
      content: '删除后未解决的意见将回到「待回复」状态，确认删除这条回复吗？',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        const finish = () => {
          const feedbacks = this.data.feedbacks.map((item) => (
            String(item.id) === String(feedback.id)
              ? this.formatFeedback(Object.assign({}, item, { reply: '', replyUserId: 0, replyNickName: '', replyAt: null, status: 'pending' }))
              : item
          ))
          this.setData({ feedbacks, expandedId: null, editingReplyId: null, replyDraft: '' })
          wx.showToast({ title: '回复已删除', icon: 'success' })
        }
        if (request.USE_MOCK) {
          const list = (wx.getStorageSync(MOCK_KEY) || []).map((item) => (
            String(item.id) === String(feedback.id)
              ? Object.assign({}, item, { reply: '', replyUserId: 0, replyNickName: '', replyAt: null, status: 'pending' })
              : item
          ))
          wx.setStorageSync(MOCK_KEY, list)
          finish()
          return
        }
        request.del('/feedback/' + feedback.id + '/reply', {}, true).then(finish).catch((error) => {
          wx.showToast({ title: error.message || '删除失败，请稍后重试', icon: 'none' })
        })
      }
    })
  },

  onReplyInput(e) { this.setData({ replyDraft: e.detail.value }) },

  cancelReply() {
    this.setData({ expandedId: null, editingReplyId: null, replyDraft: '' })
  },

  submitReply() {
    const feedbackId = this.data.expandedId
    const content = this.data.replyDraft.trim()
    if (!feedbackId) return
    if (content.length < 2) {
      wx.showToast({ title: '回复内容至少 2 个字', icon: 'none' })
      return
    }
    if (this.data.replySubmitting) return
    this.setData({ replySubmitting: true })
    const isEdit = !!this.data.editingReplyId
    const finish = (result) => {
      const feedbacks = this.data.feedbacks.map((item) => (
        String(item.id) === String(feedbackId)
          ? this.formatFeedback(Object.assign({}, item, {
              reply: result.reply,
              replyNickName: isEdit ? item.replyNickName : result.replyNickName,
              replyAt: result.replyAt,
              // 回复后状态置为已回复；「已解决」仅由管理员显式标记
              status: item.status === 'resolved' ? 'resolved' : 'replied'
            }))
          : item
      ))
      this.setData({ feedbacks, expandedId: null, replyDraft: '', editingReplyId: null, replySubmitting: false })
      wx.showToast({ title: isEdit ? '回复已更新' : '回复已发布', icon: 'success' })
    }
    if (request.USE_MOCK) {
      const list = (wx.getStorageSync(MOCK_KEY) || []).map((item) => (
        String(item.id) === String(feedbackId)
          ? Object.assign({}, item, { reply: content, replyNickName: item.replyNickName || '管理员', replyAt: new Date().toISOString(), status: item.status === 'resolved' ? 'resolved' : 'replied' })
          : item
      ))
      wx.setStorageSync(MOCK_KEY, list)
      finish({ reply: content, replyNickName: '管理员', replyAt: new Date().toISOString() })
      return
    }
    const req = isEdit
      ? request.put('/feedback/' + feedbackId + '/reply', { content }, true, { showLoading: '保存中...' })
      : request.post('/feedback/' + feedbackId + '/reply', { content }, true, { showLoading: '发布中...' })
    req.then(finish).catch((error) => {
      this.setData({ replySubmitting: false })
      wx.showToast({ title: error.message || (isEdit ? '保存失败，请稍后重试' : '回复失败，请稍后重试'), icon: 'none' })
    })
  },

  openForm() {
    if (!auth.requireLogin('填写意见前请先登录')) return
    this.setData({ showForm: true, editingId: null, feedbackType: '功能建议', feedbackContent: '', images: [], contact: '' })
  },

  closeForm() { this.setData({ showForm: false, editingId: null }) },

  onSelectType() {
    wx.showActionSheet({
      itemList: this.data.typeList,
      success: (res) => this.setData({ feedbackType: this.data.typeList[res.tapIndex] })
    })
  },

  onContentInput(e) { this.setData({ feedbackContent: e.detail.value }) },
  onContactInput(e) { this.setData({ contact: e.detail.value }) },

  onChooseImage() {
    const remain = 4 - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => this.setData({ images: this.data.images.concat(res.tempFiles.map((file) => file.tempFilePath)) })
    })
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ images: this.data.images.filter((_, itemIndex) => itemIndex !== index) })
  },

  onPreviewImage(e) {
    const current = e.currentTarget.dataset.url
    const feedback = this.data.feedbacks.find((item) => String(item.id) === String(e.currentTarget.dataset.id))
    const urls = (feedback && feedback.images) || []
    if (current && urls.length) wx.previewImage({ current, urls })
  },

  submitFeedback() {
    const content = this.data.feedbackContent.trim()
    if (content.length < 10) {
      wx.showToast({ title: '意见内容至少 10 个字', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    if (this.data.editingId) {
      this.updateFeedback(content)
      return
    }
    const payload = (images) => ({ type: this.data.feedbackType, content, contact: this.data.contact.trim(), images })
    const finish = (created) => {
      this.setData({
        feedbacks: [this.formatFeedback(created)].concat(this.data.feedbacks),
        feedbackContent: '', contact: '', images: [], showForm: false, submitting: false,
        scrollTop: 0
      })
      wx.showToast({ title: '意见已公开发布', icon: 'success' })
    }
    if (request.USE_MOCK) {
      const user = getApp().globalData.userInfo || {}
      const created = Object.assign({
        id: Date.now(), userId: user.id, images: this.data.images.slice(), status: 'pending', createdAt: new Date().toISOString(),
        nickName: user.nickName || '校园同学', avatarUrl: user.avatarUrl || '/assets/icons/avatar.png'
      }, payload(this.data.images.slice()))
      wx.setStorageSync(MOCK_KEY, [created].concat(wx.getStorageSync(MOCK_KEY) || []))
      finish(created)
      return
    }
    wechat.uploadImages(this.data.images)
      .then((images) => request.post('/feedback', payload(images), true, { showLoading: '发布中...' }).then((result) => ({ result, images })))
      .then(({ result, images }) => {
        const user = getApp().globalData.userInfo || {}
        finish(Object.assign({
          id: result.id, type: this.data.feedbackType, content, images, status: 'pending', createdAt: new Date().toISOString(),
          nickName: user.nickName || '校园同学', avatarUrl: user.avatarUrl || '/assets/icons/avatar.png'
        }, result))
        this.loadFeedbacks(true)
      })
      .catch((error) => {
        this.setData({ submitting: false })
        wx.showToast({ title: error.message || '发布失败，请稍后重试', icon: 'none' })
      })
  },

  // 编辑保存：已有 https 图片直接复用，仅上传新选的本地图；联系方式不在编辑时改动
  updateFeedback(content) {
    const finish = (images) => {
      const feedbacks = this.data.feedbacks.map((item) => (
        String(item.id) === String(this.data.editingId)
          ? this.formatFeedback(Object.assign({}, item, { type: this.data.feedbackType, content, images }))
          : item
      ))
      this.setData({ feedbacks, showForm: false, editingId: null, feedbackContent: '', images: [], submitting: false })
      wx.showToast({ title: '意见已更新', icon: 'success' })
    }
    if (request.USE_MOCK) {
      const list = (wx.getStorageSync(MOCK_KEY) || []).map((item) => (
        String(item.id) === String(this.data.editingId)
          ? Object.assign({}, item, { type: this.data.feedbackType, content, images: this.data.images.slice() })
          : item
      ))
      wx.setStorageSync(MOCK_KEY, list)
      finish(this.data.images.slice())
      return
    }
    const remoteUrls = []
    const localPaths = []
    this.data.images.forEach((url) => { (/^https:\/\//.test(url) ? remoteUrls : localPaths).push(url) })
    const uploadDone = localPaths.length ? wechat.uploadImages(localPaths) : Promise.resolve([])
    uploadDone
      .then((uploaded) => {
        const images = remoteUrls.concat(uploaded)
        return request.put('/feedback/' + this.data.editingId, {
          type: this.data.feedbackType,
          content,
          images
        }, true, { showLoading: '保存中...' }).then(() => images)
      })
      .then(finish)
      .catch((error) => {
        this.setData({ submitting: false })
        wx.showToast({ title: error.message || '保存失败，请稍后重试', icon: 'none' })
      })
  },

  scrollToTop() {
    if (this.currentScrollTop > 0) this.setData({ scrollTop: 0 })
  },
  noop() {},
  goBack() { wx.navigateBack() }
})
