const pool = require('../config/pool')
// JSON 列写入值统一走 toJsonColumn：mysql2 会把 JSON 列解析成 JS 数组，
// 数组直接当 `?` 参数会被展开成多个值，导致列数不匹配（详见 helpers.js 注释）
const { toJsonColumn } = require('./helpers')
// 默认头像/昵称与旧路径归一化：与 userController 新用户注册共用同一套规则
const {
  DEFAULT_NAME_VALUES,
  getRandomAvatar,
  getRandomName,
  normalizeLegacyAvatarUrl,
  normalizeAnonymousAvatarUrl,
  isAnonymousAvatarUrl,
  pickAnonymousAvatar,
} = require('./defaultProfile')

async function ensureColumn(tableName, columnName, definition) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  )
  if (!rows.length) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

async function ensureColumnType(tableName, columnName, definition) {
  const [rows] = await pool.query(
    `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  )
  // 期望完成时间改为自由文本，DATETIME 列只需调整一次类型
  if (rows.length && String(rows[0].DATA_TYPE).toLowerCase() !== 'varchar') {
    await pool.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${definition}`)
  }
}

async function ensureIndex(tableName, indexName, definition) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  )
  if (!rows.length) await pool.query(`CREATE INDEX ${indexName} ON ${tableName} ${definition}`)
}

async function ensureUniqueIndex(tableName, indexName, definition) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  )
  if (!rows.length) await pool.query(`CREATE UNIQUE INDEX ${indexName} ON ${tableName} ${definition}`)
}

