const messageStore = require('../../utils/messageStore')
const wechat = require('../../utils/wechat')
const request = require('../../utils/request')
const image = require('../../utils/image')
const qr = require('../../utils/qr')
const { runPullDownRefresh } = require('../../utils/refresh')

// 帖子相关页面路由：从这些页面进入聊天时，顶部展示「回到帖子」按钮
const POST_PAGE_ROUTES = [
  'pages/post-detail/index', // 帖子详情页
  'pages/index/index', // 首页帖子列表
  'pages/search/index', // 搜索结果列表
  'pages/hot-rank/index', // 热榜帖子列表
  'pages/my-posts/index', // 我的帖子列表
  'pages/my-interactions/index', // 我的互动（赞/藏列表）
  'pages/profile/index' // 用户主页帖子列表
]

function formatTime(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 安全解码 URL 参数（入口以 encodeURIComponent 传入；含非法 % 序列时回退原值）
function safeDecode(value) {
  try { return decodeURIComponent(value) } catch (e) { return value }
}

// 来源帖子本地缓存键：记录会话最初从哪个帖子发起，
// 之后从「消息通知」等页面栈中没有帖子页的入口进入时也能「回到帖子」
function sourcePostKey(peerId, personaKey) {
  const persona = String(personaKey || '').trim()
  if (!persona) return 'pm_src_post_' + peerId
  return 'pm_src_post_' + peerId + '_p_' + persona.replace(/[^0-9a-zA-Z\u4e00-\u9fa5]/g, '_')
}

Page({
  data: {
    peerId: 0,
    otherUser: {},
    anonymousMode: false,
    selfAnonymous: null,
    canSend: true,
    peerBlocked: false,
    blockedByPeer: false,
    blocking: false,
    hasPeerMessage: false,
    pendingMessageId: 0,
    recalling: false,
    messages: [],
    inputValue: '',
    activePanel: '',
    voiceMode: false,
    inputFocus: false,
    scrollToView: '',
    loadingMore: false,
    hasMore: false,
    page: 1,
    showBackToPost: false,
    returning: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    emojiList: [
      '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆',
      '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗',
      '😙', '😚', '🙂', '🤗', '🤩', '🤨', '😐', '😑',
      '😶', '😏', '😣', '😮', '🤐', '😯', '😪', '😫',
      '🥱', '😴', '😛', '😜', '😝', '🤤', '😒', '😓',
      '😔', '😕', '🙃', '🤑', '😲', '☹️', '🙁', '😖'
    ]
  },

  onLoad(options) {
    let legacyUser = {}
    try { legacyUser = JSON.parse(decodeURIComponent(options.otherUser || '{}')) } catch (e) {}
    const peerId = parseInt(options.peerId || legacyUser.id, 10)
    const anonymousMode = options.anonymous === '1'
    // 分身会话标识：同一真实用户的每个分身对应一个独立会话，
    // 历史/缓存/实时消息全部按该标识隔离，互不显示、互不残留
    const personaKey = safeDecode(options.personaKey || '')
    // 匿名聊天也可携带分身昵称/头像（从分身卡片私信进入时传入），未传则用通用匿名身份
    const otherUser = anonymousMode ? {
      nickname: options.nick ? safeDecode(options.nick) : '匿名用户',
      avatar: options.avatar ? safeDecode(options.avatar) : '/assets/icons/avatar.png'
    } : {
      nickname: options.nick ? safeDecode(options.nick) : (legacyUser.nickname || '维修人员'),
      avatar: options.avatar ? safeDecode(options.avatar) : (legacyUser.avatar || '/assets/icons/repair-logo.jpg')
    }
    if (!peerId) {
      wx.showToast({ title: '未找到聊天对象', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    // 分身私信普通用户：发起方自己的分身身份（首次进入时由服务端存档）
    let selfSeedPersona = null
    if (anonymousMode && options.anonSelfNick && options.anonSelfAvatar) {
      selfSeedPersona = { nickName: safeDecode(options.anonSelfNick), avatarUrl: safeDecode(options.anonSelfAvatar) }
    }
    this.personaKey = personaKey || (selfSeedPersona ? selfSeedPersona.avatarUrl : '')
    // 扫描页面栈找到最近的帖子页面（帖子详情/列表），计算返回层级
    // 兼容 帖子页→聊天页 (delta 1) 与 帖子页→个人主页→聊天页 (delta 2) 等路径
    const pages = getCurrentPages()
    let backToPostDelta = 0
    for (let i = pages.length - 2; i >= 0; i--) {
      if (POST_PAGE_ROUTES.indexOf(pages[i].route) > -1) { backToPostDelta = pages.length - 1 - i; break }
    }
    this._backToPostDelta = backToPostDelta
    // 来源帖子：帖子详情页进入时携带 postId，存入本地缓存；
    // 页面栈中没有帖子页（如从消息通知进入）时，读取缓存跳转到来源帖子详情页
    const sourcePostId = parseInt(options.postId, 10) || 0
    if (sourcePostId) {
      try { wx.setStorageSync(sourcePostKey(peerId, this.personaKey), sourcePostId) } catch (e) {}
    }
    let backToPostUrl = ''
    if (!backToPostDelta) {
      let storedPostId = sourcePostId
      if (!storedPostId) {
        try { storedPostId = parseInt(wx.getStorageSync(sourcePostKey(peerId, this.personaKey)), 10) || 0 } catch (e) {}
      }
      if (storedPostId) backToPostUrl = '/pages/post-detail/index?id=' + storedPostId
    }
    this._backToPostUrl = backToPostUrl
    const app = getApp()
    this.setData({
      peerId,
      otherUser,
      anonymousMode,
      // 入口是否显式指定了匿名参数（指定后以入口为准，不再被会话标记覆盖）
      anonParamExplicit: options.anonymous !== undefined,
      selfSeedPersona,
      anonSelfMode: !!selfSeedPersona,
      showBackToPost: backToPostDelta > 0 || !!backToPostUrl,
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44
    })
    this.unsubscribe = messageStore.onMessage((payload) => {
      // 拉黑后客户端兜底过滤，正常情况下服务端已拒绝投递；
      // personaKey 必须匹配，其他分身会话的实时消息不进入本页面
      if (payload.type === 'message' && payload.peerId === peerId && (payload.personaKey || '') === (this.personaKey || '') && !this.data.peerBlocked) this.appendMessage(payload.data)
      if (payload.type === 'message_recalled' && payload.peerId === peerId && (payload.personaKey || '') === (this.personaKey || '')) this.removeMessage(payload.data.id)
    })
    this.loadMessages()
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
    if (this._scrollBottomTimer) clearTimeout(this._scrollBottomTimer)
  },

  // 自定义导航栏返回按钮；无上级页面时兜底回首页
  onNavBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  },

  // 「回到帖子」：页面栈中有帖子页时直接返回（页面实例保留，滚动位置与状态自动恢复）；
  // 从消息通知等入口进入时，跳转到记录的来源帖子详情页
  onBackToPost() {
    if (this.data.returning) return // 防重复点击
    const delta = this._backToPostDelta || 0
    this.setData({ returning: true })
    if (delta > 0) {
      wx.navigateBack({
        delta,
        complete: () => this.setData({ returning: false })
      })
      return
    }
    const url = this._backToPostUrl
    if (!url) { this.setData({ returning: false }); return }
    wx.navigateTo({
      url,
      complete: () => this.setData({ returning: false })
    })
  },

  toViewMessage(message) {
    const currentUser = (getApp().globalData.userInfo || {}).id || 0
    const isSelf = Number(message.senderId) === Number(currentUser) || message.isMine === true
    // 渲染模式只看页面会话模式（由入口参数与服务端会话标记决定）。
    // message.isAnonymous 是消息渠道标记（匿名渠道消息对双方可见），不能作为渲染依据，
    // 否则普通用户收到一条匿名渠道消息后，自己的消息也会被错误渲染成匿名身份。
    const anonymousMode = !!this.data.anonymousMode
    // 自己的分身身份（本会话的分身拥有者进入时由服务端下发）；普通匿名参与者没有
    const selfPersona = this.data.selfAnonymous
    return {
      id: message.id,
      type: message.msgType || message.type || 'text',
      content: message.content,
      isSelf,
      nickname: anonymousMode
        ? (isSelf ? (selfPersona ? selfPersona.nickName : '匿名用户') : this.data.otherUser.nickname)
        : (isSelf ? '我' : (message.senderNick || this.data.otherUser.nickname)),
      // 匿名聊天：不取 senderAvatar（服务端返回的是真实身份）；自己用分身头像（若有），对方固定用会话分身头像
      avatar: anonymousMode
        ? (isSelf ? (selfPersona ? selfPersona.avatarUrl : '/assets/icons/avatar.png') : this.data.otherUser.avatar)
        : (isSelf
          ? ((getApp().globalData.userInfo || {}).avatarUrl || '/assets/icons/avatar.png')
          : (message.senderAvatar || this.data.otherUser.avatar)),
      timeText: formatTime(message.createdAt),
      canRecall: isSelf && Number(message.id) === Number(this.data.pendingMessageId)
    }
  },

  async loadMessages(page = 1) {
    try {
      // 匿名会话带上分身身份参数：服务端只在首次存档，之后所有入口都返回同一份
      // anonSelfMode：分身属于发起方自己（分身私信普通用户），存档方向为 self
      const seedPersona = this.data.selfSeedPersona
        ? this.data.selfSeedPersona
        : (this.data.anonymousMode && this.data.otherUser.avatar.indexOf('/assets/avatar1/') === 0
          ? { nickName: this.data.otherUser.nickname, avatarUrl: this.data.otherUser.avatar }
          : null)
      const anonSide = this.data.selfSeedPersona ? 'self' : 'peer'
      // personaKey 传入服务端：只拉取本分身会话的消息，其他分身的记录不会出现
      const result = await messageStore.getHistory(this.data.peerId, page, 30, this.data.anonymousMode, seedPersona, anonSide, this.personaKey)
      // 入口显式指定了 anonymous 参数时以入口为准（普通私信入口保持普通身份渲染），
      // 否则沿用会话的匿名标记
      const anonymousMode = this.data.anonParamExplicit
        ? this.data.anonymousMode
        : (this.data.anonymousMode || !!result.isAnonymous)
      // 对方身份展示优先级：对方是普通用户时用服务端下发的真实身份（peerNormal，避免普通用户被误显示为匿名用户）；
      // 对方是匿名侧时用存档的分身身份（peerAnonymous）；都没有则沿用入口参数
      const otherUser = result.peerNormal
        ? { nickname: result.peerNormal.nickName, avatar: result.peerNormal.avatarUrl }
        : (result.peerAnonymous
          ? { nickname: result.peerAnonymous.nickName, avatar: result.peerAnonymous.avatarUrl }
          : this.data.otherUser)
      // 先落地身份状态（会话匿名标记/对方身份/自己的分身身份），再映射消息列表：
      // toViewMessage 从 page data 读取匿名身份，若先映射后 setData，
      // 每次进入页面首屏时 selfAnonymous 尚为 null，自己的消息会全部错误回退到默认头像
      this.setData({ anonymousMode, otherUser, selfAnonymous: result.selfAnonymous || null })
      // 服务端记录了会话来源帖子、且本地既无帖子页可返回也无缓存时，用它补上「回到帖子」入口
      if (!this.data.showBackToPost && result.sourcePostId) {
        this._backToPostUrl = '/pages/post-detail/index?id=' + result.sourcePostId
        this.setData({ showBackToPost: true })
      }
      const list = (result.list || []).map((item) => this.toViewMessage(item))
      const messages = page === 1 ? list : list.concat(this.data.messages)
      const hasPeerMessage = this.data.hasPeerMessage || list.some((item) => !item.isSelf)
      this.setData({ messages, page, hasMore: !!result.hasMore, canSend: hasPeerMessage || result.canSend !== false, hasPeerMessage, pendingMessageId: result.pendingMessageId || 0, peerBlocked: !!result.blocked, blockedByPeer: !!result.blockedByPeer })
      if (page === 1) {
        // 会话可能新建（入口未传 personaKey 时以服务端归档为准），同步本地隔离键
        if ((result.personaKey || '') !== (this.personaKey || '')) this.personaKey = result.personaKey || ''
        messageStore.saveCache(this.data.peerId, result.list || [], this.personaKey)
        messageStore.markRead(this.data.peerId, this.personaKey).catch(() => {})
        this.scrollToBottom()
      }
    } catch (e) {
      if (page === 1) {
        const cached = messageStore.loadCache(this.data.peerId, this.personaKey).map((item) => this.toViewMessage(item))
        this.setData({ messages: cached })
        this.scrollToBottom()
      }
    }
  },

  appendMessage(message) {
    if (this.data.messages.some((item) => Number(item.id) === Number(message.id))) return
    const viewMessage = this.toViewMessage(message)
    messageStore.appendCache(this.data.peerId, message, this.personaKey)
    const isSelf = viewMessage.isSelf
    const hasPeerMessage = this.data.hasPeerMessage || !isSelf
    this.setData({ messages: this.data.messages.concat(viewMessage), canSend: hasPeerMessage, hasPeerMessage, pendingMessageId: isSelf && !hasPeerMessage ? viewMessage.id : 0 })
    this.scrollToBottom()
  },

  removeMessage(messageId) {
    const messages = this.data.messages.filter((item) => Number(item.id) !== Number(messageId))
    this.setData({ messages, canSend: true, pendingMessageId: 0, recalling: false })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onInputFocus() {
    this.setData({ activePanel: '' })
  },

  onToggleEmoji() {
    this.setData({
      voiceMode: false,
      activePanel: this.data.activePanel === 'emoji' ? '' : 'emoji',
      inputFocus: false
    })
  },

  onToggleTools() {
    this.setData({
      voiceMode: false,
      activePanel: this.data.activePanel === 'tools' ? '' : 'tools',
      inputFocus: false
    })
  },

  onToggleVoice() {
    this.setData({ voiceMode: !this.data.voiceMode, activePanel: '', inputFocus: false })
  },

  onVoiceHint() {
    wx.showToast({ title: '语音功能暂未开启', icon: 'none' })
  },

  onEmojiTap(e) {
    this.setData({ inputValue: this.data.inputValue + e.currentTarget.dataset.emoji })
  },

  async sendContent(content, msgType = 'text') {
    if (!this.data.canSend) throw new Error('请等待对方回复后再发送，可长按上一条消息撤回')
    // 匿名发送时携带自己一侧的分身形象（分身拥有者用已有档案，否则服务端自动生成存档）；
    // personaKey 保证消息落入当前分身的隔离会话
    const persona = this.data.selfSeedPersona || this.data.selfAnonymous || null
    const result = await messageStore.sendMessage(this.data.peerId, content, msgType, this.data.anonymousMode, persona, this.personaKey)
    this.appendMessage({
      id: result.id,
      senderId: (getApp().globalData.userInfo || {}).id || 0,
      receiverId: this.data.peerId,
      content,
      msgType,
      status: result.status || 'sent',
      createdAt: result.createdAt || new Date().toISOString(),
      isMine: true
    })
  },

  async onSend() {
    const content = this.data.inputValue.trim()
    if (!content) return
    if (this.data.peerBlocked) { wx.showToast({ title: '已拉黑对方，请先解除拉黑', icon: 'none' }); return }
    if (this.data.blockedByPeer) { wx.showToast({ title: '对方已将你加入黑名单', icon: 'none' }); return }
    if (!this.data.canSend) { wx.showToast({ title: '请等待对方回复，可长按上一条撤回', icon: 'none' }); return }
    this.setData({ inputValue: '', activePanel: '' })
    try {
      await this.sendContent(content)
    } catch (e) {
      this.setData({ inputValue: content })
      wx.showToast({ title: e.message || '消息发送失败，请重试', icon: 'none' })
    }
  },

  onChooseImage() {
    if (this.data.peerBlocked) { wx.showToast({ title: '已拉黑对方，请先解除拉黑', icon: 'none' }); return }
    if (this.data.blockedByPeer) { wx.showToast({ title: '对方已将你加入黑名单', icon: 'none' }); return }
    if (!this.data.canSend) { wx.showToast({ title: '请等待对方回复，可长按上一条撤回', icon: 'none' }); return }
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const paths = (res.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean)
        if (!paths.length) return
        this.setData({ activePanel: '' })
        wx.showLoading({ title: '发送图片...', mask: true })
        try {
          const urls = await wechat.uploadImages(paths)
          if (urls.some((url) => !/^https?:\/\//.test(url))) {
            throw new Error('图片上传失败')
          }
          for (const url of urls) await this.sendContent(url, 'image')
        } catch (e) {
          wx.showToast({ title: e.message || '图片发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 选择并发送视频（相册/拍摄，最长 60 秒）
  onChooseVideo() {
    if (this.data.peerBlocked) { wx.showToast({ title: '已拉黑对方，请先解除拉黑', icon: 'none' }); return }
    if (this.data.blockedByPeer) { wx.showToast({ title: '对方已将你加入黑名单', icon: 'none' }); return }
    if (!this.data.canSend) { wx.showToast({ title: '请等待对方回复，可长按上一条撤回', icon: 'none' }); return }
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: async (res) => {
        // maxDuration 只限制拍摄，相册长视频需按 duration 二次校验
        const raw = (res.tempFiles || [])[0]
        if (!raw || !raw.tempFilePath) return
        const { valid } = image.splitOverlongVideos([raw])
        if (!valid.length) {
          wx.showToast({ title: '视频不能超过1分钟，请重新选择', icon: 'none' })
          return
        }
        const file = raw
        this.setData({ activePanel: '' })
        wx.showLoading({ title: '发送视频...', mask: true })
        try {
          const url = await wechat.uploadVideo(file.tempFilePath)
          if (!/^https?:\/\//.test(url)) throw new Error('视频上传失败')
          await this.sendContent(url, 'video')
        } catch (e) {
          wx.showToast({ title: e.message || '视频发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  onPreviewImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = this.data.messages.filter((item) => item.type === 'image').map((item) => item.content)
    wx.previewImage({ current, urls })
  },

  // 长按图片消息：统一二维码识别菜单（识别 / 预览）
  onImageQrScan(e) {
    const src = e.currentTarget.dataset.src
    const urls = this.data.messages.filter((item) => item.type === 'image').map((item) => item.content)
    qr.recognize(src, urls)
  },

  onRecallMessage(e) {
    const messageId = e.currentTarget.dataset.id
    if (!messageId || Number(messageId) !== Number(this.data.pendingMessageId) || this.data.recalling) return
    wx.showModal({ title: '撤回消息', content: '撤回后对方将无法看到该消息，你可以重新编辑发送。', success: (res) => {
      if (!res.confirm) return
      this.setData({ recalling: true })
      messageStore.recallMessage(this.data.peerId, messageId, this.personaKey).then(() => {
        this.removeMessage(messageId)
        wx.showToast({ title: '消息已撤回', icon: 'success' })
      }).catch((err) => { this.setData({ recalling: false }); wx.showToast({ title: err.message || '撤回失败', icon: 'none' }) })
    } })
  },

  onToggleBlock() {
    if (this.data.blocking || !this.data.peerId) return
    if (!this.data.peerBlocked) {
      wx.showModal({
        title: '拉黑确认',
        content: '拉黑后将不再接收对方发送的任何消息（文字、图片等），对方也无法再向你发送消息。确定拉黑对方吗？',
        confirmText: '确认拉黑',
        confirmColor: '#fa5151',
        success: (res) => {
          if (!res.confirm) return
          this.setData({ blocking: true })
          messageStore.blockPeer(this.data.peerId).then(() => {
            this.setData({ peerBlocked: true, canSend: false, blocking: false })
            wx.showToast({ title: '已拉黑对方', icon: 'success' })
          }).catch((err) => {
            this.setData({ blocking: false })
            wx.showToast({ title: err.message || '拉黑失败，请重试', icon: 'none' })
          })
        }
      })
    } else {
      wx.showModal({
        title: '解除拉黑',
        content: '解除后对方将可以重新向你发送消息。确定解除拉黑吗？',
        confirmText: '确认解除',
        success: (res) => {
          if (!res.confirm) return
          this.setData({ blocking: true })
          messageStore.unblockPeer(this.data.peerId).then(() => {
            this.setData({ peerBlocked: false, blocking: false })
            wx.showToast({ title: '已解除拉黑', icon: 'success' })
            this.loadMessages(1)
          }).catch((err) => {
            this.setData({ blocking: false })
            wx.showToast({ title: err.message || '解除失败，请重试', icon: 'none' })
          })
        }
      })
    }
  },

  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    this.loadMessages(this.data.page + 1).finally(() => this.setData({ loadingMore: false }))
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadMessages(1))
  },

  scrollToBottom() {
    this._scrollBottomTimer = setTimeout(() => {
      const last = this.data.messages[this.data.messages.length - 1]
      if (last) this.setData({ scrollToView: `msg-${last.id}` })
    }, 50)
  }
})
