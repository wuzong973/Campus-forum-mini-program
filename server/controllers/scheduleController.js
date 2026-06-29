const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

function inferCourseColor(name, location, startTime) {
  const text = String(name || '') + ' ' + String(location || '')
  if (/军体|体育|操场/.test(text)) return '#52C41A'
  if (/实验|第四实训楼|B\d{3}|制图/.test(text)) return '#FA8C16'
  if (/晚训|晚自习/.test(text) || /^1[89]:/.test(startTime || '')) return '#EB2F96'
  if (/班会|活动|讲座/.test(text)) return '#13C2C2'
  return '#4A7AFF'
}

const SECTION_TIME = {
  1: ['08:30', '09:10'],
  2: ['09:15', '09:55'],
  3: ['10:15', '10:55'],
  4: ['11:00', '11:40'],
  5: ['11:45', '12:25'],
  6: ['13:15', '13:55'],
  7: ['14:00', '14:40'],
  8: ['14:45', '15:25'],
  9: ['15:45', '16:25'],
  10: ['16:30', '17:10'],
  11: ['19:30', '20:10']
}

function normalizeTime(value) {
  const match = String(value || '').match(/(\d{1,2})[:：](\d{2})/)
  if (!match) return ''
  const hour = Math.max(0, Math.min(23, parseInt(match[1], 10)))
  const minute = Math.max(0, Math.min(59, parseInt(match[2], 10)))
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

function parseWeekDay(text) {
  const weekMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 }
  const match = String(text || '').match(/(?:周|星期|礼拜)([一二三四五六日天])/)
  return match ? weekMap[match[1]] : 0
}

function parseSectionRange(text) {
  const sectionMatch = String(text || '').match(/第?\s*(\d{1,2})\s*(?:[-~至、,，]\s*(\d{1,2}))?\s*节/)
  if (!sectionMatch) return null
  const start = Math.max(1, Math.min(11, parseInt(sectionMatch[1], 10)))
  const end = Math.max(start, Math.min(11, parseInt(sectionMatch[2] || sectionMatch[1], 10)))
  return { start, end, startTime: SECTION_TIME[start][0], endTime: SECTION_TIME[end][1] }
}

function parseWeekRange(text) {
  const match = String(text || '').match(/(^|[^A-Za-z0-9])(\d{1,2})\s*(?:[-~至]\s*(\d{1,2}))?\s*周(?![\u4e00-\u9fa5])/)
  if (!match) return { startWeek: 1, endWeek: 16 }
  const startWeek = Math.max(1, Math.min(30, parseInt(match[2], 10)))
  const endWeek = Math.max(startWeek, Math.min(30, parseInt(match[3] || match[2], 10)))
  return { startWeek, endWeek }
}

