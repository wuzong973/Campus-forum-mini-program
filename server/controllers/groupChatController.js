const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')

const HTTPS_URL = /^https:\/\/\S{1,500}$/i
const MAX_IMAGES = 4
// 校区两级结构（与用户端 utils/campus.js 保持一致）；'' = 全部校区
const CAMPUS_MAIN_MAP = {
  '广州校区': ['新港校区', '琶洲校区'],
  '佛山校区': ['南海南校区', '南海北校区']
}
const CAMPUS_VALUES = Object.keys(CAMPUS_MAIN_MAP).concat(
  Object.keys(CAMPUS_MAIN_MAP).reduce((arr, key) => arr.concat(CAMPUS_MAIN_MAP[key]), [])
)

// 校区筛选匹配集：主校区 → 主校区+其分校区；分校区 → 仅自身；未知/空 → null（不过滤）
function campusMatchValues(campus) {
  if (!campus) return null
  if (CAMPUS_MAIN_MAP[campus]) return [campus].concat(CAMPUS_MAIN_MAP[campus])
  if (CAMPUS_VALUES.indexOf(campus) >= 0) return [campus]
  return null
}

async function audit(req, action, targetType, targetId, detail) {
  try {
    await writeAdminAudit(req, action, targetType, targetId, detail)
  } catch (e) {
    console.error('[admin-audit]', e.message)
  }
}

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 50)
  return { page, pageSize, offset: (page - 1) * pageSize }
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

function optionalUrl(value, max = 512) {
  if (value === undefined) return undefined
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !HTTPS_URL.test(value.trim())) return null
  return value.trim()
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

function mapApplyRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nickName: row.nick_name || '',
    avatar: row.avatar_url || '',
    groupType: row.group_type || '微信群',
    category: row.category || '',
    campus: row.campus || '',
    name: row.name || '',
    intro: row.intro || '',
    avatarUrl: row.avatar_url || '',
    qrcodeUrl: row.qrcode_url || '',
    adminQrcodeUrl: row.admin_qrcode_url || '',
    gzhQrcodeUrl: row.gzh_qrcode_url || '',
    images: parseMaybeJson(row.images, []),
    status: row.status,
    reviewNote: row.review_note || '',
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  }
}

function mapGroupRow(row) {
  return {
    id: row.id,
    applyId: row.apply_id,
    name: row.name || '',
    category: row.category || '',
    intro: row.intro || '',
    avatarUrl: row.avatar_url || '',
    qrcodeUrl: row.qrcode_url || '',
    gzhQrcodeUrl: row.gzh_qrcode_url || '',
    isOfficial: Number(row.is_official) ? 1 : 0,
    customTag: row.custom_tag || '',
    campus: row.campus || '',
    sortOrder: row.sort_order || 0,
    status: Number(row.status),
    createdAt: row.created_at
  }
}

// ===== 用户端接口 =====

