-- 广轻工数据库初始化脚本
CREATE DATABASE IF NOT EXISTS GQG_campus DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE GQG_campus;

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
  category VARCHAR(32) DEFAULT '日常生活',
  content TEXT NOT NULL,
  images JSON,
  like_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  favorite_count INT DEFAULT 0,
  share_count INT DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_category (category),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- 3. 论坛评论表
CREATE TABLE IF NOT EXISTS forum_comment (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  parent_id INT UNSIGNED DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_post (post_id)
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
  color VARCHAR(16) DEFAULT '#4A7AFF',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- 5. 课程表配置
CREATE TABLE IF NOT EXISTS schedule_config (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  start_date DATE DEFAULT '2025-09-01',
  hide_weekend TINYINT(1) DEFAULT 0,
  reminder TINYINT(1) DEFAULT 0,
  bg_color VARCHAR(16) DEFAULT '#F5F7FA',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 6. 跑腿订单表
CREATE TABLE IF NOT EXISTS errand_order (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT UNSIGNED NOT NULL,
  acceptor_id INT UNSIGNED DEFAULT NULL,
  type VARCHAR(16) DEFAULT '快递',
  title VARCHAR(128) NOT NULL,
  description TEXT,
  reward DECIMAL(10,2) NOT NULL,
  pickup_addr VARCHAR(256) DEFAULT '',
  delivery_addr VARCHAR(256) DEFAULT '',
  campus VARCHAR(32) DEFAULT '南校区',
  status ENUM('pending','accepted','finished','cancelled') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_campus (campus)
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

-- 11. 用户关注表
CREATE TABLE IF NOT EXISTS user_follow (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  follower_id INT UNSIGNED NOT NULL,
  followee_id INT UNSIGNED NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_follow (follower_id, followee_id),
  INDEX idx_followee (followee_id)
) ENGINE=InnoDB;

-- 12. 帖子转发表
CREATE TABLE IF NOT EXISTS forum_share (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  post_id INT UNSIGNED NOT NULL,
  share_content TEXT DEFAULT '',
  parent_share_id INT UNSIGNED DEFAULT 0,
  status TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_post (post_id)
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
  status ENUM('sending','sent','delivered','read','failed') DEFAULT 'sent',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation (conversation_id),
  INDEX idx_receiver (receiver_id, status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- 初始服务数据
INSERT INTO service_category (name, sort_order) VALUES
('平台自研', 1), ('校园服务', 2), ('学习相关', 3), ('生活服务', 4), ('校园资讯', 5);

INSERT INTO service_item (category_id, name, icon, badge, sort_order) VALUES
(1, '代拿跑腿', '🏃', '推荐', 1),
(1, '课程表', '📋', '推荐', 2),
(1, '社区论坛', '💬', '', 3),
(2, '二手闲置', '🛒', '推荐', 1),
(2, '南校订水', '💧', '推荐', 2),
(2, '校园卡', '💳', '', 3),
(2, '宅印', '🖨️', '推荐', 4),
(2, '校历', '📅', '新生', 5),
(2, '北校订水', '💧', '推荐', 7),
(2, '电脑义修', '💻', '推荐', 8),
(2, '信息门户', '🏫', '推荐', 9),
(2, '校园网', '📶', '', 10),
(3, '图书馆', '📖', '', 1),
(3, '选课系统', '📝', '', 2),
(3, '成绩查询', '📊', '', 3),
(3, '考试安排', '✏️', '', 4),
(3, '教务系统', '🎓', '推荐', 5),
(4, '食堂菜单', '🍜', '', 1),
(4, '校车时刻', '🚌', '', 2),
(4, '失物招领', '🔍', '', 3),
(4, '校园地图', '🗺️', '新生', 4),
(5, '通知公告', '📢', '', 1);
