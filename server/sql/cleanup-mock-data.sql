-- =====================================================================
-- 生产库 gqg_campus · 模拟测试数据清理脚本
-- 生成时间: 2026-09-10
-- 前置: 已全量备份 /home/springboot/db-backup-gqg_campus-20260910-193419.sql
--
-- 清理原则:
--   只删除「模拟账号 / 幽灵作者 / 重复种子 / 失败重试 / 过期验证码 / 死表」数据
--   不触碰任何真实用户（sys_user.id 66-74）的帖子、评论、订单、钱包、成绩、课表
--   全部在单事务内执行，任一步失败即整体回滚
--
-- 模拟账号: sys_user.id 50-57  (openid dev_user001~008)
-- 幽灵作者: user_id 1-8        (sys_user 中已不存在的早期模拟用户)
-- 模拟帖子: forum_post.id 1-12   模拟跑腿单: errand_order.id 1-8
-- =====================================================================

USE gqg_campus;

START TRANSACTION;

-- ---------- 0. 清理前快照（对照用） ----------
SELECT 'BEFORE' AS stage,
  (SELECT COUNT(*) FROM sys_user)                      AS sys_user,
  (SELECT COUNT(*) FROM forum_post)                    AS forum_post,
  (SELECT COUNT(*) FROM forum_comment)                 AS forum_comment,
  (SELECT COUNT(*) FROM forum_like)                    AS forum_like,
  (SELECT COUNT(*) FROM forum_favorite)                AS forum_favorite,
  (SELECT COUNT(*) FROM forum_share)                   AS forum_share,
  (SELECT COUNT(*) FROM errand_order)                  AS errand_order,
  (SELECT COUNT(*) FROM service_category)              AS service_category,
  (SELECT COUNT(*) FROM service_item)                  AS service_item,
  (SELECT COUNT(*) FROM payment_refund)                AS payment_refund,
  (SELECT COUNT(*) FROM post_view)                     AS post_view,
  (SELECT COUNT(*) FROM jw_captcha_challenge)          AS jw_captcha;

-- ---------- 1. 论坛：评论点赞 → 评论 → 点赞/收藏/转发 → 帖子 ----------
-- 1.0 保留真实用户挂在模拟帖下的评论：迁移到该作者自己的最新存活帖（user_id 67 的帖子 id 53）
--     （经确认保留的 9 条评论 id = 31,32,33,34,35,36,42,46,47，作者均为 user_id 67）
UPDATE forum_comment
SET post_id = 53
WHERE post_id BETWEEN 1 AND 12
  AND user_id NOT BETWEEN 1 AND 8;

-- 1.1 指向模拟帖下评论的「评论点赞」
DELETE cl FROM forum_comment_like cl
JOIN forum_comment c ON c.id = cl.comment_id
WHERE c.post_id BETWEEN 1 AND 12;

-- 1.2 评论点赞中由模拟/幽灵账号发出的
DELETE FROM forum_comment_like
WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- 1.3 评论：挂在模拟帖下的，或由模拟/幽灵账号发出的
DELETE FROM forum_comment
WHERE post_id BETWEEN 1 AND 12
   OR user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- 1.3.1 修复因父评论被删而悬空的回复关系
UPDATE forum_comment SET parent_id = 0
WHERE parent_id <> 0
  AND parent_id NOT IN (SELECT id FROM (SELECT id FROM forum_comment) AS keep);

-- 1.4 点赞 / 收藏 / 转发
DELETE FROM forum_like       WHERE post_id BETWEEN 1 AND 12 OR user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);
DELETE FROM forum_favorite   WHERE post_id BETWEEN 1 AND 12 OR user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);
DELETE FROM forum_share      WHERE post_id BETWEEN 1 AND 12 OR user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- 1.5 帖子
DELETE FROM forum_post
WHERE id BETWEEN 1 AND 12
   OR user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- 1.6 帖子相关偏好（模拟帖已删，隐藏偏好一并清理）
DELETE FROM post_hidden_preference WHERE post_id BETWEEN 1 AND 12;

-- ---------- 2. 站内通知 ----------
DELETE FROM system_notification
WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
   OR related_id IN ('1','2','3','4','5','6','7','8','9','10','11','12');

-- ---------- 3. 跑腿：日志 / 聊天 / 已读 / 取消申请 / 评价 → 订单 ----------
DELETE FROM errand_order_log      WHERE order_id BETWEEN 1 AND 8;
DELETE FROM errand_message        WHERE order_id BETWEEN 1 AND 8;
DELETE FROM errand_chat_read      WHERE order_id BETWEEN 1 AND 8;
DELETE FROM errand_cancel_request WHERE order_id BETWEEN 1 AND 8;
DELETE FROM errand_review         WHERE order_id BETWEEN 1 AND 8;
DELETE FROM errand_order
WHERE id BETWEEN 1 AND 8
   OR publisher_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
   OR acceptor_id  IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);
DELETE FROM errand_stat WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- ---------- 4. 私信 ----------
DELETE FROM private_message_recall_log
WHERE operator_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
   OR receiver_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);
DELETE FROM private_message
WHERE sender_id   IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
   OR receiver_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
   OR conversation_id IN (
        SELECT id FROM private_conversation
        WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
           OR peer_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57));
DELETE FROM private_conversation
WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57)
   OR peer_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- ---------- 5. 课表 / 教务 ----------
DELETE FROM user_schedule WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);
DELETE FROM schedule_config WHERE user_id IN (1,2,3,4,5,6,7,8,50,51,52,53,54,55,56,57);

