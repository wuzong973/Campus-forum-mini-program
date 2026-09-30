-- =====================================================================
-- 修复：PUT/GET /api/v1/schedule/config 返回 500（message: 数据库操作失败）
-- 日期：2026-09-30
-- 原因：远程库缺少课表模块的表（safeMessage 把 ER_NO_SUCH_TABLE /
--       ER_BAD_FIELD_ERROR 统一吞成"数据库操作失败"）
-- 用法：SSH 到 payun01.cn（193.112.187.95）后：
--       mysql -u<用户名> -p <远程库名> < 2026-09-30_schedule_tables_fix.sql
--       （远程库名以服务器上的 server/.env 里 DB_NAME 为准；
--        全部 CREATE TABLE IF NOT EXISTS，可安全重复执行）
-- =====================================================================

USE gqg_campus;  -- 与远程 server/.env 中 DB_NAME 一致

-- 课表手动课程（/schedule/list、增删课程依赖）
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

-- 课表配置（/schedule/config 的 GET/PUT，本次 500 的直接报错点）
CREATE TABLE IF NOT EXISTS `schedule_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `start_date` date DEFAULT '2026-09-07',
  `hide_weekend` tinyint(1) DEFAULT '0',
  `reminder` tinyint(1) DEFAULT '0',
  `bg_color` varchar(16) DEFAULT '#F5F7FA',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 教务考试安排缓存（查询考试安排依赖）
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

-- 教务成绩缓存（查询我的成绩依赖）
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

-- ==================== 执行后自检 ====================
SHOW TABLES LIKE 'schedule%';
SHOW COLUMNS FROM schedule_config;
-- 预期：user_schedule / schedule_config / user_exam / user_grade 四张表齐全，
--       schedule_config 含 start_date / hide_weekend / reminder / bg_color 四列。
-- 然后回到小程序：设置提醒开关 → PUT /schedule/config 应返回 200。
-- 若仍 500：看服务端日志里 [schedule.updateConfig] 打出的原始错误码。
