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

async function runMigrations() {
  await ensureColumn('sys_user', 'gender', "TINYINT DEFAULT 1 AFTER avatar_url")
  await ensureColumn('sys_user', 'campus', "VARCHAR(64) DEFAULT '' AFTER gender")
  await ensureColumn('sys_user', 'phone', "VARCHAR(20) DEFAULT NULL AFTER campus")
  await ensureColumn('sys_user', 'status', "TINYINT(1) DEFAULT 1 AFTER is_verified")
  await ensureColumn('forum_post', 'title', "VARCHAR(128) DEFAULT '' AFTER user_id")
  await ensureColumn('user_schedule', 'week_type', "VARCHAR(8) DEFAULT 'all' AFTER end_week")
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
}

module.exports = {
  runMigrations
}
