// 一周CP 业务服务：活动、报名、匹配、重新匹配、历史与私信只读校验
//
// 规则（与产品确认口径一致）：
//   · 总匹配名额 10 位（含首次），即最多换人 9 次
//   · 48 小时窗口从用户首次匹配成功开始，活动结束时间更早时提前截止
//   · 每个用户同一时刻只有一条有效配对；历史配对只读
//   · 重新匹配只把双方放回匹配池，新配对由下一批匹配任务统一生成

const pool = require('../config/pool')
const matcher = require('./coupleMatcher')
const notificationService = require('./notificationService')
const { toJsonColumn } = require('../utils/helpers')

const MAX_MATCHES = 10
const WINDOW_MS = 48 * 60 * 60 * 1000
const MBTI_TYPES = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP']
const COUPLE_PERSONA_RE = /^couple:(\d+)$/

let matchRunning = false

function pad(value) { return String(value).padStart(2, '0') }

function formatDateTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function timeValue(value) {
  if (!value) return 0
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? 0 : time
}

function parseArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

function int(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : 0
}

// 一周CP 是常驻功能，不是活动：couple_activity 在这套逻辑里只承载
// 标题 / 介绍 / 规则 / 维护开关，不再有报名期、匹配日、活动结束时间或名额。
function mapFeature(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title || '一周CP',
    intro: row.intro || '',
    rules: row.rules || '',
    status: int(row.status)
  }
}

function mapSignup(row) {
  if (!row) return null
  return {
    id: row.id,
    activityId: row.activity_id,
    gender: int(row.gender),
    campus: row.campus || '',
    grade: row.grade || '',
    height: int(row.height),
    mbti: row.mbti || '',
    photoUrl: row.photo_url || '',
    intro: row.intro || '',
    tags: parseArray(row.tags),
    expectGender: int(row.expect_gender),
    expectCampus: row.expect_campus || '',
    expectHeightMin: int(row.expect_height_min),
    expectHeightMax: int(row.expect_height_max),
    expectMbti: parseArray(row.expect_mbti),
    consent: Number(row.consent) === 1,
    status: int(row.status),
    createdAt: formatDateTime(row.created_at)
  }
}

function mapWindow(row) {
  if (!row) return null
  return {
    start: formatDateTime(row.window_start),
    end: formatDateTime(row.window_end),
    endAt: timeValue(row.window_end),
    used: int(row.match_count),
    remaining: Math.max(MAX_MATCHES - int(row.match_count), 0),
    status: int(row.status) === 1 ? 'active' : 'ended',
    currentMatchId: int(row.current_match_id)
  }
}

function mapPartner(userRow, signupRow) {
  if (!userRow) return null
  return {
    id: userRow.id,
    nickName: userRow.nick_name || '校园同学',
    avatarUrl: userRow.avatar_url || '',
    photoUrl: signupRow ? (signupRow.photo_url || '') : '',
    campus: (signupRow && signupRow.campus) || userRow.campus || '',
    grade: signupRow ? (signupRow.grade || '') : '',
    tags: signupRow ? parseArray(signupRow.tags) : [],
    intro: signupRow ? (signupRow.intro || '') : '',
    mbti: signupRow ? (signupRow.mbti || '') : ''
  }
}

async function getFeatureConfig() {
  const [rows] = await pool.query('SELECT * FROM couple_activity ORDER BY id ASC LIMIT 1')
  if (rows[0]) return rows[0]
  // 迁移通常已种入默认配置；这里兜底，避免空表时整页不可用
  const [result] = await pool.query(
    `INSERT INTO couple_activity (title, intro, rules, capacity, status)
     VALUES ('一周CP', '不急着一见钟情，先认真认识一个人。', '请尊重对方隐私，仅通过站内私信联系；历史配对只读。', 0, 1)`
  )
  const [created] = await pool.query('SELECT * FROM couple_activity WHERE id = ? LIMIT 1', [result.insertId])
  return created[0] || null
}

async function getActivityById(activityId) {
  if (!activityId) return null
  const [rows] = await pool.query('SELECT * FROM couple_activity WHERE id = ? LIMIT 1', [activityId])
  return rows[0] || null
}

