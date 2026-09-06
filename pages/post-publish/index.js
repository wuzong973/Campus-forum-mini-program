const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const imageUtil = require('../../utils/image')
const request = require('../../utils/request')
const api = require('../../utils/api')
const anonymousIdentity = require('../../utils/anonymousIdentity')
const { runPullDownRefresh } = require('../../utils/refresh')
const PUBLISH_DRAFT_KEY = 'post_publish_draft'
const PENDING_POST_KEY = 'home_pending_post'

// 发布页顶部轮播横幅：管理后台未配置时的本地默认（可在后台「内容配置-发布横幅」维护）
const DEFAULT_PUBLISH_BANNERS = [
  { id: 'default-1', text: '禁止引导私下交易，违规封禁！', icon: '🚫', style: 'red' },
  { id: 'default-2', text: '吃好喝好没烦恼。', icon: '😄', style: 'green' }
]

function newPoll() { return { id: Date.now() + Math.floor(Math.random() * 1000), question: '', mode: 'single', options: [{ value: '' }, { value: '' }] } }

Page({
  data: {
    categories: ['日常话题', '表白交友', '二手闲置', '失物寻物', '树洞吐槽', '组队拼车'], categoryIndex: -1, tempCategoryIndex: -1,
    title: '', content: '', images: [], mediaList: [], canSubmit: false, showTagPicker: false, showContactSheet: false, showComponentSheet: false, componentEditor: '',
    contactName: '', contactType: '手机号码', contactTypes: ['手机号码', '微信账号', 'QQ账号'], contactValue: '', contactSummary: '方便其他同学联系',
    secondIdentity: false, anonymousPreview: null, polls: [], poll: null, submitting: false, lastSubmitPayload: null, submitError: '',
    allowAnonymousPm: true,
    publishBanners: DEFAULT_PUBLISH_BANNERS.slice()
  },
  onLoad() {
    if (!auth.requirePublishReady()) { setTimeout(() => wx.navigateBack(), 500); return }
    this.loadPublishBanners()
    const restored = this.restoreDraft()
    if (!restored) {
      const settings = wx.getStorageSync('system_settings') || {}
      if (settings.postAnonymous) this.setData({ secondIdentity: true, anonymousPreview: anonymousIdentity.generate() })
    }
    this.loadAllowAnonymousPm()
    // 进入发布页先弹出主题分类选择，可选可不选，关闭后也可在下方"主题分类"里再选
    this.openTagPicker()
  },
  // ===== 顶部轮播横幅 =====
  loadPublishBanners() {
    api.getHomeConfig().then((config) => {
      const list = (config.publishBanners || []).map((b, i) => ({
        id: b.id || 'b' + i,
        text: b.text,
        style: b.style || 'red',
        icon: b.icon || ''
      }))
      if (list.length) this.setData({ publishBanners: list })
    }).catch(() => {})
  },
  onClosePublishBanner(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.publishBanners.slice()
    list.splice(index, 1)
    this.setData({ publishBanners: list })
  },
  // 「允许被匿名私信」是账号级设置（不是草稿的一部分），以服务端为准
  loadAllowAnonymousPm() {
    const cached = (getApp().globalData.userInfo || {}).allowAnonymousPm
    if (typeof cached === 'boolean') this.setData({ allowAnonymousPm: cached })
    if (request.USE_MOCK) return
    request.get('/user/info', {}, true, { silent: true }).then((info) => {
      const allowed = info ? !!info.allowAnonymousPm : true
      this.setData({ allowAnonymousPm: allowed })
      const user = getApp().globalData.userInfo
      if (user && user.id) {
        user.allowAnonymousPm = allowed
        wx.setStorageSync('userInfo', user)
      }
    }).catch(() => {})
  },
  onAllowAnonymousPmChange(e) {
    const allowed = !!e.detail.value
    const previous = this.data.allowAnonymousPm
    this.setData({ allowAnonymousPm: allowed })
    if (request.USE_MOCK) return
    request.put('/user/info', { allowAnonymousPm: allowed ? 1 : 0 }, true, { silent: true }).then(() => {
      const user = getApp().globalData.userInfo
      if (user && user.id) {
        user.allowAnonymousPm = allowed
        wx.setStorageSync('userInfo', user)
      }
      wx.showToast({ title: allowed ? '已允许匿名私信' : '已拒绝匿名私信', icon: 'none' })
    }).catch((err) => {
      this.setData({ allowAnonymousPm: previous })
      wx.showToast({ title: err.message || '设置失败', icon: 'none' })
    })
  },
  restoreDraft() {
    const draft = wx.getStorageSync(PUBLISH_DRAFT_KEY); if (!draft) return false
    const mediaList = draft.mediaList || []
    // 兼容旧草稿：单投票对象迁移为组件列表
    const polls = Array.isArray(draft.polls) ? draft.polls : (draft.poll ? [draft.poll] : [])
    this.setData({
      title: draft.title || '', content: draft.content || '', categoryIndex: draft.categoryIndex === undefined ? -1 : draft.categoryIndex, mediaList, images: mediaList.map((item) => item.path),
      contactName: draft.contactName || '', contactType: draft.contactType || '手机号码', contactValue: draft.contactValue || '', contactSummary: draft.contactName && draft.contactValue ? draft.contactName + ' · ' + (draft.contactType || '手机号码') : '方便其他同学联系',
      secondIdentity: !!draft.secondIdentity, anonymousPreview: draft.anonymousPreview || null, polls, poll: null,
      canSubmit: (!!((draft.content || '').trim()) || mediaList.length > 0) && draft.categoryIndex >= 0
    })
    return true
  },
  // 发布条件：有文字或有图片，且已选主题分类
  refreshCanSubmit() {
    const hasContent = !!this.data.content.trim()
    const hasMedia = this.data.mediaList.length > 0
    this.setData({ canSubmit: (hasContent || hasMedia) && this.data.categoryIndex >= 0 })
  },
  saveDraft() { const { title, content, categoryIndex, mediaList, contactName, contactType, contactValue, secondIdentity, anonymousPreview, polls } = this.data; wx.setStorageSync(PUBLISH_DRAFT_KEY, { title, content, categoryIndex, mediaList, contactName, contactType, contactValue, secondIdentity, anonymousPreview, polls, ts: Date.now() }) },
  goBack() { wx.navigateBack() }, noop() {},
  onTitleInput(e) { this.setData({ title: e.detail.value }); this.saveDraft() },
  onInput(e) { const content = e.detail.value; this.setData({ content }); this.saveDraft(); this.refreshCanSubmit() },
  openTagPicker() { this.setData({ showTagPicker: true, tempCategoryIndex: this.data.categoryIndex }) }, closeTagPicker() { this.setData({ showTagPicker: false }) },
  openContactSheet() { this.setData({ showContactSheet: true }) }, closeContactSheet() { this.setData({ showContactSheet: false }) },
  openComponentSheet() {
    if (this.data.polls.length >= 3) { wx.showToast({ title: '最多可添加3个组件', icon: 'none' }); return }
    this.setData({ showComponentSheet: true })
  }, closeComponentSheet() { this.setData({ showComponentSheet: false }) },
  closeAllSheets() { this.setData({ showTagPicker: false, showContactSheet: false, showComponentSheet: false, componentEditor: '' }) },
  updateContactSummary() { const { contactName, contactType, contactValue } = this.data; this.setData({ contactSummary: contactName && contactValue ? contactName + ' · ' + contactType : '方便其他同学联系' }) },
  onContactNameInput(e) { this.setData({ contactName: e.detail.value }, () => { this.updateContactSummary(); this.saveDraft() }) },
  onContactTypeSelect(e) { this.setData({ contactType: e.currentTarget.dataset.value }, () => { this.updateContactSummary(); this.saveDraft() }) },
  onContactValueInput(e) { this.setData({ contactValue: e.detail.value }, () => { this.updateContactSummary(); this.saveDraft() }) },
  confirmContact() { if (!this.data.contactName.trim() || !this.data.contactValue.trim()) { wx.showToast({ title: '请填写联系人和联系方式', icon: 'none' }); return }; this.updateContactSummary(); this.setData({ showContactSheet: false }) },
  onSecondIdentityChange(e) { const secondIdentity = !!e.detail.value; this.setData({ secondIdentity, anonymousPreview: secondIdentity ? anonymousIdentity.generate() : null }); this.saveDraft(); wx.showToast({ title: secondIdentity ? '已开启匿名发布' : '已切换为公开发布', icon: 'none' }) },
  openComponentEditor(e) {
    const type = e.currentTarget.dataset.type
    if (this.data.polls.length >= 3) { wx.showToast({ title: '最多可添加3个组件', icon: 'none' }); return }
    this.setData({ showComponentSheet: false, componentEditor: type, poll: type === 'poll' ? newPoll() : this.data.poll })
  },
  closeComponentEditor() { this.setData({ componentEditor: '' }) },
  saveComponentEditor() {
    if (this.data.componentEditor === 'poll') {
      if (!this.isPollValid()) { wx.showToast({ title: '请填写投票问题和至少两个选项', icon: 'none' }); return }
      this.setData({ polls: this.data.polls.concat(this.data.poll), poll: null })
    }
    this.setData({ componentEditor: '' }); this.saveDraft()
  },
  removeComponent(e) {
    if (e.currentTarget.dataset.type === 'poll') {
      const polls = this.data.polls.slice(); polls.splice(Number(e.currentTarget.dataset.index), 1); this.setData({ polls })
    }
    this.saveDraft()
  },
  onPollQuestionInput(e) { this.setData({ 'poll.question': e.detail.value }) }, onPollOptionInput(e) { this.setData({ ['poll.options[' + e.currentTarget.dataset.index + '].value']: e.detail.value }) },
  addPollOption() { if (this.data.poll.options.length < 8) this.setData({ 'poll.options': this.data.poll.options.concat({ value: '' }) }) },
  removePollOption(e) { if (this.data.poll.options.length <= 2) return; const options = this.data.poll.options.slice(); options.splice(e.currentTarget.dataset.index, 1); this.setData({ 'poll.options': options }) },
  setPollMode(e) { this.setData({ 'poll.mode': e.currentTarget.dataset.mode }) },
  isPollValid() { const poll = this.data.poll || {}; return !!poll.question.trim() && poll.options.filter((item) => item.value.trim()).length >= 2 },
  openRules() { wx.navigateTo({ url: '/pages/rules/index' }) }, onTempTagSelect(e) { this.setData({ tempCategoryIndex: e.currentTarget.dataset.index }) },
  confirmTag() { this.setData({ categoryIndex: this.data.tempCategoryIndex, showTagPicker: false }); this.refreshCanSubmit(); this.saveDraft() },
  onChooseImage() { imageUtil.chooseAndCompress(9 - this.data.mediaList.length).then((files) => { const mediaList = this.data.mediaList.concat(files); this.setData({ mediaList, images: mediaList.map((item) => item.path) }); this.saveDraft(); this.refreshCanSubmit() }).catch(() => {}) },
  onRemoveImage(e) { const mediaList = this.data.mediaList.slice(); mediaList.splice(e.currentTarget.dataset.index, 1); this.setData({ mediaList, images: mediaList.map((item) => item.path) }); this.saveDraft(); this.refreshCanSubmit() },
  buildComponents() {
    return this.data.polls.map((poll) => ({ type: 'poll', question: poll.question.trim(), mode: poll.mode, options: poll.options.filter((item) => item.value.trim()).map((item) => ({ text: item.value.trim(), votes: 0 })), voterIds: [] }))
  },
  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    if (!auth.requirePublishReady()) return
    const content = this.data.content.trim()
    // 纯图片/视频帖子允许无文字内容
    if (!content && !this.data.mediaList.length) { wx.showToast({ title: '请输入内容或上传图片', icon: 'none' }); return }
    if (this.data.categoryIndex < 0) { wx.showToast({ title: '请选择标签', icon: 'none' }); return }
    if (this.data.polls.some((poll) => !poll.question.trim() || poll.options.filter((item) => item.value.trim()).length < 2)) { wx.showToast({ title: '请完善投票组件', icon: 'none' }); return }
    this.setData({ submitting: true }); wx.showLoading({ title: '发布中...', mask: true })
    try {
      if (content) await wechat.checkContent(content)
      let imageUrls = this.data.mediaList.filter((item) => item.type !== 'video').map((item) => item.path); const videoUrls = this.data.mediaList.filter((item) => item.type === 'video').map((item) => item.path)
      if (imageUrls.length && !request.USE_MOCK) imageUrls = await wechat.uploadImages(imageUrls)
      const anonymous = this.data.secondIdentity ? (this.data.anonymousPreview || anonymousIdentity.generate()) : null
      const payload = { title: this.data.title.trim(), category: this.data.categories[this.data.categoryIndex], content, images: imageUrls, videos: videoUrls, components: this.buildComponents(), anonymousIdentity: anonymous, contact: this.data.contactName && this.data.contactValue ? { name: this.data.contactName.trim(), type: this.data.contactType, value: this.data.contactValue.trim() } : null }
      this.setData({ lastSubmitPayload: payload, submitError: '' })
      if (!request.USE_MOCK) await request.post('/post', payload, true)
      else { const mock = require('../../utils/mock'); const user = getApp().globalData.userInfo || {}; const newPost = { id: Date.now(), userId: user.id || 0, nickName: anonymous ? anonymous.nickName : (user.nickName || '我'), avatarUrl: anonymous ? anonymous.avatarUrl : (user.avatarUrl || ''), campus: anonymous ? '' : (user.campus || ''), title: payload.title, category: payload.category, content, images: imageUrls, components: payload.components, viewCount: 0, likeCount: 0, commentCount: 0, favoriteCount: 0, isLiked: false, isFavorited: false, contact: payload.contact, isAnonymous: !!anonymous, createdAt: new Date().toISOString() }; mock.posts.unshift(newPost); wx.setStorageSync(PENDING_POST_KEY, newPost) }
      wx.removeStorageSync(PUBLISH_DRAFT_KEY); wx.hideLoading(); wx.showToast({ title: '发布成功', icon: 'success' }); setTimeout(() => wx.navigateBack(), 1000)
    } catch (e) { wx.hideLoading(); this.setData({ submitError: e.message || '发布失败，请稍后重试' }); wx.showToast({ title: e.message || '发布失败', icon: 'none' }) } finally { this.setData({ submitting: false }) }
  },
  onRetrySubmit() { if (!this.data.submitting) this.onSubmit() },
  onPullDownRefresh() { runPullDownRefresh(this) }
})
