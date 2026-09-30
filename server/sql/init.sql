-- =====================================================================
-- 广轻工校园小程序 · 数据库完整初始化脚本（由生产库实际结构导出）
-- 库名: gqg_campus   字符集: utf8mb4 / utf8mb4_unicode_ci   引擎: InnoDB
-- 共 52 张表。本文件此前只覆盖了其中一部分表，其余表由 server/utils/migrations.js
-- 在服务启动时创建，导致「直接用 init.sql 建库」会缺表。现已补齐为完整结构。
--
-- 用法：mysql -uroot -p < init.sql     （全表 CREATE TABLE IF NOT EXISTS，可重复执行）
-- 注意：服务端每次启动仍会执行 migrations.js 做增量兜底，两者不冲突。
-- =====================================================================

CREATE DATABASE IF NOT EXISTS gqg_campus DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gqg_campus;


-- =====================================================================
-- 一、用户与账号
-- =====================================================================

-- 小程序用户主表。openid 唯一；phone/student_id 唯一（可为 NULL）。role: user / admin / super_admin。
-- is_verified + cert_label 由管理后台「认证标签」与骑手审核写入，用于帖子/主页认证角标。
-- allow_anonymous_pm=0 时其他用户无法与其建立匿名私信会话。
CREATE TABLE IF NOT EXISTS `sys_user` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `openid` varchar(64) NOT NULL,
  `nick_name` varchar(64) DEFAULT '校园用户',
  `avatar_url` varchar(512) DEFAULT '',
  `gender` tinyint(4) DEFAULT '1',
  `campus` varchar(64) DEFAULT '',
  `phone` varchar(20) DEFAULT NULL,
  `student_id` varchar(32) DEFAULT NULL,
  `real_name` varchar(32) DEFAULT '',
  `is_verified` tinyint(1) DEFAULT '0',
  `cert_label` varchar(32) DEFAULT NULL,
  `allow_anonymous_pm` tinyint(1) DEFAULT '1',
  `status` tinyint(1) DEFAULT '1',
  `role` varchar(32) NOT NULL DEFAULT 'user',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `openid` (`openid`),
  UNIQUE KEY `uk_phone` (`phone`),
  UNIQUE KEY `uk_student_id` (`student_id`),
  KEY `idx_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jw_credential` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `username` varchar(32) NOT NULL DEFAULT '',
  `password_enc` text,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jw_captcha_challenge` (
  `id` varchar(64) NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `username` varchar(32) NOT NULL DEFAULT '',
  `password_enc` text,
  `schedule_start_date` varchar(16) DEFAULT '',
  `mode` varchar(16) DEFAULT 'direct',
  `factor` varchar(255) DEFAULT '',
  `captcha_data` mediumtext,
  `cookie_jar` mediumtext,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_captcha_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `rider_verification` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `campus_name` varchar(64) DEFAULT '',
  `student_id` varchar(32) DEFAULT '',
  `campus_credential` varchar(512) DEFAULT '',
  `real_name` varchar(64) DEFAULT '',
  `identity_number` varchar(32) DEFAULT '',
  `identity_credential` varchar(512) DEFAULT '',
  `phone` varchar(20) DEFAULT '',
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `review_note` varchar(255) DEFAULT '',
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rider_verification_user` (`user_id`),
  KEY `idx_rider_verification_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `user_blacklist` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `blocked_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_blocked` (`user_id`,`blocked_id`),
  KEY `idx_blocked_user` (`blocked_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 注销申请（7 天冷静期）。到期执行由 services/accountDeletionService 每小时扫描 status=pending 且 scheduled_for<=NOW，
