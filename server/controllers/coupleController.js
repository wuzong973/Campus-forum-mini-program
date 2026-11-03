const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { writeAdminAudit } = require('../utils/adminAudit')
const coupleService = require('../services/coupleService')

function intId(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function text(value, max) {
  if (value === undefined || value === null) return ''
  return String(value).trim().slice(0, max)
}

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || 20, 1), 100)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

async function audit(req, action, targetType, targetId, detail) {
  try {
    await writeAdminAudit(req, action, targetType, targetId, detail)
  } catch (e) {
    console.error('[couple-admin-audit]', e.message)
  }
}

async function adminActivityStats(activityId) {
  const [[signup], [active], [matched]] = await Promise.all([
    pool.query('SELECT COUNT(*) AS total FROM couple_signup WHERE activity_id = ? AND status IN (1, 2)', [activityId]),
    pool.query('SELECT COUNT(*) AS total FROM couple_match WHERE activity_id = ? AND status = 1', [activityId]),
    pool.query('SELECT COUNT(*) AS total FROM couple_match WHERE activity_id = ?', [activityId])
  ])
  return {
    signups: Number(signup[0] && signup[0].total) || 0,
    activeMatches: Number(active[0] && active[0].total) || 0,
    totalMatches: Number(matched[0] && matched[0].total) || 0
  }
}

exports.current = async (req, res) => {
  try {
    const state = await coupleService.getUserState(req.userId)
    success(res, state)
  } catch (e) {
    console.error('[couple.current]', e.message)
    fail(res, '一周CP状态读取失败')
  }
}

exports.signup = async (req, res) => {
  try {
    const result = await coupleService.signup(req.userId, req.body || {})
    if (result.error) return fail(res, result.error)
    success(res, result.data, '报名成功')
  } catch (e) {
    console.error('[couple.signup]', e.message)
    fail(res, '报名失败，请稍后再试')
  }
}

exports.matchDetail = async (req, res) => {
  try {
    const matchId = intId(req.params.id)
    if (!matchId) return fail(res, '配对参数不正确')
    const result = await coupleService.getMatchDetail(req.userId, matchId)
    if (result.error) return fail(res, result.error, result.code || 400)
    success(res, result.data)
  } catch (e) {
    console.error('[couple.matchDetail]', e.message)
    fail(res, '配对详情读取失败')
  }
}

exports.history = async (req, res) => {
  try {
    const data = await coupleService.getHistory(req.userId)
    success(res, data)
  } catch (e) {
    console.error('[couple.history]', e.message)
    fail(res, '历史配对读取失败')
  }
}

exports.rematch = async (req, res) => {
  try {
    const matchId = intId(req.body && req.body.matchId)
    if (!matchId) return fail(res, '配对参数不正确')
    const result = await coupleService.rematch(req.userId, matchId)
    if (result.error) return fail(res, result.error)
    const state = await coupleService.getUserState(req.userId)
    success(res, Object.assign({}, result.data, { state }), '已回到匹配池，等待下一批揭晓')
  } catch (e) {
    console.error('[couple.rematch]', e.message)
    fail(res, '重新匹配失败，请稍后再试')
  }
}

// ===== 管理后台 =====

exports.adminActivity = async (req, res) => {
  try {
    const feature = await coupleService.getFeatureConfig()
    success(res, {
      feature: coupleService.mapFeature(feature),
      stats: feature ? await adminActivityStats(feature.id) : { signups: 0, activeMatches: 0, totalMatches: 0 }
    })
  } catch (e) {
    console.error('[couple.adminActivity]', e.message)
    fail(res, '一周CP配置读取失败')
  }
}

exports.adminSaveActivity = async (req, res) => {
  try {
    const body = req.body || {}
    const title = text(body.title, 64)
    if (!title) return fail(res, '功能标题不能为空')
    const intro = text(body.intro, 500)
    const rules = text(body.rules, 5000)
    const status = Number(body.status)
    if ([0, 1].indexOf(status) < 0) return fail(res, '功能状态需为 0（维护）或 1（开放）')

    const existing = await coupleService.getFeatureConfig()
    let featureId = existing ? existing.id : 0
    if (featureId) {
      await pool.query(
        `UPDATE couple_activity SET title = ?, intro = ?, rules = ?, status = ? WHERE id = ?`,
        [title, intro, rules, status, featureId]
      )
    } else {
      const [result] = await pool.query(
        `INSERT INTO couple_activity (title, intro, rules, capacity, status, created_by)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [title, intro, rules, status, req.userId]
      )
      featureId = result.insertId
    }
    await audit(req, '更新一周CP功能配置', 'couple_activity', featureId, { title, status })
    const feature = await coupleService.getActivityById(featureId)
    success(res, {
      feature: coupleService.mapFeature(feature),
      stats: await adminActivityStats(featureId)
    }, '一周CP配置已保存')
  } catch (e) {
    console.error('[couple.adminSaveActivity]', e.message)
    fail(res, '一周CP配置保存失败')
  }
}

exports.adminSignups = async (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const feature = await coupleService.getFeatureConfig()
    const activityId = intId(req.query.activityId) || (feature && feature.id)
    if (!activityId) return fail(res, '一周CP配置不存在')
    const status = req.query.status === '' || req.query.status === undefined ? null : Number(req.query.status)
    const where = ['s.activity_id = ?']
    const params = [activityId]
    if (status !== null) {
      if ([1, 2, 3, 4].indexOf(status) < 0) return fail(res, '报名状态不正确')
      where.push('s.status = ?')
      params.push(status)
    }
    const whereSql = where.join(' AND ')
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM couple_signup s WHERE ${whereSql}`, params),
      pool.query(
        `SELECT s.*, u.nick_name, u.avatar_url, u.phone, u.campus AS user_campus, u.gender AS user_gender
         FROM couple_signup s JOIN sys_user u ON u.id = s.user_id
         WHERE ${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    success(res, {
      list: rows.map((row) => Object.assign(coupleService.mapSignup(row), {
        user: {
          id: row.user_id,
          nickName: row.nick_name || '',
          avatarUrl: row.avatar_url || '',
          phone: row.phone || '',
          campus: row.user_campus || '',
          gender: Number(row.user_gender) || 0
        }
      })),
      total: Number(countRows[0] && countRows[0].total) || 0,
      page: Math.floor(offset / pageSize) + 1,
      pageSize
    })
  } catch (e) {
    console.error('[couple.adminSignups]', e.message)
    fail(res, '报名名单读取失败')
  }
}

exports.adminRunMatch = async (req, res) => {
  try {
    const dryRun = !!(req.body && req.body.dryRun)
    const result = await coupleService.runMatch(0, dryRun)
    if (result.error) return fail(res, result.error)
    await audit(req, dryRun ? '预览一周CP匹配' : '执行一周CP匹配', 'couple_activity', result.data.featureId, result.data.stats)
    success(res, result.data, dryRun ? '预览完成' : '匹配完成')
  } catch (e) {
    console.error('[couple.adminRunMatch]', e.message)
    fail(res, '匹配任务执行失败')
  }
}
