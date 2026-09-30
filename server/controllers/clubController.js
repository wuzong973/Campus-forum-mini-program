const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')
const { normalizeLegacyAvatarUrl } = require('../utils/defaultProfile')

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
// 申请单图片地址：仅接受 https（与群聊申请一致）
const HTTPS_URL = /^https:\/\/\S{1,500}$/i
// 图片介绍上限（用户申请与管理端共用）
const MAX_APPLY_IMAGES = 5
// 校区取值（与用户端 utils/campus.js 保持一致）；'' = 全部校区
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

// mysql2 会把 DATETIME 解析成 Date，res.json 再序列化成 UTC ISO 串（…T12:14:37.000Z），
// 小程序端按 'YYYY-MM-DD HH:mm:ss' 裁剪显示会差 8 小时。
// 统一转回服务器本地时区的 DATETIME 字符串（与页面 fmtDateTime 的约定一致）；字符串原样透传。
function toDateTimeText(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) {
    const pad = (n) => (n < 10 ? '0' : '') + n
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate())
      + ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes()) + ':' + pad(value.getSeconds())
  }
  return String(value)
}

function optionalUrl(value, max = 512) {
  if (value === undefined) return undefined
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !HTTPS_URL.test(value.trim())) return null
  return value.trim()
}

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 50)
  return { page, pageSize, offset: (page - 1) * pageSize }
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
    status: Number(row.status),
    // 分类下的社团明细：公开接口据此在用户端「社团&组织」页展示各分类的重点社团；
    // 管理端会自行覆盖为含停用社团的完整列表
    clubs: Array.isArray(clubs) ? clubs : []
  }
}

// withMedia = true 时（仅管理端）额外带出申请单媒体字段（头像/二维码/图片介绍）；
// 公开接口保持原有字段契约不变，避免用户端响应膨胀
async function loadClubsByCategory(categoryIds, onlyEnabled, campus, withMedia) {
  if (!categoryIds.length) return {}
  const placeholders = categoryIds.map(() => '?').join(',')
  const matchValues = campusMatchValues(campus)
  const params = categoryIds.slice()
  let sql
  if (withMedia) {
    const extra = onlyEnabled ? ' AND c.status = 1' : ''
    const campusClause = matchValues ? ' AND (c.campus IN (' + matchValues.map(() => '?').join(',') + ') OR c.campus = \'\')' : ''
    if (campusClause) params.push.apply(params, matchValues)
    sql = `SELECT c.id, c.category_id, c.name, c.tags, c.intro, c.recruit, c.campus, c.sort_order, c.status,
                  a.club_type, a.avatar_url, a.qrcode_url, a.admin_qrcode_url, a.gzh_qrcode_url, a.images
           FROM club c
           LEFT JOIN club_apply a ON a.id = c.apply_id
           WHERE c.deleted = 0 AND c.category_id IN (${placeholders})${extra}${campusClause}
           ORDER BY c.sort_order ASC, c.id ASC`
  } else {
    const extra = onlyEnabled ? ' AND status = 1' : ''
    const campusClause = matchValues ? ' AND (campus IN (' + matchValues.map(() => '?').join(',') + ') OR campus = \'\')' : ''
    if (campusClause) params.push.apply(params, matchValues)
    sql = `SELECT id, category_id, name, tags, intro, recruit, campus, sort_order, status,
                  (SELECT a.avatar_url FROM club_apply a WHERE a.id = club.apply_id LIMIT 1) AS avatar_url
           FROM club WHERE deleted = 0 AND category_id IN (${placeholders})${extra}${campusClause}
           ORDER BY sort_order ASC, id ASC`
  }
  const [rows] = await pool.query(sql, params)
  const grouped = {}
  for (const row of rows) {
    if (!grouped[row.category_id]) grouped[row.category_id] = []
    const club = {
      id: row.id,
      name: row.name,
      tags: row.tags || '',
      intro: row.intro || '',
      recruit: row.recruit || '',
      campus: row.campus || '',
      // 申请单媒体字段：申请人上传/更换后，分类页与管理端编辑页无需任何手动操作即可同步展示
      clubType: row.club_type || '学生社团',
      avatarUrl: row.avatar_url || '',
      qrcodeUrl: row.qrcode_url || '',
      adminQrcodeUrl: row.admin_qrcode_url || '',
      gzhQrcodeUrl: row.gzh_qrcode_url || '',
      images: parseMaybeJson(row.images, []),
      sortOrder: row.sort_order || 0,
      status: Number(row.status)
    }
    if (withMedia) {
      // 申请单媒体字段：申请人上传/更换后，管理端编辑页无需任何手动操作即可同步展示
      club.clubType = row.club_type || '学生社团'
      club.qrcodeUrl = row.qrcode_url || ''
      club.adminQrcodeUrl = row.admin_qrcode_url || ''
      club.gzhQrcodeUrl = row.gzh_qrcode_url || ''
      club.images = parseMaybeJson(row.images, [])
    }
    grouped[row.category_id].push(club)
  }
  return grouped
}

