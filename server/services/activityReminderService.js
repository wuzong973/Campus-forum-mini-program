const pool = require('../config/pool')
const subscribeService = require('./subscribeService')

// 活动开始前多久提醒（分钟）
const REMIND_BEFORE_MINUTES = 30
// 扫描间隔：活动提醒精度要求不高，10 分钟一轮足够，避免频繁查库
const SCAN_INTERVAL_MS = 10 * 60 * 1000

let timer = null

/**
 * 扫描「即将开始且尚未提醒过」的活动，给已报名的用户下发活动提醒。
 *
 * 幂等设计：campus_activity 增加 remind_sent_at 标记，同一活动只提醒一次；
 * 即便多实例部署或进程重启，也不会重复给用户发提醒（避免浪费额度）。
 */
async function scanAndRemind() {
  try {
    const [activities] = await pool.query(
      `SELECT id, title, location, activity_start, activity_end
       FROM campus_activity
       WHERE deleted = 0 AND status = 1 AND audit_status = 'approved'
         AND remind_sent_at IS NULL
         AND activity_start IS NOT NULL
         AND activity_start > NOW()
         AND activity_start <= DATE_ADD(NOW(), INTERVAL ? MINUTE)`,
      [REMIND_BEFORE_MINUTES]
    )
    if (!activities.length) return

    for (const activity of activities) {
      // P13：先确认有报名人再占位。原来先写 remind_sent_at 再查报名，
      // 「扫描时还没人报名、之后才报上」的活动会被永久标记成已提醒，报名者一条提醒都收不到。
      const [signups] = await pool.query(
        'SELECT user_id FROM activity_signup WHERE activity_id = ?',
        [activity.id]
      )
      // 无人可提醒：不写标记，下一轮（活动开始前都仍在扫描窗口内）再试
      if (!signups.length) continue

      // 确认有收件人后再条件更新占位：多实例并发只有一个抢到，避免重复发送烧额度
      const [claimed] = await pool.query(
        'UPDATE campus_activity SET remind_sent_at = NOW() WHERE id = ? AND remind_sent_at IS NULL',
        [activity.id]
      )
      if (!claimed.affectedRows) continue

      // 活动开始提醒：逐个走 activityStart 模板（date 字段格式由 subscribeService 内统一转换）
      const results = await Promise.allSettled(signups.map((s) => subscribeService.pushActivityStart(s.user_id, {
        activityTitle: activity.title,
        activityStart: activity.activity_start,
        activityEnd: activity.activity_end,
        location: activity.location,
        activityId: activity.id
      })))
      const sent = results.filter((r) => r.status === 'fulfilled' && r.value.sent).length
      console.log(`[ActivityReminder] 活动 #${activity.id}「${activity.title}」已提醒 ${sent} 人`)
    }
  } catch (e) {
    console.error('[ActivityReminder]', e.message)
  }
}

function start() {
  if (timer) return
  // 启动后延迟 1 分钟首扫，避免与服务启动争抢数据库连接
  setTimeout(scanAndRemind, 60 * 1000)
  timer = setInterval(scanAndRemind, SCAN_INTERVAL_MS)
  console.log(`[ActivityReminder] 已启动，每 ${SCAN_INTERVAL_MS / 60000} 分钟扫描一次，提前 ${REMIND_BEFORE_MINUTES} 分钟提醒`)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

module.exports = { start, stop, scanAndRemind }