-- 删除用户关联数据后写 status=completed + completed_at（此前该字段仅写入未读取，现由注销执行任务真正使用）。
CREATE TABLE IF NOT EXISTS `account_deletion_request` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `status` enum('pending','cancelled','completed') NOT NULL DEFAULT 'pending',
  `requested_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `scheduled_for` datetime NOT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deletion_request_user` (`user_id`),
  KEY `idx_deletion_status_scheduled` (`status`,`scheduled_for`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 二、论坛社区
-- =====================================================================

-- 论坛帖子。images/contact/anonymous_identity/components 为 JSON。
-- status: 1 正常 / 0 已删除（软删，后台另有 2 待审、3 隐藏 的标记约定）。
-- like_count/comment_count/favorite_count/share_count/view_count/follow_count 为计数器（与 forum_like 等明细表双写，删除明细后必须重算）。
CREATE TABLE IF NOT EXISTS `forum_post` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `title` varchar(128) DEFAULT '',
  `category` varchar(32) DEFAULT '日常生活',
  `content` text NOT NULL,
  `images` json DEFAULT NULL,
  `contact` json DEFAULT NULL,
  `anonymous_identity` json DEFAULT NULL,
  `components` json DEFAULT NULL,
  `like_count` int(11) DEFAULT '0',
  `comment_count` int(11) DEFAULT '0',
  `favorite_count` int(11) DEFAULT '0',
  `share_count` int(11) DEFAULT '0',
  `view_count` int(11) DEFAULT '0',
  `follow_count` int(11) DEFAULT '0',
  `status` tinyint(1) DEFAULT '1',
  `pinned` tinyint(1) NOT NULL DEFAULT '0',
  `review_note` varchar(255) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_category` (`category`),
  KEY `idx_created` (`created_at`),
  KEY `idx_post_feed` (`status`,`category`,`created_at`),
  KEY `idx_post_admin` (`status`,`pinned`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 论坛评论/回复。parent_id=0 为一级评论，否则为回复的评论 id。
-- anonymous_identity 存在时前端按匿名身份展示。
CREATE TABLE IF NOT EXISTS `forum_comment` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `content` text NOT NULL,
  `images` json DEFAULT NULL,
  `anonymous_identity` json DEFAULT NULL,
  `parent_id` int(10) unsigned DEFAULT '0',
  `like_count` int(11) DEFAULT '0',
  `status` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_post` (`post_id`),
  KEY `idx_comment_post_status_time` (`post_id`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `forum_comment_like` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `comment_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_comment_user` (`comment_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `forum_like` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_user` (`post_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `forum_favorite` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_user` (`post_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 蹲贴：用户对某帖子点「蹲贴」后的关注关系（与 forum_post.follow_count 双写）。
-- 帖子被评论时，除作者外还要通知所有蹲贴者（见 commentController.create）。
CREATE TABLE IF NOT EXISTS `forum_post_follow` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_user` (`post_id`,`user_id`),
  KEY `idx_user` (`user_id`,`created_at`),
  KEY `idx_post` (`post_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 帖子投票明细（P19）：投票原先只写在 forum_post.components 的 JSON 里，
-- 没有数据库级唯一约束、也没有对账依据。本表按 (帖子, 第几个投票, 用户) 唯一，
-- 投票事务内先插本表再改 JSON，重复投票直接被唯一键拒绝；JSON 仍是展示口径。
CREATE TABLE IF NOT EXISTS `forum_poll_vote` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int(10) unsigned NOT NULL,
  `poll_index` tinyint(3) unsigned NOT NULL DEFAULT '0',
  `option_indexes` varchar(64) NOT NULL DEFAULT '',
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_poll_vote` (`post_id`,`poll_index`,`user_id`),
  KEY `idx_poll_vote_user` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `forum_share` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `post_id` int(10) unsigned NOT NULL,
  `share_content` text,
  `parent_share_id` int(10) unsigned DEFAULT '0',
  `status` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_post` (`post_id`),
  KEY `idx_share_post_status_time` (`post_id`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 帖子独立访客去重记录。**当前仅有写入、没有任何读取方**，见数据库巡检报告。
CREATE TABLE IF NOT EXISTS `post_view` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_user` (`post_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `post_hidden_preference` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `post_id` int(10) unsigned NOT NULL,
  `category` varchar(32) NOT NULL DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hidden_post_user` (`user_id`,`post_id`),
  KEY `idx_hidden_user_category` (`user_id`,`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `content_report` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `reporter_id` int(10) unsigned NOT NULL,
  `target_type` enum('post','comment','user') NOT NULL,
  `target_id` bigint(20) unsigned NOT NULL,
  `reason` varchar(500) NOT NULL,
  `status` enum('pending','processing','resolved','rejected') NOT NULL DEFAULT 'pending',
  `handled_by` int(10) unsigned DEFAULT NULL,
  `handled_note` varchar(500) DEFAULT '',
  `handled_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_report_status_created` (`status`,`created_at`),
  KEY `idx_report_target` (`target_type`,`target_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 三、私信与通知
-- =====================================================================

-- 私信会话（按「用户 + 对端 + 分身」唯一）。last_message_* 为冗余缓存，用于会话列表免联表。
-- persona_key 为分身头像路径，普通私信为 空串；同一对用户的不同分身各自一条会话，互不可见。
CREATE TABLE IF NOT EXISTS `private_conversation` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `peer_id` int(10) unsigned NOT NULL,
  `persona_key` varchar(255) NOT NULL DEFAULT '',
  `last_message_id` int(10) unsigned DEFAULT NULL,
  `unread_count` int(11) DEFAULT '0',
  `last_message_text` varchar(512) DEFAULT '',
  `last_message_time` datetime DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `is_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `anon_peer_identity` varchar(512) DEFAULT NULL,
  `anon_self_identity` varchar(512) DEFAULT NULL,
  `source_post_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_peer_persona` (`user_id`,`peer_id`,`persona_key`),
  KEY `idx_peer` (`peer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 私信消息。status 含 recalled（撤回）。
CREATE TABLE IF NOT EXISTS `private_message` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `conversation_id` int(10) unsigned NOT NULL,
  `sender_id` int(10) unsigned NOT NULL,
  `receiver_id` int(10) unsigned NOT NULL,
  `persona_key` varchar(255) NOT NULL DEFAULT '',
  `content` text NOT NULL,
  `msg_type` varchar(16) DEFAULT 'text',
  `is_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('sending','sent','delivered','read','failed','recalled') DEFAULT 'sent',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversation` (`conversation_id`),
  KEY `idx_receiver` (`receiver_id`,`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_message_conversation_time` (`conversation_id`,`created_at`),
  KEY `idx_message_receiver_status_time` (`receiver_id`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `private_message_recall_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `message_id` int(10) unsigned NOT NULL,
  `operator_id` int(10) unsigned NOT NULL,
  `receiver_id` int(10) unsigned NOT NULL,
  `recalled_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recall_message` (`message_id`),
  KEY `idx_recall_operator_time` (`operator_id`,`recalled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `system_notification` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `type` enum('comment','like','system','errand','repair','follow','reply') NOT NULL,
  `title` varchar(128) NOT NULL,
  `content` text,
  `related_id` varchar(64) DEFAULT '',
  `source_comment_id` int(10) unsigned DEFAULT NULL,
  `actor_user_id` int(10) unsigned DEFAULT NULL,
  `actor_nick` varchar(64) DEFAULT '',
  `actor_avatar` varchar(255) DEFAULT '',
  `post_title` varchar(255) DEFAULT '',
  `comment_images` text,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_read` (`user_id`,`is_read`,`created_at`),
  -- P20：一条来源评论最多产生一条 reply 通知，唯一键挡住并发重复插入
  UNIQUE KEY `uk_notification_source_comment` (`source_comment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订阅消息额度账户：小程序一次性订阅，用户每点一次「允许」得 1 条可发额度，发一条扣 1

-- 媒体内容安全异步检测任务（P02/P14）：提交 wxa/media_check_async 后等微信回调，
-- 回调判违规时由 mediaCheckService 删除对象并把地址加入读路径过滤集合。
-- 官方接口只支持图片/音频，视频走「真实文件类型校验 + 每日配额 + 举报下架」。
CREATE TABLE IF NOT EXISTS `media_check_task` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL DEFAULT '0',
  `trace_id` varchar(64) NOT NULL,
  `media_type` enum('image','audio') NOT NULL DEFAULT 'image',
  `object_key` varchar(512) DEFAULT '',
  `media_url` varchar(1024) DEFAULT '',
  `scene` tinyint(4) NOT NULL DEFAULT '3',
  `status` enum('pending','pass','review','risky','failed','removed') NOT NULL DEFAULT 'pending',
  `label` int(11) DEFAULT NULL,
  `errcode` int(11) DEFAULT NULL,
  `level_info` varchar(255) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_check_trace` (`trace_id`),
  KEY `idx_media_check_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS `user_subscribe_quota` (
  `user_id` int(10) unsigned NOT NULL,
  `tpl_type` varchar(24) NOT NULL,
  `remain` int(11) NOT NULL DEFAULT '0',
  `total_granted` int(11) NOT NULL DEFAULT '0',
  `total_sent` int(11) NOT NULL DEFAULT '0',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`tpl_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订阅消息发送流水：频控（同类合并）、排障与对账
CREATE TABLE IF NOT EXISTS `subscribe_message_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `tpl_type` varchar(24) NOT NULL,
  `template_id` varchar(64) DEFAULT '',
  `page` varchar(128) DEFAULT '',
  `summary` varchar(255) DEFAULT '',
  `status` enum('sent','merged','skipped','failed','throttled') NOT NULL DEFAULT 'sent',
  `errcode` int(11) DEFAULT NULL,
  `errmsg` varchar(255) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sub_log_user_time` (`user_id`,`tpl_type`,`created_at`),
  KEY `idx_sub_log_status_time` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订阅消息待发表：命中合并窗口或额度不足时改写进这里，之后补发（每个 user+tpl_type 一个槽位）
CREATE TABLE IF NOT EXISTS `subscribe_pending_message` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `tpl_type` varchar(24) NOT NULL,
  `data_json` text NOT NULL,
  `page` varchar(128) DEFAULT '',
  `summary` varchar(255) DEFAULT '',
  `reason` enum('merged','no_quota') NOT NULL DEFAULT 'merged',
  `status` enum('pending','sent','dropped') NOT NULL DEFAULT 'pending',
  `retry_count` int(10) unsigned NOT NULL DEFAULT '0',
  `notice_sent_at` datetime DEFAULT NULL,
  `next_retry_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pending_user_tpl` (`user_id`,`tpl_type`),
  KEY `idx_pending_due` (`status`,`next_retry_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 四、跑腿订单
-- =====================================================================

-- 跑腿订单主表。order_no 唯一。
-- payment_status 与 payment_transaction 表并存（资金状态以 payment_transaction 为准，本字段用于列表过滤）。
-- status: pending 待接单 / accepted 已接单 / finishing 待发单人确认 / finished 已完成 / cancelled 已取消 / disputed 有异议。
-- auto_confirmed 标记系统自动确认完成（当前仅写入、无读取方）。
CREATE TABLE IF NOT EXISTS `errand_order` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `order_no` varchar(32) DEFAULT NULL,
  `publisher_id` int(10) unsigned NOT NULL,
  `acceptor_id` int(10) unsigned DEFAULT NULL,
  `type` varchar(16) DEFAULT '快递',
  `title` varchar(128) NOT NULL,
  `description` text,
  `reward` decimal(10,2) NOT NULL,
  `pickup_addr` varchar(256) DEFAULT '',
  `delivery_addr` varchar(256) DEFAULT '',
  `campus` varchar(32) DEFAULT '南校区',
  `gender_requirement` varchar(16) NOT NULL DEFAULT '不限性别',
  `pickup_time_type` varchar(16) DEFAULT '尽快',
  `appointment_time` varchar(64) DEFAULT NULL,
  `accept_deadline` datetime DEFAULT NULL,
  `receiver_name` varchar(32) DEFAULT '',
  `receiver_phone` varchar(20) DEFAULT '',
  `delivery_building` varchar(64) DEFAULT '',
  `delivery_room` varchar(32) DEFAULT '',
  `remark` text,
  `images` json DEFAULT NULL,
  `is_large_item` tinyint(1) DEFAULT '0',
  `is_urgent` tinyint(1) DEFAULT '0',
  `payment_status` varchar(16) NOT NULL DEFAULT 'SUCCESS',
  `transaction_id` varchar(64) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `status` enum('pending','accepted','finishing','finished','cancelled','disputed') DEFAULT 'pending',
  `accepted_at` datetime DEFAULT NULL,
  `finish_description` varchar(500) DEFAULT '',
  `finish_images` json DEFAULT NULL,
  `finish_submitted_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `auto_confirmed` tinyint(1) NOT NULL DEFAULT '0',
  `dispute_reason` varchar(500) DEFAULT '',
  `disputed_at` datetime DEFAULT NULL,
  `dispute_result` varchar(16) DEFAULT '',
  `dispute_note` varchar(255) DEFAULT '',
  `dispute_handled_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_errand_order_no` (`order_no`),
  KEY `idx_status` (`status`),
  KEY `idx_campus` (`campus`),
  KEY `idx_errand_feed` (`status`,`campus`,`created_at`),
  KEY `idx_errand_acceptor` (`acceptor_id`,`created_at`),
  KEY `idx_errand_publisher` (`publisher_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `errand_order_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int(10) unsigned NOT NULL,
  `actor_id` int(10) unsigned DEFAULT NULL,
  `action` varchar(32) NOT NULL,
  `detail` varchar(255) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_errand_log_order` (`order_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `errand_cancel_request` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int(10) unsigned NOT NULL,
  `requester_id` int(10) unsigned NOT NULL,
  `reason_side` enum('self','publisher') NOT NULL DEFAULT 'self',
  `reason` varchar(255) NOT NULL DEFAULT '',
  `images` json DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `handled_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cancel_request_order` (`order_id`,`status`),
  KEY `idx_cancel_request_requester` (`requester_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `errand_message` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int(10) unsigned NOT NULL,
  `sender_id` int(10) unsigned NOT NULL,
  `content` text NOT NULL,
  `msg_type` varchar(16) DEFAULT 'text',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_errand_message_order` (`order_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `errand_chat_read` (
  `order_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `last_read_id` bigint(20) unsigned NOT NULL DEFAULT '0',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 跑腿评价。**当前仅有写入、小程序内没有读取/展示入口**，见巡检报告。
CREATE TABLE IF NOT EXISTS `errand_review` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int(10) unsigned NOT NULL,
  `reviewer_id` int(10) unsigned NOT NULL,
  `target_id` int(10) unsigned NOT NULL,
  `rating` tinyint(4) NOT NULL DEFAULT '5',
  `content` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_reviewer` (`order_id`,`reviewer_id`),
  KEY `idx_target` (`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `errand_stat` (
  `user_id` int(10) unsigned NOT NULL,
  `finished_count` int(11) NOT NULL DEFAULT '0',
  `self_cancel_count` int(11) NOT NULL DEFAULT '0',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 五、支付与钱包
-- =====================================================================

CREATE TABLE IF NOT EXISTS `payment_transaction` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `business_type` varchar(32) NOT NULL,
  `business_order_id` int(10) unsigned NOT NULL,
  `merchant_order_no` varchar(64) NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `amount_fen` int(10) unsigned NOT NULL,
  `status` enum('CREATED','PREPAY','SUCCESS','CLOSED','REFUNDING','REFUNDED','FAILED') NOT NULL DEFAULT 'CREATED',
  `prepay_id` varchar(128) DEFAULT NULL,
  `wx_transaction_id` varchar(64) DEFAULT NULL,
  `callback_source` varchar(16) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payment_business` (`business_type`,`business_order_id`),
  UNIQUE KEY `uk_payment_order_no` (`merchant_order_no`),
  UNIQUE KEY `uk_payment_wx_transaction` (`wx_transaction_id`),
  KEY `idx_payment_user_created` (`user_id`,`created_at`),
  KEY `idx_payment_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 退款单。out_refund_no 唯一。**缺少「同一支付单最多重试 N 次」的约束**，重试任务每 10 分钟失败重发一次，已累积 521 条 FAILED 脏记录。
CREATE TABLE IF NOT EXISTS `payment_refund` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `payment_id` bigint(20) unsigned NOT NULL,
  `out_refund_no` varchar(64) NOT NULL,
  `wx_refund_id` varchar(64) DEFAULT NULL,
  `refund_fen` int(10) unsigned NOT NULL,
  `reason` varchar(80) DEFAULT '',
  `status` enum('CREATED','PROCESSING','SUCCESS','CLOSED','ABNORMAL','FAILED') NOT NULL DEFAULT 'CREATED',
  `completed_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refund_out_no` (`out_refund_no`),
  UNIQUE KEY `uk_refund_wx_no` (`wx_refund_id`),
  KEY `idx_refund_payment_created` (`payment_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 钱包流水（campus 收入）。entry_type 目前恒为 ERRAND_EARNING。
CREATE TABLE IF NOT EXISTS `wallet_ledger` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `entry_type` enum('ERRAND_EARNING') NOT NULL,
  `amount_fen` int(11) NOT NULL,
  `reference_type` varchar(32) NOT NULL,
  `reference_id` bigint(20) unsigned NOT NULL,
  `title` varchar(128) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wallet_reference` (`user_id`,`reference_type`,`reference_id`),
  KEY `idx_wallet_user_created` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `wallet_withdrawal` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `amount_fen` int(10) unsigned NOT NULL,
  `status` enum('PENDING','PROCESSING','WAIT_CONFIRM','SUCCESS','REJECTED','FAILED') NOT NULL DEFAULT 'PENDING',
  `out_batch_no` varchar(64) NOT NULL,
  `out_detail_no` varchar(64) NOT NULL,
  `wx_batch_id` varchar(64) DEFAULT NULL,
  `transfer_bill_no` varchar(64) DEFAULT NULL,
  `package_info` varchar(1024) DEFAULT NULL,
  `review_note` varchar(255) DEFAULT '',
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wallet_withdrawal_batch` (`out_batch_no`),
  UNIQUE KEY `uk_wallet_withdrawal_detail` (`out_detail_no`),
  KEY `idx_wallet_withdrawal_user_created` (`user_id`,`created_at`),
  KEY `idx_wallet_withdrawal_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `repair_order` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `order_no` varchar(32) NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `device_type` varchar(32) NOT NULL,
  `fault_type` varchar(64) NOT NULL,
  `description` text,
  `contact_name` varchar(32) NOT NULL,
  `contact_phone` varchar(20) NOT NULL,
  `technician_name` varchar(32) DEFAULT '',
  `technician_phone` varchar(20) DEFAULT '',
  `wechat_id` varchar(64) DEFAULT '',
  `expected_time` varchar(64) DEFAULT '',
  `technician_user_id` int(10) unsigned DEFAULT NULL,
  `service_address` varchar(256) NOT NULL,
  `appointment_time` datetime NOT NULL,
  `images` json DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `transaction_id` varchar(64) DEFAULT NULL,
  `status` enum('unpaid','paid','accepted','repairing','finished','cancelled') DEFAULT 'unpaid',
  `paid_at` datetime DEFAULT NULL,
  `notified_at` datetime DEFAULT NULL,
  `technician_notified_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_no` (`order_no`),
  KEY `idx_user` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_repair_user_created` (`user_id`,`created_at`),
  KEY `idx_repair_technician_created` (`technician_user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 六、课表与教务
-- =====================================================================

CREATE TABLE IF NOT EXISTS `user_schedule` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `location` varchar(128) DEFAULT '',
  `teacher` varchar(64) DEFAULT '',
  `week_day` tinyint(4) DEFAULT '1',
  `start_time` varchar(8) DEFAULT '08:00',
  `end_time` varchar(8) DEFAULT '09:40',
  `start_week` tinyint(4) DEFAULT '1',
  `end_week` tinyint(4) DEFAULT '16',
  `week_type` varchar(8) DEFAULT 'all',
  `color` varchar(16) DEFAULT '#4A7AFF',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_schedule_user_weekday` (`user_id`,`week_day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `schedule_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `start_date` date DEFAULT '2026-09-07',
  `hide_weekend` tinyint(1) DEFAULT '0',
  `reminder` tinyint(1) DEFAULT '0',
  `bg_color` varchar(128) DEFAULT '#F5F7FA',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 教务考试安排缓存，每次同步先删后插。raw 为教务原始行，当前仅写入未被读取。
CREATE TABLE IF NOT EXISTS `user_exam` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `name` varchar(128) DEFAULT '',
  `type` varchar(32) DEFAULT '',
  `date` varchar(32) DEFAULT '',
  `time` varchar(64) DEFAULT '',
  `location` varchar(128) DEFAULT '',
  `seat` varchar(32) DEFAULT '',
  `semester` varchar(32) DEFAULT '',
  `raw` json DEFAULT NULL,
  `synced_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_exam` (`user_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 教务成绩缓存，每次同步先删后插。raw 为教务原始行，当前仅写入未被读取。
CREATE TABLE IF NOT EXISTS `user_grade` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `semester` varchar(32) DEFAULT '',
  `name` varchar(128) DEFAULT '',
  `attribute` varchar(32) DEFAULT '',
  `credit` varchar(16) DEFAULT '',
  `gpa` varchar(16) DEFAULT '',
  `score` varchar(16) DEFAULT '',
  `raw` json DEFAULT NULL,
  `synced_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_grade` (`user_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 七、社团 / 群聊 / 校园活动
-- =====================================================================

CREATE TABLE IF NOT EXISTS `club_category` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(32) NOT NULL,
  `name` varchar(64) NOT NULL,
  `icon_char` varchar(8) DEFAULT '',
  `slogan` varchar(128) DEFAULT '',
  `color` varchar(16) DEFAULT '#2E6BFF',
  `position` text,
  `scope_intro` varchar(512) DEFAULT '',
  `scope` json DEFAULT NULL,
  `features` json DEFAULT NULL,
  `contact` varchar(255) DEFAULT '',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `club` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `category_id` int(10) unsigned NOT NULL,
  `apply_id` bigint(20) unsigned DEFAULT NULL,
  `name` varchar(64) NOT NULL,
  `tags` varchar(128) DEFAULT '',
  `intro` varchar(1000) DEFAULT '',
  `recruit` varchar(255) DEFAULT '',
  `campus` varchar(16) DEFAULT '',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_club_category` (`category_id`,`status`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 社团申请单。category_id 与 category_name 冗余并存（前者可能为 NULL）。
CREATE TABLE IF NOT EXISTS `club_apply` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `club_type` varchar(16) NOT NULL DEFAULT '学生社团',
  `category_id` int(10) unsigned DEFAULT NULL,
  `category_name` varchar(64) NOT NULL DEFAULT '',
  `campus` varchar(16) DEFAULT '',
  `name` varchar(64) NOT NULL,
  `intro` varchar(1000) DEFAULT '',
  `avatar_url` varchar(512) DEFAULT '',
  `qrcode_url` varchar(512) DEFAULT '',
  `admin_qrcode_url` varchar(512) DEFAULT '',
  `gzh_qrcode_url` varchar(512) DEFAULT '',
  `images` json DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `review_note` varchar(255) DEFAULT '',
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_club_apply_user` (`user_id`,`created_at`),
  KEY `idx_club_apply_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `group_chat` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `apply_id` bigint(20) unsigned DEFAULT NULL,
  `name` varchar(64) NOT NULL,
  `category` varchar(32) NOT NULL DEFAULT '',
  `intro` varchar(1000) DEFAULT '',
  `notice` varchar(500) DEFAULT '' COMMENT '群公告，用户端群详情顶部展示',
  `owner_name` varchar(32) DEFAULT '' COMMENT '群主/负责人昵称',
  `member_count` int(11) NOT NULL DEFAULT '0' COMMENT '群成员规模（仅展示）',
  `join_mode` varchar(16) NOT NULL DEFAULT 'qrcode' COMMENT 'qrcode=扫码进群/admin=加管理员/invite=仅邀请',
  `need_audit` tinyint(1) NOT NULL DEFAULT '0' COMMENT '进群是否需管理员审核',
  `images` json DEFAULT NULL,
  `avatar_url` varchar(512) DEFAULT '',
  `qrcode_url` varchar(512) DEFAULT '',
  `is_official` tinyint(1) NOT NULL DEFAULT '0',
  `gzh_qrcode_url` varchar(512) DEFAULT '',
  `custom_tag` varchar(16) DEFAULT '',
  `campus` varchar(16) DEFAULT '',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group_chat_feed` (`status`,`deleted`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 群聊申请单。admin_qrcode_url 为申请人群二维码，审核通过后不落 group_chat。
CREATE TABLE IF NOT EXISTS `group_chat_apply` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `group_type` varchar(16) NOT NULL DEFAULT '微信群',
  `category` varchar(32) NOT NULL DEFAULT '',
  `campus` varchar(16) DEFAULT '',
  `name` varchar(64) NOT NULL,
  `intro` varchar(1000) DEFAULT '',
  `avatar_url` varchar(512) DEFAULT '',
  `qrcode_url` varchar(512) DEFAULT '',
  `admin_qrcode_url` varchar(512) DEFAULT '',
  `gzh_qrcode_url` varchar(512) DEFAULT '',
  `images` json DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `review_note` varchar(255) DEFAULT '',
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gca_user` (`user_id`,`created_at`),
  KEY `idx_gca_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `group_category` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  `description` varchar(128) DEFAULT '',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_category_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 校园活动。signup_image 为旧版单图字段，已由 signup_images 取代。
-- audit_status: approved / pending / rejected。
CREATE TABLE IF NOT EXISTS `campus_activity` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `title` varchar(64) NOT NULL,
  `signup_start` datetime DEFAULT NULL,
  `signup_end` datetime DEFAULT NULL,
  `activity_start` datetime DEFAULT NULL,
  `activity_end` datetime DEFAULT NULL,
  `location` varchar(64) DEFAULT '',
  `address` varchar(255) DEFAULT '',
  `campus` varchar(16) DEFAULT '',
  `cover_url` varchar(512) DEFAULT '',
  `images` json DEFAULT NULL,
  `detail_title` varchar(64) DEFAULT '',
  `detail_content` text,
  `signup_title` varchar(16) DEFAULT '立即报名',
  `signup_content` varchar(255) DEFAULT '',
  `signup_image` varchar(512) DEFAULT '',
  `signup_images` json DEFAULT NULL,
  `capacity` int(11) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `audit_status` varchar(16) NOT NULL DEFAULT 'approved',
  `audit_note` varchar(255) DEFAULT '',
  `audit_time` datetime DEFAULT NULL,
  `remind_sent_at` datetime DEFAULT NULL,
  `deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_feed` (`status`,`deleted`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `activity_signup` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `activity_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_activity_signup` (`activity_id`,`user_id`),
  KEY `idx_activity_signup_user` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 八、意见反馈
-- =====================================================================

CREATE TABLE IF NOT EXISTS `user_feedback` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `type` enum('功能建议','Bug反馈','体验优化','其他问题') NOT NULL,
  `content` varchar(500) NOT NULL,
  `contact` varchar(128) DEFAULT '',
  `images` json DEFAULT NULL,
  `status` enum('pending','processing','replied','resolved','closed') NOT NULL DEFAULT 'pending',
  `reply` varchar(500) DEFAULT '',
  `reply_user_id` int(10) unsigned DEFAULT NULL,
  `reply_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feedback_user_created` (`user_id`,`created_at`),
  KEY `idx_feedback_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `feedback_comment` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `feedback_id` bigint(20) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `reply_to` bigint(20) unsigned NOT NULL DEFAULT '0',
  `reply_to_nick` varchar(64) DEFAULT '',
  `content` varchar(500) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feedback_comment` (`feedback_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 九、平台配置与后台
-- =====================================================================

CREATE TABLE IF NOT EXISTS `system_content` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `type` varchar(32) NOT NULL,
  `title` varchar(128) NOT NULL,
  `body` text,
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_system_content_type_status` (`type`,`status`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 功能开关（community/errand/repair/schedule.enabled）。updated_by 仅写入未读取。
CREATE TABLE IF NOT EXISTS `feature_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `config_key` varchar(64) NOT NULL,
  `label` varchar(128) NOT NULL,
  `config_value` text,
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `updated_by` int(10) unsigned DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 虚拟物品（管理后台维护）。sales_count 无任何写入逻辑，恒为 0。
CREATE TABLE IF NOT EXISTS `virtual_item` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` text,
  `cover_url` varchar(512) DEFAULT '',
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `stock` int(11) NOT NULL DEFAULT '0',
  `sales_count` int(11) NOT NULL DEFAULT '0',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_virtual_item_status` (`status`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `virtual_item_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int(10) unsigned NOT NULL,
  `admin_id` int(10) unsigned NOT NULL,
  `action` varchar(32) NOT NULL,
  `before_data` json DEFAULT NULL,
  `after_data` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_virtual_item_log` (`item_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_audit_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `admin_id` int(10) unsigned NOT NULL,
  `action` varchar(64) NOT NULL,
  `target_type` varchar(32) NOT NULL,
  `target_id` varchar(64) NOT NULL DEFAULT '',
  `detail` json DEFAULT NULL,
  `ip` varchar(64) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_audit_created` (`admin_id`,`created_at`),
  KEY `idx_audit_target` (`target_type`,`target_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 首页服务宫格分类。历史重复执行种子脚本曾写入 6 组重复数据（30 行），前端按分类名去重才未出问题。
CREATE TABLE IF NOT EXISTS `service_category` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `sort_order` int(11) DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 首页服务宫格条目。同上，存在成组重复记录（50 行，去重后应为 24 条）。
CREATE TABLE IF NOT EXISTS `service_item` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `category_id` int(10) unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `icon` varchar(16) DEFAULT '',
  `badge` varchar(16) DEFAULT '',
  `mini_app_id` varchar(64) DEFAULT '',
  `icon_path` varchar(256) DEFAULT '',
  `link` varchar(256) DEFAULT '',
  `sort_order` int(11) DEFAULT '0',
  `status` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 首页服务宫格初始数据（幂等：仅空表时插入）
-- =====================================================================
INSERT INTO service_category (id, name, sort_order)
SELECT * FROM (SELECT 1 AS id, '平台自研' AS name, 1 AS sort_order UNION ALL
  SELECT 2, '校园服务', 2 UNION ALL SELECT 3, '学习相关', 3 UNION ALL
  SELECT 4, '生活服务', 4 UNION ALL SELECT 5, '校园资讯', 5) AS seed
WHERE NOT EXISTS (SELECT 1 FROM service_category LIMIT 1);

INSERT INTO service_item (category_id, name, icon, badge, link, sort_order, status)
SELECT * FROM (
  SELECT 1 AS category_id, '代拿跑腿' AS name, '🏃' AS icon, '推荐' AS badge, '' AS link, 1 AS sort_order, 1 AS status UNION ALL
  SELECT 1, '课程表', '📋', '推荐', '', 2, 1 UNION ALL
  SELECT 1, '社区论坛', '💬', '', '', 3, 1 UNION ALL
  SELECT 2, '二手闲置', '🛒', '推荐', '', 1, 1 UNION ALL
  SELECT 2, '订水系统', '💧', '推荐', '', 2, 1 UNION ALL
  SELECT 2, '校园卡', '💳', '', '', 3, 1 UNION ALL
  SELECT 2, '宅印', '🖨️', '推荐', '', 4, 1 UNION ALL
  SELECT 2, '广轻维修', '💻', '推荐', '', 5, 1 UNION ALL
  SELECT 2, '校历', '📅', '新生', '', 6, 1 UNION ALL
  SELECT 2, '自助购电', '⚡', '推荐', '', 7, 1 UNION ALL
  SELECT 2, '零食店', '🛍️', '推荐', '', 8, 1 UNION ALL
  SELECT 2, '杂货店', '🛒', '推荐', '', 9, 1 UNION ALL
  SELECT 2, '校园网', '📶', '', '', 10, 1 UNION ALL
  SELECT 3, '图书馆', '📖', '', '', 1, 1 UNION ALL
  SELECT 3, '选课系统', '📝', '', '', 2, 1 UNION ALL
  SELECT 3, '成绩查询', '📊', '', '', 3, 1 UNION ALL
  SELECT 3, '考试安排', '✏️', '', '', 4, 1 UNION ALL
  SELECT 3, '教务系统', '🎓', '推荐', '', 5, 1 UNION ALL
  SELECT 4, '轻友指南', '📚', '', '', 1, 1 UNION ALL
  SELECT 4, '校车时刻', '🚌', '', '', 2, 1 UNION ALL
  SELECT 4, '失物招领', '🔍', '', '', 3, 1 UNION ALL
  SELECT 4, '校园地图', '🗺️', '新生', '', 4, 1 UNION ALL
  SELECT 4, '乘车码', '🎫', '', '', 5, 1 UNION ALL
  SELECT 5, '教务文档', '📄', '', '', 1, 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM service_item LIMIT 1);

-- =====================================================================
-- 校园评价模块（课程 / 食堂 / 商圈评分）
-- 与 server/utils/migrations.js 保持一致：评审对象、评分、评价、点赞
-- =====================================================================
CREATE TABLE IF NOT EXISTS `review_target` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `category` VARCHAR(16) NOT NULL COMMENT 'course/canteen/business',
  `parent_id` INT UNSIGNED DEFAULT NULL COMMENT '食堂/商圈子对象所属父对象',
  `name` VARCHAR(64) NOT NULL,
  `avatar` VARCHAR(512) DEFAULT '',
  `campus` VARCHAR(32) DEFAULT '' COMMENT '广州校区/南海南/南海北（课程为空）',
  `floor` VARCHAR(16) DEFAULT '' COMMENT '1层/2层/3层',
  `grade` VARCHAR(32) DEFAULT '' COMMENT '课程分类：通识课/大一/.../本科二年级',
  `levels` VARCHAR(64) DEFAULT '' COMMENT '适用学历层次：专科,本科,专升本',
  `hot_comment` VARCHAR(255) DEFAULT '',
  `rating_sum` INT DEFAULT 0,
  `rating_count` INT DEFAULT 0,
  `comment_count` INT DEFAULT 0,
  `like_count` INT DEFAULT 0,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `status` TINYINT(1) DEFAULT 1,
  `deleted` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_review_category` (`category`, `deleted`, `status`),
  KEY `idx_review_parent` (`parent_id`),
  KEY `idx_review_campus` (`campus`),
  KEY `idx_review_grade` (`grade`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `review_rating` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `target_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `score` TINYINT NOT NULL COMMENT '1-5',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_review_rating` (`target_id`, `user_id`),
  KEY `idx_review_rating_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `review_comment` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `target_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `content` VARCHAR(1000) NOT NULL,
  `like_count` INT DEFAULT 0,
  `status` TINYINT(1) DEFAULT 1,
  `deleted` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_review_comment_target` (`target_id`, `deleted`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `review_target_like` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `target_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_review_target_like` (`target_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `review_comment_like` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `comment_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_review_comment_like` (`comment_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