// 提交建群申请（需登录）：仅支持微信群
exports.submitApply = async (req, res) => {
  const body = req.body || {}
  const category = optionalText(body.category, 32)
  const campus = optionalText(body.campus, 16) || ''
  const name = optionalText(body.name, 64)
  const intro = optionalText(body.intro, 1000)
  const avatarUrl = optionalUrl(body.avatarUrl)
  const qrcodeUrl = optionalUrl(body.qrcodeUrl)
  const adminQrcodeUrl = optionalUrl(body.adminQrcodeUrl)
  const gzhQrcodeUrl = optionalUrl(body.gzhQrcodeUrl)
  if (!category) return fail(res, '请选择群类别')
  if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return fail(res, '校区取值不正确')
  if (!name) return fail(res, '请填写群名')
  if (avatarUrl === null || qrcodeUrl === null || adminQrcodeUrl === null || gzhQrcodeUrl === null) {
    return fail(res, '图片地址不合法')
  }
  if (!avatarUrl) return fail(res, '请上传群头像')
  if (!qrcodeUrl) return fail(res, '请上传群二维码')
  if (!adminQrcodeUrl) return fail(res, '请上传管理员微信二维码')
  if (!intro) return fail(res, '请填写文字介绍')
  let images = []
  if (body.images !== undefined) {
    images = parseMaybeJson(body.images, [])
    const valid = Array.isArray(images) && images.every((url) => typeof url === 'string' && HTTPS_URL.test(url))
    if (!valid) return fail(res, '图片介绍地址不合法')
    images = images.slice(0, MAX_IMAGES)
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO group_chat_apply (user_id, group_type, category, campus, name, intro, avatar_url, qrcode_url, admin_qrcode_url, gzh_qrcode_url, images)
       VALUES (?, '微信群', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, category, campus, name, intro, avatarUrl, qrcodeUrl, adminQrcodeUrl, gzhQrcodeUrl,
       images.length ? JSON.stringify(images) : null]
    )
    success(res, { id: result.insertId, status: 'pending' })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 我的申请列表（需登录）：展示审核状态与审核意见
exports.myApplies = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM group_chat_apply WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50',
      [req.userId]
    )
    success(res, { list: rows.map(mapApplyRow) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 公开接口：已上架群聊列表（前台群聊分类页数据源，支持按校区筛选，'' = 全部校区）
exports.listGroups = async (req, res) => {
  try {
    let where = 'WHERE deleted = 0 AND status = 1'
    const params = []
    const campus = String(req.query.campus || '').trim()
    const matchValues = campusMatchValues(campus)
    if (matchValues) {
      where += ' AND (campus IN (' + matchValues.map(() => '?').join(',') + ') OR campus = \'\')'
      params.push.apply(params, matchValues)
    }
    const [rows] = await pool.query(
      `SELECT id, apply_id, name, category, intro, avatar_url, qrcode_url, gzh_qrcode_url, is_official, custom_tag, campus, sort_order, status, created_at
       FROM group_chat ${where}
       ORDER BY sort_order ASC, id ASC`,
      params
    )
    success(res, { list: rows.map(mapGroupRow) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 公开接口：群聊详情（含申请单里的管理员/公众号二维码与介绍图片）
exports.detail = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid group id')
  try {
    const [rows] = await pool.query(
      `SELECT g.*, a.admin_qrcode_url apply_admin_qrcode, a.gzh_qrcode_url apply_gzh_qrcode, a.images apply_images
       FROM group_chat g LEFT JOIN group_chat_apply a ON a.id = g.apply_id
       WHERE g.id = ? AND g.deleted = 0 AND g.status = 1 LIMIT 1`,
      [id]
    )
    if (!rows.length) return fail(res, '群聊不存在或已下架', 404)
    const row = rows[0]
    const group = mapGroupRow(row)
    success(res, {
      group,
      adminQrcodeUrl: row.apply_admin_qrcode || '',
      // 公众号二维码：优先群聊自身维护值，回退到申请单里的值
      gzhQrcodeUrl: group.gzhQrcodeUrl || row.apply_gzh_qrcode || '',
      images: parseMaybeJson(row.apply_images, [])
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 管理端接口（挂在 /admin 路由下，需 config.manage 权限） =====

exports.adminListApplies = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  const allowed = ['', 'pending', 'approved', 'rejected']
  if (!allowed.includes(status)) return fail(res, 'Invalid apply status')
  let where = 'WHERE 1 = 1'
  const params = []
  if (status) { where += ' AND a.status = ?'; params.push(status) }
  if (keyword) { where += ' AND (a.name LIKE ? OR a.category LIKE ? OR u.nick_name LIKE ?)'; const q = '%' + keyword + '%'; params.push(q, q, q) }
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM group_chat_apply a LEFT JOIN sys_user u ON u.id = a.user_id ${where}`, params),
      pool.query(
        `SELECT a.*, u.nick_name FROM group_chat_apply a
         LEFT JOIN sys_user u ON u.id = a.user_id ${where}
         ORDER BY FIELD(a.status, 'pending', 'approved', 'rejected'), a.created_at DESC
         LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    success(res, { list: list.map(mapApplyRow), total: Number(count[0].total || 0), page, hasMore: offset + list.length < Number(count[0].total || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 审核：通过时自动上架/刷新群聊，驳回时下架关联群聊，支持改判
exports.reviewApply = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  const action = String(body.action || '').trim()
  const note = optionalText(body.note, 255)
  if (!id || !['approve', 'reject'].includes(action)) return fail(res, 'Invalid review action')
  if (action === 'reject' && !note) return fail(res, '驳回时请填写审核意见')
  try {
    const [applies] = await pool.query('SELECT * FROM group_chat_apply WHERE id = ? LIMIT 1', [id])
    if (!applies.length) return fail(res, '申请不存在', 404)
    const apply = applies[0]
    const status = action === 'approve' ? 'approved' : 'rejected'
    await pool.query(
      'UPDATE group_chat_apply SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [status, note || '', req.userId, id]
    )
    if (action === 'approve') {
      // 同一申请重复通过时刷新已有群聊，而不是重复上架
      const [existing] = await pool.query('SELECT id FROM group_chat WHERE apply_id = ? AND deleted = 0 LIMIT 1', [id])
      if (existing.length) {
        await pool.query(
          `UPDATE group_chat SET name = ?, category = ?, campus = ?, intro = ?, avatar_url = ?, qrcode_url = ?, gzh_qrcode_url = ?, status = 1 WHERE id = ?`,
          [apply.name, apply.category, apply.campus || '', apply.intro || '', apply.avatar_url || '', apply.qrcode_url || '', apply.gzh_qrcode_url || '', existing[0].id]
        )
      } else {
        await pool.query(
          `INSERT INTO group_chat (apply_id, name, category, campus, intro, avatar_url, qrcode_url, gzh_qrcode_url, sort_order, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
          [id, apply.name, apply.category, apply.campus || '', apply.intro || '', apply.avatar_url || '', apply.qrcode_url || '', apply.gzh_qrcode_url || '']
        )
      }
    } else {
      await pool.query('UPDATE group_chat SET status = 0 WHERE apply_id = ? AND deleted = 0', [id])
    }
    await audit(req, action === 'approve' ? 'groupchat.apply.approve' : 'groupchat.apply.reject', 'group_chat_apply', id, { note: note || '', name: apply.name })
    success(res, { id, status })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminListGroups = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  let where = 'WHERE deleted = 0'
  const params = []
  if (keyword) { where += ' AND (name LIKE ? OR category LIKE ?)'; const q = '%' + keyword + '%'; params.push(q, q) }
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM group_chat ${where}`, params),
      pool.query(
        `SELECT id, apply_id, name, category, intro, avatar_url, qrcode_url, gzh_qrcode_url, is_official, custom_tag, campus, sort_order, status, created_at
         FROM group_chat ${where} ORDER BY sort_order ASC, id DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    success(res, { list: list.map(mapGroupRow), total: Number(count[0].total || 0), page, hasMore: offset + list.length < Number(count[0].total || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

function validateGroupPayload(body, { partial } = {}) {
  const data = {}
  const name = optionalText(body.name, 64)
  if (name === null || (!partial && !name)) return { error: '群聊名称需为 1-64 个字符' }
  if (name !== undefined) data.name = name
  if (body.category !== undefined) {
    const category = optionalText(body.category, 32)
    if (category === null) return { error: '群类别过长' }
    data.category = category
  }
  if (body.intro !== undefined) {
    const intro = optionalText(body.intro, 1000)
    if (intro === null) return { error: '群介绍需在 1000 字以内' }
    data.intro = intro
  }
  if (body.avatarUrl !== undefined) {
    const avatarUrl = optionalUrl(body.avatarUrl)
    if (avatarUrl === null) return { error: '群头像地址不合法' }
    data.avatar_url = avatarUrl
  }
  if (body.qrcodeUrl !== undefined) {
    const qrcodeUrl = optionalUrl(body.qrcodeUrl)
    if (qrcodeUrl === null) return { error: '群二维码地址不合法' }
    data.qrcode_url = qrcodeUrl
  }
  if (body.gzhQrcodeUrl !== undefined) {
    const gzhQrcodeUrl = optionalUrl(body.gzhQrcodeUrl)
    if (gzhQrcodeUrl === null) return { error: '公众号二维码地址不合法' }
    data.gzh_qrcode_url = gzhQrcodeUrl
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isInteger(sortOrder)) return { error: '排序值需为整数' }
    data.sort_order = sortOrder
  }
  if (body.isOfficial !== undefined) data.is_official = Number(body.isOfficial) ? 1 : 0
  if (body.customTag !== undefined) {
    const customTag = optionalText(body.customTag, 16)
    if (customTag === null) return { error: '自定义标签需在 16 字以内' }
    data.custom_tag = customTag
  }
  if (body.campus !== undefined) {
    const campus = optionalText(body.campus, 16) || ''
    if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return { error: '校区取值不正确' }
    data.campus = campus
  }
  if (body.status !== undefined) data.status = Number(body.status) ? 1 : 0
  return { data }
}

exports.createGroup = async (req, res) => {
  const { data, error } = validateGroupPayload(req.body || {})
  if (error) return fail(res, error)
  try {
    const [result] = await pool.query(
      `INSERT INTO group_chat (apply_id, name, category, intro, avatar_url, qrcode_url, gzh_qrcode_url, is_official, custom_tag, campus, sort_order, status)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.category || '', data.intro || '', data.avatar_url || '', data.qrcode_url || '', data.gzh_qrcode_url || '',
       data.is_official || 0, data.custom_tag || '', data.campus || '', data.sort_order || 0, data.status === undefined ? 1 : data.status]
    )
    await audit(req, 'groupchat.group.create', 'group_chat', result.insertId, { name: data.name })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateGroup = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid group id')
  const { data, error } = validateGroupPayload(req.body || {}, { partial: true })
  if (error) return fail(res, error)
  if (!Object.keys(data).length) return fail(res, '没有需要更新的内容')
  try {
    const [result] = await pool.query('UPDATE group_chat SET ? WHERE id = ? AND deleted = 0', [data, id])
    if (!result.affectedRows) return fail(res, '群聊不存在', 404)
    await audit(req, 'groupchat.group.update', 'group_chat', id, data)
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.deleteGroup = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid group id')
  try {
    const [result] = await pool.query('UPDATE group_chat SET deleted = 1, status = 0 WHERE id = ? AND deleted = 0', [id])
    if (!result.affectedRows) return fail(res, '群聊不存在', 404)
    await audit(req, 'groupchat.group.delete', 'group_chat', id, {})
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
