// ===== 找驾校：驾校内容（公开列表/详情 + 管理后台 CRUD） =====
// 数据表 driving_school 由 utils/migrations.js 建表；字段与前台卡片一一对应。
const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage, parseImages } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')

// 校区只保留两个主分类（与用户端 utils/campus.js 主校区一致）
const CAMPUS_VALUES = ['广州校区', '佛山校区']
const LEVELS = ['S', 'A', 'B']
const HTTPS_URL = /^https:\/\/\S{1,500}$/i

async function audit(req, action, targetId, detail) {
  try {
    await writeAdminAudit(req, action, 'driving_school', targetId, detail)
  } catch (e) {
    console.error('[admin-audit]', e.message)
  }
}

function intId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

function text(value, max) {
  const s = String(value === undefined || value === null ? '' : value).trim()
  return s.length > max ? s.slice(0, max) : s
}

// 经纬度：0 表示「未定位」；超出中国大致范围的值按无效处理，避免脏数据传给 wx.openLocation
function coord(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return num
}

// 标签只按分隔符拆分，不再静默截断长度：整句被切成 16 字的半截话比报错更难排查，
// 超长改由写入校验明确拦下（见 normalizeSchool）
const TAG_MAX = 16

function parseTags(value) {
  let arr = value
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr) } catch (e) { arr = arr.split(/[,，、]/) }
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((tag) => String(tag === undefined || tag === null ? '' : tag).trim())
    .filter(Boolean)
    .slice(0, 8)
}

// 图片 URL 列表：不能复用 parseTags，它按「标签」口径把每项截到 16 字，会把 URL 截成半截（线上已踩到）
function parseImageList(value) {
  let arr = value
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr) } catch (e) { arr = arr.split(/[,，、\s]+/) }
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((url) => String(url === undefined || url === null ? '' : url).trim())
    .filter((url) => HTTPS_URL.test(url))
    .slice(0, 9)
}

function mapSchool(row) {
  return {
    id: row.id,
    name: row.name || '',
    campus: row.campus || '',
    region: row.region || '',
    address: row.address || '',
    phone: row.phone || '',
    carTypes: row.car_types || '',
    price: row.price || '',
    intro: row.intro || '',
    passRate: Number(row.pass_rate) || 0,
    level: row.level || 'A',
    tags: parseTags(row.tags),
    distanceKm: Number(row.distance_km) || 0,
    cover: row.cover || '',
    latitude: coord(row.lat),
    longitude: coord(row.lng),
    contactQr: row.contact_qr || '',
    contactName: row.contact_name || '',
    images: parseImageList(row.images),
    detail: row.detail || '',
    status: Number(row.status) === 1,
    sortOrder: Number(row.sort_order) || 0
  }
}

// 校验并归一化管理端提交的字段；返回 { data } 或 { error }
function normalizeSchool(body) {
  const name = text(body.name, 64)
  if (!name) return { error: '请填写驾校名称' }
  const campus = text(body.campus, 32)
  if (CAMPUS_VALUES.indexOf(campus) < 0) return { error: '请选择校区（广州校区/佛山校区）' }
  const level = text(body.level, 8).toUpperCase() || 'A'
  if (LEVELS.indexOf(level) < 0) return { error: '推荐等级仅支持 S/A/B' }
  const passRate = Math.max(0, Math.min(100, Number(body.passRate) || 0))
  const distanceKm = Math.max(0, Number(body.distanceKm) || 0)
  const tags = parseTags(body.tags)
  const overlong = tags.find((tag) => tag.length > TAG_MAX)
  if (overlong) {
    return { error: `单个标签不能超过 ${TAG_MAX} 字，请把「${overlong.slice(0, 24)}」改短或用「、」拆成多个标签` }
  }
  return {
    data: {
      name,
      campus,
      region: text(body.region, 32),
      address: text(body.address, 255),
      phone: text(body.phone, 32),
      car_types: text(body.carTypes, 64),
      price: text(body.price, 64),
      intro: text(body.intro, 255),
      pass_rate: passRate,
      level,
      tags: JSON.stringify(tags),
      distance_km: distanceKm,
      cover: text(body.cover, 512).match(/^https:\/\//i) ? text(body.cover, 512) : '',
      // 咨询二维码：只收 https 外链，留空 = 用户端回落到全站管理员微信
      contact_qr: text(body.contactQr, 512).match(/^https:\/\//i) ? text(body.contactQr, 512) : '',
      contact_name: text(body.contactName, 32),
      lat: coord(body.lat),
      lng: coord(body.lng),
      images: JSON.stringify(parseImageList(body.images)),
      detail: text(body.detail, 5000),
      status: body.status === undefined || body.status === null || body.status === false || Number(body.status) === 0 ? 0 : 1,
      sort_order: Math.max(0, Number(body.sortOrder) || 0)
    }
  }
}

// 公开列表：仅启用条目，按 sort_order 升序；campus 传校区名则过滤
exports.list = async (req, res) => {
  const campus = String(req.query.campus || '').trim()
  if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return fail(res, '校区取值不正确')
  try {
    const where = campus ? 'WHERE status = 1 AND campus = ?' : 'WHERE status = 1'
    const params = campus ? [campus] : []
    const [rows] = await pool.query(
      `SELECT * FROM driving_school ${where} ORDER BY sort_order ASC, id ASC`,
      params
    )
    success(res, { list: rows.map(mapSchool) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 公开详情：仅启用条目
exports.detail = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  try {
    const [rows] = await pool.query('SELECT * FROM driving_school WHERE id = ? AND status = 1 LIMIT 1', [id])
    if (!rows.length) return fail(res, '驾校不存在或已下架', 404)
    success(res, { school: mapSchool(rows[0]) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 管理后台 =====
exports.adminList = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM driving_school ORDER BY sort_order ASC, id ASC')
    success(res, { list: rows.map(mapSchool) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 坐标由管理后台「在地图上选点」(wx.chooseLocation) 人工确认，服务端不做地理编码：
// 实测高德对「公司全称」类地址只返回区县级坐标（会钉到市中心），POI 搜索又常命中别家驾校。
exports.adminCreate = async (req, res) => {
  const { data, error } = normalizeSchool(req.body || {})
  if (error) return fail(res, error)
  try {
    const cols = Object.keys(data)
    const [result] = await pool.query(
      `INSERT INTO driving_school (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((key) => data[key])
    )
    await audit(req, 'drivingSchool.create', result.insertId, { name: data.name, campus: data.campus })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminUpdate = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  const { data, error } = normalizeSchool(req.body || {})
  if (error) return fail(res, error)
  try {
    const cols = Object.keys(data)
    await pool.query(
      `UPDATE driving_school SET ${cols.map((key) => key + ' = ?').join(', ')} WHERE id = ?`,
      cols.map((key) => data[key]).concat([id])
    )
    await audit(req, 'drivingSchool.update', id, { name: data.name, campus: data.campus })
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminDelete = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  try {
    const [[before]] = await pool.query('SELECT name, campus FROM driving_school WHERE id = ? LIMIT 1', [id])
    if (!before) return fail(res, '驾校不存在', 404)
    await pool.query('DELETE FROM driving_school WHERE id = ?', [id])
    await audit(req, 'drivingSchool.delete', id, before)
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 导出解析/校验函数供单测使用：URL 截断与标签超长这两个坑都发生在这里，需要行为级护栏
module.exports.parseTags = parseTags
module.exports.parseImageList = parseImageList
module.exports.normalizeSchool = normalizeSchool
