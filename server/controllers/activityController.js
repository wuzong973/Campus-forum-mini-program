const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')

const HTTPS_URL = /^https:\/\/\S{1,500}$/i
const MAX_IMAGES = 9
// 'YYYY-MM-DD HH:mm' 或带秒
const DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/
// 校区两级结构（与用户端 utils/campus.js 保持一致）；'' = 全部校区
const CAMPUS_MAIN_MAP = {
  '广州校区': ['新港校区', '琶洲校区'],
  '佛山校区': ['南海南校区', '南海北校区']
}
const CAMPUS_VALUES = Object.keys(CAMPUS_MAIN_MAP).concat(
  Object.keys(CAMPUS_MAIN_MAP).reduce((arr, key) => arr.concat(CAMPUS_MAIN_MAP[key]), [])
)

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

async function audit(req, action, targetType, targetId, detail) {
  try {
    await writeAdminAudit(req, action, targetType, targetId, detail)
  } catch (e) {
    console.error('[admin-audit]', e.message)
  }
}

function mapActivityRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title || '',
    signupStart: row.signup_start || '',
    signupEnd: row.signup_end || '',
    activityStart: row.activity_start || '',
    activityEnd: row.activity_end || '',
    location: row.location || '',
    address: row.address || '',
    campus: row.campus || '',
    coverUrl: row.cover_url || '',
    images: parseMaybeJson(row.images, []),
    detailTitle: row.detail_title || '',
    detailContent: row.detail_content || '',
    signupTitle: row.signup_title || '立即报名',
    signupContent: row.signup_content || '',
    signupImage: row.signup_image || '',
    capacity: Number(row.capacity || 0),
    status: Number(row.status),
    createdAt: row.created_at
  }
}

// 活动状态徽标：已结束 / 报名未开始 / 报名中
function computeBadge(row) {
  const now = Date.now()
  const t = (v) => {
    if (!v) return null
    const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'))
    return isNaN(d.getTime()) ? null : d.getTime()
  }
  const signupStart = t(row.signup_start)
  const signupEnd = t(row.signup_end)
  const activityEnd = t(row.activity_end)
  if (activityEnd !== null) {
    if (now > activityEnd) return 'ended'
  } else if (signupEnd !== null && now > signupEnd) {
    return 'ended'
  }
  if (signupStart !== null && now < signupStart) return 'notStarted'
  return 'signing'
}