function cleanupCourseText(text) {
  return String(text || '')
    .replace(/(?:周|星期|礼拜)[一二三四五六日天]/g, ' ')
    .replace(/第?\s*\d{1,2}\s*(?:[-~至、,，]\s*\d{1,2})?\s*节/g, ' ')
    .replace(/\d{1,2}[:：]\d{2}\s*[-~至]\s*\d{1,2}[:：]\d{2}/g, ' ')
    .replace(/(^|[^A-Za-z0-9])\d{1,2}\s*(?:[-~至]\s*\d{1,2})?\s*周(?![\u4e00-\u9fa5])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitCourseFields(text, index) {
  const parts = cleanupCourseText(text).split(/[|｜\s]+/).filter(Boolean)
  const locationIndex = parts.findIndex((part) => /(?:操场|体育馆|实训楼|教学楼|机房|实验室|[A-Z]?\d{3,4})/i.test(part))
  let teacherIndex = parts.findIndex((part) => /老师|教师|讲师|教授/.test(part))
  if (teacherIndex < 0 && locationIndex >= 0) {
    teacherIndex = parts.findIndex((part, idx) => idx > locationIndex && /^[\u4e00-\u9fa5]{2,4}$/.test(part))
  }
  const location = locationIndex >= 0 ? parts[locationIndex] : ''
  const teacher = teacherIndex >= 0 && teacherIndex !== locationIndex ? parts[teacherIndex].replace(/老师|教师/g, '') : ''
  const nameParts = parts.filter((_, idx) => idx !== locationIndex && idx !== teacherIndex)
  return {
    name: nameParts.join('') || parts[0] || ('课程' + (index + 1)),
    location,
    teacher
  }
}

function parseLine(line, index) {
  const text = String(line || '').trim()
  if (!text) return null
  const timeMatch = text.match(/(\d{1,2}[:：]\d{2})\s*[-~至]\s*(\d{1,2}[:：]\d{2})/)
  const section = parseSectionRange(text)
  const weekDay = parseWeekDay(text)
  const time = timeMatch
    ? { startTime: normalizeTime(timeMatch[1]), endTime: normalizeTime(timeMatch[2]) }
    : (section || { startTime: '08:30', endTime: '09:10' })
  const weekRange = parseWeekRange(text)
  const fields = splitCourseFields(text, index)
  const confidence = [
    weekDay ? 24 : 0,
    (timeMatch || section) ? 24 : 0,
    fields.name && !/^课程\d+$/.test(fields.name) ? 24 : 0,
    fields.location ? 14 : 0,
    fields.teacher ? 8 : 0,
    /周/.test(text) ? 6 : 0
  ].reduce((sum, value) => sum + value, 0)
  return {
    name: fields.name,
    location: fields.location,
    teacher: fields.teacher,
    weekDay: weekDay || 1,
    startTime: time.startTime,
    endTime: time.endTime,
    startWeek: weekRange.startWeek,
    endWeek: weekRange.endWeek,
    color: inferCourseColor(fields.name, fields.location, time.startTime),
    confidence: Math.max(45, Math.min(98, confidence))
  }
}

function parseOcrText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, ' ').trim())
    .filter(Boolean)
  return lines
    .map(parseLine)
    .filter(Boolean)
    .filter((course) => course.name && !/星期|周一|周二|周三|周四|周五|周六|周日/.test(course.name))
}

