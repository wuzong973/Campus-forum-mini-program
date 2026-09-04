-- 广轻工数据库初始化脚本
CREATE DATABASE IF NOT EXISTS gqg_campus DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gqg_campus;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS sys_user (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL UNIQUE,
  nick_name VARCHAR(64) DEFAULT '校园用户',
  avatar_url VARCHAR(512) DEFAULT '',
  gender TINYINT DEFAULT 1,
  campus VARCHAR(64) DEFAULT '',
  phone VARCHAR(20) DEFAULT NULL,
  student_id VARCHAR(32) DEFAULT NULL,
  real_name VARCHAR(32) DEFAULT '',
  is_verified TINYINT(1) DEFAULT 0,
  cert_label VARCHAR(32) DEFAULT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  UNIQUE KEY uk_phone (phone),
  UNIQUE KEY uk_student_id (student_id)
) ENGINE=InnoDB;

-- 2. 论坛帖子表
CREATE TABLE IF NOT EXISTS forum_post (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(128) DEFAULT '',
  category VARCHAR(32) DEFAULT '日常话题',
    content TEXT NOT NULL,
    images JSON,
    contact JSON DEFAULT NULL,
    anonymous_identity JSON DEFAULT NULL,
    components JSON DEFAULT NULL,
    like_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  favorite_count INT DEFAULT 0,
  share_count INT DEFAULT 0,
  view_count INT DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  review_note VARCHAR(255) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_category (category),
  INDEX idx_created (created_at),
  INDEX idx_post_feed (status, category, created_at)
) ENGINE=InnoDB;

