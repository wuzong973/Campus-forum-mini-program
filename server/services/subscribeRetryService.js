const subscribeService = require('./subscribeService')

// 待发订阅消息的补发扫描。
//
// 背景：合并窗口（同类 5 分钟只发一条）与额度不足原先都是「直接丢弃」——
// 用户看到 3 条评论只收到 1 条、或者授权次数用尽后再也收不到，且完全无感知。
// 现在这两类内容会落进 subscribe_pending_message，由本任务在窗口过去 / 额度恢复后补发。
//
// 扫描间隔 1 分钟：待发记录自身的重试间隔是 2 分钟，扫描比它略密即可，
// 保证到期的记录最多等 1 分钟就被处理。
const SCAN_INTERVAL_MS = 60 * 1000
const BATCH_LIMIT = 50

let timer = null
let running = false

async function runOnce() {
  if (running) return
  running = true
  try {
    await subscribeService.flushPending(BATCH_LIMIT)
  } catch (e) {
    console.error('[SubscribeRetry]', e.message)
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  // 启动 20 秒后先跑一次，之后每分钟扫描待补发的订阅消息
  timer = setInterval(runOnce, SCAN_INTERVAL_MS)
  setTimeout(() => { runOnce() }, 20 * 1000)
  console.log('[SubscribeRetry] 订阅消息待发补发任务已启动（每分钟扫描：合并窗口过期 / 额度恢复后补发）')
}

module.exports = { start, runOnce }
