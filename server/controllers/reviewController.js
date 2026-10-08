const pool = require('../config/pool')
const { success, fail, hasPermission } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')
// 评价评论对齐论坛评论规范：图片走媒体过滤，分身身份走素材池归一化，回复走 reply 通知
const { createNotification, withMediaPlaceholder } = require('../services/notificationService')
const mediaCheck = require('../services/mediaCheckService')
const { normalizeLegacyAvatarUrl, normalizeAnonymousAvatarUrl, isAnonymousAvatarUrl, pickAnonymousAvatar } = require('../utils/defaultProfile')

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch (e) { return null }
}

function parseAnonymousIdentity(identity) {
  const value = parseJson(identity)
  if (!value || !value.nickName || !value.avatarUrl) return null
  const nickName = String(value.nickName).trim().slice(0, 32)
  const raw = String(value.avatarUrl).trim()
  if (raw.indexOf('/assets/avatar1/') !== 0) return null
  // 旧文件名先纠正；纠正后仍不在素材池内的稳定映射到池内形象（与论坛评论同口径）
  const normalized = normalizeAnonymousAvatarUrl(raw)
  const avatarUrl = isAnonymousAvatarUrl(normalized) ? normalized : pickAnonymousAvatar(nickName || raw)
  return { nickName, avatarUrl }
}

// ===== 规则常量（与 utils/review.js 镜像；以这里为服务端最终校验口径） =====
const CATEGORIES = ['course', 'canteen', 'business']
// 食堂 / 商圈按校区区分；课程评价不区分校区。
// 两级校区模型（与 utils/campus.js / activityController 的 CAMPUS_MAIN_MAP 一致）：
// 主校区命中自身 + 全部分校区，分校区精确命中
const CAMPUS_MAIN_MAP = {
  '广州校区': ['新港校区', '琶洲校区'],
  '佛山校区': ['南海南校区', '南海北校区']
}
const CAMPUS_VALUES = Object.keys(CAMPUS_MAIN_MAP).concat(
  Object.keys(CAMPUS_MAIN_MAP).reduce((arr, key) => arr.concat(CAMPUS_MAIN_MAP[key]), [])
)
// 楼层（食堂 / 商圈子对象）：最多六层，与 utils/review.js 的 REVIEW_FLOORS 保持一致
const FLOORS = ['1层', '2层', '3层', '4层', '5层', '6层']
// 课程次导航：通识课为选修课，适用于专科/本科/专升本三类
const GENERAL_COURSE = '通识课'
const COURSE_LEVELS = ['专科', '本科', '专升本']
const COURSE_LEVEL_TABS = {
  '专科': ['大一', '大二', '大三'],
  '本科': ['大一', '大二', '大三', '大四'],
  '专升本': ['本科一年级', '本科二年级']
}
const GRADE_LEVEL_MAP = (function () {
  const map = {}
  Object.keys(COURSE_LEVEL_TABS).forEach((level) => {
    COURSE_LEVEL_TABS[level].forEach((grade) => {
      if (!map[grade]) map[grade] = []
      if (map[grade].indexOf(level) < 0) map[grade].push(level)
    })
  })
  return map
})()
const VALID_GRADES = [GENERAL_COURSE].concat(Object.keys(GRADE_LEVEL_MAP))

const SORTS = ['all', 'rating', 'hot']
const COMMENT_SORTS = ['time', 'likes']

// ===== 多维度评分（与 utils/review.js 的 REVIEW_DIMENSIONS 镜像）=====
// 统一四维，权重 40/20/20/20；课程评分不启用维度（保持单一星级）。
// 服务端是「校验与计算口径」：维度分合法性、加权综合分、维度聚合都以这里为准。
const DIMENSIONS = [
  { key: 'taste', weight: 40, label: '口味', labelByCategory: { business: '品质' } },
  { key: 'env', weight: 20, label: '环境' },
  { key: 'service', weight: 20, label: '服务' },
  { key: 'value', weight: 20, label: '性价比', labelByCategory: { business: '价格' } }
]
const DIMENSION_CATEGORIES = ['canteen', 'business']
const DIMENSION_WEIGHT_TOTAL = DIMENSIONS.reduce((s, d) => s + Number(d.weight), 0)

function supportsDimensions(category) {
  return DIMENSION_CATEGORIES.indexOf(String(category || '')) >= 0
}

// 该分类下的维度定义（套用分类措辞）；不支持则返回 []
function dimensionsFor(category) {
  if (!supportsDimensions(category)) return []
  return DIMENSIONS.map((d) => ({
    key: d.key,
    weight: d.weight,
    label: (d.labelByCategory && d.labelByCategory[category]) || d.label
  }))
}

// 校验四维分：必须齐全且均为 1-5 整数。合法返回 null，否则返回错误文案。
function validateDims(dims) {
  const source = dims || {}
  for (const d of DIMENSIONS) {
    const v = Number(source[d.key])
    if (!Number.isInteger(v) || v < 1 || v > 5) return `${d.label}评分需为 1-5 星`
  }
  return null
}

// 加权综合分：Σ(维度分 × 权重) / Σ权重，保留 2 位小数。
// 与「单一星级」的 score 语义一致 → rating_sum / rating_count / ratingAvg 口径不变。
function weightedScore(dims) {
  const source = dims || {}
  if (!DIMENSION_WEIGHT_TOTAL) return 0
  const sum = DIMENSIONS.reduce((s, d) => s + Number(source[d.key] || 0) * Number(d.weight), 0)
  return Number((sum / DIMENSION_WEIGHT_TOTAL).toFixed(2))
}

// 解析库里存的 dims（JSON 列在 mysql2 下可能是对象、字符串或 null）
function parseDims(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    return null
  }
}

// 由 dim_sums / dim_count 求各维度均分；无维度数据时返回 null（端上据此隐藏维度明细）
function dimAveragesOf(row) {
  const count = Number(row.dim_count || 0)
  const sums = parseDims(row.dim_sums)
  if (!count || !sums) return null
  const out = {}
  DIMENSIONS.forEach((d) => {
    const sum = Number(sums[d.key] || 0)
    out[d.key] = Number((sum / count).toFixed(2))
  })
  return out
}

function intId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

// mysql2 会把 DATETIME 解析成 Date → res.json 序列化成 UTC ISO 串，端上会差 8 小时
function toDateTimeText(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) {
    const pad = (n) => (n < 10 ? '0' : '') + n
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate())
      + ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes()) + ':' + pad(value.getSeconds())
  }
  return String(value)
}

