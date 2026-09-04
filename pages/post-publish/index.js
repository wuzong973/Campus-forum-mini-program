const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const imageUtil = require('../../utils/image')
const request = require('../../utils/request')
const anonymousIdentity = require('../../utils/anonymousIdentity')
const { runPullDownRefresh } = require('../../utils/refresh')
const PUBLISH_DRAFT_KEY = 'post_publish_draft'
const PENDING_POST_KEY = 'home_pending_post'

function newPoll() { return { question: '', mode: 'single', options: [{ value: '' }, { value: '' }] } }
function newGathering() { return { type: '聚餐', customType: '', date: '', time: '', location: '', limit: 4, contact: '', contactPublic: false, description: '', participants: [] } }

Page({
  data: {
    categories: ['日常话题', '表白交友', '二手闲置', '失物寻物', '树洞吐槽', '组队拼车'], categoryIndex: -1, tempCategoryIndex: -1,
    title: '', content: '', images: [], mediaList: [], canSubmit: false, showTagPicker: false, showContactSheet: false, showComponentSheet: false, componentEditor: '',
    contactName: '', contactType: '手机号码', contactTypes: ['手机号码', '微信账号', 'QQ账号'], contactValue: '', contactSummary: '方便其他同学联系',
    secondIdentity: false, anonymousPreview: null, poll: null, gathering: null, activityTypes: ['聚餐', '运动', '电影', '旅行', '学习', '其他'], submitting: false, lastSubmitPayload: null, submitError: ''
  },
  onLoad() { if (!auth.requirePublishReady()) { setTimeout(() => wx.navigateBack(), 500); return }; this.restoreDraft() },
  restoreDraft() {
    const draft = wx.getStorageSync(PUBLISH_DRAFT_KEY); if (!draft) return
    this.setData({
      title: draft.title || '', content: draft.content || '', categoryIndex: draft.categoryIndex === undefined ? -1 : draft.categoryIndex, mediaList: draft.mediaList || [], images: (draft.mediaList || []).map((item) => item.path),
      contactName: draft.contactName || '', contactType: draft.contactType || '手机号码', contactValue: draft.contactValue || '', contactSummary: draft.contactName && draft.contactValue ? draft.contactName + ' · ' + (draft.contactType || '手机号码') : '方便其他同学联系',
      secondIdentity: !!draft.secondIdentity, anonymousPreview: draft.anonymousPreview || null, poll: draft.poll || null, gathering: draft.gathering || null, canSubmit: !!(draft.content && draft.content.trim() && draft.categoryIndex >= 0)
    })
  },
  saveDraft() { const { title, content, categoryIndex, mediaList, contactName, contactType, contactValue, secondIdentity, anonymousPreview, poll, gathering } = this.data; wx.setStorageSync(PUBLISH_DRAFT_KEY, { title, content, categoryIndex, mediaList, contactName, contactType, contactValue, secondIdentity, anonymousPreview, poll, gathering, ts: Date.now() }) },
  goBack() { wx.navigateBack() }, noop() {},
  onTitleInput(e) { this.setData({ title: e.detail.value }); this.saveDraft() },
  onInput(e) { const content = e.detail.value; this.setData({ content, canSubmit: content.trim().length > 0 && this.data.categoryIndex >= 0 }); this.saveDraft() },
  openTagPicker() { this.setData({ showTagPicker: true, tempCategoryIndex: this.data.categoryIndex }) }, closeTagPicker() { this.setData({ showTagPicker: false }) },
  openContactSheet() { this.setData({ showContactSheet: true }) }, closeContactSheet() { this.setData({ showContactSheet: false }) },
  openComponentSheet() { this.setData({ showComponentSheet: true }) }, closeComponentSheet() { this.setData({ showComponentSheet: false }) },
  closeAllSheets() { this.setData({ showTagPicker: false, showContactSheet: false, showComponentSheet: false, componentEditor: '' }) },
  updateContactSummary() { const { contactName, contactType, contactValue } = this.data; this.setData({ contactSummary: contactName && contactValue ? contactName + ' · ' + contactType : '方便其他同学联系' }) },
  onContactNameInput(e) { this.setData({ contactName: e.detail.value }, () => { this.updateContactSummary(); this.saveDraft() }) },
  onContactTypeSelect(e) { this.setData({ contactType: e.currentTarget.dataset.value }, () => { this.updateContactSummary(); this.saveDraft() }) },
  onContactValueInput(e) { this.setData({ contactValue: e.detail.value }, () => { this.updateContactSummary(); this.saveDraft() }) },
  confirmContact() { if (!this.data.contactName.trim() || !this.data.contactValue.trim()) { wx.showToast({ title: '请填写联系人和联系方式', icon: 'none' }); return }; this.updateContactSummary(); this.setData({ showContactSheet: false }) },
  onSecondIdentityChange(e) { const secondIdentity = !!e.detail.value; this.setData({ secondIdentity, anonymousPreview: secondIdentity ? anonymousIdentity.generate() : null }); this.saveDraft(); wx.showToast({ title: secondIdentity ? '已开启匿名发布' : '已切换为公开发布', icon: 'none' }) },
  openComponentEditor(e) {
    const type = e.currentTarget.dataset.type
    if (type === 'poll' && this.data.poll) { wx.showToast({ title: '每篇帖子只能添加一个投票', icon: 'none' }); return }
    if (type === 'gathering' && this.data.gathering) { wx.showToast({ title: '每篇帖子只能添加一个组局', icon: 'none' }); return }
    this.setData({ showComponentSheet: false, componentEditor: type, poll: type === 'poll' ? newPoll() : this.data.poll, gathering: type === 'gathering' ? newGathering() : this.data.gathering })
  },
  closeComponentEditor() { this.setData({ componentEditor: '' }) },
  saveComponentEditor() { if (this.data.componentEditor === 'poll' && !this.isPollValid()) { wx.showToast({ title: '请填写投票问题和至少两个选项', icon: 'none' }); return }; if (this.data.componentEditor === 'gathering' && !this.isGatheringValid()) { wx.showToast({ title: '请填写组局的日期、时间和地点', icon: 'none' }); return }; this.setData({ componentEditor: '' }); this.saveDraft() },
  removeComponent(e) { this.setData({ [e.currentTarget.dataset.type]: null }); this.saveDraft() },
  onPollQuestionInput(e) { this.setData({ 'poll.question': e.detail.value }) }, onPollOptionInput(e) { this.setData({ ['poll.options[' + e.currentTarget.dataset.index + '].value']: e.detail.value }) },
  addPollOption() { if (this.data.poll.options.length < 8) this.setData({ 'poll.options': this.data.poll.options.concat({ value: '' }) }) },
  removePollOption(e) { if (this.data.poll.options.length <= 2) return; const options = this.data.poll.options.slice(); options.splice(e.currentTarget.dataset.index, 1); this.setData({ 'poll.options': options }) },
  setPollMode(e) { this.setData({ 'poll.mode': e.currentTarget.dataset.mode }) },
  isPollValid() { const poll = this.data.poll || {}; return !!poll.question.trim() && poll.options.filter((item) => item.value.trim()).length >= 2 },
  onGatheringType(e) { this.setData({ 'gathering.type': e.currentTarget.dataset.value }) }, onGatheringInput(e) { this.setData({ ['gathering.' + e.currentTarget.dataset.field]: e.detail.value }) }, onGatheringLimitChange(e) { this.setData({ 'gathering.limit': Math.max(2, Number(e.detail.value) || 2) }) }, onGatheringContactPublic(e) { this.setData({ 'gathering.contactPublic': !!e.detail.value }) },
  isGatheringValid() { const g = this.data.gathering || {}; return !!(g.date && g.time && g.location && (g.type !== '其他' || g.customType.trim())) },
  openRules() { wx.navigateTo({ url: '/pages/rules/index' }) }, onTempTagSelect(e) { this.setData({ tempCategoryIndex: e.currentTarget.dataset.index }) },
  confirmTag() { const categoryIndex = this.data.tempCategoryIndex; this.setData({ categoryIndex, canSubmit: this.data.content.trim().length > 0 && categoryIndex >= 0, showTagPicker: false }); this.saveDraft() },
  onChooseImage() { imageUtil.chooseAndCompress(9 - this.data.mediaList.length).then((files) => { const mediaList = this.data.mediaList.concat(files); this.setData({ mediaList, images: mediaList.map((item) => item.path) }); this.saveDraft() }).catch(() => {}) },
  onRemoveImage(e) { const mediaList = this.data.mediaList.slice(); mediaList.splice(e.currentTarget.dataset.index, 1); this.setData({ mediaList, images: mediaList.map((item) => item.path) }); this.saveDraft() },
  buildComponents() {
    const components = []
    if (this.data.poll) components.push({ type: 'poll', question: this.data.poll.question.trim(), mode: this.data.poll.mode, options: this.data.poll.options.filter((item) => item.value.trim()).map((item) => ({ text: item.value.trim(), votes: 0 })), voterIds: [] })
    if (this.data.gathering) { const g = this.data.gathering; components.push({ type: 'gathering', activityType: g.type === '其他' ? g.customType.trim() : g.type, date: g.date, time: g.time, location: g.location.trim(), limit: Number(g.limit), contact: g.contactPublic ? g.contact.trim() : '', contactPublic: !!g.contactPublic, description: g.description.trim(), participants: [] }) }
    return components
  },
  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    if (!auth.requirePublishReady()) return
    const content = this.data.content.trim()
    if (!content) { wx.showToast({ title: '请输入内容', icon: 'none' }); return }; if (this.data.categoryIndex < 0) { wx.showToast({ title: '请选择标签', icon: 'none' }); return }
    if (this.data.poll && !this.isPollValid()) { wx.showToast({ title: '请完善投票组件', icon: 'none' }); return }; if (this.data.gathering && !this.isGatheringValid()) { wx.showToast({ title: '请完善组局组件', icon: 'none' }); return }
    this.setData({ submitting: true }); wx.showLoading({ title: '发布中...', mask: true })
    try {
      await wechat.checkContent(content)
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
