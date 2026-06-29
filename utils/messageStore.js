// 私信本地缓存管理 + WebSocket 连接管理
const request = require('./request')

const WS_BASE = 'ws://127.0.0.1:3000/ws'
const CACHE_PREFIX = 'pm_history_' // pm_history_<peerId>
const CONV_CACHE_KEY = 'pm_conversations'
const UNREAD_KEY = 'pm_unread_total'

let socket = null
let reconnectTimer = null
let heartbeatTimer = null
let messageHandlers = [] // 外部注册的消息回调

function getAppInstance() {
  try { return getApp() } catch (e) { return { globalData: { token: '' } } }
}

function getToken() {
  const app = getAppInstance()
  return app.globalData.token || ''
}

// ===== 本地缓存 =====
function loadCache(peerId) {
  return wx.getStorageSync(CACHE_PREFIX + peerId) || []
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

function saveConversations(list) {
  wx.setStorageSync(CONV_CACHE_KEY, list)
}

function loadConversations() {
  return wx.getStorageSync(CONV_CACHE_KEY) || []
}

function getUnreadTotal() {
  return wx.getStorageSync(UNREAD_KEY) || 0
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
    startHeartbeat()
  })

  socket.onMessage((res) => {
    let msg
    try { msg = JSON.parse(res.data) } catch (e) { return }
    if (msg.type === 'pong') return
    if (msg.type === 'private_message') {
      handleIncomingMessage(msg.data)
    }
  })

  socket.onClose(() => {
    stopHeartbeat()
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
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 5000)
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
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
function sendMessage(receiverId, content) {
  return request.post('/message/send', { receiverId, content }, true)
}

function getHistory(peerId, page, pageSize) {
  return request.get('/message/history', { peerId, page, pageSize }, true)
}

function getConversations() {
  return request.get('/message/conversations', {}, true)
}

function markRead(peerId) {
  return request.put('/message/read', { peerId }, true, { silent: true }).then((res) => {
    syncUnreadCount()
    return res
  }).catch((err) => {
    syncUnreadCount()
    throw err
  })
}

function getUnreadCount() {
  return request.get('/message/unread-count', {}, true, { silent: true })
}

function updateMessageStatus(messageId, status) {
  return request.put('/message/status', { messageId, status }, true, { silent: true })
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
  loadCache, saveCache, appendCache, updateCacheStatus,
  loadConversations, saveConversations,
  getUnreadTotal, setUnreadTotal, updateTabBarBadge,
  // WebSocket
  connect, disconnect, onMessage,
  // API
  sendMessage, getHistory, getConversations, markRead,
  getUnreadCount, updateMessageStatus, syncUnreadCount
}