async function runMigrations() {
  await ensureColumn('sys_user', 'gender', "TINYINT DEFAULT 1 AFTER avatar_url")
  await ensureColumn('sys_user', 'campus', "VARCHAR(64) DEFAULT '' AFTER gender")
  await ensureColumn('sys_user', 'phone', "VARCHAR(20) DEFAULT NULL AFTER campus")
  await ensureColumn('sys_user', 'status', "TINYINT(1) DEFAULT 1 AFTER is_verified")
  await ensureColumn('sys_user', 'role', "VARCHAR(32) NOT NULL DEFAULT 'user' AFTER status")
  await ensureColumn('sys_user', 'cert_label', "VARCHAR(32) DEFAULT NULL AFTER is_verified")
  // 允许被匿名私信：关闭后其他用户无法以匿名身份与该用户建立私信会话
  await ensureColumn('sys_user', 'allow_anonymous_pm', 'TINYINT(1) DEFAULT 1 AFTER cert_label')
  // 隐藏主页帖子：开启后访客进入其个人主页不再返回帖子列表（仅作者本人可见）
  await ensureColumn('sys_user', 'hide_profile_posts', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER allow_anonymous_pm')
  await ensureColumn('forum_post', 'title', "VARCHAR(128) DEFAULT '' AFTER user_id")
  await ensureColumn('forum_post', 'contact', 'JSON DEFAULT NULL AFTER images')
  await ensureColumn('forum_post', 'anonymous_identity', 'JSON DEFAULT NULL AFTER contact')
  await ensureColumn('forum_post', 'components', 'JSON DEFAULT NULL AFTER anonymous_identity')
  await ensureColumn('forum_post', 'pinned', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER status')
  await ensureColumn('forum_post', 'review_note', "VARCHAR(255) DEFAULT '' AFTER pinned")
  await ensureColumn('forum_post', 'share_count', 'INT DEFAULT 0 AFTER favorite_count')
  await ensureColumn('forum_post', 'view_count', 'INT DEFAULT 0 AFTER share_count')
  // 蹲贴：用户「蹲」一篇帖子（关注后续动态）。明细表 forum_post_follow + 计数器 follow_count 双写，
  // 与 forum_like / forum_favorite 保持同一套约定（删明细后必须重算计数器）。
  await ensureColumn('forum_post', 'follow_count', 'INT DEFAULT 0 AFTER view_count')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forum_post_follow (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      post_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_post_user (post_id, user_id),
      KEY idx_user (user_id, created_at),
      KEY idx_post (post_id, created_at)
    ) ENGINE=InnoDB
  `)
  // 历史脏数据：计数器与明细表对不上时以明细表为准重算一次（幂等，无明细的行归零）
  await pool.query(`
    UPDATE forum_post p
    SET p.follow_count = (
      SELECT COUNT(*) FROM forum_post_follow f WHERE f.post_id = p.id
    )
    WHERE p.follow_count <> (
      SELECT COUNT(*) FROM forum_post_follow f WHERE f.post_id = p.id
    )
  `).catch((e) => console.warn('[migrations] 重算蹲贴计数失败：', e.message))
  await ensureColumn('forum_comment', 'images', 'JSON AFTER content')
  await ensureColumn('forum_comment', 'anonymous_identity', 'JSON DEFAULT NULL AFTER images')
  await ensureColumn('user_schedule', 'week_type', "VARCHAR(8) DEFAULT 'all' AFTER end_week")
  await ensureColumn('user_schedule', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at')
  await ensureColumn('errand_order', 'gender_requirement', "VARCHAR(16) NOT NULL DEFAULT '不限性别' AFTER campus")
  await ensureColumn('errand_order', 'pickup_time_type', "VARCHAR(16) DEFAULT '尽快' AFTER gender_requirement")
  await ensureColumn('errand_order', 'appointment_time', 'DATETIME DEFAULT NULL AFTER pickup_time_type')
  await ensureColumnType('errand_order', 'appointment_time', 'VARCHAR(64) DEFAULT NULL')
  await ensureColumn('errand_order', 'remark', 'TEXT AFTER appointment_time')
  await ensureColumn('errand_order', 'images', 'JSON DEFAULT NULL AFTER remark')
  await ensureColumn('errand_order', 'receiver_name', "VARCHAR(32) DEFAULT '' AFTER appointment_time")
  await ensureColumn('errand_order', 'receiver_phone', "VARCHAR(20) DEFAULT '' AFTER receiver_name")
  await ensureColumn('errand_order', 'delivery_building', "VARCHAR(64) DEFAULT '' AFTER receiver_phone")
  await ensureColumn('errand_order', 'delivery_room', "VARCHAR(32) DEFAULT '' AFTER delivery_building")
  await ensureColumn('errand_order', 'is_large_item', 'TINYINT(1) DEFAULT 0 AFTER remark')
  await ensureColumn('errand_order', 'is_urgent', 'TINYINT(1) DEFAULT 0 AFTER is_large_item')
  // Existing orders predate escrow payments, so retain their visibility.
  await ensureColumn('errand_order', 'payment_status', "VARCHAR(16) NOT NULL DEFAULT 'SUCCESS' AFTER is_urgent")
  await ensureColumn('errand_order', 'order_no', 'VARCHAR(32) DEFAULT NULL AFTER id')
  await ensureColumn('errand_order', 'transaction_id', 'VARCHAR(64) DEFAULT NULL AFTER payment_status')
  await ensureColumn('errand_order', 'paid_at', 'DATETIME DEFAULT NULL AFTER transaction_id')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_notification (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      type ENUM('comment','like','system','errand','repair','follow','reply') NOT NULL,
      title VARCHAR(128) NOT NULL,
      content TEXT,
      related_id VARCHAR(64) DEFAULT '',
      is_read TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_read (user_id, is_read, created_at)
    ) ENGINE=InnoDB
  `)
  // 互动通知快照：评论/点赞者身份（匿名评论存匿名形象）与所属帖子标题
  await ensureColumn('system_notification', 'actor_user_id', 'INT UNSIGNED DEFAULT NULL AFTER related_id')
  await ensureColumn('system_notification', 'actor_nick', "VARCHAR(64) DEFAULT '' AFTER actor_user_id")
  await ensureColumn('system_notification', 'actor_avatar', "VARCHAR(255) DEFAULT '' AFTER actor_nick")
  await ensureColumn('system_notification', 'post_title', "VARCHAR(255) DEFAULT '' AFTER actor_avatar")
  await ensureColumn('system_notification', 'comment_images', 'TEXT NULL AFTER post_title')
  // 通知类型扩展：'follow' = 你蹲的帖子有新评论（与「你的帖子有新评论」区分，前端归入评论 tab）
  await pool.query("ALTER TABLE system_notification MODIFY COLUMN type ENUM('comment','like','system','errand','repair','follow','reply') NOT NULL")
  // 通知关联的来源评论 ID：reply 通知需要幂等补齐历史数据；普通评论/点赞可为 NULL
  await ensureColumn('system_notification', 'source_comment_id', 'INT UNSIGNED DEFAULT NULL AFTER related_id')
  // P20：一条来源评论最多一条 reply 通知。先清历史重复，再建唯一键；
  // 唯一键建成后回收被它取代的普通索引，避免同一列上留两个索引。
  await pool.query(`
    DELETE n FROM system_notification n
    JOIN (
      SELECT source_comment_id, MIN(id) AS keep_id
      FROM system_notification
      WHERE source_comment_id IS NOT NULL AND type = 'reply'
      GROUP BY source_comment_id
      HAVING COUNT(*) > 1
    ) d ON d.source_comment_id = n.source_comment_id
    WHERE n.type = 'reply' AND n.id <> d.keep_id
  `).catch((e) => console.warn('[migrations] 清理重复回复通知失败：', e.message))
  await ensureUniqueIndex('system_notification', 'uk_notification_source_comment', '(source_comment_id)')
    .then(() => pool.query('ALTER TABLE system_notification DROP INDEX idx_notification_source_comment').catch(() => {}))
    .catch((e) => console.warn('[migrations] source_comment_id 唯一键创建跳过（可能存在历史重复）：', e.message))
  // 历史评论区回复此前缺少独立 reply 通知，或旧枚举直接导致写库失败。
  // 这里按 forum_comment 的父子关系补齐；source_comment_id + NOT EXISTS 保证重复启动不重复插入。
  await pool.query(`
    INSERT INTO system_notification
      (user_id, type, title, content, related_id, source_comment_id,
       actor_user_id, actor_nick, actor_avatar, post_title, comment_images, is_read, created_at)
    SELECT
      parent.user_id,
      'reply',
      '有人回复了你的评论',
      CONCAT(fc.content, CASE WHEN JSON_LENGTH(COALESCE(fc.images, JSON_ARRAY())) > 0 THEN ' [图片]' ELSE '' END),
      CAST(fc.post_id AS CHAR),
      fc.id,
      fc.user_id,
      COALESCE(
        JSON_UNQUOTE(JSON_EXTRACT(fc.anonymous_identity, '$.nickName')),
        u.nick_name,
        '校园用户'
      ),
      COALESCE(
        JSON_UNQUOTE(JSON_EXTRACT(fc.anonymous_identity, '$.avatarUrl')),
        u.avatar_url,
        ''
      ),
      COALESCE(fp.title, ''),
      COALESCE(fc.images, JSON_ARRAY()),
      0,
      COALESCE(fc.created_at, NOW())
    FROM forum_comment fc
    INNER JOIN forum_comment parent ON parent.id = fc.parent_id AND parent.status = 1
    INNER JOIN forum_post fp ON fp.id = fc.post_id AND fp.status = 1
    LEFT JOIN sys_user u ON u.id = fc.user_id
    LEFT JOIN system_notification existing_notification ON existing_notification.source_comment_id = fc.id
    WHERE fc.status = 1
      AND fc.parent_id > 0
      AND fc.user_id <> parent.user_id
      AND existing_notification.id IS NULL
  `).catch((e) => console.warn('[migrations] 补齐历史回复通知失败：', e.message))
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_feedback (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      type ENUM('功能建议','Bug反馈','体验优化','其他问题') NOT NULL,
      content VARCHAR(500) NOT NULL,
      contact VARCHAR(128) DEFAULT '',
      images JSON,
      status ENUM('pending','processing','replied','resolved','closed') NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_feedback_user_created (user_id, created_at),
      INDEX idx_feedback_status_created (status, created_at)
    ) ENGINE=InnoDB
  `)
  // 意见墙管理员回复：回复公开可见并通知提交人；状态改为「已回复」，仅管理员显式标记后才为 resolved。
  await ensureColumn('user_feedback', 'reply', "VARCHAR(500) DEFAULT '' AFTER status")
  await ensureColumn('user_feedback', 'reply_user_id', 'INT UNSIGNED DEFAULT NULL AFTER reply')
  await ensureColumn('user_feedback', 'reply_at', 'DATETIME DEFAULT NULL AFTER reply_user_id')
  // 意见状态枚举扩展：replied = 管理员已回复但未标记解决
  await pool.query("ALTER TABLE user_feedback MODIFY COLUMN status ENUM('pending','processing','replied','resolved','closed') NOT NULL DEFAULT 'pending'")
  // 意见墙用户评论：reply_to 指向被回复的评论（0 = 直接评论意见），reply_to_nick 冗余存储被回复人昵称
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback_comment (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      feedback_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      reply_to BIGINT UNSIGNED NOT NULL DEFAULT 0,
      reply_to_nick VARCHAR(64) DEFAULT '',
      content VARCHAR(500) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_feedback_comment (feedback_id, created_at)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_report (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      reporter_id INT UNSIGNED NOT NULL,
      target_type ENUM('post','comment','user') NOT NULL,
      target_id BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(500) NOT NULL,
      status ENUM('pending','processing','resolved','rejected') NOT NULL DEFAULT 'pending',
      handled_by INT UNSIGNED DEFAULT NULL,
      handled_note VARCHAR(500) DEFAULT '',
      handled_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_report_status_created (status, created_at),
      INDEX idx_report_target (target_type, target_id, created_at)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_hidden_preference (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      post_id INT UNSIGNED NOT NULL,
      category VARCHAR(32) NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_hidden_post_user (user_id, post_id),
      INDEX idx_hidden_user_category (user_id, category)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_view (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      post_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_post_user (post_id, user_id)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_conversation (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      peer_id INT UNSIGNED NOT NULL,
      persona_key VARCHAR(255) NOT NULL DEFAULT '',
      last_message_id INT UNSIGNED DEFAULT NULL,
      unread_count INT DEFAULT 0,
      last_message_text VARCHAR(512) DEFAULT '',
      last_message_time DATETIME DEFAULT NULL,
      status TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_peer_persona (user_id, peer_id, persona_key),
      INDEX idx_peer (peer_id)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_config (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      config_key VARCHAR(64) NOT NULL UNIQUE,
      label VARCHAR(128) NOT NULL,
      config_value TEXT,
      status TINYINT(1) NOT NULL DEFAULT 1,
      updated_by INT UNSIGNED DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    INSERT IGNORE INTO feature_config (config_key, label, config_value, status)
    VALUES
      ('community.enabled', 'Community', '', 1),
      ('errand.enabled', 'Errand', '', 1),
      ('repair.enabled', 'Repair', '', 1),
      ('schedule.enabled', 'Schedule', '', 1)
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS virtual_item_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      item_id INT UNSIGNED NOT NULL,
      admin_id INT UNSIGNED NOT NULL,
      action VARCHAR(32) NOT NULL,
      before_data JSON,
      after_data JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_virtual_item_log (item_id, created_at)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_message (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED NOT NULL,
      receiver_id INT UNSIGNED NOT NULL,
      persona_key VARCHAR(255) NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      msg_type VARCHAR(16) DEFAULT 'text',
      is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('sending','sent','delivered','read','failed','recalled') DEFAULT 'sent',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_conversation (conversation_id),
      INDEX idx_receiver (receiver_id, status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB
  `)
  await ensureColumn('private_conversation', 'is_anonymous', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER status')
  // 私信匿名渠道标记：同一会话内匿名/普通消息各自独立展示
  await ensureColumn('private_message', 'is_anonymous', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER msg_type')
  // 匿名会话的分身身份（JSON {nickName, avatarUrl}）：anon_peer_identity 是本行用户所看到的对方分身，anon_self_identity 是本行用户自己的分身
  await ensureColumn('private_conversation', 'anon_peer_identity', "VARCHAR(512) DEFAULT NULL AFTER is_anonymous")
  await ensureColumn('private_conversation', 'anon_self_identity', "VARCHAR(512) DEFAULT NULL AFTER anon_peer_identity")
  // 会话来源帖子：首次从帖子详情发起私信时记录，之后任何入口进入聊天都能「回到帖子」
  await ensureColumn('private_conversation', 'source_post_id', 'BIGINT UNSIGNED DEFAULT NULL AFTER anon_self_identity')
  // 分身隔离维度：persona_key 为该会话绑定的分身头像路径（普通私信为 ''）。
  // 同一真实用户的每个分身各自对应独立会话，聊天记录完全互不可见
  await ensureColumn('private_conversation', 'persona_key', "VARCHAR(255) NOT NULL DEFAULT '' AFTER peer_id")
  await ensureColumn('private_message', 'persona_key', "VARCHAR(255) NOT NULL DEFAULT '' AFTER receiver_id")
  // 历史数据回填：旧匿名会话没有 persona_key，按存档的分身身份补齐，保证升级后
  // 从分身卡片/帖子进入时仍能命中原会话，聊天记录不丢
  await pool.query(`
    UPDATE private_conversation
    SET persona_key = COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(anon_peer_identity, '$.avatarUrl')),
      JSON_UNQUOTE(JSON_EXTRACT(anon_self_identity, '$.avatarUrl'))
    )
    WHERE persona_key = ''
      AND (anon_peer_identity IS NOT NULL OR anon_self_identity IS NOT NULL)
  `)
  await pool.query(`
    UPDATE private_message m
    JOIN private_conversation c ON c.user_id = m.sender_id AND c.peer_id = m.receiver_id
    SET m.persona_key = c.persona_key
    WHERE m.persona_key = '' AND m.is_anonymous = 1 AND c.persona_key != ''
  `)
  // 唯一键升级：(user_id, peer_id) → (user_id, peer_id, persona_key)，
  // 允许同一对用户按分身建立多个并行隔离会话
  await pool.query('ALTER TABLE private_conversation DROP INDEX uk_user_peer, ADD UNIQUE KEY uk_user_peer_persona (user_id, peer_id, persona_key)').catch(() => { })
  await ensureUniqueIndex('private_conversation', 'uk_user_peer_persona', '(user_id, peer_id, persona_key)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_message_recall_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      message_id INT UNSIGNED NOT NULL,
      operator_id INT UNSIGNED NOT NULL,
      receiver_id INT UNSIGNED NOT NULL,
      recalled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_recall_message (message_id),
      INDEX idx_recall_operator_time (operator_id, recalled_at)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blacklist (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      blocked_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_blocked (user_id, blocked_id),
      INDEX idx_blocked_user (blocked_id)
    ) ENGINE=InnoDB
  `)
  await pool.query("ALTER TABLE private_message MODIFY COLUMN status ENUM('sending','sent','delivered','read','failed','recalled') DEFAULT 'sent'")
  // 用户主页可举报用户，枚举需与新版接口保持一致
  await pool.query("ALTER TABLE content_report MODIFY COLUMN target_type ENUM('post','comment','user') NOT NULL")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repair_order (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(32) NOT NULL UNIQUE,
      user_id INT UNSIGNED NOT NULL,
      device_type VARCHAR(32) NOT NULL,
      fault_type VARCHAR(64) NOT NULL,
      description TEXT,
      contact_name VARCHAR(32) NOT NULL,
      contact_phone VARCHAR(20) NOT NULL,
      service_address VARCHAR(256) NOT NULL,
      appointment_time DATETIME NOT NULL,
      images JSON,
      amount DECIMAL(10,2) NOT NULL,
      transaction_id VARCHAR(64) DEFAULT NULL,
      status ENUM('unpaid','paid','accepted','repairing','finished','cancelled') DEFAULT 'unpaid',
      paid_at DATETIME DEFAULT NULL,
      notified_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_status (status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    INSERT INTO service_item (category_id, name, icon, badge, sort_order, status)
    SELECT c.id, '广轻维修', '💻', '推荐', 5, 1
    FROM service_category c
    WHERE c.name = '校园服务'
      AND NOT EXISTS (SELECT 1 FROM service_item s WHERE s.name = '广轻维修')
    LIMIT 1
  `)
  await pool.query(`
    INSERT INTO service_item (category_id, name, icon, badge, sort_order, status)
    SELECT c.id, '乘车码', '🎫', '', 5, 1
    FROM service_category c
    WHERE c.name = '生活服务'
      AND NOT EXISTS (SELECT 1 FROM service_item s WHERE s.name = '乘车码')
    LIMIT 1
  `)
  // Reconcile service data created by older deployments with the canonical
  // 24-item catalog used by the mini-program. Keep the records for audit, but
  // hide entries that were never part of the original catalog.
  await pool.query(`
    UPDATE service_item
    SET status = 1
    WHERE name IN (
      '代拿跑腿', '社区论坛', '订水系统', '宅印', '校历', '课程表',
      '二手闲置', '校园卡', '广轻维修', '自助购电', '零食店', '校园网',
      '选课系统', '考试安排', '食堂菜单', '杂货店', '图书馆', '成绩查询',
      '教务系统', '校车时刻', '失物招领', '乘车码', '校园地图', '通知公告'
    )
  `)
  await pool.query(`
    UPDATE service_item
    SET status = 0
    WHERE name IN ('电脑义修', '信息门户', '南校订水', '北校订水')
  `)
  await pool.query(`
    INSERT INTO service_item (category_id, name, icon, badge, sort_order, status)
    SELECT c.id, '订水系统', '💧', '推荐', 2, 1
    FROM service_category c
    WHERE c.name = '校园服务'
      AND NOT EXISTS (SELECT 1 FROM service_item s WHERE s.name = '订水系统')
    LIMIT 1
  `)
  await pool.query(`
    INSERT INTO service_item (category_id, name, icon, badge, sort_order, status)
    SELECT c.id, '自助购电', '⚡', '推荐', 7, 1
    FROM service_category c
    WHERE c.name = '校园服务'
      AND NOT EXISTS (SELECT 1 FROM service_item s WHERE s.name = '自助购电')
    LIMIT 1
  `)
  await pool.query(`
    INSERT INTO service_item (category_id, name, icon, badge, sort_order, status)
    SELECT c.id, '零食店', '🛍️', '推荐', 8, 1
    FROM service_category c
    WHERE c.name = '校园服务'
      AND NOT EXISTS (SELECT 1 FROM service_item s WHERE s.name = '零食店')
    LIMIT 1
  `)
  await pool.query(`
    INSERT INTO service_item (category_id, name, icon, badge, sort_order, status)
    SELECT c.id, '杂货店', '🛒', '推荐', 9, 1
    FROM service_category c
    WHERE c.name = '校园服务'
      AND NOT EXISTS (SELECT 1 FROM service_item s WHERE s.name = '杂货店')
    LIMIT 1
  `)
  await ensureColumn('repair_order', 'technician_name', "VARCHAR(32) DEFAULT '' AFTER contact_phone")
  await ensureColumn('repair_order', 'technician_phone', "VARCHAR(20) DEFAULT '' AFTER technician_name")
  await ensureColumn('repair_order', 'technician_user_id', "INT UNSIGNED DEFAULT NULL AFTER technician_phone")
  await ensureColumn('repair_order', 'technician_notified_at', "DATETIME DEFAULT NULL AFTER notified_at")
  await ensureColumn('repair_order', 'wechat_id', "VARCHAR(64) DEFAULT '' AFTER contact_phone")
  await ensureColumn('repair_order', 'expected_time', "VARCHAR(64) DEFAULT '' AFTER wechat_id")
  // 服务项可配置化：外部小程序 AppID 与本地图标路径入库（此前只能端上硬编码兜底）
  await ensureColumn('service_item', 'mini_app_id', "VARCHAR(64) DEFAULT '' AFTER badge")
  await ensureColumn('service_item', 'icon_path', "VARCHAR(256) DEFAULT '' AFTER mini_app_id")
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  await pool.query(`
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
    ) ENGINE=InnoDB
  `)
  // 新版商家转账（用户确认收款模式）：状态枚举增加 WAIT_CONFIRM，并保存微信转账单号与拉起收款页的 package_info
  const [wdStatusCol] = await pool.query("SHOW COLUMNS FROM wallet_withdrawal LIKE 'status'")
  if (wdStatusCol.length && !String(wdStatusCol[0].Type || '').includes('WAIT_CONFIRM')) {
    await pool.query("ALTER TABLE wallet_withdrawal MODIFY COLUMN status ENUM('PENDING','PROCESSING','WAIT_CONFIRM','SUCCESS','REJECTED','FAILED') NOT NULL DEFAULT 'PENDING'")
  }
  await ensureColumn('wallet_withdrawal', 'transfer_bill_no', 'VARCHAR(64) DEFAULT NULL AFTER wx_batch_id')
  await ensureColumn('wallet_withdrawal', 'package_info', 'VARCHAR(1024) DEFAULT NULL AFTER transfer_bill_no')
  await ensureIndex('forum_post', 'idx_post_feed', '(status, category, created_at)')
  await ensureIndex('forum_post', 'idx_post_admin', '(status, pinned, created_at)')
  await ensureIndex('forum_comment', 'idx_comment_post_status_time', '(post_id, status, created_at)')
  await ensureIndex('forum_share', 'idx_share_post_status_time', '(post_id, status, created_at)')
  await ensureIndex('private_message', 'idx_message_conversation_time', '(conversation_id, created_at)')
  await ensureIndex('private_message', 'idx_message_receiver_status_time', '(receiver_id, status, created_at)')
  await ensureIndex('user_schedule', 'idx_schedule_user_weekday', '(user_id, week_day)')
  await ensureIndex('errand_order', 'idx_errand_feed', '(status, campus, created_at)')
  // 接单方维度的查询（我接的单 / 订单聊天列表 / 进行中订单角标）都按 acceptor_id 过滤，缺索引会全表扫描（P16）
  await ensureIndex('errand_order', 'idx_errand_acceptor', '(acceptor_id, created_at)')
  // 发布人维度同理：我发布的 / 待支付角标按 publisher_id + created_at 排序
  await ensureIndex('errand_order', 'idx_errand_publisher', '(publisher_id, created_at)')
  await ensureUniqueIndex('errand_order', 'uk_errand_order_no', '(order_no)')
  await ensureIndex('repair_order', 'idx_repair_user_created', '(user_id, created_at)')
  await ensureIndex('repair_order', 'idx_repair_technician_created', '(technician_user_id, created_at)')
  // 课程表配置表：早期部署只写在 init.sql 里，线上旧库缺表会让 /schedule/config 一直 500
  // 默认起始日 = 本学期第 1 教学周周一（与 utils/schedule.js、jwScheduleSyncService 一致）；
  // 此前是上一学期的 2026-03-02，靠调用方每次显式传值才没暴露。存量表不改默认值
  // （写入路径一定带 start_date，改它要 ALTER 却没有任何行为差异）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_config (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      start_date DATE DEFAULT '2026-09-07',
      hide_weekend TINYINT(1) DEFAULT 0,
      reminder TINYINT(1) DEFAULT 0,
      bg_color VARCHAR(128) DEFAULT '#F5F7FA',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  await ensureColumn('schedule_config', 'bg_color', "VARCHAR(128) DEFAULT '#F5F7FA'")
  await ensureColumn('schedule_config', 'start_date', "DATE DEFAULT '2026-09-07'")
  // 存量表列宽修正：bg_color 可能是 45 字符的 linear-gradient 串（课表页 BG_COLOR_PALETTE
  // 随机抽中），VARCHAR(16) 会 ER_DATA_TOO_LONG → /schedule/config 500，且 5xx 不清
  // 前端离线队列，之后提醒开关/隐藏周末等所有配置保存全部跟着 500。MODIFY 幂等。
  await pool.query("ALTER TABLE schedule_config MODIFY COLUMN bg_color VARCHAR(128) DEFAULT '#F5F7FA'")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rider_verification (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      campus_name VARCHAR(64) DEFAULT '',
      student_id VARCHAR(32) DEFAULT '',
      campus_credential VARCHAR(512) DEFAULT '',
      real_name VARCHAR(64) DEFAULT '',
      identity_number VARCHAR(32) DEFAULT '',
      identity_credential VARCHAR(512) DEFAULT '',
      phone VARCHAR(20) DEFAULT '',
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      review_note VARCHAR(255) DEFAULT '',
      reviewed_by INT UNSIGNED DEFAULT NULL,
      reviewed_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_rider_verification_user (user_id),
      INDEX idx_rider_verification_status (status, created_at)
    ) ENGINE=InnoDB
  `)
  // 接单时间（30分钟取消规则以接单时间为准）与完成凭证
  await ensureColumn('errand_order', 'accepted_at', 'DATETIME DEFAULT NULL AFTER status')
  await ensureColumn('errand_order', 'finish_description', "VARCHAR(500) DEFAULT '' AFTER accepted_at")
  await ensureColumn('errand_order', 'finish_images', 'JSON DEFAULT NULL AFTER finish_description')
  await ensureColumn('errand_order', 'finished_at', 'DATETIME DEFAULT NULL AFTER finish_images')
  // 接单方取消接单申请：30分钟内自身原因可直接取消，其余情况需发单人同意
  await pool.query(`
    CREATE TABLE IF NOT EXISTS errand_cancel_request (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL,
      requester_id INT UNSIGNED NOT NULL,
      reason_side ENUM('self','publisher') NOT NULL DEFAULT 'self',
      reason VARCHAR(255) NOT NULL DEFAULT '',
      images JSON,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      handled_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cancel_request_order (order_id, status),
      INDEX idx_cancel_request_requester (requester_id, created_at)
    ) ENGINE=InnoDB
  `)
  // 订单流水记录（订单信息-查看记录）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS errand_order_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL,
      actor_id INT UNSIGNED DEFAULT NULL,
      action VARCHAR(32) NOT NULL,
      detail VARCHAR(255) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_errand_log_order (order_id, created_at)
    ) ENGINE=InnoDB
  `)
  // 接单方完成率统计：自身原因取消接单会降低完成率，过低冻结接单功能
  await pool.query(`
    CREATE TABLE IF NOT EXISTS errand_stat (
      user_id INT UNSIGNED PRIMARY KEY,
      finished_count INT NOT NULL DEFAULT 0,
      self_cancel_count INT NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  // 跑腿订单专属聊天（与私信完全独立）：消息按订单维度存储，仅发单人与接单人可读写
  await pool.query(`
    CREATE TABLE IF NOT EXISTS errand_message (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED NOT NULL,
      content TEXT NOT NULL,
      msg_type VARCHAR(16) DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_errand_message_order (order_id, id)
    ) ENGINE=InnoDB
  `)
  // 聊天已读位置：每个用户在每个订单聊天中读到的最大消息 id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS errand_chat_read (
      order_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (order_id, user_id)
    ) ENGINE=InnoDB
  `)
  // 找驾校内容表：前台「找驾校」页与管理后台「找驾校内容管理」共用，
  // 校区仅广州校区/佛山校区两个分类，status=1 启用才对外展示
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driving_school (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      campus VARCHAR(32) NOT NULL DEFAULT '广州校区',
      region VARCHAR(32) NOT NULL DEFAULT '',
      address VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(32) NOT NULL DEFAULT '',
      car_types VARCHAR(64) NOT NULL DEFAULT '',
      price VARCHAR(64) NOT NULL DEFAULT '',
      intro VARCHAR(255) NOT NULL DEFAULT '',
      pass_rate INT NOT NULL DEFAULT 0,
      level VARCHAR(8) NOT NULL DEFAULT 'A',
      tags JSON DEFAULT NULL,
      distance_km DECIMAL(6,1) NOT NULL DEFAULT 0,
      cover VARCHAR(512) NOT NULL DEFAULT '',
      images JSON DEFAULT NULL,
      detail TEXT,
      status TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_driving_school_status_sort (status, sort_order, id),
      KEY idx_driving_school_campus (campus, status, sort_order)
    ) ENGINE=InnoDB
  `)
  // 驾校坐标：由管理后台「在地图上选点」人工确认（高德地理编码对机构名只到区县级，不可靠）。
  // 默认 0 = 未选点，此时用户端不显示「在地图查看」入口
  await ensureColumn('driving_school', 'lat', "DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER cover")
  await ensureColumn('driving_school', 'lng', "DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER lat")
  // 每所驾校自己的咨询微信：详情页「立即咨询」弹这张码，没配则回落到全站管理员微信
  await ensureColumn('driving_school', 'contact_qr', "VARCHAR(512) NOT NULL DEFAULT '' AFTER lng")
  await ensureColumn('driving_school', 'contact_name', "VARCHAR(32) NOT NULL DEFAULT '' AFTER contact_qr")
  // 修复历史脏数据：分身私信（发起方匿名）曾把接收方（普通用户）的会话行误标为 is_anonymous=1，
  // 导致普通用户打开聊天被强制进入匿名模式、显示为匿名用户。
  // 仅修正如下行（安全条件全部满足才改）：
  //   1) 本行被标为匿名，但自己没有分身档案（anon_self_identity 为空 → 非匿名发起方）
  //   2) 对方行持有分身档案，且与本行 anon_peer_identity 完全一致（同一分身 → 典型"分身私信"存档特征）
  //   3) 本行用户在该会话从未发送过匿名消息（从未主动参与匿名，避免影响主动确认匿名的用户）
  // 匿名帖回复场景（双方均应匿名）中回复方必然发过匿名消息，不会被此修复误伤。
  await pool.query(`
    UPDATE private_conversation me
    JOIN private_conversation other
      ON other.user_id = me.peer_id AND other.peer_id = me.user_id
    LEFT JOIN (
      SELECT sender_id, receiver_id, COUNT(*) AS cnt
      FROM private_message
      WHERE is_anonymous = 1 AND status != 'recalled'
      GROUP BY sender_id, receiver_id
    ) pm ON pm.sender_id = me.user_id AND pm.receiver_id = me.peer_id
    SET me.is_anonymous = 0
    WHERE me.is_anonymous = 1
      AND me.anon_self_identity IS NULL
      AND me.anon_peer_identity IS NOT NULL
      AND other.anon_self_identity IS NOT NULL
      AND me.anon_peer_identity = other.anon_self_identity
      AND pm.cnt IS NULL
  `)
  // 广轻义修预约费统一为 0.01：未支付订单里残留的 0.99（旧默认价）批量对齐
  // repairController.DEFAULT_PRICE，保证订单展示与微信实际收款一致；
  // 已支付订单不动 —— 成交金额必须与 payment_transaction 对账，不能事后改账。
  await pool.query("UPDATE repair_order SET amount = 0.01 WHERE amount = 0.99 AND status = 'unpaid'")
  // 截止接单时间：发布时可设置（今天~大后天某时某分），到期仍无人接单则自动取消并原路退款
  await ensureColumn('errand_order', 'accept_deadline', 'DATETIME DEFAULT NULL AFTER appointment_time')
  // 教务考试安排缓存：每次同步整体覆盖（先删后插）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_exam (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      name VARCHAR(128) DEFAULT '',
      type VARCHAR(32) DEFAULT '',
      date VARCHAR(32) DEFAULT '',
      time VARCHAR(64) DEFAULT '',
      location VARCHAR(128) DEFAULT '',
      seat VARCHAR(32) DEFAULT '',
      semester VARCHAR(32) DEFAULT '',
      raw JSON,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_exam (user_id, id)
    ) ENGINE=InnoDB
  `)
  // 教务成绩缓存：每次同步整体覆盖（先删后插）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_grade (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      semester VARCHAR(32) DEFAULT '',
      name VARCHAR(128) DEFAULT '',
      attribute VARCHAR(32) DEFAULT '',
      credit VARCHAR(16) DEFAULT '',
      gpa VARCHAR(16) DEFAULT '',
      score VARCHAR(16) DEFAULT '',
      raw JSON,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_grade (user_id, id)
    ) ENGINE=InnoDB
  `)
  // 教务账号绑定凭证（AES-256-GCM 加密存储）：用于进入同步中心时免密自动刷新课表/考试/成绩
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jw_credential (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      username VARCHAR(32) NOT NULL DEFAULT '',
      password_enc TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  // 教务验证码挑战（跨实例共享）：pm2 cluster 多实例下挑战不能放单实例内存，
  // 否则创建挑战与提交验证码落到不同实例会报 410 验证码已过期
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jw_captcha_challenge (
      id VARCHAR(64) PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      username VARCHAR(32) NOT NULL DEFAULT '',
      password_enc TEXT,
      schedule_start_date VARCHAR(16) DEFAULT '',
      mode VARCHAR(16) DEFAULT 'direct',
      factor VARCHAR(255) DEFAULT '',
      captcha_data MEDIUMTEXT,
      cookie_jar MEDIUMTEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_captcha_expiry (expires_at)
    ) ENGINE=InnoDB
  `)
  // ===== 社团&组织 =====
  // 分类：color 存主色 hex，前端由主色推导渐变/浅底/深色/阴影主题
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_category (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(32) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      icon_char VARCHAR(8) DEFAULT '',
      slogan VARCHAR(128) DEFAULT '',
      color VARCHAR(16) DEFAULT '#2E6BFF',
      position TEXT,
      scope_intro VARCHAR(512) DEFAULT '',
      scope JSON,
      features JSON,
      contact VARCHAR(255) DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      status TINYINT(1) NOT NULL DEFAULT 1,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category_id INT UNSIGNED NOT NULL,
      name VARCHAR(64) NOT NULL,
      tags VARCHAR(128) DEFAULT '',
      intro VARCHAR(1000) DEFAULT '',
      recruit VARCHAR(255) DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      status TINYINT(1) NOT NULL DEFAULT 1,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_club_category (category_id, status, sort_order)
    ) ENGINE=InnoDB
  `)
  // 社团校区维度：'' = 全部校区（所有校区可见）
  await ensureColumn('club', 'campus', "VARCHAR(16) DEFAULT '' AFTER recruit")
  // 社团申请：用户端「申请创建社团」提交，管理员审核通过后才落到 club 表并出现在用户端分类中
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_apply (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      club_type VARCHAR(16) NOT NULL DEFAULT '学生社团',
      category_id INT UNSIGNED DEFAULT NULL,
      category_name VARCHAR(64) NOT NULL DEFAULT '',
      campus VARCHAR(16) DEFAULT '',
      name VARCHAR(64) NOT NULL,
      intro VARCHAR(1000) DEFAULT '',
      avatar_url VARCHAR(512) DEFAULT '',
      qrcode_url VARCHAR(512) DEFAULT '',
      admin_qrcode_url VARCHAR(512) DEFAULT '',
      gzh_qrcode_url VARCHAR(512) DEFAULT '',
      images JSON,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      review_note VARCHAR(255) DEFAULT '',
      reviewed_by INT UNSIGNED DEFAULT NULL,
      reviewed_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_club_apply_user (user_id, created_at),
      INDEX idx_club_apply_status (status, created_at)
    ) ENGINE=InnoDB
  `)
  // 审核通过后生成的社团记录回指申请单：重复通过时刷新已有社团，而不是重复上架
  await ensureColumn('club', 'apply_id', 'BIGINT UNSIGNED DEFAULT NULL AFTER category_id')
  // ===== 广轻群聊 =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_chat_apply (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      group_type VARCHAR(16) NOT NULL DEFAULT '微信群',
      category VARCHAR(32) NOT NULL DEFAULT '',
      name VARCHAR(64) NOT NULL,
      intro VARCHAR(1000) DEFAULT '',
      avatar_url VARCHAR(512) DEFAULT '',
      qrcode_url VARCHAR(512) DEFAULT '',
      admin_qrcode_url VARCHAR(512) DEFAULT '',
      gzh_qrcode_url VARCHAR(512) DEFAULT '',
      images JSON,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      review_note VARCHAR(255) DEFAULT '',
      reviewed_by INT UNSIGNED DEFAULT NULL,
      reviewed_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_gca_user (user_id, created_at),
      INDEX idx_gca_status (status, created_at)
    ) ENGINE=InnoDB
  `)
  // 建群申请校区：用户提交时选择，审核通过后随群聊落库
  await ensureColumn('group_chat_apply', 'campus', "VARCHAR(16) DEFAULT '' AFTER category")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_chat (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      apply_id BIGINT UNSIGNED DEFAULT NULL,
      name VARCHAR(64) NOT NULL,
      category VARCHAR(32) NOT NULL DEFAULT '',
      intro VARCHAR(1000) DEFAULT '',
      notice VARCHAR(500) DEFAULT '',
      owner_name VARCHAR(32) DEFAULT '',
      member_count INT NOT NULL DEFAULT 0,
      join_mode VARCHAR(16) NOT NULL DEFAULT 'qrcode',
      need_audit TINYINT(1) NOT NULL DEFAULT 0,
      avatar_url VARCHAR(512) DEFAULT '',
      qrcode_url VARCHAR(512) DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      status TINYINT(1) NOT NULL DEFAULT 1,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_group_chat_feed (status, deleted, sort_order)
    ) ENGINE=InnoDB
  `)
  // 官方群标记：分类群列表名称右侧展示黑色「官方」徽标
  await ensureColumn('group_chat', 'is_official', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER qrcode_url')
  // 公众号二维码：审核通过时从申请单同步，后台与用户端群详情可展示
  await ensureColumn('group_chat', 'gzh_qrcode_url', "VARCHAR(512) DEFAULT '' AFTER is_official")
  // 自定义群标签：管理员手动填写（如「合作」），与官方徽标并列展示
  await ensureColumn('group_chat', 'custom_tag', "VARCHAR(16) DEFAULT '' AFTER is_official")
  // 校区维度：'' = 全部校区（所有校区可见），否则按所选校区筛选
  await ensureColumn('group_chat', 'campus', "VARCHAR(16) DEFAULT '' AFTER custom_tag")
  // 群聊图片介绍：审核通过时从申请单同步，后台可维护
  await ensureColumn('group_chat', 'images', 'JSON DEFAULT NULL AFTER intro')
  // ===== 管理后台「群聊编辑」补齐的字段（群公告 / 成员与进群权限） =====
  // 群公告：用户端群详情顶部醒目展示（与「群介绍」区分：介绍用于列表，公告用于进群须知）
  await ensureColumn('group_chat', 'notice', "VARCHAR(500) DEFAULT '' AFTER intro")
  // 群主 / 负责人昵称：用户端群详情展示，便于成员知道找谁
  await ensureColumn('group_chat', 'owner_name', "VARCHAR(32) DEFAULT '' AFTER notice")
  // 群成员规模：管理员手工维护的展示值（微信群成员在微信内管理，此处仅用于展示）
  await ensureColumn('group_chat', 'member_count', 'INT NOT NULL DEFAULT 0 AFTER owner_name')
  // 进群方式：qrcode=扫码进群 / admin=加管理员拉群 / invite=仅成员邀请
  await ensureColumn('group_chat', 'join_mode', "VARCHAR(16) NOT NULL DEFAULT 'qrcode' AFTER member_count")
  // 进群是否需管理员审核：用户端「加入方式」处给出提示
  await ensureColumn('group_chat', 'need_audit', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER join_mode')
  // ===== 自愈修复：审核通过但未上架群聊的存量申请统一补建 =====
  // 历史版本审核仅回写申请状态、未生成群聊记录（或生成失败）时，
  // 用户端「已通过却看不到群聊」。启动时按申请单补建上架，保证「通过 = 可见」。
  // 注意：JOIN 不带 deleted = 0 —— 管理员主动删除过的群聊（deleted = 1）也算「已生成」，
  // 否则每次启动都会把管理员删掉的群聊重新挂回用户端。
  {
    const [missingGroups] = await pool.query(
      `SELECT a.id, a.category, a.campus, a.name, a.intro, a.avatar_url, a.qrcode_url, a.gzh_qrcode_url, a.images
       FROM group_chat_apply a
       LEFT JOIN group_chat g ON g.apply_id = a.id
       WHERE a.status = 'approved' AND g.id IS NULL`
    )
    for (const apply of missingGroups) {
      try {
        await pool.query(
          `INSERT INTO group_chat (apply_id, name, category, campus, intro, avatar_url, qrcode_url, gzh_qrcode_url, images, sort_order, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
          [apply.id, apply.name || '', apply.category || '', apply.campus || '', apply.intro || '',
          apply.avatar_url || '', apply.qrcode_url || '', apply.gzh_qrcode_url || '', toJsonColumn(apply.images)]
        )
        console.log(`[migrations] 已补建审核通过申请 ${apply.id} 的群聊记录：${apply.name}`)
      } catch (e) {
        console.error(`[migrations] 补建申请 ${apply.id} 群聊记录失败：`, e.message)
      }
    }
  }
  // ===== 群聊类别（后台「群聊类别编辑」维护，客户端优先读服务端） =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_category (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      description VARCHAR(128) DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      status TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_group_category_name (name)
    ) ENGINE=InnoDB
  `)
  // 仅空表时写入默认八类（与用户端 CATEGORY_META 一致，描述即宫格卡片副标题）
  const [[gcCatCount]] = await pool.query('SELECT COUNT(*) total FROM group_category')
  if (!Number(gcCatCount.total)) {
    const defaultCategories = [
      ['学院群', '各学院群聊'],
      ['线下桌游群', '狼人杀、三国杀等'],
      ['体育运动群', '羽毛球、乒乓球等运动群'],
      ['老乡群', '跨越山海，共叙乡情'],
      ['学习竞赛', '学科学习和竞赛交流群'],
      ['互助群', '二手书、物品交易群'],
      ['游戏群', '组队开黑，快乐翻倍'],
      ['新生群', '各届广轻工学生新生群']
    ]
    for (let i = 0; i < defaultCategories.length; i++) {
      await pool.query(
        'INSERT IGNORE INTO group_category (name, description, sort_order, status) VALUES (?, ?, ?, 1)',
        [defaultCategories[i][0], defaultCategories[i][1], i]
      )
    }
  }
  // ===== 校园活动 =====
  // 活动校区：发起时选择，'' = 全部校区（所有校区可见）
  await ensureColumn('campus_activity', 'campus', "VARCHAR(16) DEFAULT '' AFTER address")
  // 活动审核：普通用户发布需管理员审核通过后才公开；存量活动默认视为已通过
  await ensureColumn('campus_activity', 'audit_status', "VARCHAR(16) NOT NULL DEFAULT 'approved' AFTER status")
  await ensureColumn('campus_activity', 'audit_note', "VARCHAR(255) DEFAULT '' AFTER audit_status")
  await ensureColumn('campus_activity', 'audit_time', 'DATETIME DEFAULT NULL AFTER audit_note')
  // 报名图片（多张 JSON，最多 5 张）；旧单张 signup_image 保留兼容
  await ensureColumn('campus_activity', 'signup_images', 'JSON DEFAULT NULL AFTER signup_image')
  // 活动开始前提醒的幂等标记：同一活动只发一轮提醒，多实例/重启均不会重复推送
  await ensureColumn('campus_activity', 'remind_sent_at', 'DATETIME DEFAULT NULL AFTER audit_time')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campus_activity (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      title VARCHAR(64) NOT NULL,
      signup_start DATETIME DEFAULT NULL,
      signup_end DATETIME DEFAULT NULL,
      activity_start DATETIME DEFAULT NULL,
      activity_end DATETIME DEFAULT NULL,
      location VARCHAR(64) DEFAULT '',
      address VARCHAR(255) DEFAULT '',
      cover_url VARCHAR(512) DEFAULT '',
      images JSON,
      detail_title VARCHAR(64) DEFAULT '',
      detail_content TEXT,
      signup_title VARCHAR(16) DEFAULT '立即报名',
      signup_content VARCHAR(255) DEFAULT '',
      signup_image VARCHAR(512) DEFAULT '',
      capacity INT NOT NULL DEFAULT 0,
      status TINYINT(1) NOT NULL DEFAULT 1,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_activity_feed (status, deleted, created_at)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_signup (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      activity_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_activity_signup (activity_id, user_id),
      INDEX idx_activity_signup_user (user_id, created_at)
    ) ENGINE=InnoDB
  `)
  // ===== 跑腿订单多状态流转：待确认（finishing） / 有异议（disputed） =====
  // finishing：接单方已提交完成、等待发单人确认；disputed：发单人提出异议、等待管理员裁决。
  // status 是 ENUM，新增取值必须显式 MODIFY，否则写入会被截断成空串。
  const [errandStatusCol] = await pool.query("SHOW COLUMNS FROM errand_order LIKE 'status'")
  if (errandStatusCol.length && !String(errandStatusCol[0].Type || '').includes('finishing')) {
    await pool.query("ALTER TABLE errand_order MODIFY COLUMN status ENUM('pending','accepted','finishing','finished','cancelled','disputed') DEFAULT 'pending'")
  }
  // 接单方提交完成的时间：既是发单人确认倒计时的起点，也是「超2小时自动确认完成」的判定依据
  await ensureColumn('errand_order', 'finish_submitted_at', 'DATETIME DEFAULT NULL AFTER finish_images')
  // 发单人确认完成时间（自动确认时同样写入，auto_confirmed=1 用于区分人工确认与系统自动确认）
  await ensureColumn('errand_order', 'confirmed_at', 'DATETIME DEFAULT NULL AFTER finished_at')
  await ensureColumn('errand_order', 'auto_confirmed', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER confirmed_at')
  // 异议：发单人填写的内容 + 提出时间 + 管理员裁决结果（refunded=订单取消退款 / completed=订单成立结算）
  await ensureColumn('errand_order', 'dispute_reason', "VARCHAR(500) DEFAULT '' AFTER auto_confirmed")
  await ensureColumn('errand_order', 'disputed_at', 'DATETIME DEFAULT NULL AFTER dispute_reason')
  await ensureColumn('errand_order', 'dispute_result', "VARCHAR(16) DEFAULT '' AFTER disputed_at")
  await ensureColumn('errand_order', 'dispute_note', "VARCHAR(255) DEFAULT '' AFTER dispute_result")
  await ensureColumn('errand_order', 'dispute_handled_at', 'DATETIME DEFAULT NULL AFTER dispute_note')
  // 六大社团分类 + 30 个代表社团（仅空表时写入，之后由后台维护）
  await require('./clubSeed').seedClubData()
  // ===== 订阅消息额度账户 =====
  // 小程序一次性订阅：用户每点一次「允许」得 1 条可发额度，发一条扣 1。
  // 额度与模板类型绑定（activity / errand / interact），三类互不占用。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_subscribe_quota (
      user_id INT UNSIGNED NOT NULL,
      tpl_type VARCHAR(24) NOT NULL,
      remain INT NOT NULL DEFAULT 0,
      total_granted INT NOT NULL DEFAULT 0,
      total_sent INT NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tpl_type)
    ) ENGINE=InnoDB
  `)
  // 订阅消息发送流水：用于频控（同类合并）、排障与对账。
  // errcode 记录微信返回码，43101 = 用户拒收（此时清空额度）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribe_message_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      tpl_type VARCHAR(24) NOT NULL,
      template_id VARCHAR(64) DEFAULT '',
      page VARCHAR(128) DEFAULT '',
      summary VARCHAR(255) DEFAULT '',
      status ENUM('sent','merged','skipped','failed') NOT NULL DEFAULT 'sent',
      errcode INT DEFAULT NULL,
      errmsg VARCHAR(255) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sub_log_user_time (user_id, tpl_type, created_at),
      INDEX idx_sub_log_status_time (status, created_at)
    ) ENGINE=InnoDB
  `)
  // 弹窗触发节流：客户端在 tap 的**同步调用链**内判定「该触发组今天已弹满 3 次」，
  // 服务端完全无从感知，只能由客户端上报后落一行 status='throttled'。
  // 枚举必须同步扩展，否则写入被截断成 ''（ER_DATA_TRUNCATED）。
  const [subLogStatusCol] = await pool.query("SHOW COLUMNS FROM subscribe_message_log LIKE 'status'")
  if (subLogStatusCol.length && !String(subLogStatusCol[0].Type || '').includes('throttled')) {
    await pool.query("ALTER TABLE subscribe_message_log MODIFY COLUMN status ENUM('sent','merged','skipped','failed','throttled') NOT NULL DEFAULT 'sent'")
  }
  // 订阅消息待发表：命中「合并窗口」或「额度不足」时不再把内容丢掉，改写进这里，之后再补发。
  //
  // 语义是「每个 (user_id, tpl_type) 一个槽位」：同一用户同一模板只保留**最近一条**待发内容，
  // 发出去（或过期丢弃）后槽位置空，下次有新消息再复用同一行。
  // 这样窗口内来 10 条评论只会补发 1 条（内容取最新），既不会刷屏也不会丢光。
  //
  // notice_sent_at：额度不足时给用户发过站内信提示的时间，用于 24 小时节流，避免反复打扰。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribe_pending_message (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      tpl_type VARCHAR(24) NOT NULL,
      data_json TEXT NOT NULL,
      page VARCHAR(128) DEFAULT '',
      summary VARCHAR(255) DEFAULT '',
      reason ENUM('merged','no_quota') NOT NULL DEFAULT 'merged',
      status ENUM('pending','sent','dropped') NOT NULL DEFAULT 'pending',
      retry_count INT UNSIGNED NOT NULL DEFAULT 0,
      notice_sent_at DATETIME DEFAULT NULL,
      next_retry_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_pending_user_tpl (user_id, tpl_type),
      INDEX idx_pending_due (status, next_retry_at)
    ) ENGINE=InnoDB
  `)
  // 修复历史脏数据：空头像/默认昵称 + 重命名前的旧头像路径
  // ===== 校园评价模块 =====
  // 评分对象：课程（不区分校区，按学历层次/年级分类）、食堂与商圈的门店（按校区区分）
  // 及其子对象（食堂窗口 / 商圈店铺，挂在 parent_id 下并带楼层）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_target (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(16) NOT NULL COMMENT 'course/canteen/business',
      parent_id INT UNSIGNED DEFAULT NULL COMMENT '食堂/商圈子对象所属父对象',
      name VARCHAR(64) NOT NULL,
      avatar VARCHAR(512) DEFAULT '' COMMENT '头像（可空，端上按首字渲染色块）',
      campus VARCHAR(32) DEFAULT '' COMMENT '广州校区/南海南/南海北（课程为空）',
      floor VARCHAR(16) DEFAULT '' COMMENT '1层/2层/3层（根级与课程为空）',
      grade VARCHAR(32) DEFAULT '' COMMENT '课程分类：通识课/大一/.../本科二年级',
      levels VARCHAR(64) DEFAULT '' COMMENT '适用学历层次，逗号分隔：专科,本科,专升本',
      hot_comment VARCHAR(255) DEFAULT '' COMMENT '热门评价摘录',
      rating_sum INT DEFAULT 0,
      rating_count INT DEFAULT 0,
      comment_count INT DEFAULT 0,
      like_count INT DEFAULT 0,
      created_by INT UNSIGNED DEFAULT NULL,
      status TINYINT(1) DEFAULT 1,
      deleted TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_review_category (category, deleted, status),
      KEY idx_review_parent (parent_id),
      KEY idx_review_campus (campus),
      KEY idx_review_grade (grade)
    ) ENGINE=InnoDB
  `)
  // 我的评分：一人一对象一分，可重复评分（覆盖旧值）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_rating (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      target_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      score TINYINT NOT NULL COMMENT '1-5',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_review_rating (target_id, user_id),
      KEY idx_review_rating_user (user_id)
    ) ENGINE=InnoDB
  `)
  // 评价（评论）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_comment (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      target_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      content VARCHAR(1000) NOT NULL,
      like_count INT DEFAULT 0,
      status TINYINT(1) DEFAULT 1,
      deleted TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_review_comment_target (target_id, deleted, status, created_at)
    ) ENGINE=InnoDB
  `)
  // 对象点赞 / 评价点赞：明细表 + 计数器双写，删明细后必须重算计数器
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_target_like (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      target_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_review_target_like (target_id, user_id)
    ) ENGINE=InnoDB
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_comment_like (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      comment_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_review_comment_like (comment_id, user_id)
    ) ENGINE=InnoDB
  `)

  // ===== 媒体内容安全异步检测（P02/P14）=====
  // 记录提交给 wxa/media_check_async 的任务与微信回调结果；违规媒体由回调直接下线。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_check_task (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL DEFAULT 0,
      trace_id VARCHAR(64) NOT NULL,
      media_type ENUM('image','audio') NOT NULL DEFAULT 'image',
      object_key VARCHAR(512) DEFAULT '',
      media_url VARCHAR(1024) DEFAULT '',
      scene TINYINT NOT NULL DEFAULT 3,
      status ENUM('pending','pass','review','risky','failed','removed') NOT NULL DEFAULT 'pending',
      label INT DEFAULT NULL,
      errcode INT DEFAULT NULL,
      level_info VARCHAR(255) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_media_check_trace (trace_id),
      INDEX idx_media_check_status (status, created_at)
    ) ENGINE=InnoDB
  `)
  // ===== 帖子投票明细表（P19）=====
  // 投票明细此前只写在 forum_post.components 的 JSON 里，既没有数据库级唯一约束，
  // 也没有对账依据。这里补一张明细表：投票事务内先插一行（唯一键挡重复投票），
  // JSON 仍作为展示口径，历史投票数据不迁移（读路径不变，零回归风险）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forum_poll_vote (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      post_id INT UNSIGNED NOT NULL,
      poll_index TINYINT UNSIGNED NOT NULL DEFAULT 0,
      option_indexes VARCHAR(64) NOT NULL DEFAULT '',
      user_id INT UNSIGNED NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_poll_vote (post_id, poll_index, user_id),
      INDEX idx_poll_vote_user (user_id, created_at)
    ) ENGINE=InnoDB
  `)
  await repairAnonymousAvatarPaths()
  await repairUserAvatars()
}