async function expireActivityMatches(activityId) {
  if (!activityId) return
  await pool.query(
    `UPDATE couple_match SET status = 2, closed_reason = '窗口结束', closed_at = NOW()
     WHERE activity_id = ? AND status = 1 AND window_end <= NOW()`,
    [activityId]
  )
  await pool.query(
    `UPDATE couple_window SET current_match_id = 0, status = IF(window_end <= NOW(), 2, status)
     WHERE activity_id = ? AND current_match_id > 0
       AND NOT EXISTS (SELECT 1 FROM couple_match m WHERE m.id = couple_window.current_match_id AND m.status = 1)`,
    [activityId]
  )
  await pool.query(
    `UPDATE couple_window SET current_match_id = 0, status = 2
     WHERE activity_id = ? AND status = 1 AND window_end <= NOW()`,
    [activityId]
  )
  // 被释放回池的用户恢复为可匹配；窗口已结束或已达 10 位的用户不再进入候选池
  await pool.query(
    `UPDATE couple_signup s
     JOIN couple_window w ON w.user_id = s.user_id AND w.activity_id = s.activity_id
     SET s.status = 1
     WHERE s.activity_id = ? AND s.status = 2
       AND w.current_match_id = 0 AND w.status = 1 AND w.match_count < ?`,
    [activityId, MAX_MATCHES]
  )
}

