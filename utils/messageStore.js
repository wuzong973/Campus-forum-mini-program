// 私信本地缓存管理 + WebSocket 连接管理
const request = require('./request')
const mockData = require('./mock')

const WS_BASE = request.getWsUrl()
const CACHE_PREFIX = 'pm_history_' // pm_history_<peerId>
const CONV_CACHE_KEY = 'pm_conversations'
const UNREAD_KEY = 'pm_unread_total'

let socket = null
let reconnectTimer = null
let heartbeatTimer = null
let reconnectAttempts = 0 // 连续失败次数，用于指数退避
const MAX_RECONNECT_DELAY = 60000 // 重连间隔上限（毫秒）
let messageHandlers = [] // 外部注册的消息回调

function getAppInstance() {
  try {
    var app = getApp()
    if (!app) return { globalData: { token: '', userInfo: null } }
    if (!app.globalData) app.globalData = { token: '', userInfo: null }
    return app
  } catch (e) {
    return { globalData: { token: '', userInfo: null } }
  }
}

function getToken() {
  var app = getAppInstance()
  return (app.globalData && app.globalData.token) || ''
}

// ===== 本地缓存 =====
function loadCache(peerId) {
  const cached = wx.getStorageSync(CACHE_PREFIX + peerId)
  if (cached && cached.length) return cached
  if (request.USE_MOCK && mockData.mockMessages && mockData.mockMessages[peerId]) {
    return mockData.mockMessages[peerId]
  }
  return []
}

function saveCache(peerId, messages) {
  // 仅保留最近 200 条
  const list = messages.slice(-200)
  wx.setStorageSync(CACHE_PREFIX + peerId, list)
}

function appendCache(peerId, message) {
  const list = loadCache(peerId)
  // 去重（按 id）
  if (!list.find((m) => m.id === message.id)) {
    list.push(message)
    saveCache(peerId, list)
  }
}

function updateCacheStatus(peerId, messageId, status) {
  const list = loadCache(peerId)
  const idx = list.findIndex((m) => m.id === messageId)
  if (idx >= 0) {
    list[idx].status = status
    saveCache(peerId, list)
  }
}

function removeCachedMessage(peerId, messageId) {
  saveCache(peerId, loadCache(peerId).filter((item) => Number(item.id) !== Number(messageId)))
}

function saveConversations(list) {
  wx.setStorageSync(CONV_CACHE_KEY, list)
}

function loadConversations() {
  const cached = wx.getStorageSync(CONV_CACHE_KEY)
  if (cached && cached.length) return cached
  if (request.USE_MOCK) return mockData.mockConversations || []
  return []
}

function getUnreadTotal() {
  const cached = wx.getStorageSync(UNREAD_KEY)
  if (cached !== undefined && cached !== null) return cached
  if (request.USE_MOCK && mockData.mockConversations) {
    return mockData.mockConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
  }
  return 0
}

function setUnreadTotal(n) {
  wx.setStorageSync(UNREAD_KEY, n)
  // 更新 tabBar 红点
  updateTabBarBadge(n)
}

function updateTabBarBadge(n) {
  const pages = getCurrentPages()
  const cur = pages[pages.length - 1]
  if (!cur) return
  // 用户页 tabBar 角标
  try {
    if (n > 0) {
      wx.setTabBarBadge({ index: 3, text: n > 99 ? '99+' : String(n) })
    } else {
      wx.removeTabBarBadge({ index: 3 })
    }
  } catch (e) { /* ignore */ }
}

// ===== WebSocket 连接 =====
function connect() {
  if (request.USE_MOCK) return
  const token = getToken()
  if (!token) return
  if (socket && (socket.readyState === 1 || socket.readyState === 0)) return

  try {
    socket = wx.connectSocket({
      url: WS_BASE + '?token=' + encodeURIComponent(token),
      success() {},
      fail() {}
    })
  } catch (e) {
    scheduleReconnect()
    return
  }

  socket.onOpen(() => {
    reconnectAttempts = 0 // 连接成功后重置退避计数
    startHeartbeat()
  })

  socket.onMessage((res) => {
    let msg
    try { msg = JSON.parse(res.data) } catch (e) { return }
    if (msg.type === 'pong') return
    if (msg.type === 'private_message') {
      handleIncomingMessage(msg.data)
    }
    if (msg.type === 'private_message_recalled') {
      removeCachedMessage(msg.data.peerId, msg.data.id)
      notifyHandlers({ type: 'message_recalled', peerId: msg.data.peerId, data: msg.data })
    }
    // 跑腿订单专属聊天消息（与私信独立）：转发给订阅方（跑腿聊天页实时刷新）
    if (msg.type === 'errand_message') {
      notifyHandlers({ type: 'errand_message', data: msg.data })
    }
    if (msg.type === 'notification') {
      notifyHandlers({ type: 'notification', data: msg.data })
    }
  })

  socket.onClose((res) => {
    stopHeartbeat()
    // 4001: token 无效/过期，重连也不会成功，跳过自动重连
    if (res && res.code === 4001) return
    scheduleReconnect()
  })

  socket.onError(() => {
    stopHeartbeat()
    scheduleReconnect()
  })
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (socket && socket.readyState === 1) {
      socket.send({ data: JSON.stringify({ type: 'ping' }) })
    }
  }, 25000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const token = getToken()
  if (!token) return
  // 指数退避：5s、10s、20s... 最大 60s，避免无限快速重连
  const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY)
  reconnectAttempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  stopHeartbeat()
  if (socket) {
    try { socket.close({}) } catch (e) {}
    socket = null
  }
}

