const messageStore = require('../../utils/messageStore')
const wechat = require('../../utils/wechat')
const request = require('../../utils/request')
const image = require('../../utils/image')
const qr = require('../../utils/qr')
const auth = require('../../utils/auth')
const avatar = require('../../utils/avatar')
const subscribe = require('../../utils/subscribe')
const { runPullDownRefresh } = require('../../utils/refresh')

// 帖子详情页路由：「回到帖子」优先返回该页面的原实例（页面栈保留滚动位置与状态）
const POST_DETAIL_ROUTE = 'pages/post-detail/index'
// 帖子列表页路由：页面栈中没有帖子详情页时，返回进入聊天前的帖子列表
const POST_LIST_ROUTES = [
  'pages/index/index', // 首页帖子列表
  'pages/search/index', // 搜索结果列表
  'pages/hot-rank/index', // 热榜帖子列表
  'pages/my-posts/index', // 我的帖子列表
  'pages/my-interactions/index' // 我的互动（赞/藏列表）
]
// 用户主页路由：仅作最后兜底。个人主页属于「用户」维度而非「帖子」维度，
// 它的优先级必须低于帖子详情页，否则「帖子详情→个人主页→聊天」会退回个人主页而不是原帖子
const POST_PROFILE_ROUTE = 'pages/profile/index'

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

// 读取本地记录来源帖子
function readSourcePostId(peerId, personaKey) {
  try { return parseInt(wx.getStorageSync(sourcePostKey(peerId, personaKey)), 10) || 0 } catch (e) { return 0 }
}

// 「回到帖子」目标解析，返回 { delta, url, postId }：delta > 0 时按层级 navigateBack 回到页面栈中的原实例，
// 否则用 url 跳转到来源帖子详情页；postId 为解析出的来源帖子 id（0 表示本次没有帖子上下文，
// 调用方据此写入本地缓存，供之后从「我的消息」等入口进入时补显入口）。判定优先级如下：
//   1) 页面栈中仍存在入口携带的原帖子详情页（route 与 id 双重命中）→ 返回该实例。
//      该分支同时覆盖「帖子详情页→聊天页」(delta 1) 与「帖子详情页→个人主页→聊天页」(delta 2) 两条路径；
//   2) 入口未携带 postId（如从列表卡片直接私信）时，返回页面栈中最近的帖子详情页；
//   3) 携带了 postId 但原帖子详情页已被移出页面栈 → 直接跳转该帖子，不退回中间页面；
//   4) 页面栈中没有帖子详情页 → 返回最近的帖子列表页或用户主页（个人主页内含帖子列表）；
//   5) 仍未命中 → 用本地缓存或服务端下发的来源帖子兜底，最终没有来源则调用方不展示入口。
//
// 关键：第 4 步的「返回列表页」只是没有更精确帖子上下文时的兜底。当本次入口虽未携带 postId，
// 但该会话在本地缓存中已记录过来源帖子（如「首页私信入口 → 私信列表 → 聊天」，用户最初是在
// 某帖子详情页点用户头像发起私信），必须让第 3 步的来源帖子优先于第 4 步的列表页兜底，
// 否则「回到帖子」会误返回首页列表页（如 pages/index/index）而不是原帖子详情页。
function resolveBackToPost(options) {
  const entryPostId = Number(options.sourcePostId) || 0
  const pages = getCurrentPages()
  const selfIndex = pages.length - 1
  const routeOf = (i) => pages[i].route
  const postIdOf = (i) => Number((pages[i].options || {}).id) || 0
  if (entryPostId) {
    // 1) 精确命中原帖子详情页实例（route 与 id 双重匹配，避免返回到另一条帖子）
    for (let i = selfIndex - 1; i >= 0; i--) {
      if (routeOf(i) === POST_DETAIL_ROUTE && postIdOf(i) === entryPostId) {
        return { delta: selfIndex - i, url: '', postId: entryPostId, precise: true }
      }
    }
    // 3) 原帖详情页已被移出页面栈：跳转到该帖子，而不是退回无关的中间页面
    return { delta: 0, url: '/pages/post-detail/index?id=' + entryPostId, postId: entryPostId, precise: true }
  }
  // 2) 未携带 postId（如从列表卡片直接私信）：最近的帖子详情页即目标
  for (let i = selfIndex - 1; i >= 0; i--) {
    if (routeOf(i) === POST_DETAIL_ROUTE) {
      return { delta: selfIndex - i, url: '', postId: postIdOf(i), precise: true }
    }
  }
  // 3') 入口未携带 postId，但该会话此前记录过来源帖子（如「首页私信入口 → 私信列表 → 聊天」）：
  //     来源帖子必须优先于下面的列表页兜底，否则会退回首页而不是原帖子详情页
  const storedPostId = readSourcePostId(options.peerId, options.personaKey)
  if (storedPostId) {
    return { delta: 0, url: '/pages/post-detail/index?id=' + storedPostId, postId: storedPostId, precise: true }
  }
  // 4) 页面栈中没有帖子详情页、也没有已知来源帖子：最近的帖子列表页 / 用户主页（个人主页内含帖子列表）即目标。
  //    precise 为 false：这只是「帖子维度」的兜底，服务端若下发更精确的来源帖子应覆盖它
  for (let i = selfIndex - 1; i >= 0; i--) {
    const route = routeOf(i)
    if (POST_LIST_ROUTES.indexOf(route) > -1 || route === POST_PROFILE_ROUTE) {
      return { delta: selfIndex - i, url: '', postId: 0, precise: false }
    }
  }
  // 5) 没有任何帖子上下文：不展示入口
  return { delta: 0, url: '', postId: 0, precise: false }
}