// 匿名形象（/assets/avatar1/）旧文件名修复。
//
// 背景：素材池里「考拉 (2).jpg」「老虎 (2).jpg」这类含空格与半角括号的文件名在真机上
// 解析失败，文件已重命名为「考拉2.jpg」「老虎2.jpg」，但**库里仍有旧路径存量** ——
// 帖子/评论的 anonymous_identity、通知的 actor_avatar 快照、私信会话的分身档案
// 都会把它们渲染到 <image>，表现是头像空白 + 渲染层不停地刷
// 「Failed to load image /assets/avatar1/XX%20(2).jpg」。
// 读取出口已做纠正（parseAnonymousIdentity 走 normalizeLegacyAvatarUrl），
// 这里再做一次数据层清理，避免旧值随新写入继续扩散（如快照复制、转发引用）。
async function repairAnonymousAvatarPaths() {
  const jsonTargets = [
    ['forum_post', 'anonymous_identity'],
    ['forum_comment', 'anonymous_identity'],
    ['private_conversation', 'anon_peer_identity'],
    ['private_conversation', 'anon_self_identity'],
  ]
  try {
    for (const [table, column] of jsonTargets) {
      const [rows] = await pool.query(
        `SELECT id, ${column} AS payload FROM ${table}
         WHERE ${column} IS NOT NULL
           AND JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.avatarUrl')) LIKE '%(%'`
      ).catch(() => [[]])
      let fixed = 0
      for (const row of rows) {
        let value = null
        try {
          value = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
        } catch (e) {
          continue
        }
        if (!value || !value.avatarUrl) continue
        const next = repairAnonymousAvatarValue(value.avatarUrl, value.nickName)
        if (next === value.avatarUrl) continue
        value.avatarUrl = next
        // JSON 列必须经 toJsonColumn 序列化，否则数组/对象会被 mysql2 展开成多个值
        await pool.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [toJsonColumn(value), row.id])
        fixed += 1
      }
      if (fixed) console.log(`[migrations] 已修正 ${table}.${column} 中 ${fixed} 条匿名形象路径`)
    }

    // 纯文本列：通知快照头像、会话分身隔离键（值就是分身头像路径）
    const textTargets = [
      ['system_notification', 'actor_avatar'],
      ['private_conversation', 'persona_key'],
    ]
    for (const [table, column] of textTargets) {
      const [rows] = await pool.query(
        `SELECT id, ${column} AS value FROM ${table} WHERE ${column} LIKE '/assets/avatar1/%(%'`
      ).catch(() => [[]])
      let fixed = 0
      for (const row of rows) {
        const next = repairAnonymousAvatarValue(row.value, '')
        if (next === row.value) continue
        await pool.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [next, row.id])
        fixed += 1
      }
      if (fixed) console.log(`[migrations] 已修正 ${table}.${column} 中 ${fixed} 条匿名形象路径`)
    }
  } catch (e) {
    console.error('[migrations] 修复匿名形象路径失败：', e.message)
  }
}

