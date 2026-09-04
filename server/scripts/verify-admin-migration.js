const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const pool = require('../config/pool')
const { runMigrations } = require('../utils/migrations')

async function verify() {
  await runMigrations()
  const [audit] = await pool.query('SHOW TABLES LIKE ?', ['admin_audit_log'])
  const [content] = await pool.query('SHOW TABLES LIKE ?', ['system_content'])
  const [items] = await pool.query('SHOW TABLES LIKE ?', ['virtual_item'])
  const [role] = await pool.query('SHOW COLUMNS FROM sys_user LIKE ?', ['role'])
  const [flags] = await pool.query(
    'SELECT config_key, status FROM feature_config WHERE config_key IN (?,?,?,?) ORDER BY config_key',
    ['community.enabled', 'errand.enabled', 'repair.enabled', 'schedule.enabled']
  )
  console.log(JSON.stringify({ auditTable: audit.length, contentTable: content.length, itemTable: items.length, roleColumn: role.length, flags }))
}

verify().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
}).finally(() => pool.end())
