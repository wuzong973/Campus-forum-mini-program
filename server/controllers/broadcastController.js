const groupBroadcastService = require('../services/groupBroadcastService')
const { success, fail } = require('../middleware/auth')

// 微信群播报（论坛广播）：内容生产线。官方接口只到「生成文案 + 小程序短链」，
// 发进微信群靠运营者复制（或后续接协议机器人调 runOnce）。

exports.list = async (req, res) => {
  try {
    const pool = require('../config/pool')
    const [rows] = await pool.query(
      `SELECT id, window_start windowStart, window_end windowEnd, post_count postCount,
              content, delivered, delivered_at deliveredAt, created_at createdAt
       FROM group_broadcast_log ORDER BY id DESC LIMIT 20`
    )
    success(res, { broadcasts: rows })
  } catch (e) {
    fail(res, e.message, 500)
  }
}

// 手动生成一条播报：默认接着上次的窗口扫，可传 windowStart 指定起点（ISO 或 yyyy-MM-dd HH:mm:ss）
exports.runNow = async (req, res) => {
  try {
    const windowStart = req.body && req.body.windowStart ? new Date(req.body.windowStart) : undefined
    const result = await groupBroadcastService.runOnce({ windowStart })
    success(res, result)
  } catch (e) {
    fail(res, e.message, 500)
  }
}