const HTTPS_URL = /^https:\/\/\S{1,500}$/i

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 50)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

// 校区过滤集合：主校区 → 自身 + 全部分校区；分校区 → 自身；非法值 → []
function campusMatchList(campus) {
  const value = String(campus || '').trim()
  if (CAMPUS_MAIN_MAP[value]) return [value].concat(CAMPUS_MAIN_MAP[value])
  return CAMPUS_VALUES.indexOf(value) >= 0 ? [value] : []
}

// 学历层次过滤：levels 存 '专科,本科,专升本'，用逗号包裹后 LIKE，避免「专科」误命中「专升本」之外的问题
function levelsMatchSql(alias) {
  return `CONCAT(',', ${alias}.levels, ',') LIKE CONCAT('%,', ?, ',%')`
}

// 根级食堂 / 商圈是「容器」（楼层下挂档口 / 店铺），本身不是可评分对象：
// 不显示星级、不能打分、不统计自身评分人数；它的评论数 = 全部子级对菜品的评论条数之和。
function isContainerRow(row) {
  return row.parent_id === null || row.parent_id === undefined
}

function mapTargetRow(row) {
  const ratingCount = Number(row.rating_count || 0)
  const container = isContainerRow(row)
  return {
    id: row.id,
    category: row.category || '',
    parentId: row.parent_id === undefined ? undefined : (row.parent_id || null),
    parentName: row.parent_name || '',
    name: row.name || '',
    avatar: row.avatar || '',
    campus: row.campus || '',
    floor: row.floor || '',
    grade: row.grade || '',
    levels: row.levels || '',
    hotComment: row.hot_comment || '',
    ratingSum: Number(row.rating_sum || 0),
    ratingCount,
    ratingAvg: ratingCount > 0 ? Number(((Number(row.rating_sum || 0)) / ratingCount).toFixed(2)) : 0,
    // 根级食堂 / 商圈的评论总数 = 其全部子级（档口 / 店铺）的 comment_count 之和（fillContainerCommentTotals 填充）
    commentCount: Number(row.comment_count || 0),
    raterTotal: 0,
    // 子级自身打分 / 评论；根级容器用聚合值（targets 里填 commentTotal），非容器与 commentCount 相同
    commentTotal: container ? 0 : Number(row.comment_count || 0),
    // 根级食堂 / 商圈（非课程）不可评分：端上据此隐藏星级卡、评分人数
    rateable: !container || row.category === 'course',
    // 多维度评分：该分类的维度定义（含权重与分类措辞）+ 各维度均分。
    // dimAverages 为 null 表示「尚无带维度明细的评分」（如全部是历史单一星级数据），端上据此隐藏维度明细。
    dimensions: dimensionsFor(row.category),
    dimAverages: dimAveragesOf(row),
    dimCount: Number(row.dim_count || 0),
    likeCount: Number(row.like_count || 0),
    createdAt: toDateTimeText(row.created_at)
  }
}

// 卡片上的热门评价摘录：按点赞数取每个对象的第一条评价。
//
// 根级食堂 / 商圈是「容器」，评价都挂在它下面的档口 / 店铺上（review_comment.target_id 指子级），
// 缓存列 review_target.hot_comment 与 refreshHotComment 又只刷「评价所属的那个对象」，
// 所以容器自己永远取不到摘录 —— 必须把子级的高赞评价冒泡上来。
// 行已按 like_count 倒序，同一条既记到「评价所属对象」也记到「它的父对象」，
// 每个 key 第一次命中即为最高赞，叶子与容器共用一张表。
async function fillHotComments(targets) {
  const ids = targets.map((t) => t.id)
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT c.target_id AS own_id, t.parent_id AS parent_id, c.content
     FROM review_comment c
     JOIN review_target t ON c.target_id = t.id
     WHERE (t.id IN (${placeholders}) OR t.parent_id IN (${placeholders}))
       AND c.deleted = 0 AND c.status = 1
     ORDER BY c.like_count DESC, c.id DESC`,
    ids.concat(ids)
  )
  const best = {}
  for (const row of rows) {
    const content = String(row.content || '')
    if (!content) continue
    if (!best[row.own_id]) best[row.own_id] = content
    if (row.parent_id && !best[row.parent_id]) best[row.parent_id] = content
  }
  targets.forEach((t) => { if (!t.hotComment) t.hotComment = best[t.id] || '' })
}

// 根级食堂 / 商圈的评论总数 = 其全部子级（档口 / 店铺）的 comment_count 之和。
// 只对容器行填充 commentTotal；非容器保持自身值（mapTargetRow 已按 commentCount 赋值）。
// 注意：不能用 JOIN 直接 SUM —— 一个父级对多子级会让父级行重复，必须走独立聚合查询。
async function fillContainerCommentTotals(targets) {
  const containerIds = targets
    .filter((t) => t.parentId === null || t.parentId === undefined)
    .map((t) => t.id)
  if (!containerIds.length) return
  const placeholders = containerIds.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT t.parent_id AS parent_id, COUNT(c.id) AS total
     FROM review_target t
     JOIN review_comment c ON c.target_id = t.id
     WHERE t.parent_id IN (${placeholders}) AND c.deleted = 0 AND c.status = 1
     GROUP BY t.parent_id`,
    containerIds
  )
  const map = {}
  for (const row of rows) map[row.parent_id] = Number(row.total || 0)
  targets.forEach((t) => {
    if (t.parentId === null || t.parentId === undefined) {
      t.commentTotal = map[t.id] || 0
    }
  })
}

// 根级食堂 / 商圈的「已评人数」= 其全部子级（档口 / 店铺）评论的去重用户数。
// 与 commentTotal（评论条数）是两个口径：一人可在一个食堂下评论多个档口，人数要去重。
// SQL 保持全静态单字符串（无 IN 拼装）：取全部子级评论的 (父级, 用户) 对，去重在 JS 侧完成。
async function fillContainerRaterTotals(targets) {
  const containers = targets.filter((t) => t.parentId === null || t.parentId === undefined)
  if (!containers.length) return
  const wanted = {}
  containers.forEach((t) => { wanted[t.id] = new Set() })
  const [rows] = await pool.query('SELECT t.parent_id AS parent_id, c.user_id AS user_id FROM review_target t JOIN review_comment c ON c.target_id = t.id WHERE t.parent_id IS NOT NULL AND c.deleted = 0 AND c.status = 1')
  for (const row of rows) {
    const set = wanted[row.parent_id]
    if (set) set.add(Number(row.user_id))
  }
  containers.forEach((t) => { t.raterTotal = wanted[t.id] ? wanted[t.id].size : 0 })
}

