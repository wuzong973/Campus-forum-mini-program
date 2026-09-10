const pool = require('../config/pool')

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
  await ensureColumn('forum_post', 'title', "VARCHAR(128) DEFAULT '' AFTER user_id")
  await ensureColumn('forum_post', 'contact', 'JSON DEFAULT NULL AFTER images')
  await ensureColumn('forum_post', 'anonymous_identity', 'JSON DEFAULT NULL AFTER contact')
  await ensureColumn('forum_post', 'components', 'JSON DEFAULT NULL AFTER anonymous_identity')
  await ensureColumn('forum_post', 'pinned', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER status')
  await ensureColumn('forum_post', 'review_note', "VARCHAR(255) DEFAULT '' AFTER pinned")
  await ensureColumn('forum_post', 'share_count', 'INT DEFAULT 0 AFTER favorite_count')
  await ensureColumn('forum_post', 'view_count', 'INT DEFAULT 0 AFTER share_count')
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
      type ENUM('comment','like','system','errand','repair') NOT NULL,
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
  await pool.query('ALTER TABLE private_conversation DROP INDEX uk_user_peer, ADD UNIQUE KEY uk_user_peer_persona (user_id, peer_id, persona_key)').catch(() => {})
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
  await ensureUniqueIndex('errand_order', 'uk_errand_order_no', '(order_no)')
  await ensureIndex('repair_order', 'idx_repair_user_created', '(user_id, created_at)')
  await ensureIndex('repair_order', 'idx_repair_technician_created', '(technician_user_id, created_at)')
  // 课程表配置表：早期部署只写在 init.sql 里，线上旧库缺表会让 /schedule/config 一直 500
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_config (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      start_date DATE DEFAULT '2026-03-02',
      hide_weekend TINYINT(1) DEFAULT 0,
      reminder TINYINT(1) DEFAULT 0,
      bg_color VARCHAR(16) DEFAULT '#F5F7FA',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  await ensureColumn('schedule_config', 'bg_color', "VARCHAR(16) DEFAULT '#F5F7FA'")
  await ensureColumn('schedule_config', 'start_date', "DATE DEFAULT '2026-03-02'")
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
  // ===== 校园活动 =====
  // 活动校区：发起时选择，'' = 全部校区（所有校区可见）
  await ensureColumn('campus_activity', 'campus', "VARCHAR(16) DEFAULT '' AFTER address")
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
  // 六大社团分类 + 30 个代表社团（仅空表时写入，之后由后台维护）
  await require('./clubSeed').seedClubData()
}

module.exports = {
  runMigrations
}
