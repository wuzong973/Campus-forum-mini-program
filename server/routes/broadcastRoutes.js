const express = require('express')
const router = express.Router()
const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')

/**
 * 群播报机器人通道（供「企微 PC 客户端 UI 自动化」脚本轮询）。
 *
 * 鉴权：请求头 X-Bot-Token 必须等于服务器 .env 的 BROADCAST_BOT_TOKEN；
 * 该环境变量未配置时整个通道关闭（404），避免裸奔接口被扫到。
 */

function botAuth(req, res, next) {
  const token = process.env.BROADCAST_BOT_TOKEN
  if (!token) return fail(res, 'bot channel disabled', 404)
  if (String(req.headers['x-bot-token'] || '') !== token) return fail(res, 'invalid bot token', 401)
  next()
}

router.use(botAuth)

// 领取一条待发播报：只发「最近 30 分钟内生成」的最新一条；
// 抢占锁 bot_claimed_at（5 分钟过期）防止多机器人/重试导致重复发群
router.get('/pending', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, content, post_count AS postCount, created_at AS createdAt
       FROM group_broadcast_log
       WHERE group_sent = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
       ORDER BY id DESC LIMIT 1`
    )
    if (!rows.length) return success(res, null)
    const [claimed] = await pool.query(
      `UPDATE group_broadcast_log SET bot_claimed_at = NOW()
       WHERE id = ? AND (bot_claimed_at IS NULL OR bot_claimed_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE))`,
      [rows[0].id]
    )
    if (!claimed.affectedRows) return success(res, null)
    success(res, rows[0])
  } catch (e) {
    next(e)
  }
})

// 回报发送完成：本条标记已发，同时把更早的滞留待发标记为跳过(2)，机器人不补发旧消息
router.post('/:id/sent', async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0
    if (!id) return fail(res, 'invalid id', 400)
    const [result] = await pool.query(
      'UPDATE group_broadcast_log SET group_sent = 1, group_sent_at = NOW() WHERE id = ? AND group_sent = 0',
      [id]
    )
    await pool.query('UPDATE group_broadcast_log SET group_sent = 2 WHERE group_sent = 0 AND id < ?', [id])
    success(res, { updated: result.affectedRows })
  } catch (e) {
    next(e)
  }
})

module.exports = router
