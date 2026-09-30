// 注销执行任务回归测试：验证 deleteUserData 真正删除用户内容、去标识化账号，
// 且不破坏必须留存的财务/审计记录。用假连接捕获所有 SQL，不触达真实数据库。
const assert = require('assert')
const svc = require('../services/accountDeletionService')

function makeFakeConn() {
  const calls = []
  const conn = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ text, params })
      // 预置返回：让收集型 SELECT 返回可控数据
      if (/^SELECT id FROM forum_post WHERE user_id/.test(text)) return [[{ id: 101 }, { id: 102 }]]
      if (/^SELECT id, post_id FROM forum_comment WHERE user_id/.test(text)) return [[{ id: 501, post_id: 200 }]]
      if (/^SELECT id FROM forum_comment WHERE post_id IN/.test(text)) return [[{ id: 502 }, { id: 503 }]]
      if (/^SELECT post_id AS id FROM forum_like/.test(text)) return [[{ id: 300 }, { id: 200 }]]
      return [[]]
    },
  }
  return { conn, calls }
}

;(async () => {
  const { conn, calls } = makeFakeConn()
  await svc.deleteUserData(conn, 7)

  const deletes = calls.filter((c) => /^DELETE FROM/.test(c.text)).map((c) => c.text)
  const hasDelete = (table) => deletes.some((t) => t.includes(`DELETE FROM ${table} `))

  // 社区内容与互动
  assert.ok(hasDelete('forum_post'), '应删除用户发布的帖子')
  assert.ok(hasDelete('forum_comment'), '应删除评论')
  assert.ok(hasDelete('forum_comment_like'), '应删除评论点赞')
  assert.ok(hasDelete('forum_like'), '应删除点赞')
  assert.ok(hasDelete('forum_favorite'), '应删除收藏')
  assert.ok(hasDelete('forum_post_follow'), '应删除蹲贴')
  assert.ok(hasDelete('forum_share'), '应删除分享')
  assert.ok(hasDelete('post_view'), '应删除浏览记录')
  assert.ok(hasDelete('post_hidden_preference'), '应删除不感兴趣偏好')

  // 私信（双向）
  assert.ok(hasDelete('private_message'), '应删除私信消息')
  assert.ok(hasDelete('private_conversation'), '应删除私信会话')
  assert.ok(hasDelete('private_message_recall_log'), '应删除撤回日志')

  // 通知 / 教务 / 课表
  assert.ok(hasDelete('system_notification'), '应删除通知')
  assert.ok(hasDelete('jw_credential'), '应删除教务凭证')
  assert.ok(hasDelete('jw_captcha_challenge'), '应删除验证码挑战')
  assert.ok(hasDelete('user_schedule'), '应删除课表')
  assert.ok(hasDelete('schedule_config'), '应删除课表配置')
  assert.ok(hasDelete('user_exam'), '应删除考试')
  assert.ok(hasDelete('user_grade'), '应删除成绩')

  // 各类申请 / 报名 / 反馈 / 评价 / 认证 / 黑名单
  assert.ok(hasDelete('club_apply'), '应删除社团申请')
  assert.ok(hasDelete('group_chat_apply'), '应删除建群申请')
  assert.ok(hasDelete('activity_signup'), '应删除活动报名')
  assert.ok(hasDelete('user_feedback'), '应删除反馈')
  assert.ok(hasDelete('feedback_comment'), '应删除反馈回复')
  assert.ok(hasDelete('review_rating'), '应删除评价打分')
  assert.ok(hasDelete('review_comment'), '应删除评价评论')
  assert.ok(hasDelete('rider_verification'), '应删除骑手认证')
  assert.ok(hasDelete('user_blacklist'), '应删除黑名单')

  // 去标识化账号：UPDATE sys_user 且置 status=0、phone=NULL、openid 打墓碑
  const anon = calls.find((c) => /UPDATE sys_user SET/.test(c.text))
  assert.ok(anon, '应去标识化 sys_user')
  assert.ok(/status = 0/.test(anon.text), '账号应置为不可用')
  assert.ok(/phone = NULL/.test(anon.text), '应清空手机号')
  assert.ok(/openid = \?/.test(anon.text), '应重置 openid')
  assert.ok(String(anon.params[0]).startsWith('deleted_7_'), 'openid 墓碑应含用户 id')

  // 计数重算：受影响他人帖子（300/200，排除自己的 101/102）
  const recompute = calls.find((c) => /UPDATE forum_post p SET/.test(c.text))
  assert.ok(recompute, '应重算受影响帖子计数')
  assert.ok(recompute.params.includes(300) && recompute.params.includes(200), '应覆盖被互动/被评论的他人帖子')
  assert.ok(!recompute.params.includes(101) && !recompute.params.includes(102), '不应重算将被删除的本人帖子')

  // 关键护栏：不得删除财务/审计留痕
  for (const table of ['errand_order', 'payment_transaction', 'payment_refund', 'wallet_ledger', 'wallet_withdrawal', 'repair_order', 'content_report', 'admin_audit_log']) {
    assert.ok(!deletes.some((t) => t.includes(`DELETE FROM ${table} `)), `不应删除财务/审计表 ${table}`)
  }

  console.log('Account deletion service tests passed.')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