// 列表接口：按分类 + 次导航维度筛选
// - course：grade（通识课/年级）+ level（学历层次，通识课对三类全部可见）
// - canteen/business 根级：campus 必选
// - canteen/business 子级：parentId + floor
exports.targets = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const category = String(req.query.category || '').trim()
  if (CATEGORIES.indexOf(category) < 0) return fail(res, 'Invalid review category')
  const sort = SORTS.indexOf(req.query.sort) >= 0 ? req.query.sort : 'all'
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)

  const campus = String(req.query.campus || '').trim()
  if (campus && CAMPUS_VALUES.indexOf(campus) < 0) return fail(res, '校区取值不正确')
  const floor = String(req.query.floor || '').trim()
  if (floor && FLOORS.indexOf(floor) < 0) return fail(res, '楼层取值不正确')
  const grade = String(req.query.grade || '').trim()
  if (grade && VALID_GRADES.indexOf(grade) < 0) return fail(res, '课程分类取值不正确')
  const level = String(req.query.level || '').trim()
  if (level && COURSE_LEVELS.indexOf(level) < 0) return fail(res, '学历层次取值不正确')
  const parentId = intId(req.query.parentId)

  let where = 'WHERE t.deleted = 0 AND t.status = 1'
  const params = []
  where += ' AND t.category = ?'
  params.push(category)

  if (category === 'course') {
    // 课程评价不区分校区：忽略 campus 参数
    if (!grade) return fail(res, '请选择课程分类')
    where += ' AND t.grade = ?'
    params.push(grade)
    if (!level) return fail(res, '请选择学历层次')
    where += ' AND ' + levelsMatchSql('t')
    params.push(level)
  } else if (parentId) {
    // 子级（食堂窗口 / 商圈店铺）：楼层必选，校区跟随父对象
    const [parents] = await pool.query(
      'SELECT id, campus FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 AND category = ? LIMIT 1',
      [parentId, category]
    )
    if (!parents.length) return fail(res, '评分对象不存在或已下架', 404)
    if (!floor) return fail(res, '请选择楼层')
    where += ' AND t.parent_id = ? AND t.floor = ?'
    params.push(parentId, floor)
  } else {
    // 根级（食堂 / 商圈门店）：按校区区分（主校区含其分校区）
    if (!campus) return fail(res, '请选择校区')
    const match = campusMatchList(campus)
    if (!match.length) return fail(res, '校区取值不正确')
    where += ' AND t.parent_id IS NULL AND t.campus IN (' + match.map(() => '?').join(',') + ')'
    params.push.apply(params, match)
  }
  if (keyword) {
    where += ' AND t.name LIKE ?'
    params.push('%' + keyword + '%')
  }

  let orderSql = 't.id DESC'
  if (sort === 'rating') {
    orderSql = 'CASE WHEN t.rating_count > 0 THEN t.rating_sum / t.rating_count ELSE 0 END DESC, t.rating_count DESC, t.id DESC'
  } else if (sort === 'hot') {
    orderSql = 't.rating_count DESC, t.comment_count DESC, t.id DESC'
  }

  const joinSql = category === 'course'
    ? ''
    : ' LEFT JOIN review_target p ON p.id = t.parent_id'
  const selectParent = category === 'course' ? "''" : 'p.name'

  try {
    const [[count], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM review_target t ${where}`, params),
      pool.query(
        `SELECT t.*, ${selectParent} AS parent_name FROM review_target t ${joinSql} ${where}
         ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    const total = Number(count[0].total || 0)
    const list = rows.map(mapTargetRow)
    await Promise.all([fillHotComments(list), fillContainerCommentTotals(list), fillContainerRaterTotals(list)])
    success(res, { list, total, page, hasMore: offset + rows.length < total })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 详情：登录用户附带我的评分与点赞状态
exports.detail = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  try {
    const [rows] = await pool.query(
      `SELECT t.*, p.name AS parent_name FROM review_target t
       LEFT JOIN review_target p ON p.id = t.parent_id
       WHERE t.id = ? AND t.deleted = 0 AND t.status = 1 LIMIT 1`,
      [id]
    )
    if (!rows.length) return fail(res, '评分对象不存在或已下架', 404)
    const target = mapTargetRow(rows[0])
    target.myRating = null
    // 我提交过的维度明细（无则 null）：端上据此回填四行星级
    target.myDims = null
    target.liked = false
    if (req.userId) {
      const [rated] = await pool.query(
        'SELECT score, dims FROM review_rating WHERE target_id = ? AND user_id = ? LIMIT 1',
        [id, req.userId]
      )
      if (rated.length) {
        target.myRating = Number(rated[0].score)
        target.myDims = parseDims(rated[0].dims)
      }
      const [liked] = await pool.query(
        'SELECT id FROM review_target_like WHERE target_id = ? AND user_id = ? LIMIT 1',
        [id, req.userId]
      )
      target.liked = liked.length > 0
    }
    success(res, { target })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 发布评分对象（需登录）：
// - 课程：grade 必填，levels 按年级自动推导（通识课 = 三类全适用），不区分校区
// - 食堂/商圈根级：campus 必填
// - 食堂/商圈子级：parentId + floor 必填，campus 跟随父对象
exports.createTarget = async (req, res) => {
  const body = req.body || {}
  const category = String(body.category || '').trim()
  if (CATEGORIES.indexOf(category) < 0) return fail(res, 'Invalid review category')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 64) return fail(res, '名称需为 1-64 个字符')
  let avatar = typeof body.avatar === 'string' ? body.avatar.trim() : ''
  if (avatar && !HTTPS_URL.test(avatar)) return fail(res, '头像地址不合法')

  const data = {
    category,
    name,
    avatar: avatar || '',
    hot_comment: '',
    created_by: req.userId
  }

  if (category === 'course') {
    const grade = String(body.grade || '').trim()
    if (VALID_GRADES.indexOf(grade) < 0) return fail(res, '请选择课程分类')
    data.grade = grade
    data.campus = ''
    data.floor = ''
    const levels = grade === GENERAL_COURSE
      ? COURSE_LEVELS.slice()
      : (GRADE_LEVEL_MAP[grade] || []).slice()
    data.levels = levels.join(',')
    data.parent_id = null
  } else {
    const parentId = intId(body.parentId)
    if (parentId) {
      const floor = String(body.floor || '').trim()
      if (FLOORS.indexOf(floor) < 0) return fail(res, '请选择楼层')
      const [parents] = await pool.query(
        'SELECT id, campus FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 AND category = ? AND parent_id IS NULL LIMIT 1',
        [parentId, category]
      )
      if (!parents.length) return fail(res, '所属分类不存在或已下架', 404)
      data.parent_id = parentId
      data.floor = floor
      data.campus = parents[0].campus || ''
      data.grade = ''
      data.levels = ''
    } else {
      const campus = String(body.campus || '').trim()
      if (CAMPUS_VALUES.indexOf(campus) < 0) return fail(res, '请选择校区')
      data.campus = campus
      data.floor = ''
      data.grade = ''
      data.levels = ''
      data.parent_id = null
    }
  }

  try {
    // 同名查重：同分类 + 同父级（或同校区）下不允许重复添加
    let dupSql = 'SELECT id FROM review_target WHERE category = ? AND name = ? AND deleted = 0 LIMIT 1'
    const dupParams = [category, name]
    if (data.parent_id) {
      dupSql = 'SELECT id FROM review_target WHERE category = ? AND name = ? AND parent_id = ? AND deleted = 0 LIMIT 1'
      dupParams.push(data.parent_id)
    } else if (category !== 'course') {
      dupSql = 'SELECT id FROM review_target WHERE category = ? AND name = ? AND parent_id IS NULL AND campus = ? AND deleted = 0 LIMIT 1'
      dupParams.push(data.campus)
    } else {
      dupSql = 'SELECT id FROM review_target WHERE category = ? AND name = ? AND grade = ? AND deleted = 0 LIMIT 1'
      dupParams.push(data.grade)
    }
    const [dup] = await pool.query(dupSql, dupParams)
    if (dup.length) return fail(res, '该评分对象已存在')
    const [result] = await pool.query('INSERT INTO review_target SET ?', [data])
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 随机抽取一个评分对象（食堂「抽取今日美食」/ 商圈「随机挑一店」）
exports.random = async (req, res) => {
  const category = String(req.query.category || '').trim()
  if (CATEGORIES.indexOf(category) < 0) return fail(res, 'Invalid review category')
  const campus = String(req.query.campus || '').trim()
  if (CAMPUS_VALUES.indexOf(campus) < 0) return fail(res, '请选择校区')
  const parentId = intId(req.query.parentId)
  // minRating：评分下限（高于 4.5/4/3.5 分），无评分对象自然被排除。
  // 注：旧参数 scope（'all' | 省略）在根级食堂/商圈不可评分后已无区分意义，
  // 食堂/商圈恒在子级档口/店铺中抽取（见下方 where 分支），故不再读取该参数。
  const minRating = Math.max(0, Number(req.query.minRating) || 0)
  const match = campusMatchList(campus)
  if (!match.length) return fail(res, '校区取值不正确')
  try {
    let where = 'WHERE t.deleted = 0 AND t.status = 1 AND t.category = ?'
    const params = [category]
    if (parentId) {
      where += ' AND t.parent_id = ?'
      params.push(parentId)
    } else if (category === 'course') {
      // 课程本身就是可评分叶子
      where += ' AND t.parent_id IS NULL'
    } else {
      // 食堂 / 商圈：根级是容器（不可评分），随机抽取只能落在子级档口 / 店铺上。
      // scope=all 与默认（无范围限制）在本分类下等价，都是「全部窗口 / 店铺」。
      where += ' AND t.parent_id IS NOT NULL'
    }
    where += ' AND t.campus IN (' + match.map(() => '?').join(',') + ')'
    params.push.apply(params, match)
    if (minRating > 0) {
      where += ' AND t.rating_count > 0 AND t.rating_sum >= t.rating_count * ?'
      params.push(minRating)
    }
    const [rows] = await pool.query(
      `SELECT t.* FROM review_target t ${where} ORDER BY RAND() LIMIT 1`,
      params
    )
    if (!rows.length) return fail(res, '暂无符合条件的评分对象', 404)
    const target = mapTargetRow(rows[0])
    await fillHotComments([target])
    success(res, { target })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 重算对象评分聚合（明细表为准，幂等）
// 重算某对象的评分聚合（明细表为准，幂等）。
// 综合分口径与原来完全一致（rating_sum / rating_count / ratingAvg），
// 额外把「带维度明细的评分」聚合进 dim_sums / dim_count，供各维度均分使用。
// 用 JS 聚合而非 JSON SQL：新增维度时只改 DIMENSIONS 一处，不必动 SQL。
async function refreshRating(targetId) {
  const [rows] = await pool.query('SELECT score, dims FROM review_rating WHERE target_id = ?', [targetId])
  let sum = 0
  let count = 0
  let dimCount = 0
  const dimSums = {}
  DIMENSIONS.forEach((d) => { dimSums[d.key] = 0 })
  for (const r of rows) {
    sum += Number(r.score || 0)
    count += 1
    const dims = parseDims(r.dims)
    if (!dims) continue
    dimCount += 1
    DIMENSIONS.forEach((d) => { dimSums[d.key] += Number(dims[d.key] || 0) })
  }
  await pool.query(
    'UPDATE review_target SET rating_sum = ?, rating_count = ?, dim_sums = ?, dim_count = ? WHERE id = ?',
    [Number(sum.toFixed(2)), count, JSON.stringify(dimSums), dimCount, targetId]
  )
}

// 评分（需登录）：可重复评分（覆盖旧值，「再次点击可以重新评分」）。
// 两种入参都支持：
//   ① 多维度（食堂 / 商圈）：{ dims: { taste, env, service, value } } 各 1-5，
//      综合分由加权公式算出（weightedScore），明细存入 dims 列；
//   ② 单一星级（课程评分，或旧版客户端）：{ score } 1-5，dims 存 NULL（不计入维度统计）。
exports.rate = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  const body = req.body || {}
  const rawDims = body.dims
  const useDims = rawDims && typeof rawDims === 'object'
  let dims = null
  let score = 0
  if (useDims) {
    const dimError = validateDims(rawDims)
    if (dimError) return fail(res, dimError)
    dims = {}
    DIMENSIONS.forEach((d) => { dims[d.key] = Number(rawDims[d.key]) })
    score = weightedScore(dims)
  } else {
    score = Number(body.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) return fail(res, '评分需为 1-5 星')
  }
  try {
    const [targets] = await pool.query(
      'SELECT id, category, parent_id FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!targets.length) return fail(res, '评分对象不存在或已下架', 404)
    // 根级食堂 / 商圈是容器（挂档口 / 店铺），本身不可评分；只有课程与子级档口 / 店铺可评分
    const row = targets[0]
    const isContainer = row.parent_id === null || row.parent_id === undefined
    if (isContainer && row.category !== 'course') return fail(res, '该对象不支持直接评分，请对具体窗口/店铺评分')
    await pool.query(
      'INSERT INTO review_rating (target_id, user_id, score, dims) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score), dims = VALUES(dims)',
      [id, req.userId, score, dims ? JSON.stringify(dims) : null]
    )
    await refreshRating(id)
    const [rows] = await pool.query(
      'SELECT rating_sum, rating_count, dim_sums, dim_count FROM review_target WHERE id = ?',
      [id]
    )
    const ratingCount = Number(rows[0].rating_count || 0)
    success(res, {
      score,
      dims,
      dimensions: dimensionsFor(row.category),
      dimAverages: dimAveragesOf(rows[0]),
      ratingCount,
      ratingAvg: ratingCount > 0 ? Number((Number(rows[0].rating_sum) / ratingCount).toFixed(2)) : 0
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 对象点赞（需登录）：再点一次取消
exports.likeTarget = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  try {
    const [targets] = await pool.query(
      'SELECT id FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!targets.length) return fail(res, '评分对象不存在或已下架', 404)
    const [existing] = await pool.query(
      'SELECT id FROM review_target_like WHERE target_id = ? AND user_id = ? LIMIT 1',
      [id, req.userId]
    )
    let liked
    if (existing.length) {
      await pool.query('DELETE FROM review_target_like WHERE target_id = ? AND user_id = ?', [id, req.userId])
      liked = false
    } else {
      await pool.query('INSERT IGNORE INTO review_target_like (target_id, user_id) VALUES (?, ?)', [id, req.userId])
      liked = true
    }
    await pool.query(
      `UPDATE review_target t SET t.like_count = (SELECT COUNT(*) FROM review_target_like l WHERE l.target_id = t.id) WHERE t.id = ?`,
      [id]
    )
    const [rows] = await pool.query('SELECT like_count FROM review_target WHERE id = ?', [id])
    success(res, { liked, likeCount: Number(rows[0].like_count || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

function mapCommentRow(row, parentNickName) {
  // 分身评论：昵称/头像换成分身身份（与论坛评论 presentComment 同口径），不再显示认证标签
  const anonymousIdentity = parseAnonymousIdentity(row.anonymous_identity)
  const rawImages = parseJson(row.images)
  const images = mediaCheck.filterStoredImages(Array.isArray(rawImages) ? rawImages : [])
  return {
    id: row.id,
    targetId: row.target_id,
    userId: row.user_id,
    nickName: anonymousIdentity ? anonymousIdentity.nickName : (row.nick_name || ''),
    avatarUrl: anonymousIdentity ? anonymousIdentity.avatarUrl : normalizeLegacyAvatarUrl(row.avatar_url),
    certLabel: anonymousIdentity ? '' : (row.cert_label || ''),
    isAnonymous: !!anonymousIdentity,
    // 对方是否允许分身私信：端上据此决定头像卡片按钮文案（「分身私信」/「私信」）。
    // 缺省 true（与 postController 同口径）；真正的拦截在 messageController（服务端为准）。
    allowAnonymousPm: row.allow_anonymous_pm === undefined ? true : !!row.allow_anonymous_pm,
    content: row.content || '',
    images,
    likeCount: Number(row.like_count || 0),
    // 回复关系：parentId=0 为顶层评价；parentNickName 仅供「回复 xxx」前缀展示，
    // 是否显示前缀由端上按「父级是否也是回复」判断（与论坛评论 replyToNick 规则一致）
    parentId: Number(row.parent_id || 0),
    parentNickName: String(parentNickName || ''),
    createdAt: toDateTimeText(row.created_at)
  }
}

// 评价列表：按顶层评价分页，每条顶层评价一次性带上其全部回复（对齐论坛评论的两级树）。
// 顶层共 N 条 → 总行数 N + 回复数，设硬上限防止单页拉爆；超出部分按 id 截断（极少见的刷屏场景）。
const COMMENT_FETCH_LIMIT = 2000

exports.comments = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  const { page, pageSize, offset } = pageParams(req.query)
  const sort = COMMENT_SORTS.indexOf(req.query.sort) >= 0 ? req.query.sort : 'time'
  const orderSql = sort === 'likes' ? 'c.like_count DESC, c.id DESC' : 'c.id DESC'
  try {
    // 分页单元是「顶层评价」而非「行」：否则一页内的回复会把顶层评价挤到后续页，
    // 端上拼树时找不到父级，回复会变成孤儿或整条丢失。
    const [[count], [rootCount], [rootRows], [rows]] = await Promise.all([
      // 评论区计数 = 顶层 + 回复并存（与「论坛评论 total 计全部」口径一致）
      pool.query(
        'SELECT COUNT(*) total FROM review_comment c WHERE c.target_id = ? AND c.deleted = 0 AND c.status = 1',
        [id]
      ),
      // hasMore 只看顶层评价：还有下一批顶层才有下一页
      pool.query(
        'SELECT COUNT(*) total FROM review_comment c WHERE c.target_id = ? AND c.deleted = 0 AND c.status = 1 AND c.parent_id = 0',
        [id]
      ),
      pool.query(
        `SELECT c.id FROM review_comment c
         WHERE c.target_id = ? AND c.deleted = 0 AND c.status = 1 AND c.parent_id = 0
         ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
        [id, pageSize, offset]
      ),
      pool.query(
        `SELECT c.*, u.nick_name, u.avatar_url, u.cert_label, u.allow_anonymous_pm,
           (SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pc.anonymous_identity, '$.nickName')), pu.nick_name)
              FROM review_comment pc LEFT JOIN sys_user pu ON pu.id = pc.user_id
             WHERE pc.id = c.parent_id) AS parent_nick_name
         FROM review_comment c
         LEFT JOIN sys_user u ON u.id = c.user_id
         WHERE c.target_id = ? AND c.deleted = 0 AND c.status = 1
         ORDER BY c.id ASC LIMIT ?`,
        [id, COMMENT_FETCH_LIMIT]
      )
    ])
    const total = Number(count[0].total || 0)
    const rootTotal = Number(rootCount[0].total || 0)
    const all = rows.map((row) => mapCommentRow(row, row.parent_nick_name))
    // 端上按 parentId 自行拼两级树，这里只需保证「本页顶层 + 其全部后代」都下发。
    // ⚠ parent_id 存的是「实际被回复的那条」，可能是另一条回复（回复的回复），
    //   所以不能再用 `rootIdSet[c.parentId]` 直接判断归属 —— 必须沿父链上溯到顶层。
    //   （旧实现假定 parent_id 恒为顶层，改存真实父级后会把回复的回复整条漏掉。）
    const byId = {}
    all.forEach((c) => { byId[Number(c.id)] = c })
    const rootIdCache = {}
    const rootIdOf = (comment) => {
      const key = Number(comment.id)
      if (rootIdCache[key] !== undefined) return rootIdCache[key]
      let current = comment
      const seen = {}
      while (current && current.parentId && byId[Number(current.parentId)] && !seen[current.id]) {
        seen[current.id] = true
        current = byId[Number(current.parentId)]
      }
      rootIdCache[key] = Number(current.id)
      return rootIdCache[key]
    }
    const rootIds = rootRows.map((row) => Number(row.id))
    const rootIdSet = {}
    const rootOrder = {}
    rootIds.forEach((rid, index) => { rootIdSet[rid] = true; rootOrder[rid] = index })
    // 只下发「所属顶层在本页」的条目（含其全部后代），顶层按排序、其下按 id 升序
    const list = all.filter((c) => rootIdSet[rootIdOf(c)])
    list.sort((a, b) => {
      const diff = rootOrder[rootIdOf(a)] - rootOrder[rootIdOf(b)]
      if (diff) return diff
      const aIsRoot = Number(a.id) === rootIdOf(a)
      const bIsRoot = Number(b.id) === rootIdOf(b)
      if (aIsRoot !== bIsRoot) return aIsRoot ? -1 : 1
      return Number(a.id) - Number(b.id)
    })
    if (req.userId && list.length) {
      const ids = list.map((c) => c.id)
      const placeholders = ids.map(() => '?').join(',')
      const [likes] = await pool.query(
        `SELECT comment_id FROM review_comment_like WHERE user_id = ? AND comment_id IN (${placeholders})`,
        [req.userId].concat(ids)
      )
      const likedSet = new Set(likes.map((row) => row.comment_id))
      list.forEach((c) => { c.liked = likedSet.has(c.id) })
    } else {
      list.forEach((c) => { c.liked = false })
    }
    success(res, { list, total, page, hasMore: offset + rootIds.length < rootTotal })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 热门评价摘录随评价新增 / 点赞变化刷新（取点赞最高的一条）
async function refreshHotComment(targetId) {
  await pool.query(
    `UPDATE review_target t SET t.hot_comment = (
       SELECT content FROM review_comment c
       WHERE c.target_id = t.id AND c.deleted = 0 AND c.status = 1
       ORDER BY c.like_count DESC, c.id DESC LIMIT 1
     ) WHERE t.id = ?`,
    [targetId]
  )
}

// 评论计数按明细表全量重算（幂等）：不再依赖 ±1 增量。
// 旧实现用「COUNT 子查询全量重算」本身是对的，但新建对象/后台删除等写入链缺口会让字段漂移，
// 这里统一收口成一个函数，并让 migrations 启动时兜底对账一次。
async function refreshCommentCount(targetId) {
  await pool.query(
    `UPDATE review_target t SET t.comment_count = (
       SELECT COUNT(*) FROM review_comment c WHERE c.target_id = t.id AND c.deleted = 0 AND c.status = 1
     ) WHERE t.id = ?`,
    [targetId]
  )
}

// 发布评价 / 回复评价（需登录）
// parentId 语义与论坛评论一致：0 = 顶层评价；>0 = **实际被回复的那条**（可能是另一条回复）。
// ⚠ 不做「两级收口」：早期实现会把「回复的回复」的 parent_id 压平成顶层，
//   那样会永久丢掉「回复的是谁」，端上的「回复 xxx」前缀就永远显示不出来。
//   展示层级（只两级）由端上沿父链上溯归并，存储保持保真。
exports.addComment = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  const body = req.body || {}
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  // 配图与分身：对齐论坛评论规范（纯图片评论允许；分身身份必须是内置素材池形象）
  const images = (Array.isArray(body.images) ? body.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, 9)
  const anonymousIdentity = body.anonymousIdentity ? parseAnonymousIdentity(body.anonymousIdentity) : null
  if (body.anonymousIdentity && !anonymousIdentity) return fail(res, '分身身份格式不正确')
  if (!content && !images.length) return fail(res, '说点什么再发布吧')
  if (content.length > 1000) return fail(res, '评价内容需在 1000 字以内')
  try {
    const [targets] = await pool.query(
      'SELECT id FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!targets.length) return fail(res, '评分对象不存在或已下架', 404)

    // 解析回复目标：父评价必须属于同一评分对象且可见，否则拒绝（否则会出现跨对象挂载的孤儿回复）
    const requestedParentId = intId(body.parentId)
    let parentId = 0
    let parentAuthorId = 0
    if (requestedParentId) {
      const [parents] = await pool.query(
        'SELECT id, target_id, parent_id, user_id FROM review_comment WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
        [requestedParentId]
      )
      if (!parents.length) return fail(res, '被回复的评价不存在或已删除', 404)
      const parent = parents[0]
      if (Number(parent.target_id) !== id) return fail(res, '被回复的评价不属于当前评分对象')
      // 存「实际被回复的那条」的 id —— 与论坛评论 commentController 同款。
      // ⚠ 不要在这里收口成顶层：那样会丢掉「回复的是谁」，端上的「回复 xxx」前缀就永远显示不出来
      //   （端上判据是「父级本身也是回复」，父级恒为顶层时该条件恒假）。
      // 展示层级由端上 buildCommentTree 沿父链上溯归并到顶层（只两级展示），不需要服务端压平 parent_id。
      parentId = Number(parent.id)
      parentAuthorId = Number(parent.user_id) || 0
    }

    // 同一评分对象身份一致性：该用户在此对象下已有匿名评论时，一律复用首次存档的分身身份，
    // 不再采用客户端本次随机生成的，避免同一评论区每条评论头像昵称各不相同（与论坛评论同款）
    let effectiveIdentity = anonymousIdentity
    if (effectiveIdentity) {
      const [archived] = await pool.query(
        'SELECT anonymous_identity FROM review_comment WHERE target_id = ? AND user_id = ? AND anonymous_identity IS NOT NULL ORDER BY id DESC LIMIT 1',
        [id, req.userId]
      )
      const existingIdentity = archived.length ? parseAnonymousIdentity(archived[0].anonymous_identity) : null
      if (existingIdentity) effectiveIdentity = existingIdentity
    }

    const [result] = await pool.query(
      'INSERT INTO review_comment (target_id, parent_id, user_id, content, images, anonymous_identity) VALUES (?, ?, ?, ?, ?, ?)',
      [id, parentId, req.userId, content, images.length ? JSON.stringify(images) : null, effectiveIdentity ? JSON.stringify(effectiveIdentity) : null]
    )
    await refreshCommentCount(id)
    await refreshHotComment(id)
    const [rows] = await pool.query(
      `SELECT c.*, u.nick_name, u.avatar_url, u.cert_label FROM review_comment c
       LEFT JOIN sys_user u ON u.id = c.user_id WHERE c.id = ? LIMIT 1`,
      [result.insertId]
    )
    const comment = mapCommentRow(rows[0] || {})
    comment.liked = false

    // 被回复者通知：与论坛评论的 reply 类型同款，前端归入「评论」tab 并走回复订阅模板。
    // 自己回复自己不通知；匿名回复用分身形象快照，避免通知里泄露真实身份。
    if (parentId && parentAuthorId && parentAuthorId !== Number(req.userId)) {
      let actorSnapshot = null
      if (effectiveIdentity) {
        actorSnapshot = { actorUserId: null, actorNick: effectiveIdentity.nickName, actorAvatar: effectiveIdentity.avatarUrl }
      } else {
        const [actors] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ?', [req.userId])
        if (actors.length) {
          actorSnapshot = { actorUserId: actors[0].id, actorNick: actors[0].nick_name || '', actorAvatar: actors[0].avatar_url || '' }
        }
      }
      createNotification(Object.assign({
        userId: parentAuthorId,
        type: 'reply',
        sourceCommentId: result.insertId,
        title: '有人回复了你的评价',
        content: withMediaPlaceholder(content.slice(0, 200), images),
        relatedId: id,
        commentImages: images
      }, actorSnapshot || {})).catch(() => {})
    }

    // 返回实际生效的匿名身份：客户端乐观上屏时用它纠偏，保证显示与服务端存档一致（与论坛评论同款）
    success(res, { comment, parentId, commentCount: await commentCountOf(id), anonymousIdentity: effectiveIdentity })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

async function commentCountOf(targetId) {
  const [rows] = await pool.query('SELECT comment_count FROM review_target WHERE id = ?', [targetId])
  return Number((rows[0] || {}).comment_count || 0)
}

// 评价点赞（需登录）：再点一次取消
exports.likeComment = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid comment id')
  try {
    const [comments] = await pool.query(
      'SELECT id, target_id FROM review_comment WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!comments.length) return fail(res, '评价不存在或已删除', 404)
    const [existing] = await pool.query(
      'SELECT id FROM review_comment_like WHERE comment_id = ? AND user_id = ? LIMIT 1',
      [id, req.userId]
    )
    let liked
    if (existing.length) {
      await pool.query('DELETE FROM review_comment_like WHERE comment_id = ? AND user_id = ?', [id, req.userId])
      liked = false
    } else {
      await pool.query('INSERT IGNORE INTO review_comment_like (comment_id, user_id) VALUES (?, ?)', [id, req.userId])
      liked = true
    }
    await pool.query(
      `UPDATE review_comment c SET c.like_count = (SELECT COUNT(*) FROM review_comment_like l WHERE l.comment_id = c.id) WHERE c.id = ?`,
      [id]
    )
    await refreshHotComment(comments[0].target_id)
    const [rows] = await pool.query('SELECT like_count FROM review_comment WHERE id = ?', [id])
    success(res, { liked, likeCount: Number(rows[0].like_count || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 编辑评价评论（需登录，仅作者本人）：
// 与论坛评论（PUT /comment/:id）同款收口 —— 只有作者能改自己的内容，
// 管理员也不提供「改他人内容」的能力（治理动作是删除，不是篡改）。配图沿用原值不动。
exports.updateComment = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  const body = req.body || {}
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return fail(res, '内容不能为空')
  if (content.length > 1000) return fail(res, '评价内容需在 1000 字以内')
  try {
    const [comments] = await pool.query(
      'SELECT id, target_id, user_id, images FROM review_comment WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!comments.length) return fail(res, '评价不存在或已删除', 404)
    const comment = comments[0]
    // 纯图片评价（无文字）编辑后不能变成空内容：content 已校验非空，这里无需再兜
    if (Number(comment.user_id) !== Number(req.userId)) return fail(res, '只能编辑自己的评价', 403)

    await pool.query('UPDATE review_comment SET content = ? WHERE id = ?', [content, id])
    await refreshHotComment(comment.target_id)
    success(res, { id: Number(id), content })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 删除评价评论（软删，需登录）：
//   · 管理员（content.manage）—— 可删任意评价评论；
//   · 评论作者本人 —— 可删自己的评价评论。
// 与论坛评论 intentionally 不同：评分对象是公共条目、不存在「帖子作者」这一角色，
// 因此不引入「条目创建者可删他人评论」的档位，权限口径只收紧不放宽。
// 删除顶层评价时连带软删其下所有回复（parent_id 指向它），否则会留下点不到的孤儿回复；
// 删除单条回复则只删自身。删完刷新 target 的评论数与热评（与 likeComment 同款收口）。
exports.deleteComment = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  try {
    const [comments] = await pool.query(
      'SELECT id, target_id, parent_id, user_id, content FROM review_comment WHERE id = ? AND deleted = 0 LIMIT 1',
      [id]
    )
    if (!comments.length) return fail(res, '评价不存在或已删除', 404)
    const comment = comments[0]
    const isOwner = Number(comment.user_id) === Number(req.userId)
    const isAdmin = hasPermission((req.user || {}).role, 'content.manage')
    if (!isOwner && !isAdmin) return fail(res, '无权删除该评价', 403)

    // 顶层评价（parent_id = 0）连带其下**全部后代**；回复只删自身。
    // ⚠ 必须逐层收集后代：parent_id 存的是「实际被回复的那条」，回复「回复」会形成两级以上的链，
    //   只写 `WHERE parent_id = ?` 只能删到第一层，更深的回复会变成点不到的孤儿。
    //   （与论坛评论 commentController.deleteComment 同款做法。）
    const isRoot = !Number(comment.parent_id)
    const removedIds = [id]
    if (isRoot) {
      let frontier = [id]
      while (frontier.length) {
        const [children] = await pool.query(
          `SELECT id FROM review_comment WHERE parent_id IN (${frontier.map(() => '?').join(', ')}) AND deleted = 0`,
          frontier
        )
        if (!children.length) break
        frontier = children.map((item) => Number(item.id))
        removedIds.push(...frontier)
      }
    }
    const [result] = await pool.query(
      `UPDATE review_comment SET deleted = 1 WHERE id IN (${removedIds.map(() => '?').join(', ')}) AND deleted = 0`,
      removedIds
    )

    await refreshCommentCount(comment.target_id)
    await refreshHotComment(comment.target_id)

    if (!isOwner) {
      await writeAdminAudit(req, 'reviewComment.delete', 'review_comment', id, {
        targetId: Number(comment.target_id),
        root: isRoot,
        affected: result.affectedRows,
        content: String(comment.content || '').slice(0, 100)
      })
    }

    success(res, { affected: result.affectedRows, commentCount: await commentCountOf(comment.target_id) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 管理后台：评分对象治理 =====
// 删除走软删（deleted = 1）：用户端所有查询都带 deleted = 0，条目立即全端下线，
// 评分/评价明细留在库内可查；删父对象时连带其子对象（食堂窗口 / 商圈店铺），避免留下点不到的孤儿条目。
async function auditTarget(req, action, targetId, detail) {
  try {
    await writeAdminAudit(req, action, 'review_target', targetId, detail)
  } catch (e) {
    console.error('[admin-audit]', e.message)
  }
}

// 后台列表按用户端层级钻取：默认只出根条目（食堂/商圈/课程），带 parentId 时出该食堂窗口 / 该商圈店铺
exports.adminTargets = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const category = String(req.query.category || '').trim()
  if (category && CATEGORIES.indexOf(category) < 0) return fail(res, 'Invalid review category')
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  const showDeleted = req.query.state === 'deleted'
  const parentId = intId(req.query.parentId)

  let where = 'WHERE t.deleted = ?'
  const params = [showDeleted ? 1 : 0]
  if (category) { where += ' AND t.category = ?'; params.push(category) }
  if (keyword) { where += ' AND t.name LIKE ?'; params.push('%' + keyword + '%') }
  where += parentId ? ' AND t.parent_id = ?' : ' AND t.parent_id IS NULL'
  if (parentId) params.push(parentId)

  try {
    const [[count], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM review_target t ${where}`, params),
      pool.query(
        `SELECT t.*, p.name AS parent_name, u.nick_name AS created_by_name,
           (SELECT COUNT(*) FROM review_target c WHERE c.parent_id = t.id AND c.deleted = 0) AS child_count
         FROM review_target t
         LEFT JOIN review_target p ON p.id = t.parent_id
         LEFT JOIN sys_user u ON u.id = t.created_by
         ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    let parent = null
    if (parentId) {
      const [parents] = await pool.query(
        'SELECT id, name, category, campus FROM review_target WHERE id = ? LIMIT 1', [parentId]
      )
      parent = parents.length ? {
        id: parents[0].id,
        name: parents[0].name,
        category: parents[0].category,
        campus: parents[0].campus || ''
      } : null
    }
    const total = Number(count[0].total || 0)
    success(res, {
      list: rows.map((row) => Object.assign(mapTargetRow(row), {
        deleted: Number(row.deleted) === 1,
        childCount: Number(row.child_count || 0),
        createdByName: row.created_by_name || '',
        updatedAt: toDateTimeText(row.updated_at)
      })),
      parent,
      total, page, hasMore: offset + rows.length < total
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminDeleteTarget = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  try {
    const [target] = await pool.query(
      'SELECT id, name, category, deleted FROM review_target WHERE id = ? LIMIT 1', [id]
    )
    if (!target.length) return fail(res, '评分对象不存在', 404)
    if (Number(target[0].deleted) === 1) return fail(res, '该条目已删除')
    const [result] = await pool.query('UPDATE review_target SET deleted = 1 WHERE id = ? OR parent_id = ?', [id, id])
    await auditTarget(req, 'reviewTarget.delete', id, {
      name: target[0].name, category: target[0].category, affected: result.affectedRows
    })
    success(res, { affected: result.affectedRows })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.adminRestoreTarget = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, '参数不完整')
  try {
    const [target] = await pool.query(
      'SELECT id, name, category, parent_id, deleted FROM review_target WHERE id = ? LIMIT 1', [id]
    )
    if (!target.length) return fail(res, '评分对象不存在', 404)
    if (Number(target[0].deleted) === 0) return fail(res, '该条目未删除')
    if (target[0].parent_id) {
      const [parent] = await pool.query('SELECT deleted FROM review_target WHERE id = ? LIMIT 1', [target[0].parent_id])
      if (parent.length && Number(parent[0].deleted) === 1) return fail(res, '请先恢复所属的食堂/商圈')
    }
    await pool.query('UPDATE review_target SET deleted = 0 WHERE id = ?', [id])
    await auditTarget(req, 'reviewTarget.restore', id, { name: target[0].name, category: target[0].category })
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

module.exports.CATEGORIES = CATEGORIES
module.exports.CAMPUS_VALUES = CAMPUS_VALUES
module.exports.CAMPUS_MAIN_MAP = CAMPUS_MAIN_MAP
module.exports.FLOORS = FLOORS
module.exports.COURSE_LEVEL_TABS = COURSE_LEVEL_TABS
module.exports.GENERAL_COURSE = GENERAL_COURSE
