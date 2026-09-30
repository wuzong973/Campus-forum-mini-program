const request = require('./request')
const schedule = require('./schedule')

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
  // 自愈：旧版本可能把 2026-02-30 这类非法日期写进队列，服务端会一直拒绝，
  // 连带隐藏周末 / 上课提醒 / 背景色三项也存不上，所以发送前先纠正
  payload.startDate = schedule.legalizeStartDate(payload.startDate)
  // 自愈：bg_color 若混入超长脏值（正常是 7 位 hex 或 ~45 字符渐变串），
  // 会在服务端 ER_DATA_TOO_LONG → 500，且 5xx 不清队列——一条坏颜色会把
  // 提醒开关 / 隐藏周末等所有后续保存全部卡死，这里直接回退默认色放行
  payload.bgColor =
    typeof payload.bgColor === 'string' && payload.bgColor.length <= 128
      ? payload.bgColor
      : '#F5F7FA'
  try {
    await request.put('/schedule/config', payload, true, { silent: true, retryable: true, idempotencyKey: `schedule_${pending.updatedAt}` })
  } catch (err) {
    // 4xx 是服务端明确拒绝这份内容（如开始日期非法），重试永远不会成功；
    // 不清队列的话每次冷启动都会再打一次，线上表现为该接口长期 500
    if (err && err.statusCode >= 400 && err.statusCode < 500) wx.removeStorageSync(SCHEDULE_QUEUE_KEY)
    throw err
  }
  wx.removeStorageSync(SCHEDULE_QUEUE_KEY)
  return true
}

module.exports = { queueProfile, hasPendingProfile, flushProfile, queueScheduleConfig, flushScheduleConfig }
