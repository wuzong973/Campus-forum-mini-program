const WebSocket = require('ws')
const jwt = require('jsonwebtoken')
const jwtConfig = require('../config/jwt')

// 在线用户连接池：userId -> Set<WebSocket>
const onlineClients = new Map()

let wss = null

/**
 * 初始化 WebSocket 服务器
 * @param {http.Server} server HTTP 服务器实例
 */
function init(server) {
  wss = new WebSocket.Server({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    // 从 URL query 解析 token
    const url = new URL(req.url, 'http://localhost')
    const token = url.searchParams.get('token')
    let userId = 0
    if (token) {
      try {
        const decoded = jwt.verify(token, jwtConfig.secret)
        userId = decoded.userId
      } catch (e) {
        ws.close(4001, 'Token无效')
        return
      }
    }
    if (!userId) {
      ws.close(4002, '未登录')
      return
    }

    // 注册到连接池
    if (!onlineClients.has(userId)) {
      onlineClients.set(userId, new Set())
    }
    onlineClients.get(userId).add(ws)
    ws.userId = userId

    // 通知该用户所有连接：上线状态变化可在此处理

    ws.on('message', (raw) => {
      // 心跳/客户端消息处理
      let msg
      try { msg = JSON.parse(raw) } catch (e) { return }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    })

    ws.on('close', () => {
      const set = onlineClients.get(userId)
      if (set) {
        set.delete(ws)
        if (!set.size) onlineClients.delete(userId)
      }
    })

    ws.on('error', () => {
      // 忽略连接错误
    })
  })
}

/**
 * 向指定用户推送消息（所有活跃连接）
 * @param {number} userId
 * @param {object} payload
 */
function sendToUser(userId, payload) {
  const set = onlineClients.get(userId)
  if (!set || !set.size) return false
  const text = JSON.stringify(payload)
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(text)
    }
  })
  return true
}

/**
 * 判断用户是否在线
 */
function isOnline(userId) {
  const set = onlineClients.get(userId)
  return !!(set && set.size)
}

module.exports = { init, sendToUser, isOnline }
