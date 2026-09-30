const pool = require('../config/pool')
const { safeMessage } = require('../utils/helpers')

// 注销账号执行任务：扫描「已过 7 天冷静期且仍为 pending」的注销申请，
// 删除该用户的社区内容、私信、教务数据、各类申请与互动记录，并对 sys_user 做去标识化，
// 最后把申请标记为 completed。此前只有申请写入、没有任何逻辑真正执行注销（隐私合规缺陷）。

// 注销是低频后台操作，每小时巡检一次即可（冷静期本身以「天」为单位）。
const SCAN_INTERVAL_MS = 60 * 60 * 1000
const BATCH_LIMIT = 50
let timer = null

function placeholders(list) {
  return list.map(() => '?').join(',')
}

// 重算受影响帖子的计数列（用户删除的点赞/收藏/关注/分享/评论会改变他人帖子的计数）。
async function recomputePostStats(conn, postIds) {
  const ids = [...new Set(postIds)].filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) return
  await conn.query(
    `UPDATE forum_post p SET
       like_count = (SELECT COUNT(*) FROM forum_like l WHERE l.post_id = p.id),
       comment_count = (SELECT COUNT(*) FROM forum_comment c WHERE c.post_id = p.id AND c.status = 1),
       favorite_count = (SELECT COUNT(*) FROM forum_favorite f WHERE f.post_id = p.id),
       follow_count = (SELECT COUNT(*) FROM forum_post_follow fo WHERE fo.post_id = p.id),
       share_count = (SELECT COUNT(*) FROM forum_share s WHERE s.post_id = p.id AND s.status = 1)
     WHERE p.id IN (${placeholders(ids)})`,
    ids,
  )
}

