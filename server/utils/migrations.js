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
  await ensureColumn('forum_post', 'title', "VARCHAR(128) DEFAULT '' AFTER user_id")
  await ensureColumn('forum_post', 'contact', 'JSON DEFAULT NULL AFTER images')
  await ensureColumn('forum_post', 'pinned', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER status')
  await ensureColumn('forum_post', 'review_note', "VARCHAR(255) DEFAULT '' AFTER pinned")
  await ensureColumn('forum_post', 'share_count', 'INT DEFAULT 0 AFTER favorite_count')
  await ensureColumn('forum_post', 'view_count', 'INT DEFAULT 0 AFTER share_count')
  await ensureColumn('forum_comment', 'images', 'JSON AFTER content')
  await ensureColumn('user_schedule', 'week_type', "VARCHAR(8) DEFAULT 'all' AFTER end_week")
  await ensureColumn('user_schedule', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at')
  await ensureColumn('errand_order', 'gender_requirement', "VARCHAR(16) NOT NULL DEFAULT '不限性别' AFTER campus")
  await ensureColumn('errand_order', 'pickup_time_type', "VARCHAR(16) DEFAULT '尽快' AFTER gender_requirement")
  await ensureColumn('errand_order', 'appointment_time', 'DATETIME DEFAULT NULL AFTER pickup_time_type')
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
  await pool.query(`
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
      last_message_id INT UNSIGNED DEFAULT NULL,
      unread_count INT DEFAULT 0,
      last_message_text VARCHAR(512) DEFAULT '',
      last_message_time DATETIME DEFAULT NULL,
      status TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_peer (user_id, peer_id),
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
      content TEXT NOT NULL,
      msg_type VARCHAR(16) DEFAULT 'text',
      status ENUM('sending','sent','delivered','read','failed') DEFAULT 'sent',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_conversation (conversation_id),
      INDEX idx_receiver (receiver_id, status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB
  `)
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
}

module.exports = {
  runMigrations
}