Page({
  data: {
    peerId: 0,
    otherUser: {},
    anonymousMode: false,
    selfAnonymous: null,
    // 对方非匿名时其头像可点，进入对方个人主页
    canOpenPeerProfile: false,
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
    this._enterOptions = options || {}
    // 未登录：弹窗引导去登录（取消则退回），登录后回到本页在 onShow 补初始化
    if (!auth.guardPage('使用私信需要先登录')) return
    this._initialized = true
    this.initChat(this._enterOptions)
  },

  onShow() {
    // 从登录页返回时补执行初始化（首次进入已在 onLoad 完成）
    if (this._initialized) return
    if (!auth.isLoggedIn()) return
    this._initialized = true
    this.initChat(this._enterOptions || {})
  },

  initChat(options) {
    let legacyUser = {}
    try { legacyUser = JSON.parse(decodeURIComponent(options.otherUser || '{}')) } catch (e) {}
    const peerId = parseInt(options.peerId || legacyUser.id, 10)
    const anonymousMode = options.anonymous === '1'
    // 分身会话标识：同一真实用户的每个分身对应一个独立会话，
    // 历史/缓存/实时消息全部按该标识隔离，互不显示、互不残留
    const personaKey = safeDecode(options.personaKey || '')
    // 匿名聊天也可携带分身昵称/头像（从分身卡片私信进入时传入），未传则用通用匿名身份
    // 头像统一过归一化：历史脏数据（不存在的内置素材路径）会让 <image> 一直图裂
    const otherUser = anonymousMode ? {
      nickname: options.nick ? safeDecode(options.nick) : '分身用户',
      avatar: avatar.normalizeLegacyAvatar(options.avatar ? safeDecode(options.avatar) : '/assets/icons/avatar.png')
    } : {
      nickname: options.nick ? safeDecode(options.nick) : (legacyUser.nickname || '维修人员'),
      avatar: avatar.normalizeLegacyAvatar(options.avatar ? safeDecode(options.avatar) : (legacyUser.avatar || '/assets/icons/repair-logo.jpg'))
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
    // 来源帖子：帖子详情页进入时携带 postId，先写入本地缓存；
    // 页面栈中没有帖子页（如从消息通知进入）时，读取缓存跳转到来源帖子详情页
    const entryPostId = parseInt(options.postId, 10) || 0
    // 解析「回到帖子」目标：页面栈中的原帖子实例优先，其次来源帖子，都没有则不展示入口
    const backToPost = resolveBackToPost({ sourcePostId: entryPostId, peerId, personaKey: this.personaKey })
    this._backToPostDelta = backToPost.delta
    this._backToPostUrl = backToPost.url
    // 本次解析是否已锁定精确的帖子目标（而非仅退到列表页兜底）：
    // 未锁定时，服务端下发的会话来源帖子可覆盖，避免从首页私信入口进入时只退回首页
    this._backToPostPrecise = !!backToPost.precise
    // 本次解析出的来源帖子 id：既写本地缓存，也在拉历史时上报服务端（服务端只记一次），
    // 这样之后从「我的消息」等没有帖子页面的入口进入也能补显「回到帖子」
    this._sourcePostId = backToPost.postId || entryPostId || 0
    if (this._sourcePostId) {
      try { wx.setStorageSync(sourcePostKey(peerId, this.personaKey), this._sourcePostId) } catch (e) {}
    }
    const app = getApp()
    this.setData({
      peerId,
      otherUser,
      anonymousMode,
      // 入口是否显式指定了匿名参数（指定后以入口为准，不再被会话标记覆盖）
      anonParamExplicit: options.anonymous !== undefined,
      selfSeedPersona,
      anonSelfMode: !!selfSeedPersona,
      showBackToPost: backToPost.delta > 0 || !!backToPost.url,
      // 对方非匿名时头像可点进其个人主页（首屏先按入口参数判断，服务端身份回来后再纠正）
      canOpenPeerProfile: this.computeCanOpenPeerProfile(anonymousMode, otherUser),
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

  // 对方头像能否点进个人主页：
  //   1) peerId 必须有效；
  //   2) 匿名会话 / 匿名分身一律不给入口 —— 匿名聊天的前提就是不暴露真实身份，
  //      留一个「进入对方主页」的入口等于把匿名者直接指认出来；
  //   3) 对方头像是匿名素材池里的形象时同样拦截（历史脏数据里存在
  //      「会话未标记匿名、但对方头像却是匿名素材」的组合，只看标记会漏）。
  computeCanOpenPeerProfile(anonymousMode, otherUser) {
    if (!Number(this.data.peerId)) return false
    if (anonymousMode) return false
    return !avatar.looksAnonymousAvatar((otherUser || {}).avatar)
  },

  // 点击对方头像 → 对方个人主页（自己发的消息头像不可点）
  onTapAvatar(e) {
    const dataset = e.currentTarget.dataset || {}
    if (dataset.self) return
    if (!this.data.canOpenPeerProfile) {
      // 匿名会话里点对方头像：明确告知原因，而不是静默无反应
      if (this.data.anonymousMode || this.data.selfSeedPersona) {
        wx.showToast({ title: '分身聊天不展示对方主页', icon: 'none' })
      }
      return
    }
    const peerId = Number(this.data.peerId) || 0
    if (!peerId) {
      wx.showToast({ title: '无法打开对方主页', icon: 'none' })
      return
    }
    // 防连点：头像紧邻消息气泡，快速连点会重复压栈，栈深超限后整页白屏
    if (this._profileNavigating) return
    this._profileNavigating = true
    setTimeout(() => { this._profileNavigating = false }, 800)
    wx.navigateTo({
      // 带上来源帖子：个人主页再进私信时「回到帖子」仍能精确回到原帖
      url: '/pages/profile/index?id=' + peerId + (this._sourcePostId ? '&postId=' + this._sourcePostId : ''),
      // 跳转失败（页面栈超限等）必须有反馈，否则用户会觉得「点了没反应」
      fail: () => {
        this._profileNavigating = false
        wx.showToast({ title: '打开主页失败，请稍后重试', icon: 'none' })
      }
    })
  },

  // 头像加载失败兜底：历史脏路径（库里存量或本地缓存里的旧内置素材名）会让渲染层
  // 反复报「Failed to load image」且头像长期空白，这里就地换成可用头像止损。
  // 匿名形象换成素材池内的稳定形象（同一身份始终同一张脸），其余换默认头像。
  onAvatarError(e) {
    const index = Number((e.currentTarget.dataset || {}).index)
    const messages = this.data.messages
    if (!Number.isInteger(index) || index < 0 || !messages[index]) return
    const broken = String(messages[index].avatar || '')
    const fallback = avatar.looksAnonymousAvatar(broken)
      ? avatar.pickAnonymousAvatar(messages[index].nickname || broken)
      : '/assets/icons/avatar.png'
    // 兜底值本身也必须变化，否则会与损坏路径来回抖动
    if (!fallback || fallback === broken) return
    this.setData({ ['messages[' + index + '].avatar']: fallback })
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
      // 来源帖子可能已被删除或页面栈超限：失败时给出提示并复位按钮，
      // 否则按钮会一直停留在 returning（半透明）不可再点
      fail: () => {
        wx.showToast({ title: '帖子不存在或已被删除', icon: 'none' })
      },
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
        ? (isSelf ? (selfPersona ? selfPersona.nickName : '分身用户') : this.data.otherUser.nickname)
        : (isSelf ? '我' : (message.senderNick || this.data.otherUser.nickname)),
      // 匿名聊天：不取 senderAvatar（服务端返回的是真实身份）；自己用分身头像（若有），对方固定用会话分身头像
      // 所有分支都过一层归一化，避免历史脏路径直接进 <image> 造成图裂
      avatar: avatar.normalizeLegacyAvatar(anonymousMode
        ? (isSelf ? (selfPersona ? selfPersona.avatarUrl : '/assets/icons/avatar.png') : this.data.otherUser.avatar)
        : (isSelf
          ? ((getApp().globalData.userInfo || {}).avatarUrl || '/assets/icons/avatar.png')
          : (message.senderAvatar || this.data.otherUser.avatar))),
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
      // personaKey 传入服务端：只拉取本分身会话的消息，其他分身的记录不会出现；
      // sourcePostId 上报后服务端只在首次写入，供后续无帖子页面的入口补显「回到帖子」
      const result = await messageStore.getHistory(this.data.peerId, page, 30, this.data.anonymousMode, seedPersona, anonSide, this.personaKey, this._sourcePostId || 0)
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
      otherUser.avatar = avatar.normalizeLegacyAvatar(otherUser.avatar)
      // 先落地身份状态（会话匿名标记/对方身份/自己的分身身份），再映射消息列表：
      // toViewMessage 从 page data 读取匿名身份，若先映射后 setData，
      // 每次进入页面首屏时 selfAnonymous 尚为 null，自己的消息会全部错误回退到默认头像
      this.setData({
        anonymousMode,
        otherUser,
        selfAnonymous: result.selfAnonymous || null,
        // 服务端下发的对方身份比入口参数权威，头像可点性随之纠正
        canOpenPeerProfile: this.computeCanOpenPeerProfile(anonymousMode, otherUser)
      })
      // 会话可能新建（入口未传 personaKey 时以服务端归档为准），先同步本地隔离键：
      // 下面补显「回到帖子」读本地缓存必须用真实键，否则从「我的消息」进入匿名会话会读不到
      if (page === 1 && (result.personaKey || '') !== (this.personaKey || '')) this.personaKey = result.personaKey || ''
      // 「回到帖子」补显 / 纠正：服务端记录的会话来源帖子最精确，其次按真实 personaKey 读本地缓存。
      // 覆盖两类入口：
      //   a) 页面栈里没有帖子页、入口也没带 postId（如从「我的消息」进入）→ 补显入口；
      //   b) 入口只命中了列表页兜底（如「首页私信入口 → 私信列表 → 聊天」，栈顶上方只有首页）→
      //      用真正的来源帖子替换掉「退回首页」的目标，保证「回到帖子」回到原帖子详情页
      if (!this.data.showBackToPost || !this._backToPostPrecise) {
        const fallbackPostId = Number(result.sourcePostId) || readSourcePostId(this.data.peerId, this.personaKey)
        if (fallbackPostId) {
          this._sourcePostId = fallbackPostId
          this._backToPostDelta = 0
          this._backToPostUrl = '/pages/post-detail/index?id=' + fallbackPostId
          this._backToPostPrecise = true
          this.setData({ showBackToPost: true })
        }
      }
      const list = (result.list || []).map((item) => this.toViewMessage(item))
      const messages = page === 1 ? list : list.concat(this.data.messages)
      const hasPeerMessage = this.data.hasPeerMessage || list.some((item) => !item.isSelf)
      this.setData({ messages, page, hasMore: !!result.hasMore, canSend: hasPeerMessage || result.canSend !== false, hasPeerMessage, pendingMessageId: result.pendingMessageId || 0, peerBlocked: !!result.blocked, blockedByPeer: !!result.blockedByPeer })
      if (page === 1) {
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
    // personaKey 保证消息落入当前分身的隔离会话；sourcePostId 让「本次会话由首条消息创建」
    // 的场景（历史接口失败后直接发送）也不丢来源帖子
    const persona = this.data.selfSeedPersona || this.data.selfAnonymous || null
    const result = await messageStore.sendMessage(this.data.peerId, content, msgType, this.data.anonymousMode, persona, this.personaKey, this._sourcePostId || 0)
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
    // 在发送按钮点击同步链内申请私信通知授权；不能放在 onShow 或发送接口完成后。
    if (typeof subscribe.requestTriggerByTap === 'function') {
      subscribe.requestTriggerByTap('message').then((res) => {
        // 被拒且微信侧是「总是拒绝」时永远静默无额度，节流引导去设置页重开（7 天最多一次）
        if (res.rejected && res.rejected.indexOf('message') > -1 && typeof subscribe.guideReopen === 'function') {
          subscribe.guideReopen(['message'], '私信通知', { throttleKey: 'subscribe_reopen_guide_chat' })
        }
      })
    }
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