-- Administrative data. The initial super administrator must be assigned manually
-- after creating a user: UPDATE sys_user SET role = 'super_admin' WHERE id = ?;
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id INT UNSIGNED NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  detail JSON,
  ip VARCHAR(64) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_audit_created (admin_id, created_at),
  INDEX idx_audit_target (target_type, target_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_content (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  body TEXT,
  status TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_system_content_type_status (type, status, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS feature_config (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(128) NOT NULL,
  config_value TEXT,
  status TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT UNSIGNED DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS virtual_item (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  cover_url VARCHAR(512) DEFAULT '',
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  sales_count INT NOT NULL DEFAULT 0,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_virtual_item_status (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS virtual_item_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  admin_id INT UNSIGNED NOT NULL,
  action VARCHAR(32) NOT NULL,
  before_data JSON,
  after_data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_virtual_item_log (item_id, created_at)
) ENGINE=InnoDB;

-- 3. 论坛评论表
CREATE TABLE IF NOT EXISTS forum_comment (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
    images JSON,
    anonymous_identity JSON DEFAULT NULL,
    parent_id INT UNSIGNED DEFAULT 0,
  like_count INT DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_post (post_id),
  INDEX idx_comment_post_status_time (post_id, status, created_at)
) ENGINE=InnoDB;

-- 评论点赞表
CREATE TABLE IF NOT EXISTS forum_comment_like (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  comment_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comment_user (comment_id, user_id)
) ENGINE=InnoDB;

-- 4. 用户课程表
CREATE TABLE IF NOT EXISTS user_schedule (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  location VARCHAR(128) DEFAULT '',
  teacher VARCHAR(64) DEFAULT '',
  week_day TINYINT DEFAULT 1,
  start_time VARCHAR(8) DEFAULT '08:00',
  end_time VARCHAR(8) DEFAULT '09:40',
  start_week TINYINT DEFAULT 1,
  end_week TINYINT DEFAULT 16,
  week_type VARCHAR(8) DEFAULT 'all',
  color VARCHAR(16) DEFAULT '#4A7AFF',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_schedule_user_weekday (user_id, week_day)
) ENGINE=InnoDB;

-- 5. 课程表配置
CREATE TABLE IF NOT EXISTS schedule_config (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  start_date DATE DEFAULT '2026-03-02',
  hide_weekend TINYINT(1) DEFAULT 0,
  reminder TINYINT(1) DEFAULT 0,
  bg_color VARCHAR(16) DEFAULT '#F5F7FA',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 6. 跑腿订单表
CREATE TABLE IF NOT EXISTS errand_order (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(32) DEFAULT NULL,
  publisher_id INT UNSIGNED NOT NULL,
  acceptor_id INT UNSIGNED DEFAULT NULL,
  type VARCHAR(16) DEFAULT '快递',
  title VARCHAR(128) NOT NULL,
  description TEXT,
  reward DECIMAL(10,2) NOT NULL,
  pickup_addr VARCHAR(256) DEFAULT '',
  delivery_addr VARCHAR(256) DEFAULT '',
  campus VARCHAR(32) DEFAULT '南校区',
  gender_requirement VARCHAR(16) NOT NULL DEFAULT '不限性别',
  pickup_time_type VARCHAR(16) DEFAULT '尽快',
  appointment_time DATETIME DEFAULT NULL,
  receiver_name VARCHAR(32) DEFAULT '',
  receiver_phone VARCHAR(20) DEFAULT '',
  delivery_building VARCHAR(64) DEFAULT '',
  delivery_room VARCHAR(32) DEFAULT '',
  remark TEXT,
  images JSON DEFAULT NULL,
  is_large_item TINYINT(1) DEFAULT 0,
  is_urgent TINYINT(1) DEFAULT 0,
  payment_status VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
  transaction_id VARCHAR(64) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  status ENUM('pending','accepted','finished','cancelled') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_campus (campus),
  UNIQUE KEY uk_errand_order_no (order_no),
  INDEX idx_errand_feed (status, campus, created_at)
) ENGINE=InnoDB;

-- System and activity records
CREATE TABLE IF NOT EXISTS system_notification (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  type ENUM('comment','like','system','errand','repair') NOT NULL,
  title VARCHAR(128) NOT NULL,
  content TEXT,
  related_id VARCHAR(64) DEFAULT '',
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_read (user_id, is_read, created_at)
) ENGINE=InnoDB;

-- 用户反馈。图片地址为已上传至受控存储的 HTTPS URL。
CREATE TABLE IF NOT EXISTS user_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  type ENUM('功能建议','Bug反馈','体验优化','其他问题') NOT NULL,
  content VARCHAR(500) NOT NULL,
  contact VARCHAR(128) DEFAULT '',
  images JSON,
  status ENUM('pending','processing','resolved','closed') NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_feedback_user_created (user_id, created_at),
  INDEX idx_feedback_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS content_report (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT UNSIGNED NOT NULL,
  target_type ENUM('post','comment') NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('pending','processing','resolved','rejected') NOT NULL DEFAULT 'pending',
  handled_by INT UNSIGNED DEFAULT NULL,
  handled_note VARCHAR(500) DEFAULT '',
  handled_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_report_status_created (status, created_at),
  INDEX idx_report_target (target_type, target_id, created_at)
) ENGINE=InnoDB;

-- 用户“不感兴趣”偏好：屏蔽指定帖子及同分类后续内容。
CREATE TABLE IF NOT EXISTS post_hidden_preference (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  post_id INT UNSIGNED NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hidden_post_user (user_id, post_id),
  INDEX idx_hidden_user_category (user_id, category)
) ENGINE=InnoDB;

-- 提交注销申请后提供七天冷静期，实际清理任务仅处理到期且仍为 pending 的记录。
CREATE TABLE IF NOT EXISTS account_deletion_request (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  status ENUM('pending','cancelled','completed') NOT NULL DEFAULT 'pending',
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  scheduled_for DATETIME NOT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  UNIQUE KEY uk_deletion_request_user (user_id),
  INDEX idx_deletion_status_scheduled (status, scheduled_for)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_view (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_post_user (post_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS errand_review (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  reviewer_id INT UNSIGNED NOT NULL,
  target_id INT UNSIGNED NOT NULL,
  rating TINYINT NOT NULL DEFAULT 5,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_order_reviewer (order_id, reviewer_id),
  INDEX idx_target (target_id)
) ENGINE=InnoDB;

-- 广轻维修订单（支付成功后进入待接单状态）
CREATE TABLE IF NOT EXISTS repair_order (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  device_type VARCHAR(32) NOT NULL,
  fault_type VARCHAR(64) NOT NULL,
  description TEXT,
  contact_name VARCHAR(32) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  technician_name VARCHAR(32) DEFAULT '',
  technician_phone VARCHAR(20) DEFAULT '',
  technician_user_id INT UNSIGNED DEFAULT NULL,
  service_address VARCHAR(256) NOT NULL,
  appointment_time DATETIME NOT NULL,
  images JSON,
  amount DECIMAL(10,2) NOT NULL,
  transaction_id VARCHAR(64) DEFAULT NULL,
  status ENUM('unpaid','paid','accepted','repairing','finished','cancelled') DEFAULT 'unpaid',
  paid_at DATETIME DEFAULT NULL,
  notified_at DATETIME DEFAULT NULL,
  technician_notified_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id), INDEX idx_status (status),
  INDEX idx_repair_user_created (user_id, created_at),
  INDEX idx_repair_technician_created (technician_user_id, created_at)
) ENGINE=InnoDB;

-- Payment records are the source of truth for monetary state. Amounts are stored in fen.
CREATE TABLE IF NOT EXISTS payment_transaction (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_type VARCHAR(32) NOT NULL,
  business_order_id INT UNSIGNED NOT NULL,
  merchant_order_no VARCHAR(64) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  amount_fen INT UNSIGNED NOT NULL,
  status ENUM('CREATED','PREPAY','SUCCESS','CLOSED','REFUNDING','REFUNDED','FAILED') NOT NULL DEFAULT 'CREATED',
  prepay_id VARCHAR(128) DEFAULT NULL,
  wx_transaction_id VARCHAR(64) DEFAULT NULL,
  callback_source VARCHAR(16) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  last_error VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_payment_business (business_type, business_order_id),
  UNIQUE KEY uk_payment_order_no (merchant_order_no),
  UNIQUE KEY uk_payment_wx_transaction (wx_transaction_id),
  INDEX idx_payment_user_created (user_id, created_at),
  INDEX idx_payment_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_refund (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  out_refund_no VARCHAR(64) NOT NULL,
  wx_refund_id VARCHAR(64) DEFAULT NULL,
  refund_fen INT UNSIGNED NOT NULL,
  reason VARCHAR(80) DEFAULT '',
  status ENUM('CREATED','PROCESSING','SUCCESS','CLOSED','ABNORMAL','FAILED') NOT NULL DEFAULT 'CREATED',
  completed_at DATETIME DEFAULT NULL,
  last_error VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_refund_out_no (out_refund_no),
  UNIQUE KEY uk_refund_wx_no (wx_refund_id),
  INDEX idx_refund_payment_created (payment_id, created_at)
) ENGINE=InnoDB;

-- Wallet earnings are immutable. Withdrawals reserve the requested amount while pending review.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  entry_type ENUM('ERRAND_EARNING') NOT NULL,
  amount_fen INT NOT NULL,
  reference_type VARCHAR(32) NOT NULL,
  reference_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(128) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wallet_reference (user_id, reference_type, reference_id),
  INDEX idx_wallet_user_created (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wallet_withdrawal (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  amount_fen INT UNSIGNED NOT NULL,
  status ENUM('PENDING','PROCESSING','SUCCESS','REJECTED','FAILED') NOT NULL DEFAULT 'PENDING',
  out_batch_no VARCHAR(64) NOT NULL,
  out_detail_no VARCHAR(64) NOT NULL,
  wx_batch_id VARCHAR(64) DEFAULT NULL,
  review_note VARCHAR(255) DEFAULT '',
  reviewed_by INT UNSIGNED DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  last_error VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wallet_withdrawal_batch (out_batch_no),
  UNIQUE KEY uk_wallet_withdrawal_detail (out_detail_no),
  INDEX idx_wallet_withdrawal_user_created (user_id, created_at),
  INDEX idx_wallet_withdrawal_status_created (status, created_at)
) ENGINE=InnoDB;

-- 7. 服务分类表
CREATE TABLE IF NOT EXISTS service_category (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  sort_order INT DEFAULT 0
) ENGINE=InnoDB;

-- 8. 服务项表
CREATE TABLE IF NOT EXISTS service_item (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  icon VARCHAR(16) DEFAULT '',
  badge VARCHAR(16) DEFAULT '',
  link VARCHAR(256) DEFAULT '',
  sort_order INT DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  INDEX idx_category (category_id)
) ENGINE=InnoDB;

-- 9. 帖子点赞表
CREATE TABLE IF NOT EXISTS forum_like (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_post_user (post_id, user_id)
) ENGINE=InnoDB;

-- 10. 帖子收藏表
CREATE TABLE IF NOT EXISTS forum_favorite (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_post_user (post_id, user_id)
) ENGINE=InnoDB;

-- 11. 帖子转发表
CREATE TABLE IF NOT EXISTS forum_share (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  post_id INT UNSIGNED NOT NULL,
  share_content TEXT,
  parent_share_id INT UNSIGNED DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_post (post_id),
  INDEX idx_share_post_status_time (post_id, status, created_at)
) ENGINE=InnoDB;

-- 13. 私信会话表
CREATE TABLE IF NOT EXISTS private_conversation (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  peer_id INT UNSIGNED NOT NULL,
  last_message_id INT UNSIGNED DEFAULT NULL,
  unread_count INT DEFAULT 0,
  last_message_text VARCHAR(512) DEFAULT '',
  last_message_time DATETIME DEFAULT NULL,
  status TINYINT(1) DEFAULT 1,
  is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_peer (user_id, peer_id),
  INDEX idx_peer (peer_id)
) ENGINE=InnoDB;

-- 14. 私信消息表
CREATE TABLE IF NOT EXISTS private_message (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  receiver_id INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  msg_type VARCHAR(16) DEFAULT 'text',
  status ENUM('sending','sent','delivered','read','failed','recalled') DEFAULT 'sent',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation (conversation_id),
  INDEX idx_receiver (receiver_id, status),
  INDEX idx_created (created_at),
  INDEX idx_message_conversation_time (conversation_id, created_at),
  INDEX idx_message_receiver_status_time (receiver_id, status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS private_message_recall_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  operator_id INT UNSIGNED NOT NULL,
  receiver_id INT UNSIGNED NOT NULL,
  recalled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recall_message (message_id),
  INDEX idx_recall_operator_time (operator_id, recalled_at)
) ENGINE=InnoDB;

-- 初始服务数据（幂等：仅在表为空时插入，避免重复执行脚本产生重复数据）
INSERT INTO service_category (name, sort_order)
SELECT * FROM (SELECT '平台自研' AS name, 1 AS sort_order UNION ALL
  SELECT '校园服务', 2 UNION ALL SELECT '学习相关', 3 UNION ALL
  SELECT '生活服务', 4 UNION ALL SELECT '校园资讯', 5) AS seed
WHERE NOT EXISTS (SELECT 1 FROM service_category LIMIT 1);

INSERT INTO service_item (category_id, name, icon, badge, sort_order)
SELECT * FROM (
  SELECT 1 AS category_id, '代拿跑腿' AS name, '🏃' AS icon, '' AS badge, 1 AS sort_order UNION ALL
  SELECT 1, '课程表', '📋', '', 2 UNION ALL
  SELECT 1, '社区论坛', '💬', '', 3 UNION ALL
  SELECT 2, '二手闲置', '🛒', '', 1 UNION ALL
  SELECT 2, '订水系统', '💧', '', 2 UNION ALL
  SELECT 2, '校园卡', '💳', '', 3 UNION ALL
  SELECT 2, '宅印', '🖨️', '', 4 UNION ALL
  SELECT 2, '广轻维修', '💻', '', 5 UNION ALL
  SELECT 2, '校历', '📅', '', 6 UNION ALL
  SELECT 2, '自助购电', '⚡', '', 7 UNION ALL
  SELECT 2, '零食店', '🛍️', '', 8 UNION ALL
  SELECT 2, '杂货店', '🛒', '', 9 UNION ALL
  SELECT 2, '校园网', '📶', '', 10 UNION ALL
  SELECT 3, '图书馆', '📖', '', 1 UNION ALL
  SELECT 3, '选课系统', '📝', '', 2 UNION ALL
  SELECT 3, '成绩查询', '📊', '', 3 UNION ALL
  SELECT 3, '考试安排', '✏️', '', 4 UNION ALL
  SELECT 3, '教务系统', '🎓', '', 5 UNION ALL
  SELECT 4, '食堂菜单', '🍜', '', 1 UNION ALL
  SELECT 4, '校车时刻', '🚌', '', 2 UNION ALL
  SELECT 4, '失物招领', '🔍', '', 3 UNION ALL
  SELECT 4, '校园地图', '🗺️', '', 4 UNION ALL
  SELECT 4, '乘车码', '🎫', '', 5 UNION ALL
  SELECT 5, '通知公告', '📢', '', 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM service_item LIMIT 1);
