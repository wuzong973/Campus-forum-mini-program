const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

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

exports.ocr = async (req, res) => {
  success(res, {
    courses: [
      { name: '高等数学', location: '教学楼A101', teacher: '张老师', weekDay: 1, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, color: '#4A7AFF' }
    ]
  })
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
