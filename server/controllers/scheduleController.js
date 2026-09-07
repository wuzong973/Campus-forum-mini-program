const pool = require("../config/pool");
const { success, fail } = require("../middleware/auth");
const { safeMessage } = require("../utils/helpers");
const {
  DEFAULT_SEMESTER_START,
  syncScheduleFromJw,
  refreshFromJw,
  submitScheduleCaptcha,
  getJwBinding,
} = require("../services/jwScheduleSyncService");

function inferCourseColor(name, location, startTime) {
  const text = String(name || "") + " " + String(location || "");
  if (/军体|体育|操场/.test(text)) return "#52C41A";
  if (/实验|第四实训楼|B\d{3}|制图/.test(text)) return "#FA8C16";
  if (/晚训|晚自习/.test(text) || /^1[89]:/.test(startTime || "")) return "#EB2F96";
  if (/班会|活动|讲座/.test(text)) return "#13C2C2";
  return "#4A7AFF";
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
    const [rows] = await pool.query(
      `SELECT
        id,
        user_id AS userId,
        name,
        location,
        teacher,
        week_day AS weekDay,
        start_time AS startTime,
        end_time AS endTime,
        start_week AS startWeek,
        end_week AS endWeek,
        COALESCE(week_type, 'all') AS weekType,
        color,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM user_schedule
      WHERE user_id = ?
      ORDER BY week_day, start_time, start_week`,
      [req.userId],
    );
    success(res, rows);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.add = async (req, res) => {
  const {
    name,
    location,
    teacher,
    weekDay,
    startTime,
    endTime,
    startWeek,
    endWeek,
    weekType,
    color,
  } = req.body;
  if (!String(name || '').trim()) return fail(res, "课程名称不能为空");
  const normalizedWeekDay = Number(weekDay);
  const normalizedStartWeek = Number(startWeek || 1);
  const normalizedEndWeek = Number(endWeek || normalizedStartWeek);
  const normalizedWeekType = ['all', 'odd', 'even'].includes(weekType) ? weekType : 'all';
  if (!Number.isInteger(normalizedWeekDay) || normalizedWeekDay < 1 || normalizedWeekDay > 7) return fail(res, "星期参数无效");
  if (!Number.isInteger(normalizedStartWeek) || !Number.isInteger(normalizedEndWeek) || normalizedStartWeek < 1 || normalizedEndWeek < normalizedStartWeek || normalizedEndWeek > 30) return fail(res, "周次范围无效");
  try {
    const [result] = await pool.query(
      "INSERT INTO user_schedule (user_id, name, location, teacher, week_day, start_time, end_time, start_week, end_week, week_type, color) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        req.userId,
        String(name).trim().slice(0, 64),
        String(location || '').trim().slice(0, 128),
        String(teacher || '').trim().slice(0, 64),
        normalizedWeekDay,
        String(startTime || '').trim().slice(0, 8),
        String(endTime || '').trim().slice(0, 8),
        normalizedStartWeek,
        normalizedEndWeek,
        normalizedWeekType,
        String(color || '').trim().slice(0, 16),
      ],
    );
    success(res, { id: result.insertId });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.replace = async (req, res) => {
  const courses = Array.isArray(req.body.courses) ? req.body.courses : [];
  if (!courses.length || courses.length > 100) return fail(res, "课程数据不能为空且最多导入100门");
  const normalized = [];
  for (const course of courses) {
    const name = String(course.name || '').trim();
    const weekDay = Number(course.weekDay);
    const startWeek = Number(course.startWeek || 1);
    const endWeek = Number(course.endWeek || startWeek);
    if (!name || !Number.isInteger(weekDay) || weekDay < 1 || weekDay > 7 || !Number.isInteger(startWeek) || !Number.isInteger(endWeek) || startWeek < 1 || endWeek < startWeek || endWeek > 30) {
      return fail(res, "课程数据格式无效");
    }
    normalized.push({
      name: name.slice(0, 64),
      location: String(course.location || '').trim().slice(0, 128),
      teacher: String(course.teacher || '').trim().slice(0, 64),
      weekDay,
      startTime: String(course.startTime || '').trim().slice(0, 8),
      endTime: String(course.endTime || '').trim().slice(0, 8),
      startWeek,
      endWeek,
      weekType: ['all', 'odd', 'even'].includes(course.weekType) ? course.weekType : 'all',
      color: String(course.color || '').trim().slice(0, 16),
    });
  }
  try {
    await persistScheduleCourses(req.userId, normalized);
    success(res, { count: normalized.length });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.clear = async (req, res) => {
  try {
    await pool.query("DELETE FROM user_schedule WHERE user_id = ?", [req.userId]);
    success(res, null);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.ocr = async (req, res) => {
  try {
    const rawText = String(req.body.rawText || req.body.text || "").trim();
    let courses = [];
    const tips = [];
    if (rawText) {
      courses = parseOcrText(rawText);
      const lowConfidenceCount = courses.filter(
        (item) => item.confidence < 70,
      ).length;
      if (lowConfidenceCount)
        tips.push(lowConfidenceCount + " 门课程置信度偏低，请导入前人工核对");
    }
    if (!courses.length) return fail(res, "未能识别出有效课程，请上传清晰完整的课表截图", 422)
    success(res, {
      courses,
      tips,
      strategy: "rule-parse-v2",
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

// ===== 同步结果落库与响应组装（课表/考试/成绩共用） =====

async function persistScheduleCourses(userId, courses) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM user_schedule WHERE user_id = ?", [
      userId,
    ]);

    for (const course of courses) {
      await connection.query(
        "INSERT INTO user_schedule (user_id, name, location, teacher, week_day, start_time, end_time, start_week, end_week, week_type, color) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          userId,
          course.name,
          course.location,
          course.teacher,
          course.weekDay,
          course.startTime,
          course.endTime,
          course.startWeek,
          course.endWeek,
          course.weekType || "all",
          course.color || inferCourseColor(course.name, course.location, course.startTime),
        ],
      );
    }

    await connection.commit();
  } catch (dbError) {
    await connection.rollback();
    throw dbError;
  } finally {
    connection.release();
  }
}

async function persistExams(userId, exams) {
  if (!exams || !exams.length) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM user_exam WHERE user_id = ?", [userId]);
    for (const exam of exams) {
      await connection.query(
        "INSERT INTO user_exam (user_id, name, type, date, time, location, seat, semester, raw) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          userId,
          String(exam.name || "").slice(0, 128),
          String(exam.type || "").slice(0, 32),
          String(exam.date || "").slice(0, 32),
          String(exam.time || "").slice(0, 64),
          String(exam.location || "").slice(0, 128),
          String(exam.seat || "").slice(0, 32),
          String(exam.semester || "").slice(0, 32),
          exam.raw ? JSON.stringify(exam.raw) : null,
        ],
      );
    }
    await connection.commit();
  } catch (dbError) {
    await connection.rollback();
    throw dbError;
  } finally {
    connection.release();
  }
}

async function persistGrades(userId, grades) {
  if (!grades || !grades.length) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM user_grade WHERE user_id = ?", [userId]);
    for (const grade of grades) {
      await connection.query(
        "INSERT INTO user_grade (user_id, semester, name, attribute, credit, gpa, score, raw) VALUES (?,?,?,?,?,?,?,?)",
        [
          userId,
          String(grade.semester || "").slice(0, 32),
          String(grade.name || "").slice(0, 128),
          String(grade.attribute || "").slice(0, 32),
          String(grade.credit || "").slice(0, 16),
          String(grade.gpa || "").slice(0, 16),
          String(grade.score || "").slice(0, 16),
          grade.raw ? JSON.stringify(grade.raw) : null,
        ],
      );
    }
    await connection.commit();
  } catch (dbError) {
    await connection.rollback();
    throw dbError;
  } finally {
    connection.release();
  }
}

// 考试/成绩抓取失败不阻断课表同步：落库失败仅记录警告，不回滚课表
function buildSyncPayload(result) {
  return {
    count: result.courses.length,
    courses: result.courses,
    startDate: result.meta.semesterStart,
    totalWeeks: result.meta.totalWeeks,
    rawWeekCount: result.meta.rawWeekCount,
    rawCourseCount: result.meta.rawCourseCount,
    partial: !!result.meta.partial,
    currentWeek: result.meta.currentWeek || null,
    fast: !!result.meta.fast,
    concurrency: result.meta.concurrency || null,
    exams: result.exams || [],
    grades: result.grades || [],
    warnings: result.warnings || [],
  };
}

exports.sync = async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) return fail(res, "学号和密码不能为空");
  if (!/^\d{6,20}$/.test(username)) return fail(res, "请输入正确的教务账号");

  try {
    const [[user]] = await pool.query(
      "SELECT student_id, is_verified FROM sys_user WHERE id = ? LIMIT 1",
      [req.userId],
    );
    if (!user) return fail(res, "用户不存在", 404);
    if (
      user.is_verified &&
      user.student_id &&
      String(user.student_id).trim() !== username
    ) {
      return fail(res, "当前登录用户仅允许同步本人认证学号的课表", 403);
    }

    const [[configRow]] = await pool.query(
      "SELECT start_date FROM schedule_config WHERE user_id = ? LIMIT 1",
      [req.userId],
    );
    const syncResult = await syncScheduleFromJw({
      userId: req.userId,
      username,
      password,
      scheduleStartDate: configRow && configRow.start_date,
    });

    await persistScheduleCourses(req.userId, syncResult.courses);
    await persistExams(req.userId, syncResult.exams).catch(() => {});
    await persistGrades(req.userId, syncResult.grades).catch(() => {});

    success(res, buildSyncPayload(syncResult), "同步成功");
  } catch (e) {
    if (e.code === "CAPTCHA_REQUIRED" && e.challenge) {
      return res.status(409).json({
        code: 409,
        message: e.message,
        data: e.challenge,
      });
    }
    fail(res, safeMessage(e), e.status || 500);
  }
};

