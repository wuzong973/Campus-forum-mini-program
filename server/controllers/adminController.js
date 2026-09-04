const pool = require('../config/pool')
const { success, fail, permissionsFor } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')

const ADMIN_ROLES = ['super_admin', 'content_admin', 'user_admin', 'operator']
const CONTENT_TYPES = ['category', 'tag', 'notice']
const POST_STATUS = [0, 1, 2, 3]

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 50)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function intId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

function bool(value) {
  return Number(value) ? 1 : 0
}

function optionalText(value, max) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length > max) return null
  return value.trim()
}

async function audit(req, action, targetType, targetId, detail) {
  try {
    await writeAdminAudit(req, action, targetType, targetId, detail)
  } catch (e) {
    // Management data must remain usable if the separate audit table is unavailable.
    console.error('[admin-audit]', e.message)
  }
}

exports.me = async (req, res) => {
  success(res, { role: req.user.role, permissions: permissionsFor(req.user.role) })
}

exports.stats = async (req, res) => {
  try {
    const [[users], [posts], [errands], [items], [activity], [recent]] = await Promise.all([
      pool.query('SELECT COUNT(*) total, SUM(status = 1) enabled FROM sys_user'),
      pool.query('SELECT COUNT(*) total, SUM(status = 1) published, SUM(status = 2) pending, SUM(status = 3) hidden FROM forum_post'),
      pool.query("SELECT COUNT(*) total, SUM(status = 'finished') finished, IFNULL(SUM(CASE WHEN status = 'finished' THEN reward ELSE 0 END), 0) amount FROM errand_order"),
      pool.query('SELECT COUNT(*) total, SUM(status = 1) online, IFNULL(SUM(sales_count), 0) sales FROM virtual_item'),
      pool.query('SELECT COUNT(*) posts7d, COUNT(DISTINCT user_id) activeUsers7d FROM forum_post WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
      pool.query('SELECT action, target_type targetType, target_id targetId, created_at createdAt FROM admin_audit_log ORDER BY id DESC LIMIT 8')
    ])
    success(res, {
      users: { total: Number(users.total || 0), enabled: Number(users.enabled || 0), active7d: Number(activity.activeUsers7d || 0) },
      posts: { total: Number(posts.total || 0), published: Number(posts.published || 0), pending: Number(posts.pending || 0), hidden: Number(posts.hidden || 0), published7d: Number(activity.posts7d || 0) },
      errands: { total: Number(errands.total || 0), finished: Number(errands.finished || 0), amount: Number(errands.amount || 0) },
      items: { total: Number(items.total || 0), online: Number(items.online || 0), sales: Number(items.sales || 0) },
      recentActions: recent
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listReports = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const allowed = ['', 'pending', 'processing', 'resolved', 'rejected']
  if (!allowed.includes(status)) return fail(res, 'Invalid report status')
  const params = []
  const where = status ? 'WHERE r.status = ?' : ''
  if (status) params.push(status)
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM content_report r ${where}`, params),
      pool.query(`SELECT r.id, r.reporter_id reporterId, r.target_type targetType, r.target_id targetId, r.reason, r.status, r.handled_note handledNote, r.created_at createdAt, u.nick_name reporterName FROM content_report r LEFT JOIN sys_user u ON u.id = r.reporter_id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list, total: Number(count.total || 0), page, hasMore: offset + list.length < Number(count.total || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateReport = async (req, res) => {
  const id = intId(req.params.id)
  const status = String((req.body || {}).status || '').trim()
  const note = optionalText((req.body || {}).note, 500)
  if (!id || !['processing', 'resolved', 'rejected'].includes(status) || note === null) return fail(res, 'Invalid report update')
  try {
    const [result] = await pool.query('UPDATE content_report SET status = ?, handled_by = ?, handled_note = ?, handled_at = NOW() WHERE id = ?', [status, req.userId, note || '', id])
    if (!result.affectedRows) return fail(res, 'Report not found', 404)
    await audit(req, 'report.update', 'content_report', id, { status, note: note || '' })
    success(res, { id, status })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listPosts = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = req.query.status === '' || req.query.status === undefined ? null : Number(req.query.status)
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  if (status !== null && !POST_STATUS.includes(status)) return fail(res, 'Invalid post status')
  try {
    let where = 'WHERE 1 = 1'
    const params = []
    if (status !== null) { where += ' AND p.status = ?'; params.push(status) }
    if (keyword) { where += ' AND (p.title LIKE ? OR p.content LIKE ? OR u.nick_name LIKE ?)'; const q = '%' + keyword + '%'; params.push(q, q, q) }
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM forum_post p LEFT JOIN sys_user u ON u.id = p.user_id ${where}`, params),
      pool.query(`SELECT p.id, p.user_id userId, p.title, p.category, p.content, p.status, p.pinned, p.review_note reviewNote, p.created_at createdAt, p.updated_at updatedAt, p.like_count likeCount, p.comment_count commentCount, u.nick_name nickName FROM forum_post p LEFT JOIN sys_user u ON u.id = p.user_id ${where} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list, total: Number(count.total), page, hasMore: offset + list.length < Number(count.total) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updatePost = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  if (!id) return fail(res, 'Invalid post id')
  const title = optionalText(body.title, 128)
  const content = optionalText(body.content, 10000)
  const category = optionalText(body.category, 32)
  if (title === null || content === null || category === null || (content !== undefined && !content)) return fail(res, 'Invalid post content')
  const fields = []; const values = []
  if (title !== undefined) { fields.push('title = ?'); values.push(title) }
  if (content !== undefined) { fields.push('content = ?'); values.push(content) }
  if (category !== undefined) { fields.push('category = ?'); values.push(category) }
  if (!fields.length) return fail(res, 'No changes supplied')
  try {
    const [result] = await pool.query(`UPDATE forum_post SET ${fields.join(', ')} WHERE id = ?`, values.concat(id))
    if (!result.affectedRows) return fail(res, 'Post not found', 404)
    await audit(req, 'post.edit', 'post', id, { fields: Object.keys(body).filter((key) => ['title', 'content', 'category'].includes(key)) })
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.postAction = async (req, res) => {
  const id = intId(req.params.id)
  const action = String((req.body || {}).action || '')
  const actions = { approve: ['status = 1', []], delete: ['status = 0, pinned = 0', []], hide: ['status = 3, pinned = 0', []], pin: ['pinned = 1', []], unpin: ['pinned = 0', []] }
  if (!id || !actions[action]) return fail(res, 'Invalid management action')
  try {
    const [result] = await pool.query(`UPDATE forum_post SET ${actions[action][0]} WHERE id = ?`, [id])
    if (!result.affectedRows) return fail(res, 'Post not found', 404)
    await audit(req, 'post.' + action, 'post', id, {})
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.batchPostAction = async (req, res) => {
  const ids = Array.from(new Set(((req.body || {}).ids || []).map(intId).filter(Boolean))).slice(0, 100)
  const action = String((req.body || {}).action || '')
  const setByAction = { approve: 'status = 1', delete: 'status = 0, pinned = 0', hide: 'status = 3, pinned = 0', pin: 'pinned = 1', unpin: 'pinned = 0' }
  if (!ids.length || !setByAction[action]) return fail(res, 'Select 1 to 100 posts and a valid action')
  try {
    const marks = ids.map(() => '?').join(',')
    const [result] = await pool.query(`UPDATE forum_post SET ${setByAction[action]} WHERE id IN (${marks})`, ids)
    await audit(req, 'post.batch.' + action, 'post', ids.join(','), { count: result.affectedRows })
    success(res, { affected: result.affectedRows })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listContent = async (req, res) => {
  const type = String(req.query.type || '')
  if (type && !CONTENT_TYPES.includes(type)) return fail(res, 'Invalid content type')
  try {
    const [list] = await pool.query(`SELECT id, type, title, body, status, sort_order sortOrder, updated_at updatedAt FROM system_content ${type ? 'WHERE type = ?' : ''} ORDER BY type, sort_order, id DESC`, type ? [type] : [])
    success(res, { list })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.createContent = async (req, res) => {
  const body = req.body || {}; const type = String(body.type || ''); const title = optionalText(body.title, 128); const text = optionalText(body.body || '', 10000)
  if (!CONTENT_TYPES.includes(type) || !title || title === null || text === null) return fail(res, 'Invalid content data')
  try {
    const [result] = await pool.query('INSERT INTO system_content (type, title, body, status, sort_order) VALUES (?, ?, ?, ?, ?)', [type, title, text, bool(body.status === undefined ? 1 : body.status), Math.max(0, Number(body.sortOrder) || 0)])
    await audit(req, 'content.create', 'content', result.insertId, { type, title })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateContent = async (req, res) => {
  const id = intId(req.params.id); const body = req.body || {}; const title = optionalText(body.title, 128); const text = optionalText(body.body, 10000)
  if (!id || title === null || text === null || (body.type && !CONTENT_TYPES.includes(body.type))) return fail(res, 'Invalid content data')
  const fields = []; const values = []
  ;[['type', body.type], ['title', title], ['body', text], ['status', body.status === undefined ? undefined : bool(body.status)], ['sort_order', body.sortOrder === undefined ? undefined : Math.max(0, Number(body.sortOrder) || 0)]].forEach(([key, value]) => { if (value !== undefined) { fields.push(key + ' = ?'); values.push(value) } })
  if (!fields.length) return fail(res, 'No changes supplied')
  try { const [result] = await pool.query(`UPDATE system_content SET ${fields.join(', ')} WHERE id = ?`, values.concat(id)); if (!result.affectedRows) return fail(res, 'Content not found', 404); await audit(req, 'content.update', 'content', id, { fields }); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.deleteContent = async (req, res) => {
  const id = intId(req.params.id); if (!id) return fail(res, 'Invalid content id')
  try { const [result] = await pool.query('DELETE FROM system_content WHERE id = ?', [id]); if (!result.affectedRows) return fail(res, 'Content not found', 404); await audit(req, 'content.delete', 'content', id, {}); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listFeatures = async (req, res) => { try { const [list] = await pool.query('SELECT id, config_key configKey, label, config_value configValue, status, updated_at updatedAt FROM feature_config ORDER BY id DESC'); success(res, { list }) } catch (e) { fail(res, safeMessage(e), 500) } }
exports.saveFeature = async (req, res) => {
  const body = req.body || {}; const key = optionalText(body.configKey, 64); const label = optionalText(body.label, 128); const value = optionalText(body.configValue || '', 10000)
  if (!key || key === null || !/^[a-z][a-z0-9_.-]*$/.test(key) || !label || label === null || value === null) return fail(res, 'Invalid feature configuration')
  try { await pool.query('INSERT INTO feature_config (config_key, label, config_value, status, updated_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label), config_value = VALUES(config_value), status = VALUES(status), updated_by = VALUES(updated_by)', [key, label, value, bool(body.status === undefined ? 1 : body.status), req.userId]); await audit(req, 'feature.save', 'feature', key, { label }); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listItems = async (req, res) => { try { const [list] = await pool.query('SELECT id, name, description, cover_url coverUrl, price, stock, sales_count salesCount, status, updated_at updatedAt FROM virtual_item ORDER BY updated_at DESC'); success(res, { list }) } catch (e) { fail(res, safeMessage(e), 500) } }
exports.createItem = async (req, res) => {
  const body = req.body || {}; const name = optionalText(body.name, 128); const description = optionalText(body.description || '', 10000); const coverUrl = optionalText(body.coverUrl || '', 512); const price = Number(body.price); const stock = Number(body.stock)
  if (!name || name === null || description === null || coverUrl === null || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return fail(res, 'Invalid virtual item')
  try { const [result] = await pool.query('INSERT INTO virtual_item (name, description, cover_url, price, stock, status) VALUES (?, ?, ?, ?, ?, ?)', [name, description, coverUrl, price, stock, bool(body.status === undefined ? 1 : body.status)]); await pool.query('INSERT INTO virtual_item_log (item_id, admin_id, action, after_data) VALUES (?, ?, ?, ?)', [result.insertId, req.userId, 'create', JSON.stringify({ name, price, stock })]); await audit(req, 'item.create', 'virtual_item', result.insertId, { name }); success(res, { id: result.insertId }) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateItem = async (req, res) => {
  const id = intId(req.params.id); const body = req.body || {}; if (!id) return fail(res, 'Invalid item id')
  try {
    const [[before]] = await pool.query('SELECT id, name, description, cover_url, price, stock, sales_count, status FROM virtual_item WHERE id = ?', [id]); if (!before) return fail(res, 'Virtual item not found', 404)
    const name = body.name === undefined ? before.name : optionalText(body.name, 128); const description = body.description === undefined ? before.description : optionalText(body.description, 10000); const cover = body.coverUrl === undefined ? before.cover_url : optionalText(body.coverUrl, 512); const price = body.price === undefined ? Number(before.price) : Number(body.price); const stock = body.stock === undefined ? before.stock : Number(body.stock)
    if (!name || name === null || description === null || cover === null || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return fail(res, 'Invalid virtual item')
    const status = body.status === undefined ? before.status : bool(body.status)
    await pool.query('UPDATE virtual_item SET name = ?, description = ?, cover_url = ?, price = ?, stock = ?, status = ? WHERE id = ?', [name, description, cover, price, stock, status, id])
    await pool.query('INSERT INTO virtual_item_log (item_id, admin_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)', [id, req.userId, 'update', JSON.stringify(before), JSON.stringify({ name, description, coverUrl: cover, price, stock, status })])
    await audit(req, 'item.update', 'virtual_item', id, { name, status }); success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listUsers = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query); const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  try { const where = keyword ? 'WHERE nick_name LIKE ? OR phone LIKE ? OR student_id LIKE ?' : ''; const params = keyword ? ['%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%'] : []; const [[count], [list]] = await Promise.all([pool.query(`SELECT COUNT(*) total FROM sys_user ${where}`, params), pool.query(`SELECT id, nick_name nickName, avatar_url avatarUrl, campus, phone, student_id studentId, is_verified isVerified, cert_label certLabel, role, status, created_at createdAt FROM sys_user ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))]); success(res, { list, total: Number(count.total), page, hasMore: offset + list.length < Number(count.total) }) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateUserStatus = async (req, res) => {
  const id = intId(req.params.id); const status = bool((req.body || {}).status); if (!id || id === req.userId) return fail(res, 'Invalid account status operation')
  try {
    const [[target]] = await pool.query('SELECT role FROM sys_user WHERE id = ?', [id])
    if (!target) return fail(res, 'User not found', 404)
    if (!status && target.role === 'super_admin') {
      const [[count]] = await pool.query("SELECT COUNT(*) total FROM sys_user WHERE role = 'super_admin' AND status = 1")
      if (Number(count.total) <= 1) return fail(res, 'Keep at least one enabled super administrator')
    }
    await pool.query('UPDATE sys_user SET status = ? WHERE id = ?', [status, id])
    await audit(req, status ? 'user.enable' : 'user.disable', 'user', id, {})
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateUserRole = async (req, res) => {
  const id = intId(req.params.id); const role = String((req.body || {}).role || ''); if (!id || !ADMIN_ROLES.concat('user').includes(role) || id === req.userId) return fail(res, 'Invalid role operation')
  try { const [[target]] = await pool.query('SELECT role FROM sys_user WHERE id = ?', [id]); if (!target) return fail(res, 'User not found', 404); if (target.role === 'super_admin' && role !== 'super_admin') { const [[count]] = await pool.query("SELECT COUNT(*) total FROM sys_user WHERE role = 'super_admin' AND status = 1"); if (Number(count.total) <= 1) return fail(res, 'Keep at least one enabled super administrator') }; await pool.query('UPDATE sys_user SET role = ? WHERE id = ?', [role, id]); await audit(req, 'user.role', 'user', id, { from: target.role, to: role }); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateUserCertLabel = async (req, res) => {
  const id = intId(req.params.id); const certLabel = optionalText((req.body || {}).certLabel || '', 32)
  if (!id) return fail(res, 'Invalid user id')
  if (certLabel === null) return fail(res, '认证信息最多 32 个字符')
  try {
    const [[target]] = await pool.query('SELECT id, nick_name FROM sys_user WHERE id = ?', [id])
    if (!target) return fail(res, 'User not found', 404)
    await pool.query('UPDATE sys_user SET cert_label = ? WHERE id = ?', [certLabel || null, id])
    await audit(req, 'user.cert_label', 'user', id, { certLabel: certLabel || null })
    success(res, { certLabel: certLabel || null })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
