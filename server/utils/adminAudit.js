const pool = require('../config/pool')

async function writeAdminAudit(req, action, targetType, targetId, detail) {
  await pool.query(
    'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [req.userId, action, targetType, String(targetId || ''), JSON.stringify(detail || {}), req.ip || '']
  )
}

module.exports = { writeAdminAudit }