// 单个匿名形象路径纠正：能按改名规则修好就修；改不好的（历史脏数据、凭空写进来的路径）
// 稳定映射到素材池内形象 —— 既不渲染不存在的图片，也保留匿名语义（绝不回落真实头像）
function repairAnonymousAvatarValue(raw, nickName) {
  const url = String(raw || '').trim()
  if (!url) return url
  const fixed = normalizeAnonymousAvatarUrl(url)
  if (isAnonymousAvatarUrl(fixed)) return fixed
  if (fixed.indexOf('/assets/avatar1/') === 0) return pickAnonymousAvatar(nickName || fixed)
  return url
}

// 历史数据修复：
// 1) avatar_url 为空的用户补发一个包内默认头像
// 2) nick_name 为 '校园用户'（历史默认值）的用户补发随机昵称
// 3) /assets/avatar2/1%20(9).jpg 这类旧路径（空格已编码、括号未编码，真机渲染失败）
//    映射到重命名后的 /assets/avatar2/avatar_09.jpg
async function repairUserAvatars() {
  try {
    // 1) 旧路径映射：文件名形如 "1 (N).jpg" → "avatar_0N.jpg"
    const [legacyRows] = await pool.query(
      "SELECT id, avatar_url FROM sys_user WHERE avatar_url LIKE '/assets/avatar2/1%20(%' OR avatar_url LIKE '/assets/avatar2/1 (%'"
    )
    for (const row of legacyRows) {
      const fixed = normalizeLegacyAvatarUrl(row.avatar_url)
      if (fixed === row.avatar_url) continue
      await pool.query('UPDATE sys_user SET avatar_url = ? WHERE id = ?', [fixed, row.id])
    }
    if (legacyRows.length) console.log(`[migrations] 已修正 ${legacyRows.length} 个旧头像路径`)

    // 2) 空头像补发
    const [emptyAvatarRows] = await pool.query(
      "SELECT id FROM sys_user WHERE avatar_url IS NULL OR avatar_url = ''"
    )
    for (const row of emptyAvatarRows) {
      await pool.query('UPDATE sys_user SET avatar_url = ? WHERE id = ?', [getRandomAvatar(), row.id])
    }
    if (emptyAvatarRows.length) console.log(`[migrations] 已为 ${emptyAvatarRows.length} 个用户补发默认头像`)

    // 3) 默认昵称补发
    const placeholders = DEFAULT_NAME_VALUES.map(() => '?').join(', ')
    const [defaultNickRows] = await pool.query(
      `SELECT id FROM sys_user WHERE nick_name IS NULL OR nick_name = '' OR nick_name IN (${placeholders})`,
      DEFAULT_NAME_VALUES,
    )
    for (const row of defaultNickRows) {
      await pool.query('UPDATE sys_user SET nick_name = ? WHERE id = ?', [getRandomName(), row.id])
    }
    if (defaultNickRows.length) console.log(`[migrations] 已为 ${defaultNickRows.length} 个用户补发默认昵称`)

    // 4) 通知表里的历史头像快照（sendToUser 时写入的 actor_avatar）同样需要修正，
    //    否则用户点开消息通知列表仍会看到空白头像
    const [notifRows] = await pool.query(
      "SELECT id, actor_avatar FROM system_notification WHERE actor_avatar LIKE '/assets/avatar2/1%20(%' OR actor_avatar LIKE '/assets/avatar2/1 (%'"
    )
    for (const row of notifRows) {
      const fixed = normalizeLegacyAvatarUrl(row.actor_avatar)
      if (fixed === row.actor_avatar) continue
      await pool.query('UPDATE system_notification SET actor_avatar = ? WHERE id = ?', [fixed, row.id])
    }
    if (notifRows.length) console.log(`[migrations] 已修正 ${notifRows.length} 条通知的头像路径`)
  } catch (e) {
    console.error('[migrations] 修复用户头像昵称失败：', e.message)
  }
}

module.exports = {
  runMigrations
}