// 公开接口：前台社团&组织页数据源（含各分类下的社团列表，支持按校区筛选，'' = 全部校区）
exports.listCategories = async (req, res) => {
  try {
    const campus = String(req.query.campus || '').trim()
    const [rows] = await pool.query(
      'SELECT * FROM club_category WHERE deleted = 0 AND status = 1 ORDER BY sort_order ASC, id ASC'
    )
    const grouped = await loadClubsByCategory(rows.map((r) => r.id), true, campus)
    success(res, { list: rows.map((row) => mapCategoryRow(row, grouped[row.id] || [])) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 公开接口：单个社团详情（用户端从分类页点进某个社团）
// 按社团唯一标识（id）匹配；不存在 / 已下架（status=0）/ 已删除（deleted=1）一律 404，
// 前端据此回退并提示，避免把「已下线社团」当成正常数据渲染。
//
// 展示字段与「申请创建社团」页保持一致（club 表没有媒体列，头像/二维码/图片介绍只存在
// club_apply，因此 LEFT JOIN 申请单带出，字段命名与 mapApplyRow 统一）：
//   club.clubType / avatarUrl / qrcodeUrl / adminQrcodeUrl(负责人微信) / gzhQrcodeUrl / images(图片介绍)
//
// 「成员」与「近期活动」由现有数据推导（不额外建表，见方案确认）：
//   成员   = 发起人（club_apply.user_id，负责人）+ 审核管理员（club_apply.reviewed_by）
//   近期活动 = 该社团发起人发布、已审核通过且未下线的校园活动
// 管理端手工创建（createClub）的社团没有 apply_id，此时发起人缺失 → 成员/活动返回空数组。
exports.detail = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '社团不存在或已下线', 404)
  try {
    const [rows] = await pool.query(
      `SELECT c.*, cat.name AS category_name, cat.slug AS category_slug, cat.color AS category_color,
              a.club_type, a.created_at AS applied_at, a.reviewed_at AS approved_at, a.review_note,
              a.avatar_url, a.qrcode_url, a.admin_qrcode_url, a.gzh_qrcode_url, a.images,
              a.user_id AS creator_id, a.reviewed_by AS reviewer_id
       FROM club c
       LEFT JOIN club_category cat ON cat.id = c.category_id AND cat.deleted = 0
       LEFT JOIN club_apply a ON a.id = c.apply_id
       WHERE c.id = ? AND c.deleted = 0 AND c.status = 1
       LIMIT 1`,
      [id]
    )
    if (!rows.length) return fail(res, '社团不存在或已下线', 404)
    const row = rows[0]

    // 只取展示必需的公开字段，绝不带出 phone / openid / real_name 等敏感信息
    const userIds = [row.creator_id, row.reviewer_id]
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
    const uniqueIds = Array.from(new Set(userIds))
    const userMap = {}
    if (uniqueIds.length) {
      const [users] = await pool.query(
        `SELECT id, nick_name, avatar_url FROM sys_user WHERE id IN (${uniqueIds.map(() => '?').join(',')})`,
        uniqueIds
      )
      for (const user of users) userMap[user.id] = user
    }
    const toMember = (userId, role) => {
      const user = userMap[Number(userId)]
      if (!user) return null
      return {
        userId: user.id,
        nickName: user.nick_name || '校园用户',
        avatarUrl: normalizeLegacyAvatarUrl(user.avatar_url || ''),
        role
      }
    }

    const members = []
    const creatorMember = toMember(row.creator_id, '负责人')
    if (creatorMember) members.push(creatorMember)
    const reviewerMember = toMember(row.reviewer_id, '审核管理员')
    // 同一人既发起又审核时只保留一条，避免成员列表出现重复行
    if (reviewerMember && (!creatorMember || reviewerMember.userId !== creatorMember.userId)) members.push(reviewerMember)

    let activities = []
    if (creatorMember) {
      const [acts] = await pool.query(
        `SELECT a.id, a.title, a.activity_start, a.activity_end, a.location, a.campus,
                a.cover_url, a.capacity,
                (SELECT COUNT(*) FROM activity_signup s WHERE s.activity_id = a.id) AS signup_count
         FROM campus_activity a
         WHERE a.user_id = ? AND a.deleted = 0 AND a.status = 1 AND a.audit_status = 'approved'
         ORDER BY (a.activity_start IS NULL) ASC, a.activity_start DESC, a.id DESC
         LIMIT 5`,
        [creatorMember.userId]
      )
      activities = acts.map((act) => ({
        id: act.id,
        title: act.title || '',
        activityStart: toDateTimeText(act.activity_start),
        activityEnd: toDateTimeText(act.activity_end),
        location: act.location || '',
        campus: act.campus || '',
        coverUrl: act.cover_url || '',
        capacity: Number(act.capacity || 0),
        signupCount: Number(act.signup_count || 0)
      }))
    }

    success(res, {
      club: {
        id: row.id,
        name: row.name || '',
        tags: row.tags || '',
        intro: row.intro || '',
        recruit: row.recruit || '',
        campus: row.campus || '',
        // 以下字段与「申请创建社团」页 / club_apply.mapApplyRow 命名保持一致
        clubType: row.club_type || '学生社团',
        avatarUrl: row.avatar_url || '',
        qrcodeUrl: row.qrcode_url || '',
        adminQrcodeUrl: row.admin_qrcode_url || '',
        gzhQrcodeUrl: row.gzh_qrcode_url || '',
        images: parseMaybeJson(row.images, []),
        categoryId: row.category_id,
        categoryName: row.category_name || '',
        categorySlug: row.category_slug || '',
        categoryColor: row.category_color || '#2E6BFF',
        status: Number(row.status),
        createdAt: toDateTimeText(row.created_at),
        updatedAt: toDateTimeText(row.updated_at)
      },
      creation: {
        appliedAt: toDateTimeText(row.applied_at),
        approvedAt: toDateTimeText(row.approved_at),
        reviewNote: row.review_note || '',
        creator: creatorMember,
        reviewer: reviewerMember
      },
      members,
      activities
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 社团申请（用户端提交 → 管理端审核 → 通过后落到 club 表） =====

function mapApplyRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nickName: row.nick_name || '',
    // 申请人信息：管理端审核列表/详情用（用户端 myApplies 无 JOIN 时为空）
    creatorAvatar: row.user_avatar || '',
    creatorPhone: row.user_phone || '',
    clubType: row.club_type || '学生社团',
    categoryId: row.category_id || null,
    categoryName: row.category_name || '',
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
    createdAt: row.created_at,
    // 关联社团：myApplies 查询 LEFT JOIN club 带出，客户端据此为已通过的申请展示「查看社团」
    clubId: row.club_id || null,
    clubStatus: row.club_status === undefined || row.club_status === null ? null : Number(row.club_status)
  }
}

// 提交社团申请（需登录）：分类取服务端「社团分类」，通过后归属该分类
exports.submitApply = async (req, res) => {
  const body = req.body || {}
  const categoryId = intId(body.categoryId)
  const campus = optionalText(body.campus, 16) || ''
  const name = optionalText(body.name, 64)
  const intro = optionalText(body.intro, 1000)
  const avatarUrl = optionalUrl(body.avatarUrl)
  const qrcodeUrl = optionalUrl(body.qrcodeUrl)
  const adminQrcodeUrl = optionalUrl(body.adminQrcodeUrl)
  const gzhQrcodeUrl = optionalUrl(body.gzhQrcodeUrl)
  if (!categoryId) return fail(res, '请选择社团分类')
  if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return fail(res, '校区取值不正确')
  if (!name) return fail(res, '请填写社团名称')
  if (avatarUrl === null || qrcodeUrl === null || adminQrcodeUrl === null || gzhQrcodeUrl === null) {
    return fail(res, '图片地址不合法')
  }
  if (!avatarUrl) return fail(res, '请上传社团头像')
  if (!qrcodeUrl) return fail(res, '请上传社团二维码')
  if (!adminQrcodeUrl) return fail(res, '请上传负责人微信二维码')
  if (!intro) return fail(res, '请填写文字介绍')
  let images = []
  if (body.images !== undefined) {
    images = parseMaybeJson(body.images, [])
    const valid = Array.isArray(images) && images.every((url) => typeof url === 'string' && HTTPS_URL.test(url))
    if (!valid) return fail(res, '图片介绍地址不合法')
    images = images.slice(0, MAX_APPLY_IMAGES)
  }
  try {
    const [categories] = await pool.query(
      'SELECT id, name FROM club_category WHERE id = ? AND deleted = 0 LIMIT 1',
      [categoryId]
    )
    if (!categories.length) return fail(res, '所选社团分类不存在', 404)
    const [pending] = await pool.query(
      "SELECT id FROM club_apply WHERE user_id = ? AND name = ? AND status = 'pending' LIMIT 1",
      [req.userId, name]
    )
    if (pending.length) return fail(res, '你已提交过同名社团申请，请等待管理员审核')
    const [result] = await pool.query(
      `INSERT INTO club_apply (user_id, club_type, category_id, category_name, campus, name, intro,
                               avatar_url, qrcode_url, admin_qrcode_url, gzh_qrcode_url, images)
       VALUES (?, '学生社团', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, categoryId, categories[0].name || '', campus, name, intro,
       avatarUrl, qrcodeUrl, adminQrcodeUrl, gzhQrcodeUrl, images.length ? JSON.stringify(images) : null]
    )
    success(res, { id: result.insertId, status: 'pending' })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 我的社团申请（需登录）：展示审核进度与审核意见；已通过且已上架时带出 club_id
exports.myApplies = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, c.id AS club_id, c.status AS club_status
       FROM club_apply a
       LEFT JOIN club c ON c.apply_id = a.id AND c.deleted = 0
       WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 50`,
      [req.userId]
    )
    success(res, { list: rows.map(mapApplyRow) })
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
  if (body.campus !== undefined) {
    const campus = optionalText(body.campus, 16) || ''
    if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return { error: '校区取值不正确' }
    data.campus = campus
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isInteger(sortOrder)) return { error: '排序值需为整数' }
    data.sort_order = sortOrder
  }
  if (body.status !== undefined) data.status = Number(body.status) ? 1 : 0
  return { data }
}

// 社团媒体字段（头像/二维码/图片介绍）存 club_apply；管理端编辑/创建时随表单一起提交
const CLUB_MEDIA_FIELDS = {
  avatarUrl: 'avatar_url',
  qrcodeUrl: 'qrcode_url',
  adminQrcodeUrl: 'admin_qrcode_url',
  gzhQrcodeUrl: 'gzh_qrcode_url'
}

function extractApplyMedia(body) {
  const data = {}
  if (body.clubType !== undefined) {
    const clubType = optionalText(body.clubType, 32)
    if (clubType === null) return { error: '社团类型需在 32 字以内' }
    data.club_type = clubType || '学生社团'
  }
  for (const [field, column] of Object.entries(CLUB_MEDIA_FIELDS)) {
    if (body[field] !== undefined) {
      const url = optionalUrl(body[field])
      if (url === null) return { error: '图片地址不合法' }
      data[column] = url
    }
  }
  if (body.images !== undefined) {
    const images = parseMaybeJson(body.images, null)
    const valid = Array.isArray(images) && images.every((url) => typeof url === 'string' && HTTPS_URL.test(url))
    if (!valid) return { error: '图片介绍地址不合法' }
    data.images = JSON.stringify(images.slice(0, MAX_APPLY_IMAGES))
  }
  return { data }
}

exports.createClub = async (req, res) => {
  const categoryId = intId((req.body || {}).categoryId)
  if (!categoryId) return fail(res, '请选择所属分类')
  const { data, error } = validateClubPayload(req.body || {})
  if (error) return fail(res, error)
  const media = extractApplyMedia(req.body || {})
  if (media.error) return fail(res, media.error)
  try {
    const [categories] = await pool.query('SELECT id FROM club_category WHERE id = ? AND deleted = 0 LIMIT 1', [categoryId])
    if (!categories.length) return fail(res, '所属分类不存在', 404)
    const [result] = await pool.query(
      `INSERT INTO club (category_id, name, tags, intro, recruit, campus, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
       [categoryId, data.name, data.tags || '', data.intro || '', data.recruit || '',
       data.campus || '', data.sort_order || 0, data.status === undefined ? 1 : data.status]
    )
    // 手动创建时若带媒体字段：落一份 club_apply（与申请创建的社团同构），保证详情页/编辑页能读到
    if (Object.keys(media.data).length) {
      const [applyResult] = await pool.query(
        `INSERT INTO club_apply (user_id, club_type, category_id, category_name, campus, name, intro,
                                 avatar_url, qrcode_url, admin_qrcode_url, gzh_qrcode_url, images, status, reviewed_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW())`,
        [req.userId, media.data.club_type || '学生社团', categoryId, categories[0].name || '', data.campus || '',
         data.name, data.intro || '', media.data.avatar_url || null, media.data.qrcode_url || null,
         media.data.admin_qrcode_url || null, media.data.gzh_qrcode_url || null, media.data.images || null, req.userId]
      )
      await pool.query('UPDATE club SET apply_id = ? WHERE id = ?', [applyResult.insertId, result.insertId])
    }
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
  const media = extractApplyMedia(payload)
  if (media.error) return fail(res, media.error)
  if (!Object.keys(data).length && !Object.keys(media.data).length) return fail(res, '没有需要更新的内容')
  try {
    if (data.category_id) {
      const [categories] = await pool.query('SELECT id FROM club_category WHERE id = ? AND deleted = 0 LIMIT 1', [data.category_id])
      if (!categories.length) return fail(res, '所属分类不存在', 404)
    }
    if (Object.keys(data).length) {
      const [result] = await pool.query('UPDATE club SET ? WHERE id = ? AND deleted = 0', [data, id])
      if (!result.affectedRows) return fail(res, '社团不存在', 404)
    } else {
      const [rows] = await pool.query('SELECT id FROM club WHERE id = ? AND deleted = 0 LIMIT 1', [id])
      if (!rows.length) return fail(res, '社团不存在', 404)
    }
    // 媒体字段落 club_apply：申请创建的社团直接更新关联申请单；
    // 手动创建且无申请单的社团暂无落库位置，忽略（不影响基础信息保存）
    if (Object.keys(media.data).length) {
      const [rows] = await pool.query('SELECT apply_id FROM club WHERE id = ? LIMIT 1', [id])
      const applyId = intId((rows[0] || {}).apply_id)
      if (applyId) {
        await pool.query('UPDATE club_apply SET ? WHERE id = ?', [media.data, applyId])
      }
    }
    await audit(req, 'club.club.update', 'club', id, Object.assign({}, data, media.data))
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

// ===== 管理端：社团审核 =====

// 申请列表：带出申请人昵称/头像/手机号（手机号等敏感字段仅管理端返回），支持状态筛选与关键词搜索
exports.adminListApplies = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  const allowed = ['', 'pending', 'approved', 'rejected']
  if (!allowed.includes(status)) return fail(res, 'Invalid apply status')
  let where = 'WHERE 1 = 1'
  const params = []
  if (status) { where += ' AND a.status = ?'; params.push(status) }
  if (keyword) {
    where += ' AND (a.name LIKE ? OR a.category_name LIKE ? OR u.nick_name LIKE ?)'
    const q = '%' + keyword + '%'
    params.push(q, q, q)
  }
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM club_apply a LEFT JOIN sys_user u ON u.id = a.user_id ${where}`, params),
      pool.query(
        `SELECT a.*, u.nick_name, u.avatar_url AS user_avatar, u.phone AS user_phone
         FROM club_apply a LEFT JOIN sys_user u ON u.id = a.user_id ${where}
         ORDER BY FIELD(a.status, 'pending', 'approved', 'rejected'), a.created_at DESC
         LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    success(res, {
      list: list.map(mapApplyRow),
      total: Number(count[0].total || 0),
      page,
      hasMore: offset + list.length < Number(count[0].total || 0)
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 审核：通过时在所属分类下上架社团（用户端「社团&组织」页实时可见），驳回时下架关联社团，支持改判
exports.reviewApply = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  const action = String(body.action || '').trim()
  const note = optionalText(body.note, 255)
  if (!id || !['approve', 'reject'].includes(action)) return fail(res, 'Invalid review action')
  if (action === 'reject' && !note) return fail(res, '驳回时请填写审核意见')
  try {
    const [applies] = await pool.query('SELECT * FROM club_apply WHERE id = ? LIMIT 1', [id])
    if (!applies.length) return fail(res, '申请不存在', 404)
    const apply = applies[0]
    // 通过前先校验归属分类仍可用，避免申请已标记通过却无处上架
    if (action === 'approve') {
      if (!apply.category_id) return fail(res, '该申请未选择社团分类，无法通过')
      const [categories] = await pool.query('SELECT id FROM club_category WHERE id = ? AND deleted = 0 LIMIT 1', [apply.category_id])
      if (!categories.length) return fail(res, '所属分类已被删除，请先恢复分类并通过', 400)
    }
    const status = action === 'approve' ? 'approved' : 'rejected'
    await pool.query(
      'UPDATE club_apply SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [status, note || '', req.userId, id]
    )
    if (action === 'approve') {
      // 同一申请重复通过时刷新已有社团，而不是重复上架
      const [existing] = await pool.query('SELECT id FROM club WHERE apply_id = ? AND deleted = 0 LIMIT 1', [id])
      const intro = String(apply.intro || '').slice(0, 1000)
      if (existing.length) {
        await pool.query(
          'UPDATE club SET category_id = ?, name = ?, intro = ?, campus = ?, status = 1, deleted = 0 WHERE id = ?',
          [apply.category_id, apply.name, intro, apply.campus || '', existing[0].id]
        )
      } else {
        await pool.query(
          `INSERT INTO club (apply_id, category_id, name, tags, intro, recruit, campus, sort_order, status)
           VALUES (?, ?, ?, '', ?, '', ?, 0, 1)`,
          [id, apply.category_id, apply.name, intro, apply.campus || '']
        )
      }
    } else {
      await pool.query('UPDATE club SET status = 0 WHERE apply_id = ? AND deleted = 0', [id])
    }
    await audit(req, action === 'approve' ? 'club.apply.approve' : 'club.apply.reject', 'club_apply', id, { note: note || '', name: apply.name })
    success(res, { id, status })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
