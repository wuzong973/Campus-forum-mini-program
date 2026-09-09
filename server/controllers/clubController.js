const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

async function audit(req, action, targetType, targetId, detail) {
  try {
    await writeAdminAudit(req, action, targetType, targetId, detail)
  } catch (e) {
    console.error('[admin-audit]', e.message)
  }
}

function intId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

function optionalText(value, max) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > max) return null
  return trimmed
}

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (Array.isArray(value)) return value
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed : fallback
  } catch (e) {
    return fallback
  }
}

function mapCategoryRow(row, clubs) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    iconChar: row.icon_char || row.name.charAt(0),
    slogan: row.slogan || '',
    color: row.color || '#2E6BFF',
    position: row.position || '',
    scopeIntro: row.scope_intro || '',
    scope: parseMaybeJson(row.scope, []),
    features: parseMaybeJson(row.features, []),
    contact: row.contact || '',
    sortOrder: row.sort_order || 0,
    status: Number(row.status)
  }
}

async function loadClubsByCategory(categoryIds, onlyEnabled) {
  if (!categoryIds.length) return {}
  const placeholders = categoryIds.map(() => '?').join(',')
  const extra = onlyEnabled ? ' AND status = 1' : ''
  const [rows] = await pool.query(
    `SELECT id, category_id, name, tags, intro, recruit, sort_order, status
     FROM club WHERE deleted = 0 AND category_id IN (${placeholders})${extra}
     ORDER BY sort_order ASC, id ASC`,
    categoryIds
  )
  const grouped = {}
  for (const row of rows) {
    if (!grouped[row.category_id]) grouped[row.category_id] = []
    grouped[row.category_id].push({
      id: row.id,
      name: row.name,
      tags: row.tags || '',
      intro: row.intro || '',
      recruit: row.recruit || '',
      sortOrder: row.sort_order || 0,
      status: Number(row.status)
    })
  }
  return grouped
}

// 公开接口：前台社团&组织页数据源（含各分类下的社团列表）
exports.listCategories = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM club_category WHERE deleted = 0 AND status = 1 ORDER BY sort_order ASC, id ASC'
    )
    const grouped = await loadClubsByCategory(rows.map((r) => r.id), true)
    success(res, { list: rows.map((row) => mapCategoryRow(row, grouped[row.id] || [])) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 以下为管理端接口（挂在 /admin 路由下，需 config.manage 权限） =====

// 管理端列表：包含停用分类与停用社团，并统计数量（含各分类下社团明细，便于后台直接编辑）
exports.adminListCategories = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM club_category WHERE deleted = 0 ORDER BY sort_order ASC, id ASC'
    )
    const [counts] = await pool.query(
      `SELECT category_id, COUNT(*) total, IFNULL(SUM(status = 1 AND deleted = 0), 0) enabled
       FROM club WHERE deleted = 0 GROUP BY category_id`
    )
    const countMap = {}
    for (const row of counts) countMap[row.category_id] = row
    const grouped = await loadClubsByCategory(rows.map((r) => r.id), false)
    const list = rows.map((row) => ({
      ...mapCategoryRow(row),
      clubTotal: Number((countMap[row.id] || {}).total || 0),
      clubEnabled: Number((countMap[row.id] || {}).enabled || 0),
      clubs: grouped[row.id] || []
    }))
    success(res, { list })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

function validateCategoryPayload(body, { partial } = {}) {
  const data = {}
  const name = optionalText(body.name, 64)
  if (name === null || (!partial && !name)) return { error: '分类名称需为 1-64 个字符' }
  if (name !== undefined) data.name = name

  if (body.iconChar !== undefined) {
    const iconChar = optionalText(body.iconChar, 8)
    if (iconChar === null) return { error: '图标字符过长' }
    data.icon_char = iconChar || (name || '').charAt(0)
  }
  if (body.slogan !== undefined) {
    const slogan = optionalText(body.slogan, 128)
    if (slogan === null) return { error: '标语需在 128 字以内' }
    data.slogan = slogan
  }
  if (body.color !== undefined) {
    const color = optionalText(body.color, 16)
    if (color === null || !HEX_COLOR.test(color || '')) return { error: '主题色需为 #RRGGBB 格式' }
    data.color = color
  }
  if (body.position !== undefined) {
    const position = optionalText(body.position, 2000)
    if (position === null) return { error: '分类定位介绍过长' }
    data.position = position
  }
  if (body.scopeIntro !== undefined) {
    const scopeIntro = optionalText(body.scopeIntro, 512)
    if (scopeIntro === null) return { error: '涵盖范围介绍过长' }
    data.scope_intro = scopeIntro
  }
  if (body.scope !== undefined) {
    const scope = parseMaybeJson(body.scope, null)
    if (!Array.isArray(scope) || scope.some((item) => typeof item !== 'string' || item.length > 32)) {
      return { error: '涵盖范围格式不正确' }
    }
    data.scope = JSON.stringify(scope.slice(0, 30))
  }
  if (body.features !== undefined) {
    const features = parseMaybeJson(body.features, null)
    const valid = Array.isArray(features) && features.every(
      (item) => item && typeof item.title === 'string' && item.title.length <= 32
        && typeof item.desc === 'string' && item.desc.length <= 300
    )
    if (!valid) return { error: '特色说明格式不正确（需为标题+描述）' }
    data.features = JSON.stringify(features.slice(0, 8))
  }
  if (body.contact !== undefined) {
    const contact = optionalText(body.contact, 255)
    if (contact === null) return { error: '联系咨询文案过长' }
    data.contact = contact
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isInteger(sortOrder)) return { error: '排序值需为整数' }
    data.sort_order = sortOrder
  }
  if (body.status !== undefined) {
    data.status = Number(body.status) ? 1 : 0
  }
  return { data }
}