async function deleteUserData(conn, userId) {
  // 先收集需要联动清理/重算的 ID，再按依赖顺序删除。
  const [userPosts] = await conn.query('SELECT id FROM forum_post WHERE user_id = ?', [userId])
  const userPostIds = userPosts.map((r) => r.id)

  const [userComments] = await conn.query('SELECT id, post_id FROM forum_comment WHERE user_id = ?', [userId])
  const userCommentIds = userComments.map((r) => r.id)
  const commentedPostIds = userComments.map((r) => r.post_id)

  // 用户自己帖子下的评论（他人所写）也要一并删除，其点赞同样要清理。
  let commentsOnUserPostIds = []
  if (userPostIds.length) {
    const [rows] = await conn.query(
      `SELECT id FROM forum_comment WHERE post_id IN (${placeholders(userPostIds)})`,
      userPostIds,
    )
    commentsOnUserPostIds = rows.map((r) => r.id)
  }

  // 用户互动过的、非本人帖子（删除其互动后需重算计数）。
  const [touched] = await conn.query(
    `SELECT post_id AS id FROM forum_like WHERE user_id = ?
     UNION SELECT post_id FROM forum_favorite WHERE user_id = ?
     UNION SELECT post_id FROM forum_post_follow WHERE user_id = ?
     UNION SELECT post_id FROM forum_share WHERE user_id = ?`,
    [userId, userId, userId, userId],
  )
  const affectedPostIds = [...commentedPostIds, ...touched.map((r) => r.id)]
    .filter((id) => !userPostIds.includes(id))

  // 1) 评论点赞：用户自己写的评论 + 用户帖子下的全部评论。
  const commentIdsForLikeCleanup = [...new Set([...userCommentIds, ...commentsOnUserPostIds])]
  if (commentIdsForLikeCleanup.length) {
    await conn.query(
      `DELETE FROM forum_comment_like WHERE comment_id IN (${placeholders(commentIdsForLikeCleanup)})`,
      commentIdsForLikeCleanup,
    )
  }

  // 2) 评论：用户写的 + 用户帖子下的。
  if (userCommentIds.length || userPostIds.length) {
    const conds = []
    const params = []
    if (userCommentIds.length) { conds.push('user_id = ?'); params.push(userId) }
    if (userPostIds.length) { conds.push(`post_id IN (${placeholders(userPostIds)})`); params.push(...userPostIds) }
    await conn.query(`DELETE FROM forum_comment WHERE ${conds.join(' OR ')}`, params)
  }

  // 3) 帖子维度的互动记录：本人发起的 + 指向本人被删帖子的。
  const postScoped = [
    'forum_like', 'forum_favorite', 'forum_post_follow', 'forum_share', 'post_view', 'post_hidden_preference',
  ]
  for (const table of postScoped) {
    const conds = ['user_id = ?']
    const params = [userId]
    if (userPostIds.length) { conds.push(`post_id IN (${placeholders(userPostIds)})`); params.push(...userPostIds) }
    await conn.query(`DELETE FROM ${table} WHERE ${conds.join(' OR ')}`, params)
  }

  // 4) 用户发布的帖子本体。
  await conn.query('DELETE FROM forum_post WHERE user_id = ?', [userId])

  // 5) 重算受影响他人帖子的计数。
  await recomputePostStats(conn, affectedPostIds)

  // 6) 私信：彻底删除与本人相关的会话与消息（双向隐私）。
  await conn.query('DELETE FROM private_message WHERE sender_id = ? OR receiver_id = ?', [userId, userId])
  await conn.query('DELETE FROM private_conversation WHERE user_id = ? OR peer_id = ?', [userId, userId])
  await conn.query('DELETE FROM private_message_recall_log WHERE operator_id = ? OR receiver_id = ?', [userId, userId])

  // 7) 通知：本人收到的通知删除；别人通知里「本人作为操作者」的身份快照去标识化。
  await conn.query('DELETE FROM system_notification WHERE user_id = ?', [userId])
  // P21：点赞/评论/回复时写进他人通知的昵称与头像属于注销者的个人信息。
  // 通知本身要留给收件人（不能连带删掉别人的历史消息），但身份快照必须抹除。
  await conn.query(
    "UPDATE system_notification SET actor_user_id = NULL, actor_nick = '已注销用户', actor_avatar = '' WHERE actor_user_id = ?",
    [userId],
  )

  // 8) 教务相关（凭证、验证码挑战、课表/考试/成绩、课表配置）。
  await conn.query('DELETE FROM jw_credential WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM jw_captcha_challenge WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM user_schedule WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM schedule_config WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM user_exam WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM user_grade WHERE user_id = ?', [userId])

  // 9) 跑腿聊天与统计（保留订单/支付等财务留痕，仅清个人内容）。
  await conn.query('DELETE FROM errand_message WHERE sender_id = ?', [userId])
  await conn.query('DELETE FROM errand_chat_read WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM errand_stat WHERE user_id = ?', [userId])

  // 10) 各类申请与报名、反馈、评价、认证、黑名单。
  await conn.query('DELETE FROM club_apply WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM group_chat_apply WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM activity_signup WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM user_feedback WHERE user_id = ?', [userId])
  // P21：意见墙里指向本次注销用户的「被回复人昵称」快照先抹除，再删本人自己的评论。
  const [ownCommentRows] = await conn.query('SELECT id FROM feedback_comment WHERE user_id = ?', [userId])
  const ownCommentIds = ownCommentRows.map((row) => row.id)
  if (ownCommentIds.length) {
    await conn.query(
      `UPDATE feedback_comment SET reply_to_nick = '已注销用户' WHERE reply_to IN (${placeholders(ownCommentIds)})`,
      ownCommentIds,
    )
  }
  await conn.query('DELETE FROM feedback_comment WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM review_rating WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM review_comment WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM review_target_like WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM review_comment_like WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM rider_verification WHERE user_id = ?', [userId])
  await conn.query('DELETE FROM user_blacklist WHERE user_id = ? OR blocked_id = ?', [userId, userId])

  // 11) 去标识化账号本身：清空 PII、置为不可用、释放 openid/手机号/学号供重新注册。
  //     保留行是为了不破坏仍需留存记录（订单/支付/后台审计）的外键展示与统计。
  await conn.query(
    `UPDATE sys_user SET
       openid = ?, nick_name = '已注销用户', avatar_url = '', gender = 0, campus = '',
       phone = NULL, student_id = NULL, real_name = '', is_verified = 0, cert_label = NULL,
       allow_anonymous_pm = 0, status = 0, role = 'user'
     WHERE id = ?`,
    [`deleted_${userId}_${Date.now()}`, userId],
  )
}

async function processDueDeletions() {
  const [due] = await pool.query(
    `SELECT id, user_id FROM account_deletion_request
     WHERE status = 'pending' AND scheduled_for <= NOW()
     ORDER BY scheduled_for ASC LIMIT ?`,
    [BATCH_LIMIT],
  )
  if (!due.length) return 0

  for (const row of due) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await deleteUserData(conn, row.user_id)
      // 同一事务内标记完成：删除失败会回滚，申请保持 pending 由下轮重试。
      await conn.query(
        `UPDATE account_deletion_request SET status = 'completed', completed_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [row.id],
      )
      await conn.commit()
      console.log(`[AccountDeletion] 用户 #${row.user_id} 注销已执行完成`)
    } catch (e) {
      await conn.rollback()
      console.error(`[AccountDeletion] 用户 #${row.user_id} 注销执行失败:`, safeMessage(e))
    } finally {
      conn.release()
    }
  }
  return due.length
}

let running = false
async function runOnce() {
  if (running) return
  running = true
  try {
    await processDueDeletions()
  } catch (e) {
    console.error('[AccountDeletion]', safeMessage(e))
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  timer = setInterval(runOnce, SCAN_INTERVAL_MS)
  // 启动后延迟 90 秒首扫，避开服务启动高峰。
  setTimeout(() => { runOnce() }, 90 * 1000)
  console.log(`[AccountDeletion] 注销执行任务已启动（每小时扫描过期的 pending 注销申请并删除关联数据）`)
}

function stop() {
  if (timer) { clearInterval(timer); timer = null }
}

module.exports = { start, stop, runOnce, deleteUserData }
