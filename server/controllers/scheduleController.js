const fs = require("fs");
const pool = require("../config/pool");
const { success, fail } = require("../middleware/auth");
const { safeMessage } = require("../utils/helpers");
const ocrService = require("../services/ocrService");
const {
  DEFAULT_SEMESTER_START,
  syncScheduleFromJw,
  refreshFromJw,
  submitScheduleCaptcha,
  refreshCaptchaChallenge,
  getJwBinding,
} = require("../services/jwScheduleSyncService");

function inferCourseColor(name, location, startTime) {
  const text = String(name || "") + " " + String(location || "");
  if (/军体|体育|操场/.test(text)) return "#52C41A";
  if (/实验|第四实训楼|B\d{3}|制图/.test(text)) return "#FA8C16";
  if (/晚训|晚自习/.test(text) || /^(1[89]|2[0-9]):/.test(startTime || "")) return "#EB2F96";
  if (/班会|活动|讲座/.test(text)) return "#13C2C2";
  return "#4A7AFF";
}

// 校定作息表：与小程序 utils/schedule.js 的 CLASS_PERIODS 同口径。
// 官方教务系统课表按两节一行展示：1-2 08:30-09:55 / 3-4 10:15-11:40 /
// 5-6 14:00-15:25 / 7-8 15:45-17:10 / 9-10 18:30-19:55 / 11-12 20:00-21:25。
// 旧表把 5-6 节当成午休（11:45-13:55）并整体下移两节，OCR 按节次回填时
// 会把课程时间写错，这里一并纠正。
const SECTION_TIME = {
  1: ['08:30', '09:10'],
  2: ['09:15', '09:55'],
  3: ['10:15', '10:55'],
  4: ['11:00', '11:40'],
  5: ['14:00', '14:40'],
  6: ['14:45', '15:25'],
  7: ['15:45', '16:25'],
  8: ['16:30', '17:10'],
  9: ['18:30', '19:10'],
  10: ['19:15', '19:55'],
  11: ['20:00', '20:40'],
  12: ['20:45', '21:25'],
}

const TOTAL_SECTIONS = Object.keys(SECTION_TIME).length

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
  const start = Math.max(1, Math.min(TOTAL_SECTIONS, parseInt(sectionMatch[1], 10)))
  const end = Math.max(start, Math.min(TOTAL_SECTIONS, parseInt(sectionMatch[2] || sectionMatch[1], 10)))
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
    : (section || { startTime: '08:30', endTime: '09:55' })
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

function normalizeCoursePayload(course) {
  const name = String(course.name || '').trim();
  const weekDay = Number(course.weekDay);
  const startWeek = Number(course.startWeek || 1);
  const endWeek = Number(course.endWeek || startWeek);
  if (!name || !Number.isInteger(weekDay) || weekDay < 1 || weekDay > 7 || !Number.isInteger(startWeek) || !Number.isInteger(endWeek) || startWeek < 1 || endWeek < startWeek || endWeek > 30) return null;
  return {
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
  };
}

