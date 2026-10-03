const messageStore = require('../../utils/messageStore')
const request = require('../../utils/request')
const api = require('../../utils/api')
const avatar = require('../../utils/avatar')
const format = require('../../utils/format')
const auth = require('../../utils/auth')
const subscribe = require('../../utils/subscribe')
const { runPullDownRefresh } = require('../../utils/refresh')
const liquidTab = require('../../utils/liquid-tab')

// 各 tab（私信/评论/点赞/蹲贴/回复/系统）与通知类型的映射。
// 评论 tab 只收纳帖子/蹲贴下的新评论；“用户回复用户”的 type='reply'
// 独立进入「回复」tab，避免被普通评论通知淹没。
const TAB_NOTIFY_TYPES = [null, ['comment', 'follow'], ['like'], null, ['reply'], ['system', 'errand', 'repair']]
// 蹲贴 tab 不是通知流而是帖子列表，索引单列，避免被当作消息类型过滤
const TAB_INDEX_SQUAT = 3

Page({
  data: {
    activeTab: 0,
    tabs: ['私信', '评论', '点赞', '蹲贴', '回复', '系统'],
    messages: [],
    allMessages: [],
    conversations: [],
    // 各 tab 文字右上角的未读数角标：[私信, 评论, 点赞, 蹲贴, 回复, 系统]
    tabUnread: [0, 0, 0, 0, 0, 0],
    // 蹲贴 tab：0 = 我蹲过的帖子，1 = 其他用户蹲过的我的帖子
    squatTab: 0,
    squatList: [],
    squatMine: [],
    squatTheirs: [],
    squatLoaded: false,
    // 顶部「订阅私信消息提醒」入口：订阅生效（偏好开 + 微信侧已授权）后隐藏，
    // 在设置页关闭「私信通知」后重新出现（见 refreshMessageSubscribeEntry）
    showMessageSubscribeEntry: false,
    messageSubscribeChecked: false
  },

  onLoad(options) {
    const tab = Number(options && options.tab)
    if (Number.isInteger(tab) && tab >= 0 && tab < this.data.tabs.length) {
      this.setData({ activeTab: tab })
    }
    // 液态标签指示条：onLoad 落位可能早于布局完成，onReady 再重测量校正
    this.liquidTab = liquidTab.create(this, {
      track: '.tabs',
      items: '.tab',
      indicator: '.liquid-indicator'
    })
    this.liquidTab.snap(this.data.activeTab)
    this.loadInteractMessages()
    this.loadConversations()
    if (this.data.activeTab === TAB_INDEX_SQUAT) this.loadSquattedPosts(true)
    // 注册实时消息回调
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload.type === 'new_message' || payload.type === 'message') {
        this.loadConversations()
      }
      if (payload.type === 'notification') {
        this.loadInteractMessages()
        // 蹲贴的动态条数（帖子被蹲 / 被取消）依赖列表刷新
        if (this.data.activeTab === TAB_INDEX_SQUAT) this.loadSquattedPosts(true)
      }
    })
  },

  onShow() {
    // 未登录：弹窗引导去登录（取消则退回上一页）
    if (!auth.guardPage('查看我的消息需要先登录')) return
    // 订阅状态可能在设置页被改动（开启/关闭「私信通知」），每次进入都重算入口显隐
    this.refreshMessageSubscribeEntry()
    // 每次显示刷新会话列表
    this.loadConversations()
    this.loadInteractMessages()
    if (this.data.activeTab === TAB_INDEX_SQUAT) this.loadSquattedPosts(true)
    messageStore.syncUnreadCount()
  },

  // ===== 顶部「订阅私信消息提醒」入口 =====
  // 与聊天页顶部入口走同一个 message 触发组（即设置页的「私信通知」渠道），
  // 逻辑复用 utils/subscribe.js 的统一封装，原有逻辑一概不动。
  // 显隐口径：偏好已开且微信侧已授权才隐藏，因此在设置页关闭「私信通知」后入口会自动重新出现。
  refreshMessageSubscribeEntry() {
    // 本地判定为「需要引导」时直接显示（不发额外请求）；
    // 本地认为「已订阅」时再复核一次服务端额度 —— 额度是「点一次允许发一条」，
    // 高频场景（私信）极易用尽；用尽后必须让入口重新出现，否则用户无从重新订阅。
    if (typeof subscribe.entryVisibleAsync === 'function') {
      subscribe.entryVisibleAsync('message')
        .then((need) => this.setData({ showMessageSubscribeEntry: !!need, messageSubscribeChecked: false }))
        .catch(() => {})
      return
    }
    const visible = typeof subscribe.entryVisible === 'function' ? subscribe.entryVisible('message') : false
    this.setData({ showMessageSubscribeEntry: !!visible, messageSubscribeChecked: false })
  },
  // 点击整行（左半区）与拨动开关走同一条路径
  onMessageSubscribeTap(e) {
    // 开关被拨到「关」时不申请授权，只回正视觉状态（入口在订阅生效后本就会整体隐藏）
    if (e && e.detail && e.detail.value === false) { this.setData({ messageSubscribeChecked: false }); return }
    this.setData({ messageSubscribeChecked: true })
    if (typeof subscribe.requestEntryByTap !== 'function') { this.refreshMessageSubscribeEntry(); return }
    // 必须在 tap 同步链内进入原生 API；requestEntryByTap = requestTriggerByTap + 允许后写偏好。
    // 被拒时内部的 guideReopen **不节流**（用户主动点击必须得到反馈）。
    subscribe.requestEntryByTap('message')
      .then(() => this.refreshMessageSubscribeEntry())
      .catch(() => this.refreshMessageSubscribeEntry())
  },

  onReady() {
    // 首次测量可能早于字体/徽标渲染完成，宽度微差在这里校正
    if (this.liquidTab) this.liquidTab.refresh(this.data.activeTab)
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
    if (this.liquidTab) this.liquidTab.destroy()
  },

  loadInteractMessages(append) {
    if (append && (this._notifLoading || this._notifHasMore === false)) return
    const page = append ? (this._notifPage || 1) + 1 : 1
    this._notifLoading = true
    request.get('/notification', { page, pageSize: 50 }, true, { silent: true }).then((res) => {
      this._notifPage = page
      this._notifHasMore = !!res.hasMore
      const mapped = (res.list || []).map((item) => {
        // 有操作者昵称时拆成两行：第一行昵称加粗，第二行动作描述。
        // 这样避免“昵称 + 动作”挤在一行，也便于详情页继续用完整 title。
        const nick = item.actorNick || ''
        let actionText = ''
        if (nick) {
          if (item.type === 'comment') actionText = '评论了你的帖子'
          // 蹲贴通知：区分「你蹲的帖子被评论」与「你的帖子被评论」，
          // 否则用户会误以为是自己发布的帖子收到了评论
          else if (item.type === 'follow') actionText = '评论了你蹲的帖子'
          // 评论被回复：区分「回复了你的评论」与「评论了你的帖子」
          else if (item.type === 'reply') actionText = '回复了你的评论'
          else if (item.type === 'like') actionText = String(item.title || '').indexOf('评论') > -1 ? '点赞了你的评论' : '点赞了你的帖子'
          else actionText = '与你产生了互动'
        }
        const displayTitle = nick ? nick + ' ' + actionText : item.title
        return {
          id: item.id,
          type: item.type,
          title: displayTitle,
          // 消息卡片专用：有操作者时首行只显示昵称；系统等消息首行显示原标题
          primaryText: nick || item.title,
          actionText,
          content: item.content,
          actorNick: nick,
          // 通知快照头像是历史脏路径的高发地（「考拉 (2).jpg」这类已改名的内置素材），
          // 渲染前统一归一化，否则头像空白 + 渲染层刷「Failed to load image」
          actorAvatar: avatar.normalizeLegacyAvatar(item.actorAvatar || ''),
          actorUserId: item.actorUserId || 0,
          postTitle: item.postTitle || '',
          commentImages: item.commentImages || [],
          sourceCommentId: item.sourceCommentId || 0,
          postId: ['comment', 'like', 'follow', 'reply'].indexOf(item.type) > -1 ? item.relatedId : '',
          read: !!item.isRead,
          time: format.formatRelativeTime(item.createdAt)
        }
      })
      this.setInteractionMessages(append ? this.data.allMessages.concat(mapped) : mapped)
    }).catch(() => {}).then(() => { this._notifLoading = false })
  },

  onReachBottom() {
    this.loadInteractMessages(true)
  },

  loadConversations() {
    // 先用本地缓存
    const cached = messageStore.loadConversations()
    if (cached.length) {
      this.setData({ conversations: this.formatConv(cached) }, () => this.updateTotalUnread())
    }
    messageStore.getConversations().then((res) => {
      const list = res.list || []
      messageStore.saveConversations(list)
      this.setData({ conversations: this.formatConv(list) }, () => this.updateTotalUnread())
    }).catch(() => {})
  },

  // 各 tab 右上角未读角标：私信取会话未读之和；评论/点赞/回复/系统按通知类型统计。
  // 进入相应会话或通知详情、未读清零后角标自动消失。
  // 「蹲贴」tab 是被蹲帖子的列表（非消息流），不参与角标统计。
  updateTotalUnread() {
    const pmUnread = this.data.conversations.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0)
    const countByType = (match) => this.data.allMessages.filter((m) => !m.read && match(m.type)).length
    this.setData({
      tabUnread: [
        pmUnread,
        countByType((t) => t === 'comment' || t === 'follow'),
        countByType((t) => t === 'like'),
        0,
        countByType((t) => t === 'reply'),
        countByType((t) => ['system', 'errand', 'repair'].indexOf(t) > -1)
      ]
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, [
      () => this.loadInteractMessages(),
      () => this.loadConversations(),
      () => this.loadSquattedPosts(true)
    ])
  },

  // 蹲贴列表：一次取回「我蹲的」与「别人蹲我的」两组帖子。
  // 前者是当前用户蹲过的帖子，后者是自己的帖子中被其他用户蹲过的（展示蹲贴人数与蹲贴者）。
  loadSquattedPosts(force) {
    if (this.data.squatLoaded && !force) return
    return Promise.all([
      api.getFollowedPosts('mine'),
      api.getFollowedPosts('theirs')
    ]).then((res) => {
      const mine = this.formatSquatPosts((res[0] && res[0].list) || [])
      const theirs = this.formatSquatPosts((res[1] && res[1].list) || [])
      this.setData({
        squatMine: mine,
        squatTheirs: theirs,
        squatList: this.data.squatTab === 0 ? mine : theirs,
        squatLoaded: true
      })
    }).catch(() => {
      this.setData({ squatLoaded: true })
    })
  },

  formatSquatPosts(list) {
    return list.map((p) => ({
      id: p.id,
      // 卡片不展示标题，改展示作者（头像+昵称）与正文
      author: p.nickName || '校园同学',
      avatarUrl: avatar.normalizeLegacyAvatar(p.avatarUrl || '/assets/icons/avatar.png'),
      isAnonymous: !!p.isAnonymous,
      content: this.formatSquatContent(p),
      followCount: Number(p.followCount) || 0,
      isFollowed: !!p.isFollowed,
      // 需求：展示帖子发布时间
      timeText: format.formatRelativeTime(p.createdAt) || '刚刚',
      // 蹲贴者昵称预览（「蹲我的」分组展示「XXX 等 N 人蹲过」）
      squatUsers: (p.squatUsers || []).map((u) => u.nickName).filter(Boolean)
    }))
  },

  // 卡片正文摘要：
  //   1) 换行折成空格 —— 两行截断的卡片里保留 \n 会切出大片空白；
  //   2) 纯图片/视频帖正文为空，用占位文案兜底，否则卡片只剩作者一行，看起来像没内容；
  //   3) 都没有（老数据）也给一句话，避免空白卡片。
  formatSquatContent(post) {
    const text = String((post && post.content) || '').replace(/\s+/g, ' ').trim()
    if (text) return text
    const images = (post && post.images) || []
    return images.length ? '[图片]' : '暂无内容'
  },

  onSquatTab(e) {
    const squatTab = Number(e.currentTarget.dataset.index)
    if (squatTab === this.data.squatTab) return
    this.setData({ squatTab, squatList: squatTab === 0 ? this.data.squatMine : this.data.squatTheirs })
    if (!this.data.squatLoaded) this.loadSquattedPosts()
  },

  onOpenSquatPost(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/post-detail/index?id=' + id })
  },

  // 会话头像加载失败兜底：历史脏路径会让私信列表头像长期空白并刷渲染层错误
  onConvAvatarError(e) {
    const index = Number((e.currentTarget.dataset || {}).index)
    const conversations = this.data.conversations
    if (!Number.isInteger(index) || index < 0 || !conversations[index]) return
    const broken = String(conversations[index].peerAvatar || '')
    const fallback = avatar.looksAnonymousAvatar(broken)
      ? avatar.pickAnonymousAvatar(conversations[index].peerNick || broken)
      : '/assets/icons/avatar.png'
    if (!fallback || fallback === broken) return
    this.setData({ ['conversations[' + index + '].peerAvatar']: fallback })
  },

  // 通知头像加载失败兜底：历史脏路径（改名前存在的内置素材名）会让头像长期空白
  onMsgAvatarError(e) {
    const index = Number((e.currentTarget.dataset || {}).index)
    const messages = this.data.messages
    if (!Number.isInteger(index) || index < 0 || !messages[index]) return
    const broken = String(messages[index].actorAvatar || '')
    const fallback = avatar.looksAnonymousAvatar(broken)
      ? avatar.pickAnonymousAvatar(messages[index].actorNick || broken)
      : '/assets/icons/avatar.png'
    if (!fallback || fallback === broken) return
    this.setData({ ['messages[' + index + '].actorAvatar']: fallback })
  },

  // 蹲贴卡片头像加载失败兜底（同上）
  onSquatAvatarError(e) {
    const index = Number((e.currentTarget.dataset || {}).index)
    const squatList = this.data.squatList
    if (!Number.isInteger(index) || index < 0 || !squatList[index]) return
    const broken = String(squatList[index].avatarUrl || '')
    const fallback = avatar.looksAnonymousAvatar(broken)
      ? avatar.pickAnonymousAvatar(squatList[index].author || broken)
      : '/assets/icons/avatar.png'
    if (!fallback || fallback === broken) return
    this.setData({ ['squatList[' + index + '].avatarUrl']: fallback })
  },

  formatConv(list) {
    return list.map((c) => ({
      // 同一真实用户可有多个分身会话，peerId 不再唯一，组合键避免 wx:key 冲突
      id: c.peerId + '_' + (c.personaKey || 'normal'),
      peerId: c.peerId,
      // 分身会话隔离键：同一真实用户的每个分身各自一个会话入口
      personaKey: c.personaKey || '',
      peerNick: c.peerNick || '用户',
      // 会话头像同样可能是历史脏路径（不存在的内置素材名），渲染前统一归一化
      peerAvatar: avatar.normalizeLegacyAvatar(c.peerAvatar || '/assets/icons/avatar.png'),
      isAnonymous: !!c.isAnonymous,
      unreadCount: c.unreadCount || 0,
      lastMessage: c.lastMessage || '',
      timeText: c.lastTime ? format.formatRelativeTime(c.lastTime) : ''
    }))
  },

  onTab(e) {
    const activeTab = parseInt(e.currentTarget.dataset.tab, 10)
    // 新增触发点：六个 tab（私信 / 评论 / 点赞 / 蹲贴 / 回复 / 系统）点击时
    // 同步申请「私信通知」订阅授权（与聊天页「发送」按钮共用 message 触发组）。
    // 这些 tab 里的通知最终都通过微信服务通知触达，所以统一挂私信组。
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('message')
    this.setData({ activeTab }, () => this.filterInteractionMessages())
    this.liquidTab.moveTo(activeTab)
    // 蹲贴 tab 展示的是帖子列表，数据独立于通知，首次进入才拉取
    if (activeTab === TAB_INDEX_SQUAT) this.loadSquattedPosts()
  },

  onOpenChat(e) {    const peerId = e.currentTarget.dataset.peer
    const nick = e.currentTarget.dataset.nick
    const avatar = e.currentTarget.dataset.avatar
    const anonymous = !!e.currentTarget.dataset.anonymous
    const personaKey = e.currentTarget.dataset.persona || ''
    wx.navigateTo({
      url: '/pages/chat/index?peerId=' + peerId +
        '&nick=' + encodeURIComponent(nick) +
        '&avatar=' + encodeURIComponent(avatar) +
        '&anonymous=' + (anonymous ? '1' : '0') +
        '&personaKey=' + encodeURIComponent(personaKey || '')
    })
  },

  onReadAll() {
    const done = () => {
      const messages = this.data.allMessages.map((m) => Object.assign({}, m, { read: true }))
      this.setInteractionMessages(messages)
      wx.showToast({ title: '已全部标记为已读', icon: 'success' })
    }
    request.put('/notification/read-all', {}, true).then(done).catch(() => {}).finally(() => {
      messageStore.syncUnreadCount()
    })
  },

  onOpenNotification(e) {
    const id = e.currentTarget.dataset.id
    const target = this.data.allMessages.find((item) => Number(item.id) === Number(id))
    const messages = this.data.allMessages.map((item) => Number(item.id) === Number(id) ? Object.assign({}, item, { read: true }) : item)
    this.setInteractionMessages(messages)
    request.put('/notification/' + id + '/read', {}, true, { silent: true }).catch(() => {}).finally(() => {
      messageStore.syncUnreadCount()
    })
    // 评论/点赞通知进入消息详情页（展示评论者、评论内容与原帖完整信息），详情页内可跳转原帖
    // 评论内容可能较长，经 globalData 交接避免 URL 传参截断
    if (target && target.postId) {
      const app = getApp()
      app.__messageDetail = {
        nick: target.actorNick || '',
        avatar: target.actorAvatar || '',
        // actorUserId>0 为真实用户（头像可进主页）；匿名形象/占位用户为 0（不可点击）
        actorUserId: target.actorUserId || 0,
        content: target.content || '',
        time: target.time || '',
        title: target.title || '',
        postTitle: target.postTitle || '',
        commentImages: target.commentImages || [],
        // 来源评论 id：详情页「查看原帖」跳帖子后直接定位到该条评论/回复
        sourceCommentId: target.sourceCommentId || 0
      }
      wx.navigateTo({ url: '/pages/message-detail/index?id=' + target.postId })
    }
  },

  setInteractionMessages(messages) {
    this.setData({ allMessages: messages }, () => { this.filterInteractionMessages(); this.updateTotalUnread(); })
  },

  filterInteractionMessages() {
    const types = TAB_NOTIFY_TYPES[this.data.activeTab]
    // 私信（0）与蹲贴（3）tab 不渲染通知流：前者是会话列表，后者是蹲贴帖子列表
    const messages = !types ? [] : this.data.allMessages.filter((item) => types.indexOf(item.type) > -1)
    this.setData({ messages })
  }
})