exports.createCategory = async (req, res) => {
  const { data, error } = validateCategoryPayload(req.body || {})
  if (error) return fail(res, error)
  const slug = optionalText((req.body || {}).slug, 32) || 'cat' + Date.now().toString(36)
  try {
    const [exists] = await pool.query('SELECT id FROM club_category WHERE slug = ? LIMIT 1', [slug])
    if (exists.length) return fail(res, '分类标识已存在')
    const [result] = await pool.query(
      `INSERT INTO club_category (slug, name, icon_char, slogan, color, position, scope_intro, scope, features, contact, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [slug, data.name, data.icon_char || data.name.charAt(0), data.slogan || '', data.color || '#2E6BFF',
       data.position || '', data.scope_intro || '', data.scope || '[]', data.features || '[]',
       data.contact || '', data.sort_order || 0, data.status === undefined ? 1 : data.status]
    )
    await audit(req, 'club.category.create', 'club_category', result.insertId, { name: data.name, slug })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateCategory = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid category id')
  const { data, error } = validateCategoryPayload(req.body || {}, { partial: true })
  if (error) return fail(res, error)
  if (!Object.keys(data).length) return fail(res, '没有需要更新的内容')
  try {
    const [result] = await pool.query('UPDATE club_category SET ? WHERE id = ? AND deleted = 0', [data, id])
    if (!result.affectedRows) return fail(res, '分类不存在', 404)
    await audit(req, 'club.category.update', 'club_category', id, data)
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.deleteCategory = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid category id')
  try {
    const [result] = await pool.query('UPDATE club_category SET deleted = 1, status = 0 WHERE id = ? AND deleted = 0', [id])
    if (!result.affectedRows) return fail(res, '分类不存在', 404)
    await pool.query('UPDATE club SET status = 0 WHERE category_id = ?', [id])
    await audit(req, 'club.category.delete', 'club_category', id, {})
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

function validateClubPayload(body, { partial } = {}) {
  const data = {}
  const name = optionalText(body.name, 64)
  if (name === null || (!partial && !name)) return { error: '社团名称需为 1-64 个字符' }
  if (name !== undefined) data.name = name
  if (body.tags !== undefined) {
    const tags = optionalText(body.tags, 128)
    if (tags === null) return { error: '标签需在 128 字以内' }
    data.tags = tags
  }
  if (body.intro !== undefined) {
    const intro = optionalText(body.intro, 1000)
    if (intro === null) return { error: '简介需在 1000 字以内' }
    data.intro = intro
  }
  if (body.recruit !== undefined) {
    const recruit = optionalText(body.recruit, 255)
    if (recruit === null) return { error: '招新说明需在 255 字以内' }
    data.recruit = recruit
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isInteger(sortOrder)) return { error: '排序值需为整数' }
    data.sort_order = sortOrder
  }
  if (body.status !== undefined) data.status = Number(body.status) ? 1 : 0
  return { data }
}

exports.createClub = async (req, res) => {
  const categoryId = intId((req.body || {}).categoryId)
  if (!categoryId) return fail(res, '请选择所属分类')
  const { data, error } = validateClubPayload(req.body || {})
  if (error) return fail(res, error)
  try {
    const [categories] = await pool.query('SELECT id FROM club_category WHERE id = ? AND deleted = 0 LIMIT 1', [categoryId])
    if (!categories.length) return fail(res, '所属分类不存在', 404)
    const [result] = await pool.query(
      `INSERT INTO club (category_id, name, tags, intro, recruit, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [categoryId, data.name, data.tags || '', data.intro || '', data.recruit || '',
       data.sort_order || 0, data.status === undefined ? 1 : data.status]
    )
    await audit(req, 'club.club.create', 'club', result.insertId, { categoryId, name: data.name })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateClub = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid club id')
  const payload = req.body || {}
  const { data, error } = validateClubPayload(payload, { partial: true })
  if (error) return fail(res, error)
  if (payload.categoryId !== undefined) {
    const categoryId = intId(payload.categoryId)
    if (!categoryId) return fail(res, '所属分类不正确')
    data.category_id = categoryId
  }
  if (!Object.keys(data).length) return fail(res, '没有需要更新的内容')
  try {
    if (data.category_id) {
      const [categories] = await pool.query('SELECT id FROM club_category WHERE id = ? AND deleted = 0 LIMIT 1', [data.category_id])
      if (!categories.length) return fail(res, '所属分类不存在', 404)
    }
    const [result] = await pool.query('UPDATE club SET ? WHERE id = ? AND deleted = 0', [data, id])
    if (!result.affectedRows) return fail(res, '社团不存在', 404)
    await audit(req, 'club.club.update', 'club', id, data)
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.deleteClub = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid club id')
  try {
    const [result] = await pool.query('UPDATE club SET deleted = 1, status = 0 WHERE id = ? AND deleted = 0', [id])
    if (!result.affectedRows) return fail(res, '社团不存在', 404)
    await audit(req, 'club.club.delete', 'club', id, {})
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
