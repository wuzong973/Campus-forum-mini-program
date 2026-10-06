const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const imageUtil = require('../../utils/image')
const request = require('../../utils/request')
const api = require('../../utils/api')
const anonymousIdentity = require('../../utils/anonymousIdentity')
const subscribe = require('../../utils/subscribe')
const { runPullDownRefresh } = require('../../utils/refresh')
const PUBLISH_DRAFT_KEY = 'post_publish_draft'

function newPoll() { return { id: Date.now() + Math.floor(Math.random() * 1000), question: '', mode: 'single', options: [{ value: '' }, { value: '' }] } }

// 与服务端 DATETIME 展示口径一致的当前时间 'YYYY-MM-DD HH:mm:ss'
function formatNow() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' : '') + n
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

Page({
  data: {
    categories: ['日常话题', '表白交友', '二手闲置', '失物寻物', '树洞吐槽', '组队拼车'], categoryIndex: -1, tempCategoryIndex: -1,
    title: '', content: '', images: [], mediaList: [], canSubmit: false, showTagPicker: false, showContactSheet: false, showComponentSheet: false, componentEditor: '',
    contactName: '', contactType: '手机号码', contactTypes: ['手机号码', '微信账号', 'QQ账号'], contactValue: '', contactSummary: '方便其他同学联系',
    secondIdentity: false, anonymousPreview: null, polls: [], poll: null, componentEditIndex: -1, submitting: false, lastSubmitPayload: null, submitError: '',
    allowAnonymousPm: true,
    publishBanners: [],
    // 顶部「订阅评论消息提醒」入口：订阅生效（偏好开启 + 微信侧已授权）后隐藏，
    // 在设置页关闭「评论通知」后重新出现（见 refreshCommentSubscribeEntry）
    showCommentSubscribeEntry: false,
    commentSubscribeChecked: false
  },
  onLoad() {
    if (!auth.requirePublishReady()) { setTimeout(() => wx.navigateBack(), 500); return }
    // 轮播横幅由 onShow 统一拉取（首次进入 onShow 也会触发）
    const restored = this.restoreDraft()
    if (!restored) {
      const settings = wx.getStorageSync('system_settings') || {}
      if (settings.postAnonymous) this.setData({ secondIdentity: true, anonymousPreview: anonymousIdentity.generate() })
    }
    this.loadAllowAnonymousPm()
    // 进入发布页先弹出主题分类选择，可选可不选，关闭后也可在下方"主题分类"里再选
    this.openTagPicker()
  },

  onShow() {
    // 管理员后台更新发布横幅样式后，再次进入发布页即可同步（onLoad 只走一次）
    this.loadPublishBanners()
    // 订阅状态可能在设置页被改动（开启/关闭「评论通知」），每次进入都重算入口显隐
    this.refreshCommentSubscribeEntry()
  },

  // ===== 顶部「订阅评论消息提醒」入口 =====
  // 与原「确认发布」按钮走同一个 postPublish 触发组（commentNew + commentReply 两个模板），
  // 逻辑全部复用 utils/subscribe.js 的统一封装，不改动 onSubmit 里的原有逻辑。
  // 显隐口径 entryVisible('postPublish')：偏好已开且微信侧已授权才隐藏，
  // 因此在设置页关闭「评论通知」后入口会自动重新出现。
  // 返回 Promise：调用方（尤其是 applyCommentSubscribe）可等待「入口显隐已重算完成」，
  // 避免在授权回调后立刻读取 showCommentSubscribeEntry / commentSubscribeChecked 时读到旧值。
  refreshCommentSubscribeEntry() {
    // 本地判定为「需要引导」时直接显示（不发额外请求）；
    // 本地认为「已订阅」时再复核一次服务端额度 —— 额度是「点一次允许发一条」，
    // 高频场景（评论/私信）极易用尽；用尽后必须让入口重新出现，否则用户无从重新订阅。
    if (typeof subscribe.entryVisibleAsync === 'function') {
      return subscribe.entryVisibleAsync('postPublish')
        .then((need) => this.setData({ showCommentSubscribeEntry: !!need, commentSubscribeChecked: false }))
        .catch(() => {})
    }
    const visible = typeof subscribe.entryVisible === 'function' ? subscribe.entryVisible('postPublish') : false
    this.setData({ showCommentSubscribeEntry: !!visible, commentSubscribeChecked: false })
    return Promise.resolve()
  },

  // 点击整行（左半区）与拨动开关走同一条路径
  onTapCommentSubscribe(e) {
    // 开关被拨到「关」时不申请授权，只回正视觉状态（入口在订阅生效后本就会整体隐藏）
    if (e && e.detail && e.detail.value === false) { this.setData({ commentSubscribeChecked: false }); return }
    this.applyCommentSubscribe()
  },

  // 同步调用链内直接申请原生订阅授权（与「确认发布」触发效果一致）。
  // requestEntryByTap = requestTriggerByTap + 允许后把偏好键一并开启（见 utils/subscribe.js），
  // 否则「授权成功」但偏好未开时入口无法隐藏。返回 Promise 便于测试等待授权回调完成。
  applyCommentSubscribe() {
    this.setData({ commentSubscribeChecked: true })
    if (typeof subscribe.requestEntryByTap !== 'function') return this.refreshCommentSubscribeEntry().then(() => null)
    return subscribe.requestEntryByTap('postPublish')
      // 必须等 refresh 完成再 resolve：入口是否隐藏取决于服务端额度，是异步结果
      .then((res) => this.refreshCommentSubscribeEntry().then(() => res))
      .catch(() => this.refreshCommentSubscribeEntry())
  },
  // ===== 顶部轮播横幅 =====
  loadPublishBanners() {
    api.getHomeConfig().then((config) => {
      const list = (config.publishBanners || []).map((b, i) => ({
        id: b.id || 'b' + i,
        text: b.text,
        style: b.style || 'red',
        icon: b.icon || '',
        link: b.link || '',
        linkText: b.linkText || '',
        bannerStyle: (b.bgColor ? 'background:' + b.bgColor + ';' : '') + (b.textColor ? 'color:' + b.textColor + ';' : '')
      }))
      if (list.length) this.setData({ publishBanners: list })
    }).catch(() => {})
  },

  // 点击发布横幅：配置了跳转链接则按类型跳转，未配置则打开横幅详情页
  onPublishBannerTap(e) {
    const banner = this.data.publishBanners[Number(e.currentTarget.dataset.index)] || {}
    const link = String(banner.link || '').trim()
    if (/^https?:\/\//i.test(link)) {
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(banner.linkText || '公告详情')
      })
      return
    }
    if (link) {
      const path = link.charAt(0) === '/' ? link : '/' + link
      wx.navigateTo({
        url: path,
        fail: () => wx.switchTab({ url: path, fail: () => wx.navigateTo({ url: '/pages/banner-detail/index?scope=publish&id=' + (banner.id || '') }) })
      })
      return
    }
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=publish&id=' + (banner.id || '') })
  },
  onClosePublishBanner(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.publishBanners.slice()
    list.splice(index, 1)
    this.setData({ publishBanners: list })
  },
  // 「允许被匿名私信」是账号级设置（不是草稿的一部分），以服务端为准；
  // 服务端未显式设置过（info 缺失或字段为 undefined）时，回退到设置页的
  // 设备级默认「默认允许分身私信」（system_settings.anonymousMessage）
  loadAllowAnonymousPm() {
    const cached = (getApp().globalData.userInfo || {}).allowAnonymousPm
    if (typeof cached === 'boolean') this.setData({ allowAnonymousPm: cached })
    const localDefault = !!((wx.getStorageSync('system_settings') || {}).anonymousMessage)
    request.get('/user/info', {}, true, { silent: true }).then((info) => {
      const serverValue = info ? info.allowAnonymousPm : undefined
      const allowed = typeof serverValue === 'boolean' ? serverValue : localDefault
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
    request.put('/user/info', { allowAnonymousPm: allowed ? 1 : 0 }, true, { silent: true }).then(() => {
      const user = getApp().globalData.userInfo
      if (user && user.id) {
        user.allowAnonymousPm = allowed
        wx.setStorageSync('userInfo', user)
      }
      wx.showToast({ title: allowed ? '已允许分身私信' : '已拒绝分身私信', icon: 'none' })
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
  onSecondIdentityChange(e) { const secondIdentity = !!e.detail.value; this.setData({ secondIdentity, anonymousPreview: secondIdentity ? anonymousIdentity.generate() : null }); this.saveDraft(); wx.showToast({ title: secondIdentity ? '已开启分身发布' : '已切换为公开发布', icon: 'none' }) },
  openComponentEditor(e) {
    const type = e.currentTarget.dataset.type
    if (this.data.polls.length >= 3) { wx.showToast({ title: '最多可添加3个组件', icon: 'none' }); return }
    this.setData({ showComponentSheet: false, componentEditor: type, componentEditIndex: -1, poll: type === 'poll' ? newPoll() : this.data.poll })
  },
  // 点已添加的组件行：把该组件装回编辑器继续改；保存时原位替换而不是追加一条
  editComponent(e) {
    const index = Number(e.currentTarget.dataset.index)
    const poll = this.data.polls[index]
    if (!poll) return
    this.setData({ poll: JSON.parse(JSON.stringify(poll)), componentEditor: 'poll', componentEditIndex: index })
  },
  closeComponentEditor() { this.setData({ componentEditor: '', componentEditIndex: -1 }) },
  saveComponentEditor() {
    if (this.data.componentEditor === 'poll') {
      if (!this.isPollValid()) { wx.showToast({ title: '请填写投票问题和至少两个选项', icon: 'none' }); return }
      const editIndex = this.data.componentEditIndex
      if (editIndex >= 0) {
        const polls = this.data.polls.slice(); polls.splice(editIndex, 1, this.data.poll)
        this.setData({ polls, poll: null, componentEditIndex: -1 })
      } else {
        this.setData({ polls: this.data.polls.concat(this.data.poll), poll: null })
      }
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
  onChooseImage() {
    imageUtil.chooseAndCompress(9 - this.data.mediaList.length).then((files) => {
      let incoming = files
      let mediaList = this.data.mediaList
      // 帖子最多 1 个视频：已有视频再次选择视频时，用新视频替换旧视频
      const incomingVideo = incoming.find((item) => item.type === 'video')
      if (incomingVideo && mediaList.some((item) => item.type === 'video')) {
        mediaList = mediaList.filter((item) => item.type !== 'video')
        incoming = incoming.filter((item) => item.type !== 'video').concat([incomingVideo])
        wx.showToast({ title: '最多上传1个视频，已替换原视频', icon: 'none' })
      }
      mediaList = mediaList.concat(incoming).slice(0, 9)
      this.setData({ mediaList, images: mediaList.map((item) => item.path) })
      this.saveDraft(); this.refreshCanSubmit()
    }).catch(() => {})
  },
  onRemoveImage(e) { const mediaList = this.data.mediaList.slice(); mediaList.splice(e.currentTarget.dataset.index, 1); this.setData({ mediaList, images: mediaList.map((item) => item.path) }); this.saveDraft(); this.refreshCanSubmit() },
  buildComponents() {
    return this.data.polls.map((poll) => ({ type: 'poll', question: poll.question.trim(), mode: poll.mode, options: poll.options.filter((item) => item.value.trim()).map((item) => ({ text: item.value.trim(), votes: 0 })), voterIds: [] }))
  },
  async onSubmit() {
    // 注意：这里不能因为 canSubmit=false 就直接 return——未选主题分类时 canSubmit 也是 false，
    // 直接返回会导致「点了发布却没有任何提示」。校验必须逐项执行并给出对应提示。
    if (this.data.submitting) return
    if (!auth.requirePublishReady()) return
    const content = this.data.content.trim()
    // 纯图片/视频帖子允许无文字内容
    if (!content && !this.data.mediaList.length) { wx.showToast({ title: '请输入内容或上传图片/视频', icon: 'none' }); return }
    // 未选主题分类：阻止发布并提示（文案与设计稿一致）
    if (this.data.categoryIndex < 0) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }
    if (this.data.polls.some((poll) => !poll.question.trim() || poll.options.filter((item) => item.value.trim()).length < 2)) { wx.showToast({ title: '请完善投票组件', icon: 'none' }); return }
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('postPublish')
    this.setData({ submitting: true }); wx.showLoading({ title: '发布中...', mask: true })
    try {
      if (content) await wechat.checkContent(content)
      let imageUrls = this.data.mediaList.filter((item) => item.type !== 'video').map((item) => item.path); let videoUrls = this.data.mediaList.filter((item) => item.type === 'video').map((item) => item.path)
      if (imageUrls.length) imageUrls = await wechat.uploadImages(imageUrls)
      // 视频走专属上传通道（服务端要求 https 地址）；上传前已在选择时限制时长 ≤ 1 分钟
      if (videoUrls.length) videoUrls = await Promise.all(videoUrls.map((p) => wechat.uploadVideo(p)))
      if (videoUrls.some((url) => !/^https?:\/\//.test(url))) throw new Error('视频上传失败')
      const anonymous = this.data.secondIdentity ? (this.data.anonymousPreview || anonymousIdentity.generate()) : null
      const payload = { title: this.data.title.trim(), category: this.data.categories[this.data.categoryIndex], content, images: imageUrls, videos: videoUrls, components: this.buildComponents(), anonymousIdentity: anonymous, contact: this.data.contactName && this.data.contactValue ? { name: this.data.contactName.trim(), type: this.data.contactType, value: this.data.contactValue.trim() } : null }
      this.setData({ lastSubmitPayload: payload, submitError: '' })
      const created = await request.post('/post', payload, true)
      // 通知首页就地插入新帖（首页 onShow 的 consumePendingPost 消费；无 id 时跳过）
      if (created && created.id) {
        const identity = anonymous || { nickName: '', avatarUrl: '' }
        const me = (getApp().globalData.userInfo) || wx.getStorageSync('userInfo') || {}
        wx.setStorageSync('home_pending_post', {
          id: created.id,
          userId: me.id,
          nickName: anonymous ? identity.nickName : me.nickName,
          avatarUrl: anonymous ? identity.avatarUrl : me.avatarUrl,
          campus: me.campus,
          title: payload.title,
          category: payload.category,
          content: payload.content,
          images: imageUrls.map((url) => ({ url })).concat(videoUrls.map((url) => ({ type: 'video', url }))),
          isAnonymous: !!anonymous,
          createdAt: formatNow()
        })
      }
      wx.removeStorageSync(PUBLISH_DRAFT_KEY); wx.hideLoading()
      this.finishPublish()
    } catch (e) { wx.hideLoading(); this.setData({ submitError: e.message || '发布失败，请稍后重试' }); wx.showToast({ title: e.message || '发布失败', icon: 'none' }) } finally { this.setData({ submitting: false }) }
  },
  // 发布按钮点击（onSubmit）是评论提醒授权的真实用户手势入口
  finishPublish() {
    wx.showToast({ title: '发布成功', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 800)
  },
  onRetrySubmit() { if (!this.data.submitting) this.onSubmit() },
  onPullDownRefresh() { runPullDownRefresh(this) }
})