async function countSignups(activityId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM couple_signup WHERE activity_id = ? AND status IN (1, 2)`,
    [activityId]
  )
  return int(rows[0] && rows[0].total)
}

async function loadMatchSummary(matchId, userId) {
  if (!matchId) return null
  const [rows] = await pool.query(
    `SELECT m.*, u.id AS partner_user_id, u.nick_name, u.avatar_url,
       s.photo_url, s.campus, s.grade, s.tags
     FROM couple_match m
     JOIN sys_user u ON u.id = IF(m.user_a = ?, m.user_b, m.user_a)
     LEFT JOIN couple_signup s ON s.activity_id = m.activity_id AND s.user_id = u.id
     WHERE m.id = ? AND (m.user_a = ? OR m.user_b = ?) LIMIT 1`,
    [userId, matchId, userId, userId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    score: int(row.score),
    status: int(row.status) === 1 ? 'active' : 'closed',
    commonTags: parseArray(row.common_tags),
    createdAt: formatDateTime(row.created_at),
    windowEnd: formatDateTime(row.window_end),
    windowEndAt: timeValue(row.window_end),
    partner: mapPartner(Object.assign({}, row, { id: row.partner_user_id }), row) || {
      id: row.partner_user_id,
      nickName: '已注销用户',
      avatarUrl: '',
      photoUrl: '',
      campus: '',
      grade: '',
      tags: [],
      intro: '',
      mbti: ''
    }
  }
}

async function getUserState(userId) {
  const feature = await getFeatureConfig()
  if (!feature) return { feature: null, signup: null, window: null, currentMatch: null, historyCount: 0 }
  await expireActivityMatches(feature.id)
  const [signupRows] = await pool.query(
    'SELECT * FROM couple_signup WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [feature.id, userId]
  )
  const [windowRows] = await pool.query(
    'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [feature.id, userId]
  )
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM couple_match WHERE (user_a = ? OR user_b = ?)',
    [userId, userId]
  )
  const window = windowRows[0] || null
  let currentMatch = null
  if (window && int(window.current_match_id)) {
    currentMatch = await loadMatchSummary(int(window.current_match_id), userId)
    if (!currentMatch || currentMatch.status !== 'active') {
      await pool.query('UPDATE couple_window SET current_match_id = 0 WHERE user_id = ? AND activity_id = ?', [userId, feature.id])
      currentMatch = null
    }
  }
  return {
    feature: mapFeature(feature),
    signup: mapSignup(signupRows[0]),
    window: mapWindow(window),
    currentMatch,
    historyCount: int(countRows[0] && countRows[0].total)
  }
}

function normalizeTags(value) {
  return matcher.normalizeTags(value)
}

function normalizeMbti(value) {
  const text = String(value || '').trim().toUpperCase()
  return MBTI_TYPES.indexOf(text) > -1 ? text : ''
}

function normalizeExpectMbti(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => MBTI_TYPES.indexOf(item) > -1)
    .slice(0, 4)
}

function validHeight(value) {
  const height = int(value)
  if (!height) return 0
  return height >= 140 && height <= 220 ? height : -1
}

function validateSignup(body, user) {
  const data = {}
  const gender = int(body.gender) || int(user.gender)
  if (gender !== 1 && gender !== 2) return { error: '请选择性别' }
  data.gender = gender

  const campus = String(body.campus || user.campus || '').trim()
  if (!campus || campus.length > 64) return { error: '请选择校区' }
  data.campus = campus

  const grade = String(body.grade || '').trim()
  if (!grade || grade.length > 16) return { error: '请选择年级' }
  data.grade = grade

  const height = validHeight(body.height)
  if (height < 0) return { error: '身高需在 140–220cm 之间' }
  data.height = height

  const mbti = normalizeMbti(body.mbti)
  if (body.mbti && !mbti) return { error: 'MBTI 取值不正确' }
  data.mbti = mbti

  const photoUrl = String(body.photoUrl || '').trim()
  if (photoUrl && !/^https:\/\/\S{1,512}$/i.test(photoUrl)) return { error: '照片地址不合法' }
  data.photo_url = photoUrl

  const intro = String(body.intro || '').trim()
  if (intro.length < 10) return { error: '一句话介绍至少写 10 个字' }
  if (intro.length > 200) return { error: '一句话介绍不能超过 200 字' }
  data.intro = intro

  const tags = normalizeTags(body.tags)
  if (tags.length < 2) return { error: '至少选择 2 个兴趣标签' }
  if (tags.length > 8) return { error: '兴趣标签最多 8 个' }
  data.tags = tags

  const expectGender = int(body.expectGender)
  if ([0, 1, 2].indexOf(expectGender) < 0) return { error: '期望性别取值不正确' }
  data.expect_gender = expectGender

  const expectCampus = String(body.expectCampus || '').trim()
  if (expectCampus.length > 64) return { error: '期望校区取值不正确' }
  data.expect_campus = expectCampus

  const expectHeightMin = int(body.expectHeightMin)
  const expectHeightMax = int(body.expectHeightMax)
  if ((expectHeightMin || expectHeightMax) &&
    (expectHeightMin < 140 || expectHeightMax > 220 || expectHeightMin >= expectHeightMax ||
      (expectHeightMin % 5) || (expectHeightMax % 5))) {
    return { error: '期望身高需按 5cm 区间选择，且最低小于最高' }
  }
  data.expect_height_min = expectHeightMin
  data.expect_height_max = expectHeightMax

  const expectMbti = normalizeExpectMbti(body.expectMbti)
  data.expect_mbti = expectMbti
  if (body.consent !== true) return { error: '请先阅读并同意活动规则与隐私说明' }
  data.consent = 1
  return { data }
}

async function signup(userId, body) {
  const feature = await getFeatureConfig()
  if (!feature) return { error: '一周CP暂不可用' }
  if (Number(feature.status) !== 1) return { error: '一周CP功能维护中' }

  const [userRows] = await pool.query('SELECT id, gender, campus, status FROM sys_user WHERE id = ? LIMIT 1', [userId])
  const user = userRows[0]
  if (!user || Number(user.status) !== 1) return { error: '账号不可用' }
  const checked = validateSignup(body, user)
  if (checked.error) return { error: checked.error }
  const data = checked.data

  const [windowRows] = await pool.query(
    'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [feature.id, userId]
  )
  const windowRow = windowRows[0]
  if (windowRow && int(windowRow.current_match_id)) {
    const [matchRows] = await pool.query(
      'SELECT status, window_end FROM couple_match WHERE id = ? LIMIT 1',
      [int(windowRow.current_match_id)]
    )
    const current = matchRows[0]
    if (current && Number(current.status) === 1 && timeValue(current.window_end) > Date.now()) {
      return { error: '你已有进行中的配对，请先在结果页处理' }
    }
    await pool.query(
      'UPDATE couple_window SET current_match_id = 0 WHERE user_id = ? AND activity_id = ?',
      [userId, feature.id]
    )
  }
  if (windowRow && Number(windowRow.status) === 1 &&
    timeValue(windowRow.window_end) > Date.now() && int(windowRow.match_count) >= MAX_MATCHES) {
    return { error: '本轮已匹配 10 位，请等待本轮结束后开启新一轮' }
  }
  // 48 小时本轮结束后，用户重新提交资料即开启新一轮：
  // 删除旧窗口（历史配对仍保留），首次匹配成功时会重新创建窗口并重新计时。
  if (windowRow && (Number(windowRow.status) !== 1 || timeValue(windowRow.window_end) <= Date.now())) {
    await pool.query(
      'DELETE FROM couple_window WHERE user_id = ? AND activity_id = ?',
      [userId, feature.id]
    )
  }

  await pool.query(
    `INSERT INTO couple_signup
      (activity_id, user_id, gender, campus, grade, height, mbti, photo_url, intro, tags,
       expect_gender, expect_campus, expect_height_min, expect_height_max, expect_mbti, consent, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       gender = VALUES(gender), campus = VALUES(campus), grade = VALUES(grade),
       height = VALUES(height), mbti = VALUES(mbti), photo_url = VALUES(photo_url),
       intro = VALUES(intro), tags = VALUES(tags), expect_gender = VALUES(expect_gender),
       expect_campus = VALUES(expect_campus), expect_height_min = VALUES(expect_height_min),
       expect_height_max = VALUES(expect_height_max), expect_mbti = VALUES(expect_mbti),
       consent = VALUES(consent), status = 1`,
    [
      feature.id, userId, data.gender, data.campus, data.grade, data.height, data.mbti,
      data.photo_url, data.intro, toJsonColumn(data.tags), data.expect_gender, data.expect_campus,
      data.expect_height_min, data.expect_height_max, toJsonColumn(data.expect_mbti), data.consent
    ]
  )
  return { data: await getUserState(userId) }
}

async function getMatchDetail(userId, matchId) {
  const [rows] = await pool.query('SELECT * FROM couple_match WHERE id = ? LIMIT 1', [matchId])
  const match = rows[0]
  if (!match) return { error: '配对不存在', code: 404 }
  if (Number(match.user_a) !== Number(userId) && Number(match.user_b) !== Number(userId)) {
    return { error: '无权查看该配对', code: 403 }
  }
  await expireActivityMatches(match.activity_id)
  const [freshRows] = await pool.query('SELECT * FROM couple_match WHERE id = ? LIMIT 1', [matchId])
  const fresh = freshRows[0]
  const partnerId = Number(fresh.user_a) === Number(userId) ? fresh.user_b : fresh.user_a
  const [userRows] = await pool.query(
    `SELECT id, nick_name, avatar_url, gender, campus FROM sys_user WHERE id IN (?, ?)`,
    [userId, partnerId]
  )
  const meUser = userRows.find((row) => Number(row.id) === Number(userId))
  const partnerUser = userRows.find((row) => Number(row.id) === Number(partnerId))
  const [signupRows] = await pool.query(
    `SELECT * FROM couple_signup WHERE activity_id = ? AND user_id IN (?, ?)`,
    [fresh.activity_id, userId, partnerId]
  )
  const meSignup = signupRows.find((row) => Number(row.user_id) === Number(userId))
  const partnerSignup = signupRows.find((row) => Number(row.user_id) === Number(partnerId))
  const [windowRows] = await pool.query(
    'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [fresh.activity_id, userId]
  )
  const windowRow = windowRows[0]
  const active = Number(fresh.status) === 1 && timeValue(fresh.window_end) > Date.now()
  const window = mapWindow(windowRow) || {
    start: '',
    end: '',
    endAt: 0,
    used: 0,
    remaining: MAX_MATCHES,
    status: 'ended',
    currentMatchId: 0
  }
  const partner = mapPartner(partnerUser, partnerSignup) || {
    id: partnerId,
    nickName: '已注销用户',
    avatarUrl: '',
    photoUrl: '',
    campus: '',
    grade: '',
    tags: [],
    intro: '',
    mbti: ''
  }
  return {
    data: {
      id: fresh.id,
      status: active ? 'active' : 'closed',
      score: int(fresh.score),
      commonTags: parseArray(fresh.common_tags),
      createdAt: formatDateTime(fresh.created_at),
      windowEnd: formatDateTime(fresh.window_end),
      windowEndAt: timeValue(fresh.window_end),
      canSend: active,
      canRematch: active && !!windowRow && Number(windowRow.status) === 1 && int(windowRow.match_count) < MAX_MATCHES,
      personaKey: 'couple:' + fresh.id,
      chatPeerId: partnerId,
      me: {
        id: userId,
        nickName: (meUser && meUser.nick_name) || '我',
        avatarUrl: (meUser && meUser.avatar_url) || '',
        photoUrl: meSignup ? (meSignup.photo_url || '') : '',
        campus: meSignup ? (meSignup.campus || '') : ((meUser && meUser.campus) || ''),
        grade: meSignup ? (meSignup.grade || '') : ''
      },
      partner,
      window
    }
  }
}

async function getHistory(userId) {
  const feature = await getFeatureConfig()
  if (!feature) return { feature: null, current: null, list: [] }
  await expireActivityMatches(feature.id)
  const [windowRows] = await pool.query(
    'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [feature.id, userId]
  )
  const windowRow = windowRows[0]
  const currentMatchId = windowRow ? int(windowRow.current_match_id) : 0
  const [rows] = await pool.query(
    `SELECT m.*,
       u.id AS partner_id, u.nick_name, u.avatar_url,
       s.photo_url, s.campus, s.grade, s.tags
     FROM couple_match m
     JOIN sys_user u ON u.id = IF(m.user_a = ?, m.user_b, m.user_a)
     LEFT JOIN couple_signup s ON s.activity_id = m.activity_id AND s.user_id = u.id
     WHERE (m.user_a = ? OR m.user_b = ?)
     ORDER BY m.created_at DESC, m.id DESC LIMIT 50`,
    [userId, userId, userId]
  )
  const list = rows.map((row) => ({
    id: row.id,
    status: int(row.status) === 1 ? 'active' : 'closed',
    isCurrent: Number(row.id) === currentMatchId,
    score: int(row.score),
    commonTags: parseArray(row.common_tags),
    createdAt: formatDateTime(row.created_at),
    windowEnd: formatDateTime(row.window_end),
    windowEndAt: timeValue(row.window_end),
    canSend: Number(row.status) === 1 && timeValue(row.window_end) > Date.now(),
    personaKey: 'couple:' + row.id,
    chatPeerId: row.partner_id,
    partner: mapPartner(Object.assign({}, row, { id: row.partner_id }), row)
  }))
  return {
    feature: mapFeature(feature),
    current: list.find((item) => item.isCurrent) || null,
    list,
    window: mapWindow(windowRow)
  }
}

async function rematch(userId, matchId) {
  const [rows] = await pool.query('SELECT * FROM couple_match WHERE id = ? LIMIT 1', [matchId])
  const match = rows[0]
  if (!match) return { error: '配对不存在', code: 404 }
  if (Number(match.user_a) !== Number(userId) && Number(match.user_b) !== Number(userId)) {
    return { error: '无权操作该配对', code: 403 }
  }
  if (Number(match.status) !== 1) return { error: '该配对已结束' }
  await expireActivityMatches(match.activity_id)
  const [freshRows] = await pool.query('SELECT * FROM couple_match WHERE id = ? LIMIT 1', [matchId])
  const fresh = freshRows[0]
  if (Number(fresh.status) !== 1) return { error: '该配对已结束' }
  const [windowRows] = await pool.query(
    'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? LIMIT 1',
    [fresh.activity_id, userId]
  )
  const windowRow = windowRows[0]
  if (!windowRow || Number(windowRow.status) !== 1 || timeValue(windowRow.window_end) <= Date.now()) {
    return { error: '本轮匹配已结束' }
  }
  if (int(windowRow.current_match_id) !== Number(matchId)) return { error: '该配对不是当前配对' }
  if (int(windowRow.match_count) >= MAX_MATCHES) return { error: '本轮已匹配 10 位，无法继续匹配' }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [lockRows] = await conn.query('SELECT * FROM couple_match WHERE id = ? FOR UPDATE', [matchId])
    const locked = lockRows[0]
    if (!locked || Number(locked.status) !== 1) throw new Error('该配对已结束')
    await conn.query(
      `UPDATE couple_match SET status = 2, closed_reason = '重新匹配', closed_at = NOW() WHERE id = ?`,
      [matchId]
    )
    await conn.query(
      'UPDATE couple_window SET current_match_id = 0 WHERE activity_id = ? AND user_id IN (?, ?)',
      [fresh.activity_id, fresh.user_a, fresh.user_b]
    )
    await conn.query(
      `UPDATE couple_signup s
       JOIN couple_window w ON w.user_id = s.user_id AND w.activity_id = s.activity_id
       SET s.status = 1
       WHERE s.activity_id = ? AND s.user_id IN (?, ?)
         AND w.current_match_id = 0 AND w.status = 1 AND w.match_count < ?`,
      [fresh.activity_id, fresh.user_a, fresh.user_b, MAX_MATCHES]
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    return { error: e.message || '重新匹配失败' }
  } finally {
    conn.release()
  }
  // 中性通知：不暴露是谁发起的重新匹配，只告知对方已回到匹配池
  const partnerId = Number(fresh.user_a) === Number(userId) ? fresh.user_b : fresh.user_a
  notificationService.createNotification({
    userId: partnerId,
    type: 'system',
    title: '一周CP配对已结束',
    content: '对方申请了重新匹配，你已回到匹配池。',
    relatedId: matchId
  }).catch((error) => console.warn('[CoupleRematchNotify]', error.message))
  return {
    data: {
      closedMatchId: matchId,
      remaining: Math.max(MAX_MATCHES - int(windowRow.match_count), 0)
    }
  }
}

async function buildCandidateSignups(activityId, blockedPairs) {
  const [rows] = await pool.query(
    `SELECT s.*, u.nick_name, u.avatar_url, u.gender AS user_gender, u.campus AS user_campus,
       w.match_count, w.current_match_id, w.window_end, w.status AS window_status
     FROM couple_signup s
     JOIN sys_user u ON u.id = s.user_id AND u.status = 1
     LEFT JOIN couple_window w ON w.user_id = s.user_id AND w.activity_id = s.activity_id
     WHERE s.activity_id = ? AND s.status = 1
       AND (w.user_id IS NULL OR (w.current_match_id = 0 AND w.match_count < ?
         AND w.status = 1 AND w.window_end > NOW()))`,
    [activityId, MAX_MATCHES]
  )
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    gender: int(row.gender) || int(row.user_gender),
    campus: row.campus || row.user_campus || '',
    grade: row.grade || '',
    height: int(row.height),
    mbti: row.mbti || '',
    tags: parseArray(row.tags),
    expectGender: int(row.expect_gender),
    expectCampus: row.expect_campus || '',
    expectHeightMin: int(row.expect_height_min),
    expectHeightMax: int(row.expect_height_max),
    expectMbti: parseArray(row.expect_mbti),
    nickName: row.nick_name || '校园同学'
  }))
}

async function createPair(feature, a, b, score, commonTags) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [windowA] = await conn.query(
      'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? FOR UPDATE',
      [feature.id, a.userId]
    )
    const [windowB] = await conn.query(
      'SELECT * FROM couple_window WHERE activity_id = ? AND user_id = ? FOR UPDATE',
      [feature.id, b.userId]
    )
    const now = Date.now()
    const limitEnd = now + WINDOW_MS

    function windowBounds(row) {
      if (!row) return { start: now, end: limitEnd, fresh: true }
      if (Number(row.status) !== 1 || int(row.current_match_id) || int(row.match_count) >= MAX_MATCHES) return null
      const end = timeValue(row.window_end)
      if (end <= now) return null
      return { start: timeValue(row.window_start), end, fresh: false }
    }

    const boundsA = windowBounds(windowA[0])
    const boundsB = windowBounds(windowB[0])
    if (!boundsA || !boundsB) throw new Error('候选用户状态已变化')
    const matchEnd = Math.min(boundsA.end, boundsB.end)
    if (matchEnd <= now) throw new Error('匹配窗口已结束')

    const userA = Math.min(Number(a.userId), Number(b.userId))
    const userB = Math.max(Number(a.userId), Number(b.userId))
    const [result] = await conn.query(
      `INSERT INTO couple_match
        (activity_id, user_a, user_b, score, common_tags, status, window_start, window_end)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)`,
      [feature.id, userA, userB, score, toJsonColumn(commonTags), new Date(matchEnd)]
    )
    const matchId = result.insertId

    if (boundsA.fresh) {
      await conn.query(
        `INSERT INTO couple_window
          (user_id, activity_id, window_start, window_end, match_count, current_match_id, status)
         VALUES (?, ?, ?, ?, 1, ?, 1)`,
        [a.userId, feature.id, new Date(boundsA.start), new Date(boundsA.end), matchId]
      )
    } else {
      const [updatedA] = await conn.query(
        `UPDATE couple_window SET match_count = match_count + 1, current_match_id = ?
         WHERE activity_id = ? AND user_id = ? AND current_match_id = 0
           AND match_count < ? AND status = 1`,
        [matchId, feature.id, a.userId, MAX_MATCHES]
      )
      if (updatedA.affectedRows !== 1) throw new Error('候选用户状态已变化')
    }
    if (boundsB.fresh) {
      await conn.query(
        `INSERT INTO couple_window
          (user_id, activity_id, window_start, window_end, match_count, current_match_id, status)
         VALUES (?, ?, ?, ?, 1, ?, 1)`,
        [b.userId, feature.id, new Date(boundsB.start), new Date(boundsB.end), matchId]
      )
    } else {
      const [updatedB] = await conn.query(
        `UPDATE couple_window SET match_count = match_count + 1, current_match_id = ?
         WHERE activity_id = ? AND user_id = ? AND current_match_id = 0
           AND match_count < ? AND status = 1`,
        [matchId, feature.id, b.userId, MAX_MATCHES]
      )
      if (updatedB.affectedRows !== 1) throw new Error('候选用户状态已变化')
    }
    const [signupUpdated] = await conn.query(
      'UPDATE couple_signup SET status = 2 WHERE id IN (?, ?) AND status = 1',
      [a.id, b.id]
    )
    if (signupUpdated.affectedRows !== 2) throw new Error('候选用户状态已变化')
    await conn.commit()
    return matchId
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function runMatch(_activityId, dryRun = false) {
  if (matchRunning) return { error: '匹配任务正在进行中，请稍后再试' }
  matchRunning = true
  try {
    const feature = await getFeatureConfig()
    if (!feature) return { error: '一周CP配置不存在' }
    if (Number(feature.status) !== 1) return { error: '一周CP功能维护中' }
    await expireActivityMatches(feature.id)

    const [blockedRows] = await pool.query(
      'SELECT user_a, user_b FROM couple_match WHERE activity_id = ?',
      [feature.id]
    )
    const blocked = {}
    blockedRows.forEach((row) => {
      const a = Math.min(Number(row.user_a), Number(row.user_b))
      const b = Math.max(Number(row.user_a), Number(row.user_b))
      blocked[a + ':' + b] = true
    })

    const candidates = await buildCandidateSignups(feature.id, blocked)
    const result = matcher.buildMatches(candidates, {
      seed: Date.now(),
      blockedPairs: blocked
    })
    const sample = result.pairs.slice(0, 10).map((pair) => ({
      a: pair.a.nickName,
      b: pair.b.nickName,
      score: pair.score
    }))
    if (dryRun) {
      return {
        data: {
          dryRun: true,
          featureId: feature.id,
          stats: result.stats,
          sample,
          unmatched: result.unmatched.slice(0, 20).map((item) => item.nickName)
        }
      }
    }

    let created = 0
    for (const pair of result.pairs) {
      try {
        await createPair(feature, pair.a, pair.b, pair.score, pair.commonTags)
        created += 1
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') continue
        console.warn('[CoupleMatch] pair skipped:', e.message)
      }
    }
    return {
      data: {
        dryRun: false,
        featureId: feature.id,
        stats: Object.assign({}, result.stats, { created }),
        sample,
        unmatched: result.unmatched.slice(0, 20).map((item) => item.nickName)
      }
    }
  } finally {
    matchRunning = false
  }
}

async function assertCoupleChatAllowed(senderId, receiverId, personaKey) {
  const matched = COUPLE_PERSONA_RE.exec(String(personaKey || ''))
  if (!matched) return null
  const matchId = int(matched[1])
  if (!matchId) throw new Error('配对不存在')
  const [rows] = await pool.query('SELECT * FROM couple_match WHERE id = ? LIMIT 1', [matchId])
  const match = rows[0]
  if (!match) throw new Error('配对不存在')
  const sender = Number(senderId)
  const receiver = Number(receiverId)
  if (!((Number(match.user_a) === sender && Number(match.user_b) === receiver) ||
    (Number(match.user_a) === receiver && Number(match.user_b) === sender))) {
    throw new Error('无权向该配对发送消息')
  }
  if (Number(match.status) !== 1 || timeValue(match.window_end) <= Date.now()) {
    await expireActivityMatches(match.activity_id)
    throw new Error('该配对已结束，仅可查看历史消息')
  }
  return match
}

module.exports = {
  MAX_MATCHES,
  WINDOW_MS,
  getFeatureConfig,
  getActivityById,
  getUserState,
  signup,
  getMatchDetail,
  getHistory,
  rematch,
  runMatch,
  assertCoupleChatAllowed,
  expireActivityMatches,
  mapFeature,
  mapSignup,
  mapWindow,
  mapPartner,
  countSignups
}
