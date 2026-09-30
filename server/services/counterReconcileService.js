const pool = require('../config/pool')
const { safeMessage } = require('../utils/helpers')

/**
 * 帖子/评论计数器对账（P22）
 *
 * 背景：like_count / comment_count / favorite_count / follow_count / share_count
 * 与明细表（forum_like 等）是**双写**关系。任何一次「明细写入成功但计数更新回滚」
 * 「历史数据迁移」「人工删库清数据」都会让展示数与明细不一致，而列表、热榜、
 * 我的-互动统计都直接读计数器，用户看到的数字就会长期偏差。
 *
 * 策略：不做全表扫描 —— 每轮只重算「最近仍在变动」的帖子（updated_at 落在窗口内），
 * 按主键分批更新；数值已经一致时 UPDATE 影响 0 行，不会持续写盘。
 */
const SCAN_INTERVAL_MS = 30 * 60 * 1000
// 只回看最近 12 小时有变更的帖子：比扫描间隔留一倍余量，避免两轮之间漏掉
const RECENT_WINDOW_HOURS = 12
const BATCH_SIZE = 200

let timer = null
let running = false

function placeholders(list) {
  return list.map(() => '?').join(',')
}

// 帖子维度五个计数器 + 评论点赞数一次性重算
async function recomputePosts(postIds) {
  if (!postIds.length) return 0
  const [result] = await pool.query(
    `UPDATE forum_post p SET
       like_count = (SELECT COUNT(*) FROM forum_like l WHERE l.post_id = p.id),
       comment_count = (SELECT COUNT(*) FROM forum_comment c WHERE c.post_id = p.id AND c.status = 1),
       favorite_count = (SELECT COUNT(*) FROM forum_favorite f WHERE f.post_id = p.id),
       follow_count = (SELECT COUNT(*) FROM forum_post_follow fo WHERE fo.post_id = p.id),
       share_count = (SELECT COUNT(*) FROM forum_share s WHERE s.post_id = p.id AND s.status = 1)
     WHERE p.id IN (${placeholders(postIds)})`,
    postIds,
  )
  return result.affectedRows || 0
}

// 评论点赞数：按这批帖子下的评论重算（评论没有 updated_at，只能挂在帖子上回看）
async function recomputeCommentLikes(postIds) {
  if (!postIds.length) return 0
  const [result] = await pool.query(
    `UPDATE forum_comment c SET
       like_count = (SELECT COUNT(*) FROM forum_comment_like cl WHERE cl.comment_id = c.id)
     WHERE c.post_id IN (${placeholders(postIds)}) AND c.status = 1`,
    postIds,
  )
  return result.affectedRows || 0
}

async function runOnce() {
  const [rows] = await pool.query(
    `SELECT id FROM forum_post
     WHERE updated_at >= NOW() - INTERVAL ? HOUR
     ORDER BY updated_at DESC
     LIMIT ${BATCH_SIZE}`,
    [RECENT_WINDOW_HOURS],
  )
  const postIds = rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0)
  if (!postIds.length) return { scanned: 0, fixed: 0 }
  const fixedPosts = await recomputePosts(postIds)
  const fixedComments = await recomputeCommentLikes(postIds)
  return { scanned: postIds.length, fixed: fixedPosts, fixedComments }
}

async function scan() {
  if (running) return
  running = true
  try {
    const result = await runOnce()
    if (result.fixed) console.log(`[CounterReconcile] 已校正 ${result.fixed} 个帖子的计数（本轮检查 ${result.scanned} 个）`)
  } catch (error) {
    console.error('[CounterReconcile]', safeMessage(error))
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  timer = setInterval(scan, SCAN_INTERVAL_MS)
  // 启动后延迟 3 分钟首跑，避开服务启动与迁移高峰
  setTimeout(() => { scan() }, 3 * 60 * 1000)
  console.log(`[CounterReconcile] 计数器对账任务已启动（每 ${SCAN_INTERVAL_MS / 60000} 分钟重算最近 ${RECENT_WINDOW_HOURS} 小时有变更的帖子）`)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

module.exports = { start, stop, scan, runOnce }
