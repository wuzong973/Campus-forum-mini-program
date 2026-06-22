const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')

exports.list = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = clampPageSize(req.query.pageSize)
  const type = req.query.type || ''
  const campus = req.query.campus || ''
  const offset = (page - 1) * pageSize
  try {
    let where = "WHERE e.status = 'pending'"
    const params = []
    if (type) { where += ' AND e.type = ?'; params.push(type) }
    if (campus) { where += ' AND e.campus = ?'; params.push(campus) }
    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM errand_order e ${where}`, params)
    const [rows] = await pool.query(
      `SELECT e.*, u.nick_name as publisher_name FROM errand_order e LEFT JOIN sys_user u ON e.publisher_id = u.id ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )
    const total = countRows[0].total
    success(res, { list: rows, total, hasMore: offset + pageSize < total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.create = async (req, res) => {
  const { type, title, desc, reward, pickupAddr, deliveryAddr, campus } = req.body
  if (!title || !reward) return fail(res, '参数不完整')
  try {
    const [result] = await pool.query(
      'INSERT INTO errand_order (publisher_id, type, title, description, reward, pickup_addr, delivery_addr, campus) VALUES (?,?,?,?,?,?,?,?)',
      [req.userId, type || '快递', title, desc || '', reward, pickupAddr || '', deliveryAddr || '', campus || '']
    )
    success(res, { id: result.insertId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.accept = async (req, res) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query("SELECT * FROM errand_order WHERE id = ? AND status = 'pending' FOR UPDATE", [req.params.id])
    if (!rows.length) { await conn.rollback(); return fail(res, '订单不存在或已被接单') }
    if (rows[0].publisher_id === req.userId) { await conn.rollback(); return fail(res, '不能接自己的单') }
    await conn.query("UPDATE errand_order SET status = 'accepted', acceptor_id = ? WHERE id = ?", [req.userId, req.params.id])
    await conn.commit()
    success(res, null, '接单成功')
  } catch (e) {
    await conn.rollback()
    fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
}

exports.finish = async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE errand_order SET status = 'finished' WHERE id = ? AND status = 'accepted' AND (publisher_id = ? OR acceptor_id = ?)",
      [req.params.id, req.userId, req.userId]
    )
    if (!result.affectedRows) return fail(res, '订单状态不允许完成')
    success(res, null, '订单已完成')
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
