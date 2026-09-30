// Per-account hand-off for a status changed on another order page. It allows
// the list to repaint from its cached data before the confirming request ends.
const KEY_PREFIX = 'errand_pending_status_updates:'
const MAX_AGE = 5 * 60 * 1000

function userKey() {
  try {
    const app = getApp()
    const user = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {}
    return KEY_PREFIX + (user.id == null ? 'anonymous' : String(user.id))
  } catch (e) { return KEY_PREFIX + 'anonymous' }
}

function read() {
  let raw = {}
  try { raw = wx.getStorageSync(userKey()) || {} } catch (e) {}
  const now = Date.now()
  const result = {}
  Object.keys(raw).forEach((id) => {
    const update = raw[id]
    if (update && update.status && now - Number(update.updatedAt || 0) <= MAX_AGE) result[String(id)] = update
  })
  return result
}

function publish(id, status) {
  if (id == null || !status) return
  const updates = read()
  updates[String(id)] = { status: String(status), updatedAt: Date.now() }
  try { wx.setStorageSync(userKey(), updates) } catch (e) {}
}

function consume() {
  const updates = read()
  try { wx.removeStorageSync(userKey()) } catch (e) {}
  const statuses = {}
  Object.keys(updates).forEach((id) => { statuses[id] = updates[id].status })
  return statuses
}

module.exports = { publish, consume }