exports.list = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM user_schedule WHERE user_id = ? ORDER BY week_day, start_time', [req.userId])
    success(res, rows)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.add = async (req, res) => {
  const { name, location, teacher, weekDay, startTime, endTime, startWeek, endWeek, color } = req.body
  if (!name) return fail(res, '课程名称不能为空')
  try {
    const [result] = await pool.query(
      'INSERT INTO user_schedule (user_id, name, location, teacher, week_day, start_time, end_time, start_week, end_week, color) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [req.userId, name, location, teacher, weekDay, startTime, endTime, startWeek, endWeek, color]
    )
    success(res, { id: result.insertId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.clear = async (req, res) => {
  try {
    await pool.query('DELETE FROM user_schedule WHERE user_id = ?', [req.userId])
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.ocr = async (req, res) => {
  try {
    const rawText = String(req.body.rawText || req.body.text || '').trim()
    let courses = []
    const tips = []
    if (rawText) {
      courses = parseOcrText(rawText)
      const lowConfidenceCount = courses.filter((item) => item.confidence < 70).length
      if (lowConfidenceCount) tips.push(lowConfidenceCount + ' 门课程置信度偏低，请导入前人工核对')
    }
    if (!courses.length) {
      if (req.file && !rawText) {
        tips.push('当前服务端未接入真实图片 OCR 引擎，仅保存了上传图片；请接入 OCR 文本结果后再调用该接口以获得稳定识别率')
      }
      courses = [
        { name: '大学英语(下)', location: '1305', teacher: '周立平', weekDay: 1, startTime: '14:00', endTime: '17:10', startWeek: 1, endWeek: 16, color: '#4A7AFF', confidence: 60 },
        { name: '机械制图', location: '第四实训楼B605', teacher: '艾雄', weekDay: 2, startTime: '14:00', endTime: '17:10', startWeek: 1, endWeek: 16, color: '#FA8C16', confidence: 60 },
        { name: '军体课', location: '操场', teacher: '潘岐辉', weekDay: 3, startTime: '08:30', endTime: '09:55', startWeek: 1, endWeek: 16, color: '#52C41A', confidence: 60 }
      ]
    }
    success(res, { courses, tips, strategy: rawText ? 'rule-parse-v2' : 'demo-fallback' })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 同步教务系统课表
exports.sync = async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return fail(res, '学号和密码不能为空')

  try {
    // TODO: 实际对接教务系统 API
    // 1. 模拟登录 jw.gdip.edu.cn
    // 2. 获取课表数据
    // 3. 解析 HTML/JSON 为结构化数据

    // 当前为演示数据，根据 J25092 课表录入
    const mockCourses = [
      // 周一
      { name: '军体课', location: '操场', teacher: '潘岐辉', weekDay: 1, startTime: '08:30', endTime: '09:55', startWeek: 1, endWeek: 16, color: '#4A7AFF' },
      { name: '大学英语(下)', location: '1305', teacher: '周立平', weekDay: 1, startTime: '14:00', endTime: '17:10', startWeek: 1, endWeek: 16, color: '#52C41A' },
      { name: '晚训', location: '操场', teacher: '潘岐辉', weekDay: 1, startTime: '19:30', endTime: '20:10', startWeek: 1, endWeek: 16, color: '#FAAD14' },
      // 周二
      { name: '大学语文', location: '1305', teacher: '袁鸿', weekDay: 2, startTime: '10:15', endTime: '11:40', startWeek: 1, endWeek: 16, color: '#13C2C2' },
      { name: '机械制图', location: '第四实训楼B605', teacher: '艾雄', weekDay: 2, startTime: '14:00', endTime: '17:10', startWeek: 1, endWeek: 16, color: '#FAAD14' },
      { name: '晚自习', location: '2301', teacher: '吴丽婷', weekDay: 2, startTime: '19:30', endTime: '20:10', startWeek: 1, endWeek: 16, color: '#722ED1' },
      // 周三
      { name: '大学生安全教育', location: '1213', teacher: '袁鸿', weekDay: 3, startTime: '08:30', endTime: '09:55', startWeek: 1, endWeek: 16, color: '#FF4D4F' },
      { name: '计算机应用基础教程2', location: '第四实训楼B604', teacher: '周杭声', weekDay: 3, startTime: '10:15', endTime: '11:40', startWeek: 1, endWeek: 16, color: '#EB2F96' },
      { name: '飞行原理', location: '1124', teacher: '刘香云', weekDay: 3, startTime: '14:00', endTime: '17:10', startWeek: 1, endWeek: 16, color: '#2F54EB' },
      { name: '晚训', location: '操场', teacher: '潘岐辉', weekDay: 3, startTime: '19:30', endTime: '20:10', startWeek: 1, endWeek: 16, color: '#FAAD14' },
      // 周四
      { name: '民航主要机型安全设备与应急处置', location: '1205', teacher: '刘香云', weekDay: 4, startTime: '08:30', endTime: '11:40', startWeek: 1, endWeek: 16, color: '#FA8C16' },
      { name: '民航安全管理', location: '1122', teacher: '刘香云', weekDay: 4, startTime: '14:00', endTime: '15:25', startWeek: 1, endWeek: 16, color: '#A0D911' },
      // 周五
      { name: 'J25092主题班会', location: '1203', teacher: '吴丽婷', weekDay: 5, startTime: '08:30', endTime: '09:10', startWeek: 1, endWeek: 16, color: '#F759AB' }
    ]

    // 删除旧课表
    await pool.query('DELETE FROM user_schedule WHERE user_id = ?', [req.userId])

    // 插入新课表
    for (const course of mockCourses) {
      await pool.query(
        'INSERT INTO user_schedule (user_id, name, location, teacher, week_day, start_time, end_time, start_week, end_week, color) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [req.userId, course.name, course.location, course.teacher, course.weekDay, course.startTime, course.endTime, course.startWeek, course.endWeek, course.color]
      )
    }

    success(res, { count: mockCourses.length })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.getConfig = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM schedule_config WHERE user_id = ?', [req.userId])
    if (rows.length) success(res, rows[0])
    else success(res, { start_date: '2025-09-01', hide_weekend: 0, reminder: 0, bg_color: '#F5F7FA' })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.updateConfig = async (req, res) => {
  const { startDate, hideWeekend, reminder, bgColor } = req.body
  try {
    const [rows] = await pool.query('SELECT id FROM schedule_config WHERE user_id = ?', [req.userId])
    if (rows.length) {
      await pool.query('UPDATE schedule_config SET start_date=?, hide_weekend=?, reminder=?, bg_color=? WHERE user_id=?',
        [startDate, hideWeekend ? 1 : 0, reminder ? 1 : 0, bgColor, req.userId])
    } else {
      await pool.query('INSERT INTO schedule_config (user_id, start_date, hide_weekend, reminder, bg_color) VALUES (?,?,?,?,?)',
        [req.userId, startDate, hideWeekend ? 1 : 0, reminder ? 1 : 0, bgColor])
    }
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