-- ---------- 6. 临时数据 / 死表 ----------
DELETE FROM jw_captcha_challenge WHERE expires_at < NOW();   -- 教务验证码 3 分钟生命周期，全部已过期
DELETE FROM post_view;                                       -- 只写不读的死表（小程序浏览量走 forum_post.view_count）

-- ---------- 7. 删除模拟账号本体 ----------
DELETE FROM sys_user WHERE id IN (50,51,52,53,54,55,56,57);

-- ---------- 8. 重算计数器（避免删明细后计数虚高） ----------
UPDATE forum_post p SET
  like_count     = (SELECT COUNT(*) FROM forum_like     l WHERE l.post_id = p.id),
  favorite_count = (SELECT COUNT(*) FROM forum_favorite f WHERE f.post_id = p.id),
  share_count    = (SELECT COUNT(*) FROM forum_share    s WHERE s.post_id = p.id),
  comment_count  = (SELECT COUNT(*) FROM forum_comment  c WHERE c.post_id = p.id AND c.status = 1);

UPDATE forum_comment c SET
  like_count = (SELECT COUNT(*) FROM forum_comment_like l WHERE l.comment_id = c.id);

-- ---------- 9. 首页服务宫格去重 ----------
-- 9.1 删除重复服务项：保留每个分类下首次出现的规范条目（共 24 条）
DELETE FROM service_item WHERE id NOT IN (
   -- 平台自研
   1, 2, 3,
   -- 校园服务
   4, 6, 7, 8, 12, 23, 47, 48, 49, 50,
   -- 学习相关
   13, 14, 15, 16, 17,
   -- 生活服务
   18, 19, 20, 21, 46,
   -- 校园资讯
   22
);

-- 9.2 删除重复分类（保留 id 1-5）
DELETE FROM service_category WHERE id NOT IN (1, 2, 3, 4, 5);

-- ---------- 10. 退款重试堆积数据 ----------
-- 仅删除失败重试记录，保留 3 条 PROCESSING（正常挂起）
DELETE FROM payment_refund WHERE status = 'FAILED';

-- ---------- 10.1 测试性质的意见反馈（已确认删除） ----------
DELETE FROM user_feedback WHERE id IN (1, 2, 3);

-- ---------- 11. 清理后快照 ----------
SELECT 'AFTER' AS stage,
  (SELECT COUNT(*) FROM sys_user)                      AS sys_user,
  (SELECT COUNT(*) FROM forum_post)                    AS forum_post,
  (SELECT COUNT(*) FROM forum_comment)                 AS forum_comment,
  (SELECT COUNT(*) FROM forum_like)                    AS forum_like,
  (SELECT COUNT(*) FROM forum_favorite)                AS forum_favorite,
  (SELECT COUNT(*) FROM forum_share)                   AS forum_share,
  (SELECT COUNT(*) FROM errand_order)                  AS errand_order,
  (SELECT COUNT(*) FROM service_category)              AS service_category,
  (SELECT COUNT(*) FROM service_item)                  AS service_item,
  (SELECT COUNT(*) FROM payment_refund)                AS payment_refund,
  (SELECT COUNT(*) FROM post_view)                     AS post_view,
  (SELECT COUNT(*) FROM jw_captcha_challenge)          AS jw_captcha;

-- ---------- 12. 一致性校验：孤儿数据应为 0 ----------
SELECT 'ORPHAN_post'      AS check_item, COUNT(*) AS cnt FROM forum_post p
  LEFT JOIN sys_user u ON u.id = p.user_id WHERE u.id IS NULL
UNION ALL SELECT 'ORPHAN_comment', COUNT(*) FROM forum_comment c
  LEFT JOIN forum_post p ON p.id = c.post_id WHERE p.id IS NULL
UNION ALL SELECT 'ORPHAN_like', COUNT(*) FROM forum_like l
  LEFT JOIN forum_post p ON p.id = l.post_id WHERE p.id IS NULL
UNION ALL SELECT 'ORPHAN_favorite', COUNT(*) FROM forum_favorite f
  LEFT JOIN forum_post p ON p.id = f.post_id WHERE p.id IS NULL
UNION ALL SELECT 'ORPHAN_share', COUNT(*) FROM forum_share s
  LEFT JOIN forum_post p ON p.id = s.post_id WHERE p.id IS NULL
UNION ALL SELECT 'ORPHAN_comment_like', COUNT(*) FROM forum_comment_like cl
  LEFT JOIN forum_comment c ON c.id = cl.comment_id WHERE c.id IS NULL
UNION ALL SELECT 'ORPHAN_errand_order_log', COUNT(*) FROM errand_order_log l
  LEFT JOIN errand_order o ON o.id = l.order_id WHERE o.id IS NULL
UNION ALL SELECT 'ORPHAN_service_item', COUNT(*) FROM service_item i
  LEFT JOIN service_category c ON c.id = i.category_id WHERE c.id IS NULL
UNION ALL SELECT 'ORPHAN_conversation', COUNT(*) FROM private_conversation c
  LEFT JOIN sys_user u ON u.id = c.user_id WHERE u.id IS NULL
UNION ALL SELECT 'ORPHAN_message', COUNT(*) FROM private_message m
  LEFT JOIN private_conversation c ON c.id = m.conversation_id WHERE c.id IS NULL;

-- 确认无异常后提交
COMMIT;

-- =====================================================================
-- 说明：post_view（纯写不读的死表）已清空，但写入代码按约定暂不改动；
--       errand_review 中 2 条评价挂在真实订单 24 上，属真实用户提交的数据，
--       故保留不清（如需一并清空请单独执行：DELETE FROM errand_review;）。
-- =====================================================================
