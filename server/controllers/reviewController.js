const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')

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

function mapTargetRow(row) {
  const ratingCount = Number(row.rating_count || 0)
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
    commentCount: Number(row.comment_count || 0),
    likeCount: Number(row.like_count || 0),
    createdAt: toDateTimeText(row.created_at)
  }
}

// 卡片上的热门评价摘录：按点赞数取每个对象的第一条评价
async function fillHotComments(targets) {
  const ids = targets.map((t) => t.id)
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT target_id, content FROM review_comment
     WHERE target_id IN (${placeholders}) AND deleted = 0 AND status = 1
     ORDER BY like_count DESC, id DESC`,
    ids
  )
  const map = {}
  for (const row of rows) {
    if (!map[row.target_id]) map[row.target_id] = String(row.content || '')
  }
  targets.forEach((t) => { if (!t.hotComment) t.hotComment = map[t.id] || '' })
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
    await fillHotComments(list)
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
    target.liked = false
    if (req.userId) {
      const [rated] = await pool.query(
        'SELECT score FROM review_rating WHERE target_id = ? AND user_id = ? LIMIT 1',
        [id, req.userId]
      )
      if (rated.length) target.myRating = Number(rated[0].score)
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
  // scope=all：根级 + 子级全层级抽取（「抽取今日美食」选择范围=全部）；
  // minRating：评分下限（高于 4.5/4/3.5 分），无评分对象自然被排除
  const scopeAll = String(req.query.scope || '') === 'all'
  const minRating = Math.max(0, Number(req.query.minRating) || 0)
  const match = campusMatchList(campus)
  if (!match.length) return fail(res, '校区取值不正确')
  try {
    let where = 'WHERE t.deleted = 0 AND t.status = 1 AND t.category = ?'
    const params = [category]
    if (parentId) {
      where += ' AND t.parent_id = ?'
      params.push(parentId)
    } else if (!scopeAll) {
      where += ' AND t.parent_id IS NULL'
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
async function refreshRating(targetId) {
  await pool.query(
    `UPDATE review_target t SET
       t.rating_sum = (SELECT COALESCE(SUM(r.score), 0) FROM review_rating r WHERE r.target_id = t.id),
       t.rating_count = (SELECT COUNT(*) FROM review_rating r WHERE r.target_id = t.id)
     WHERE t.id = ?`,
    [targetId]
  )
}

// 评分（需登录）：1-5 分，可重复评分（覆盖旧值，「再次点击可以重新评分」）
exports.rate = async (req, res) => {
  const id = intId(req.params.id)
  const score = Number((req.body || {}).score)
  if (!id) return fail(res, 'Invalid target id')
  if (!Number.isInteger(score) || score < 1 || score > 5) return fail(res, '评分需为 1-5 星')
  try {
    const [targets] = await pool.query(
      'SELECT id FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!targets.length) return fail(res, '评分对象不存在或已下架', 404)
    await pool.query(
      'INSERT INTO review_rating (target_id, user_id, score) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score)',
      [id, req.userId, score]
    )
    await refreshRating(id)
    const [rows] = await pool.query('SELECT rating_sum, rating_count FROM review_target WHERE id = ?', [id])
    const ratingCount = Number(rows[0].rating_count || 0)
    success(res, {
      score,
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

function mapCommentRow(row) {
  return {
    id: row.id,
    targetId: row.target_id,
    userId: row.user_id,
    nickName: row.nick_name || '',
    avatarUrl: row.avatar_url || '',
    certLabel: row.cert_label || '',
    content: row.content || '',
    likeCount: Number(row.like_count || 0),
    createdAt: toDateTimeText(row.created_at)
  }
}

// 评价列表：sort = time 时间 / likes 赞数；登录用户附带点赞状态
exports.comments = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  const { page, pageSize, offset } = pageParams(req.query)
  const sort = COMMENT_SORTS.indexOf(req.query.sort) >= 0 ? req.query.sort : 'time'
  const orderSql = sort === 'likes' ? 'c.like_count DESC, c.id DESC' : 'c.id DESC'
  try {
    const [[count], [rows]] = await Promise.all([
      pool.query(
        'SELECT COUNT(*) total FROM review_comment c WHERE c.target_id = ? AND c.deleted = 0 AND c.status = 1',
        [id]
      ),
      pool.query(
        `SELECT c.*, u.nick_name, u.avatar_url, u.cert_label FROM review_comment c
         LEFT JOIN sys_user u ON u.id = c.user_id
         WHERE c.target_id = ? AND c.deleted = 0 AND c.status = 1
         ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
        [id, pageSize, offset]
      )
    ])
    const total = Number(count[0].total || 0)
    const list = rows.map(mapCommentRow)
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
    success(res, { list, total, page, hasMore: offset + rows.length < total })
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

// 发布评价（需登录）
exports.addComment = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid target id')
  const content = typeof (req.body || {}).content === 'string' ? req.body.content.trim() : ''
  if (!content) return fail(res, '说点什么再发布吧')
  if (content.length > 1000) return fail(res, '评价内容需在 1000 字以内')
  try {
    const [targets] = await pool.query(
      'SELECT id FROM review_target WHERE id = ? AND deleted = 0 AND status = 1 LIMIT 1',
      [id]
    )
    if (!targets.length) return fail(res, '评分对象不存在或已下架', 404)
    const [result] = await pool.query(
      'INSERT INTO review_comment (target_id, user_id, content) VALUES (?, ?, ?)',
      [id, req.userId, content]
    )
    await pool.query(
      `UPDATE review_target t SET t.comment_count = (
         SELECT COUNT(*) FROM review_comment c WHERE c.target_id = t.id AND c.deleted = 0 AND c.status = 1
       ) WHERE t.id = ?`,
      [id]
    )
    await refreshHotComment(id)
    const [rows] = await pool.query(
      `SELECT c.*, u.nick_name, u.avatar_url, u.cert_label FROM review_comment c
       LEFT JOIN sys_user u ON u.id = c.user_id WHERE c.id = ? LIMIT 1`,
      [result.insertId]
    )
    const comment = mapCommentRow(rows[0] || {})
    comment.liked = false
    success(res, { comment })
  } catch (e) { fail(res, safeMessage(e), 500) }
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