exports.syncCaptcha = async (req, res) => {
  const challengeId = String(req.body.challengeId || "").trim();
  const code = String(req.body.code || "").trim();

  if (!challengeId) return fail(res, "验证码挑战不存在");
  if (!code) return fail(res, "请输入验证码");

  try {
    const syncResult = await submitScheduleCaptcha({
      userId: req.userId,
      challengeId,
      code,
    });

    await persistScheduleCourses(req.userId, syncResult.courses);
    await persistExams(req.userId, syncResult.exams).catch(() => {});
    await persistGrades(req.userId, syncResult.grades).catch(() => {});

    success(res, buildSyncPayload(syncResult), "同步成功");
  } catch (e) {
    if (e.code === "CAPTCHA_REQUIRED" && e.challenge) {
      return res.status(409).json({
        code: 409,
        message: e.message,
        data: e.challenge,
      });
    }
    fail(res, safeMessage(e), e.status || 500);
  }
};

// 绑定状态：是否已在服务端保存过教务账号（决定同步中心是否走免密自动同步）
exports.bindStatus = async (req, res) => {
  try {
    success(res, await getJwBinding(req.userId));
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

// 免密刷新：使用已绑定的教务账号自动同步课表 + 考试安排 + 成绩
exports.refresh = async (req, res) => {
  try {
    const [[configRow]] = await pool.query(
      "SELECT start_date FROM schedule_config WHERE user_id = ? LIMIT 1",
      [req.userId],
    );
    const syncResult = await refreshFromJw({
      userId: req.userId,
      scheduleStartDate: configRow && configRow.start_date,
    });

    await persistScheduleCourses(req.userId, syncResult.courses);
    await persistExams(req.userId, syncResult.exams).catch(() => {});
    await persistGrades(req.userId, syncResult.grades).catch(() => {});

    success(res, buildSyncPayload(syncResult), "刷新成功");
  } catch (e) {
    if (e.code === "CAPTCHA_REQUIRED" && e.challenge) {
      return res.status(409).json({
        code: 409,
        message: e.message,
        data: e.challenge,
      });
    }
    fail(res, safeMessage(e), e.status || 500);
  }
};

// 最近一次同步的考试安排（读缓存，不访问教务系统）
exports.listExams = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        id,
        user_id AS userId,
        name,
        type,
        date,
        time,
        location,
        seat,
        semester,
        synced_at AS syncedAt
      FROM user_exam
      WHERE user_id = ?
      ORDER BY date, time, id`,
      [req.userId],
    );
    success(res, rows);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

// 最近一次同步的成绩（读缓存，不访问教务系统）
exports.listGrades = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        id,
        user_id AS userId,
        semester,
        name,
        attribute,
        credit,
        gpa,
        score,
        synced_at AS syncedAt
      FROM user_grade
      WHERE user_id = ?
      ORDER BY semester DESC, id`,
      [req.userId],
    );
    success(res, rows);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getConfig = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        id,
        user_id AS userId,
        start_date AS startDate,
        hide_weekend AS hideWeekend,
        reminder,
        bg_color AS bgColor
      FROM schedule_config
      WHERE user_id = ?`,
      [req.userId],
    );
    if (rows.length) success(res, rows[0]);
    else
      success(res, {
        startDate: DEFAULT_SEMESTER_START,
        hideWeekend: 0,
        reminder: 0,
        bgColor: "#F5F7FA",
      });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.updateConfig = async (req, res) => {
  const { startDate, hideWeekend, reminder, bgColor } = req.body;
  // 客户端离线队列可能缺字段，兜底默认值，避免 mysql2 遇到 undefined 直接抛错返回 500
  const safeStartDate = startDate || DEFAULT_SEMESTER_START;
  const safeBgColor = bgColor || "#F5F7FA";
  try {
    const [rows] = await pool.query(
      "SELECT id FROM schedule_config WHERE user_id = ?",
      [req.userId],
    );
    if (rows.length) {
      await pool.query(
        "UPDATE schedule_config SET start_date=?, hide_weekend=?, reminder=?, bg_color=? WHERE user_id=?",
        [safeStartDate, hideWeekend ? 1 : 0, reminder ? 1 : 0, safeBgColor, req.userId],
      );
    } else {
      await pool.query(
        "INSERT INTO schedule_config (user_id, start_date, hide_weekend, reminder, bg_color) VALUES (?,?,?,?,?)",
        [req.userId, safeStartDate, hideWeekend ? 1 : 0, reminder ? 1 : 0, safeBgColor],
      );
    }
    success(res, null);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