exports.updateCourse = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, "课程 ID 无效");
  const payload = normalizeCoursePayload(req.body || {});
  if (!payload) return fail(res, "课程数据无效");
  try {
    const [result] = await pool.query(
      `UPDATE user_schedule
       SET name = ?, location = ?, teacher = ?, week_day = ?, start_time = ?, end_time = ?, start_week = ?, end_week = ?, week_type = ?, color = ?
       WHERE id = ? AND user_id = ?`,
      [
        payload.name,
        payload.location,
        payload.teacher,
        payload.weekDay,
        payload.startTime,
        payload.endTime,
        payload.startWeek,
        payload.endWeek,
        payload.weekType,
        payload.color,
        id,
        req.userId,
      ],
    );
    if (!result.affectedRows) return fail(res, "课程不存在", 404);
    success(res, { id });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.deleteCourse = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, "课程 ID 无效");
  try {
    const [result] = await pool.query("DELETE FROM user_schedule WHERE id = ? AND user_id = ?", [id, req.userId]);
    if (!result.affectedRows) return fail(res, "课程不存在", 404);
    success(res, { id });
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

// 课表截图 OCR：客户端上传图片（multipart），服务端走微信通用印刷体 OCR
// 得到逐行文本，再交给 parseOcrText 结构化。JSON 直接传 rawText 的老用法保留，
// 便于排查与测试。strategy 字段标明实际生效的识别链路。
exports.ocr = async (req, res) => {
  try {
    const tips = [];
    let rawText = String(req.body.rawText || req.body.text || "").trim();
    let strategy = "rule-parse-v2";

    if (req.ocrImageBuffer) {
      if (!ocrService.isConfigured()) {
        return fail(res, "课表识别服务未配置，请联系管理员", 503);
      }
      try {
        const ocr = await ocrService.recognizeScheduleImage(req.ocrImageBuffer);
        rawText = ocr.rawText;
        strategy = "wechat-ocr+rule-parse";
        if (!rawText) {
          tips.push("OCR 未从图片中识别出文字，请上传更清晰的课表完整截图");
        }
      } catch (e) {
        if (e.expose) return fail(res, e.message, e.status || 503);
        console.error("[ScheduleOcr] failed:", e.message);
        return fail(res, "课表识别服务暂时不可用，请稍后重试", 503);
      }
    }

    let courses = rawText ? parseOcrText(rawText) : [];
    const lowConfidenceCount = courses.filter(
      (item) => item.confidence < 70,
    ).length;
    if (lowConfidenceCount)
      tips.push(lowConfidenceCount + " 门课程置信度偏低，请导入前人工核对");
    if (!courses.length) return fail(res, "未能识别出有效课程，请上传清晰完整的课表截图", 422)
    success(res, {
      courses,
      tips,
      strategy,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  } finally {
    // multer 临时文件只服务本次识别，旧实现从不清理导致 uploads 目录持续膨胀
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
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
// 由成绩文本派生「是否通过」，供前端挂科标红（此前后端不返回 pass，红色永不生效）。
// 规则：纯分数 >=60 通过；文字等级按及格/不及格判定；无法判定返回 null（前端不标红）。
function deriveGradePass(grade) {
  if (!grade || typeof grade !== "object") return grade;
  const raw = String(grade.score == null ? "" : grade.score).trim();
  let pass = null;
  if (raw) {
    const numMatch = raw.match(/^(\d+(?:\.\d+)?)\s*分?$/);
    if (numMatch) pass = Number(numMatch[1]) >= 60;
    else if (/不及格|不合格|未通过|不通过|缺考|作弊/.test(raw)) pass = false;
    else if (/优秀|良好|中等|及格|合格|通过|一等|二等|三等/.test(raw)) pass = true;
    else {
      const letter = raw.toUpperCase().match(/^[A-F]/);
      if (letter) pass = letter[0] !== "F";
    }
  }
  return Object.assign({}, grade, { pass });
}

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
    grades: (result.grades || []).map(deriveGradePass),
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

// 换一张验证码：复用挑战内已保存的凭据与会话重新抓图，
// 用户在「教务同步」页点「换一张」时无需重新输入学号密码
exports.refreshCaptcha = async (req, res) => {
  const challengeId = String(req.body.challengeId || "").trim();
  if (!challengeId) return fail(res, "验证码挑战不存在");

  try {
    success(
      res,
      await refreshCaptchaChallenge({ userId: req.userId, challengeId }),
    );
  } catch (e) {
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
    // 成绩读库后补派生字段 pass，供前端挂科标红（M1e）
    success(res, rows.map(deriveGradePass));
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
    // safeMessage 会把 ER_* 吞成"数据库操作失败"，这里落一条原始错误方便线上排障
    console.error(`[schedule.getConfig] requestId=${req.requestId}`, e.code || "", e.message);
    fail(res, safeMessage(e), 500);
  }
};

// 形状对不等于日期对：'2026-02-30' 能过 /^\d{4}-\d{2}-\d{2}$/，但 MySQL 会以
// ER_TRUNCATED_WRONG_VALUE 拒绝，端上再把坏值永久重发（每次启动一次 500）。
function isRealDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d
  );
}

exports.updateConfig = async (req, res) => {
  const { startDate, hideWeekend, reminder, bgColor } = req.body || {};
  if (startDate && !isRealDate(startDate))
    return fail(res, "开始日期不合法，请按 2026-09-07 填写真实日期");
  // 客户端离线队列可能缺字段，兜底默认值，避免 mysql2 遇到 undefined 直接抛错返回 500
  const safeStartDate = startDate || DEFAULT_SEMESTER_START;
  // bg_color 允许 7 位 hex 与 ~45 字符的 linear-gradient 串（课表页 BG_COLOR_PALETTE），
  // 列宽 VARCHAR(128)；超长脏值回退默认色而不是让 ER_DATA_TOO_LONG 打成 500——
  // 5xx 不清前端离线队列，一条坏颜色会把提醒开关等所有配置保存一起卡死
  const safeBgColor =
    typeof bgColor === "string" && bgColor.length <= 128 ? bgColor : "#F5F7FA";
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
    // 同上：原始错误落日志（ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR 一眼定位）
    console.error(`[schedule.updateConfig] requestId=${req.requestId}`, e.code || "", e.message);
    fail(res, safeMessage(e), 500);
  }
};

// 导出成绩派生函数，便于单测（前端挂科标红依赖 pass 字段）
exports.deriveGradePass = deriveGradePass;
