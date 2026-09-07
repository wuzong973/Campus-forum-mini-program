const request = require('./request')

const PROFILE_QUEUE_KEY = 'pending_profile_sync'
const SCHEDULE_QUEUE_KEY = 'pending_schedule_config_sync'

function queueProfile(fields) {
  const current = wx.getStorageSync(PROFILE_QUEUE_KEY) || {}
  wx.setStorageSync(PROFILE_QUEUE_KEY, Object.assign({}, current, fields, { updatedAt: Date.now() }))
}

function hasPendingProfile() {
  return !!wx.getStorageSync(PROFILE_QUEUE_KEY)
}

async function flushProfile() {
  const pending = wx.getStorageSync(PROFILE_QUEUE_KEY)
  if (!pending) return false
  const payload = Object.assign({}, pending)
  delete payload.updatedAt
  await request.put('/user/info', payload, true, { silent: true, retryable: true, idempotencyKey: `profile_${pending.updatedAt}` })
  wx.removeStorageSync(PROFILE_QUEUE_KEY)
  return true
}

function queueScheduleConfig(config) {
  wx.setStorageSync(SCHEDULE_QUEUE_KEY, Object.assign({}, config, { updatedAt: Date.now() }))
}

async function flushScheduleConfig() {
  const pending = wx.getStorageSync(SCHEDULE_QUEUE_KEY)
  if (!pending) return false
  const payload = Object.assign({}, pending)
  delete payload.updatedAt
  await request.put('/schedule/config', payload, true, { silent: true, retryable: true, idempotencyKey: `schedule_${pending.updatedAt}` })
  wx.removeStorageSync(SCHEDULE_QUEUE_KEY)
  return true
}

module.exports = { queueProfile, hasPendingProfile, flushProfile, queueScheduleConfig, flushScheduleConfig }