async function countSignups(activityIds) {
  if (!activityIds.length) return {}
  const placeholders = activityIds.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT activity_id, COUNT(*) c FROM activity_signup WHERE activity_id IN (${placeholders}) GROUP BY activity_id`,
    activityIds
  )
  const map = {}
  for (const row of rows) map[row.activity_id] = Number(row.c)
  return map
}

function decorate(row, countMap, joined) {
  const base = mapActivityRow(row)
  const signupCount = countMap[base.id] || 0
  return Object.assign(base, {
    badge: computeBadge(row),
    signupCount,
    remaining: base.capacity > 0 ? Math.max(base.capacity - signupCount, 0) : null,
    joined: !!joined
  })
}

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 50)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function validateActivityPayload(body, { partial, requireCover } = {}) {
  const data = {}
  const title = optionalText(body.title, 64)
  if (title === null || (!partial && !title)) return { error: '活动标题需为 1-64 个字符' }
  if (title !== undefined) data.title = title

  const timeFields = [
    ['signupStart', 'signup_start', '报名时间'],
    ['signupEnd', 'signup_end', '报名截止时间'],
    ['activityStart', 'activity_start', '活动开始时间'],
    ['activityEnd', 'activity_end', '活动结束时间']
  ]
  for (const [camel, snake, label] of timeFields) {
    if (body[camel] === undefined) continue
    const value = optionalText(body[camel], 19)
    if (value === null) return { error: label + '格式不正确' }
    if (!value) data[snake] = null
    else if (!DT_RE.test(value)) return { error: label + '需为 YYYY-MM-DD HH:mm 格式' }
    else data[snake] = value
  }

  if (body.location !== undefined) {
    const location = optionalText(body.location, 64)
    if (location === null) return { error: '活动位置需在 64 字以内' }
    data.location = location
  }
  if (body.address !== undefined) {
    const address = optionalText(body.address, 255)
    if (address === null) return { error: '详细地址需在 255 字以内' }
    data.address = address
  }
  if (body.campus !== undefined) {
    const campus = optionalText(body.campus, 16) || ''
    if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return { error: '校区取值不正确' }
    data.campus = campus
  }
  if (body.coverUrl !== undefined) {
    const coverUrl = optionalUrl(body.coverUrl)
    if (coverUrl === null) return { error: '封面图片地址不合法' }
    if (!coverUrl && requireCover) return { error: '请上传封面图片' }
    data.cover_url = coverUrl
  } else if (requireCover && !optionalText(body.coverUrl, 512)) {
    return { error: '请上传封面图片' }
  }
  if (body.images !== undefined) {
    const images = parseMaybeJson(body.images, [])
    const valid = Array.isArray(images) && images.every((url) => typeof url === 'string' && HTTPS_URL.test(url))
    if (!valid) return { error: '详细图片地址不合法' }
    data.images = images.length ? JSON.stringify(images.slice(0, MAX_IMAGES)) : null
  }
  if (body.detailTitle !== undefined) {
    const detailTitle = optionalText(body.detailTitle, 64)
    if (detailTitle === null) return { error: '详细介绍标题需在 64 字以内' }
    data.detail_title = detailTitle
  }
  if (body.detailContent !== undefined) {
    const detailContent = optionalText(body.detailContent, 5000)
    if (detailContent === null) return { error: '详细介绍内容需在 5000 字以内' }
    data.detail_content = detailContent
  }
  if (body.signupTitle !== undefined) {
    const signupTitle = optionalText(body.signupTitle, 16)
    if (signupTitle === null) return { error: '报名按钮标题需在 16 字以内' }
    data.signup_title = signupTitle || '立即报名'
  }
  if (body.signupContent !== undefined) {
    const signupContent = optionalText(body.signupContent, 255)
    if (signupContent === null) return { error: '报名提示内容需在 255 字以内' }
    data.signup_content = signupContent
  }
  if (body.signupImage !== undefined) {
    const signupImage = optionalUrl(body.signupImage)
    if (signupImage === null) return { error: '报名图片地址不合法' }
    data.signup_image = signupImage
  }
  if (body.capacity !== undefined) {
    const capacity = Number(body.capacity)
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100000) return { error: '报名名额需为 0-100000 的整数（0 为不限）' }
    data.capacity = capacity
  }
  if (body.status !== undefined) data.status = Number(body.status) ? 1 : 0
  return { data }
}

// ===== 用户端接口 =====

// 公开列表：tab = all 全部 / signing 报名中 / mine 我的参与（需登录）
exports.list = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const tab = ['all', 'signing', 'mine'].indexOf(String(req.query.tab || 'all')) >= 0
    ? String(req.query.tab || 'all') : 'all'
  try {
    let joinSql = ''
    let where = 'WHERE a.deleted = 0 AND a.status = 1'
    // 注意：SQL 中 JOIN 占位符先于 WHERE 占位符，参数必须按 joinParams → whereParams 顺序拼接
    const joinParams = []
    const whereParams = []
    let orderSql = 'a.created_at DESC'
    // 校区筛选：'' = 全部校区（所有校区可见）；主校区含其分校区
    const campus = String(req.query.campus || '').trim()
    const campusMatch = campus && CAMPUS_MAIN_MAP[campus]
      ? [campus].concat(CAMPUS_MAIN_MAP[campus])
      : (CAMPUS_VALUES.indexOf(campus) >= 0 ? [campus] : null)
    if (campusMatch) {
      where += ' AND (a.campus IN (' + campusMatch.map(() => '?').join(',') + ') OR a.campus = \'\')'
      whereParams.push.apply(whereParams, campusMatch)
    }
    // 报名中：与 computeBadge 判定一致（未结束且已开始报名）
    if (tab === 'signing') {
      where += ' AND ((a.activity_end IS NOT NULL AND a.activity_end > NOW()) OR (a.activity_end IS NULL AND (a.signup_end IS NULL OR a.signup_end > NOW())))'
      where += ' AND (a.signup_start IS NULL OR a.signup_start <= NOW())'
    }
    if (tab === 'mine') {
      if (!req.userId) return fail(res, 'Not logged in', 401)
      joinSql = 'INNER JOIN activity_signup s ON s.activity_id = a.id AND s.user_id = ?'
      joinParams.push(req.userId)
      orderSql = 's.created_at DESC'
    }
    const params = joinParams.concat(whereParams)
    const [[count], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM campus_activity a ${joinSql} ${where}`, params),
      pool.query(
        `SELECT a.* FROM campus_activity a ${joinSql} ${where} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    const total = Number(count[0].total || 0)
    const countMap = await countSignups(rows.map((r) => r.id))
    let joinedSet = new Set()
    if (tab === 'mine' && rows.length) {
      joinedSet = new Set(rows.map((r) => r.id))
    }
    success(res, {
      list: rows.map((row) => decorate(row, countMap, joinedSet.has(row.id))),
      total, page,
      hasMore: offset + rows.length < total
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 公开详情：登录用户附带报名状态
exports.detail = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid activity id')
  try {
    const [rows] = await pool.query(
      'SELECT * FROM campus_activity WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!rows.length) return fail(res, '活动不存在或已下架', 404)
    const countMap = await countSignups([id])
    let joined = false
    if (req.userId) {
      const [signed] = await pool.query(
        'SELECT id FROM activity_signup WHERE activity_id = ? AND user_id = ? LIMIT 1',
        [id, req.userId]
      )
      joined = signed.length > 0
    }
    const activity = decorate(rows[0], countMap, joined)
    activity.isOwner = !!req.userId && Number(rows[0].user_id) === Number(req.userId)
    success(res, { activity })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 发布活动（需登录）
exports.create = async (req, res) => {
  const { data, error } = validateActivityPayload(req.body || {}, { requireCover: true })
  if (error) return fail(res, error)
  try {
    const [result] = await pool.query(
      `INSERT INTO campus_activity
        (user_id, title, signup_start, signup_end, activity_start, activity_end, location, address, campus,
         cover_url, images, detail_title, detail_content, signup_title, signup_content, signup_image, capacity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [req.userId, data.title, data.signup_start || null, data.signup_end || null,
       data.activity_start || null, data.activity_end || null, data.location || '', data.address || '', data.campus || '',
       data.cover_url || '', data.images || null, data.detail_title || '', data.detail_content || '',
       data.signup_title || '立即报名', data.signup_content || '', data.signup_image || '', data.capacity || 0]
    )
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 报名（需登录）：校验时间窗与名额
exports.signup = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid activity id')
  try {
    const [rows] = await pool.query(
      'SELECT * FROM campus_activity WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!rows.length) return fail(res, '活动不存在或已下架', 404)
    const activity = rows[0]
    const badge = computeBadge(activity)
    if (badge === 'ended') return fail(res, '该活动报名已结束')
    if (badge === 'notStarted') return fail(res, '该活动报名尚未开始')
    const [signed] = await pool.query(
      'SELECT id FROM activity_signup WHERE activity_id = ? AND user_id = ? LIMIT 1',
      [id, req.userId]
    )
    if (signed.length) return fail(res, '你已报名该活动')
    if (Number(activity.capacity) > 0) {
      const countMap = await countSignups([id])
      if ((countMap[id] || 0) >= Number(activity.capacity)) return fail(res, '名额已满')
    }
    const [result] = await pool.query(
      'INSERT IGNORE INTO activity_signup (activity_id, user_id) VALUES (?, ?)',
      [id, req.userId]
    )
    if (!result.affectedRows) return fail(res, '你已报名该活动')
    const countMap = await countSignups([id])
    const signupCount = countMap[id] || 0
    success(res, {
      joined: true,
      signupCount,
      remaining: Number(activity.capacity) > 0 ? Math.max(Number(activity.capacity) - signupCount, 0) : null
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 管理端接口（挂在 /admin 路由下，需 content.manage 权限） =====

exports.adminList = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  let where = 'WHERE a.deleted = 0'
  const params = []
  if (keyword) { where += ' AND (a.title LIKE ? OR a.location LIKE ? OR u.nick_name LIKE ?)'; const q = '%' + keyword + '%'; params.push(q, q, q) }
  try {
    const [[count], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM campus_activity a LEFT JOIN sys_user u ON u.id = a.user_id ${where}`, params),
      pool.query(
        `SELECT a.*, u.nick_name, u.avatar_url, u.phone FROM campus_activity a
         LEFT JOIN sys_user u ON u.id = a.user_id ${where}
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    const total = Number(count[0].total || 0)
    const countMap = await countSignups(rows.map((r) => r.id))
    const list = rows.map((row) => {
      const item = decorate(row, countMap, false)
      item.nickName = row.nick_name || ''
      // 发起人信息（管理端展示用）：头像、昵称、手机号
      item.initiator = {
        userId: row.user_id,
        nickName: row.nick_name || '',
        avatarUrl: row.avatar_url || '',
        phone: row.phone || ''
      }
      return item
    })
    success(res, { list, total, page, hasMore: offset + rows.length < total })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminUpdate = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid activity id')
  const { data, error } = validateActivityPayload(req.body || {}, { partial: true })
  if (error) return fail(res, error)
  if (!Object.keys(data).length) return fail(res, '没有需要更新的内容')
  try {
    const [result] = await pool.query('UPDATE campus_activity SET ? WHERE id = ? AND deleted = 0', [data, id])
    if (!result.affectedRows) return fail(res, '活动不存在', 404)
    await audit(req, 'activity.update', 'campus_activity', id, Object.assign({ fields: Object.keys(data) }, data.title ? { name: data.title } : {}))
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminDelete = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid activity id')
  try {
    const [result] = await pool.query('UPDATE campus_activity SET deleted = 1, status = 0 WHERE id = ? AND deleted = 0', [id])
    if (!result.affectedRows) return fail(res, '活动不存在', 404)
    await audit(req, 'activity.delete', 'campus_activity', id, {})
    success(res, { id })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