// 处理收到的实时消息
function handleIncomingMessage(data) {
  const app = getAppInstance()
  const currentUserId = (app.globalData.userInfo || {}).id || 0
  if (data.receiverId !== currentUserId) return
  const peerId = data.senderId

  // 写入本地缓存
  appendCache(peerId, {
    id: data.id,
    senderId: data.senderId,
    receiverId: data.receiverId,
    content: data.content,
    msgType: data.msgType || 'text',
    status: 'delivered',
    createdAt: data.createdAt,
    isMine: false
  })

  // 更新未读数（除当前正在打开的会话）
  const pages = getCurrentPages()
  const cur = pages[pages.length - 1]
  const inChat = cur && cur.route === 'pages/chat/index' && cur.data && cur.data.peerId === peerId
  if (!inChat) {
    const total = getUnreadTotal() + 1
    setUnreadTotal(total)
    // 通知已注册的回调（消息列表页刷新等）
    notifyHandlers({ type: 'new_message', peerId, data })
  } else {
    // 当前正在聊天，标记已读
    markRead(peerId)
  }
  // 触发 UI 更新
  notifyHandlers({ type: 'message', peerId, data })
}

function onMessage(handler) {
  messageHandlers.push(handler)
  return () => {
    messageHandlers = messageHandlers.filter((h) => h !== handler)
  }
}

function notifyHandlers(payload) {
  messageHandlers.forEach((h) => {
    try { h(payload) } catch (e) {}
  })
}

// ===== API 调用 =====
function sendMessage(receiverId, content, msgType = 'text', anonymous = false, anonymousIdentity = null) {
  if (request.USE_MOCK) {
    const message = { id: Date.now(), senderId: (getAppInstance().globalData.userInfo || {}).id || 1, receiverId, content, msgType, status: 'sent', createdAt: new Date().toISOString(), isMine: true }
    appendCache(receiverId, message)
    return Promise.resolve(message)
  }
  const body = { receiverId, content, msgType, anonymous }
  // 匿名发送时携带自己一侧的分身形象，服务端首次存档后收信方列表/聊天页统一显示
  if (anonymous && anonymousIdentity && anonymousIdentity.nickName && anonymousIdentity.avatarUrl) {
    body.anonNick = anonymousIdentity.nickName
    body.anonAvatar = anonymousIdentity.avatarUrl
  }
  return request.post('/message/send', body, true)
}

function getHistory(peerId, page, pageSize, anonymous = false, anonymousIdentity = null, anonSide = 'peer') {
  if (request.USE_MOCK) {
    const list = loadCache(peerId)
    return Promise.resolve({ list: list, total: list.length, hasMore: false })
  }
  const query = { peerId, page, pageSize, anonymous: anonymous ? 1 : 0 }
  // 匿名会话首次进入时把分身身份传给服务端存档（服务端只存一次）
  if (anonymousIdentity && anonymousIdentity.nickName && anonymousIdentity.avatarUrl) {
    query.anonNick = anonymousIdentity.nickName
    query.anonAvatar = anonymousIdentity.avatarUrl
    // 分身属于发起方自己（分身私信普通用户）时告知服务端存档方向
    if (anonSide === 'self') query.anonSide = 'self'
  }
  return request.get('/message/history', query, true)
}

function recallMessage(peerId, messageId) {
  if (request.USE_MOCK) { removeCachedMessage(peerId, messageId); return Promise.resolve(null) }
  return request.post('/message/' + messageId + '/recall', {}, true).then((res) => { removeCachedMessage(peerId, messageId); return res })
}

function getConversations() {
  if (request.USE_MOCK) return Promise.resolve(loadConversations())
  return request.get('/message/conversations', {}, true)
}

function markRead(peerId) {
  if (request.USE_MOCK) return Promise.resolve(null)
  return request.put('/message/read', { peerId }, true, { silent: true }).then((res) => {
    syncUnreadCount()
    return res
  }).catch((err) => {
    syncUnreadCount()
    throw err
  })
}

function getUnreadCount() {
  if (request.USE_MOCK) return Promise.resolve({ total: getUnreadTotal() })
  return request.get('/message/unread-count', {}, true, { silent: true })
}

function updateMessageStatus(messageId, status) {
  if (request.USE_MOCK) return Promise.resolve(null)
  return request.put('/message/status', { messageId, status }, true, { silent: true })
}

function blockPeer(peerId) {
  if (request.USE_MOCK) return Promise.resolve({ blocked: true })
  return request.post('/message/block', { peerId }, true)
}

function unblockPeer(peerId) {
  if (request.USE_MOCK) return Promise.resolve({ blocked: false })
  return request.post('/message/unblock', { peerId }, true)
}

function getBlacklist() {
  if (request.USE_MOCK) return Promise.resolve({ list: [] })
  return request.get('/message/blacklist', {}, true)
}

// 同步未读数到本地
function syncUnreadCount() {
  return getUnreadCount().then((res) => {
    setUnreadTotal(res.total || 0)
    return res.total || 0
  }).catch(() => 0)
}

module.exports = {
  // 缓存
  loadCache, saveCache, appendCache, updateCacheStatus, removeCachedMessage,
  loadConversations, saveConversations,
  getUnreadTotal, setUnreadTotal, updateTabBarBadge,
  // WebSocket
  connect, disconnect, onMessage,
  // API
  sendMessage, getHistory, recallMessage, getConversations, markRead,
  getUnreadCount, updateMessageStatus, syncUnreadCount,
  blockPeer, unblockPeer, getBlacklist
}
