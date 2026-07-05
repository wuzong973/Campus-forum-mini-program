const path = require("path");
const Module = require("module");

const SERVER_NODE_MODULES = path.resolve(__dirname, "..", "node_modules");
if (!Module.globalPaths.includes(SERVER_NODE_MODULES)) {
  process.env.NODE_PATH = [process.env.NODE_PATH, SERVER_NODE_MODULES]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

const JwCrawler = require(
  path.join(__dirname, "..", "..", "教务系统爬虫", "crawler"),
);

const CRAWLER_ROOT = path.resolve(__dirname, "..", "..", "教务系统爬虫");
const DEFAULT_SEMESTER_START =
  process.env.SCHEDULE_DEFAULT_START_DATE ||
  process.env.JW_SEMESTER_START ||
  "2026-03-02";
const DEFAULT_TOTAL_WEEKS = clampNumber(
  process.env.SCHEDULE_TOTAL_WEEKS || process.env.JW_TOTAL_WEEKS,
  19,
  1,
  30,
);
const SYNC_COOLDOWN_MS = clampNumber(
  process.env.JW_SYNC_COOLDOWN_MS,
  60000,
  0,
  10 * 60 * 1000,
);
const CHALLENGE_TTL_MS = clampNumber(
  process.env.JW_CAPTCHA_TTL_SECONDS,
  180,
  30,
  600,
) * 1000;

const lastSyncByUser = new Map();
const activeSyncUsers = new Set();
const captchaChallenges = new Map();

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function inferCourseColor(name, location, startTime) {
  const text = String(name || "") + " " + String(location || "");
  if (/军体|体育|操场/.test(text)) return "#52C41A";
  if (/实验|第四实训楼|B\d{3}|制图/.test(text)) return "#FA8C16";
  if (/晚训|晚自习/.test(text) || /^1[89]:/.test(startTime || ""))
    return "#EB2F96";
  if (/班会|活动|讲座/.test(text)) return "#13C2C2";
  return "#4A7AFF";
}

function buildCrawler(overrides = {}) {
  return new JwCrawler({
    verbose: false,
    useOcr: true,
    captchaPath: null,
    maxCaptchaAttempts: clampNumber(process.env.JW_CAPTCHA_ATTEMPTS, 3, 1, 6),
    minOcrConfidence: clampNumber(process.env.JW_OCR_MIN_CONFIDENCE, 0, 0, 100),
    baseDelay: clampNumber(process.env.JW_BASE_DELAY_MS, 1200, 500, 5000),
    jitter: clampNumber(process.env.JW_JITTER_MS, 500, 0, 2000),
    timeout: clampNumber(process.env.JW_TIMEOUT_MS, 20000, 5000, 120000),
    ocrOptions: {
      langPath: CRAWLER_ROOT,
      cachePath: path.join(CRAWLER_ROOT, ".ocr-cache"),
      gzip: false,
    },
    ...overrides,
  });
}

async function loginCrawler(crawler, username, password) {
  const loginMode = String(process.env.JW_LOGIN_MODE || "direct").toLowerCase();

  if (loginMode === "unified") {
    return crawler.loginWithCaptcha(username, password, { useOcr: true });
  }

  if (loginMode === "auto") {
    try {
      return await crawler.loginWithCaptcha(username, password, {
        useOcr: true,
      });
    } catch (error) {
      return crawler.loginJsxsdWithCaptcha(username, password, {
        useOcr: true,
      });
    }
  }

  return crawler.loginJsxsdWithCaptcha(username, password, { useOcr: true });
}

function buildCourseKey(course) {
  return [
    course.name,
    course.location,
    course.campus,
    course.attribute,
    course.credits,
    course.weekDay,
    course.startSection,
    course.endSection,
    course.startTime,
    course.endTime,
  ].join("||");
}

function normalizeRemoteCourse(course, weekNumber) {
  const weekDay = Number(course.weekDayIndex || 0);
  const startSection = Number(course.startSection || 0);
  const endSection = Number(course.endSection || startSection || 0);
  const name = String(course.courseName || "").trim();

  return {
    name,
    teacher: "",
    location: String(course.location || "").trim(),
    campus: String(course.campus || "").trim(),
    attribute: String(course.attribute || "").trim(),
    credits: String(course.credits || "").trim(),
    weekDay,
    startSection,
    endSection,
    startTime: String(course.startTime || "").trim(),
    endTime: String(course.endTime || "").trim(),
    weekNumber,
  };
}

function buildWeekSegments(weeks) {
  const values = Array.from(
    new Set(
      (weeks || [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ).sort((a, b) => a - b);

  if (!values.length) return [];

  const segments = [];
  let current = [values[0]];
  let mode = null;

  const pushCurrent = () => {
    if (!current.length) return;
    const weekType =
      mode === "parity" ? (current[0] % 2 === 0 ? "even" : "odd") : "all";
    segments.push({
      startWeek: current[0],
      endWeek: current[current.length - 1],
      weekType,
    });
  };

  for (let index = 1; index < values.length; index += 1) {
    const week = values[index];
    const prev = current[current.length - 1];
    const diff = week - prev;

    if (mode === null) {
      if (diff === 1) {
        mode = "all";
        current.push(week);
        continue;
      }
      if (diff === 2 && week % 2 === current[0] % 2) {
        mode = "parity";
        current.push(week);
        continue;
      }
      pushCurrent();
      current = [week];
      mode = null;
      continue;
    }

    if (mode === "all" && diff === 1) {
      current.push(week);
      continue;
    }

    if (mode === "parity" && diff === 2 && week % 2 === current[0] % 2) {
      current.push(week);
      continue;
    }

    pushCurrent();
    current = [week];
    mode = null;
  }

  pushCurrent();
  return segments;
}

function aggregateWeeklyCourses(weeklyResults) {
  const grouped = new Map();

  weeklyResults.forEach((item) => {
    (item.courses || []).forEach((course) => {
      const normalized = normalizeRemoteCourse(course, item.weekNumber);
      if (!normalized.name || !normalized.weekDay) return;
      const key = buildCourseKey(normalized);
      const current = grouped.get(key);

      if (current) {
        current.weeks.push(item.weekNumber);
        return;
      }

      grouped.set(key, {
        ...normalized,
        weeks: [item.weekNumber],
      });
    });
  });

  const courses = [];
  grouped.forEach((item) => {
    const segments = buildWeekSegments(item.weeks);
    segments.forEach((segment) => {
      courses.push({
        name: item.name,
        teacher: item.teacher,
        location: item.location,
        weekDay: item.weekDay,
        startTime: item.startTime,
        endTime: item.endTime,
        startWeek: segment.startWeek,
        endWeek: segment.endWeek,
        weekType: segment.weekType,
        color: inferCourseColor(item.name, item.location, item.startTime),
      });
    });
  });

  courses.sort((a, b) => {
    return (
      a.weekDay - b.weekDay ||
      a.startWeek - b.startWeek ||
      a.startTime.localeCompare(b.startTime, "zh-Hans-CN") ||
      a.name.localeCompare(b.name, "zh-Hans-CN")
    );
  });

  return courses;
}

function ensureSyncCooldown(userId) {
  const now = Date.now();
  if (activeSyncUsers.has(userId)) {
    const error = new Error("课表同步正在进行中，请稍候");
    error.status = 429;
    throw error;
  }
  const lastSyncAt = lastSyncByUser.get(userId) || 0;
  if (SYNC_COOLDOWN_MS > 0 && now - lastSyncAt < SYNC_COOLDOWN_MS) {
    const seconds = Math.ceil((SYNC_COOLDOWN_MS - (now - lastSyncAt)) / 1000);
    const error = new Error(`操作过于频繁，请 ${seconds} 秒后再试`);
    error.status = 429;
    throw error;
  }
}

function pruneCaptchaChallenges() {
  const now = Date.now();
  for (const [id, challenge] of captchaChallenges.entries()) {
    if (now > challenge.expiresAt) captchaChallenges.delete(id);
  }
}

function shouldRequireManualCaptcha(error) {
  const message = String((error && error.message) || "");
  return /验证码|captcha|OCR|must be 4|randomcode/i.test(message);
}

function makeCaptchaRequiredError(challenge) {
  const error = new Error("需要输入教务系统验证码");
  error.status = 409;
  error.code = "CAPTCHA_REQUIRED";
  error.challenge = serializeCaptchaChallenge(challenge);
  return error;
}

function serializeCaptchaChallenge(challenge) {
  return {
    code: "CAPTCHA_REQUIRED",
    challengeId: challenge.id,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    captcha: {
      mime: "image/png",
      dataUrl: `data:image/png;base64,${challenge.captchaBuffer.toString("base64")}`,
    },
  };
}

async function createCaptchaChallenge({
  userId,
  username,
  password,
  scheduleStartDate,
}) {
  pruneCaptchaChallenges();

  const loginMode = String(process.env.JW_LOGIN_MODE || "direct").toLowerCase();
  const mode = loginMode === "unified" ? "unified" : "direct";
  const crawler = buildCrawler({ useOcr: false, captchaPath: null });
  let captchaBuffer;
  let factor = "";

  if (mode === "unified") {
    const challenge = await crawler.createLoginChallenge({ captchaPath: null });
    captchaBuffer = challenge.captchaBuffer;
    factor = challenge.factor || "";
  } else {
    await crawler.initJsxsdLoginPage();
    captchaBuffer = await crawler.getJsxsdCaptcha(null);
  }

  const id = require("crypto").randomUUID();
  const challenge = {
    id,
    userId,
    username,
    password,
    scheduleStartDate,
    crawler,
    mode,
    factor,
    captchaBuffer,
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  captchaChallenges.set(id, challenge);
  return challenge;
}

async function submitChallengeLogin(challenge, code) {
  if (challenge.mode === "unified") {
    return challenge.crawler.submitLogin(
      challenge.username,
      challenge.password,
      code,
      challenge.factor,
    );
  }

  return challenge.crawler.submitJsxsdLogin(
    challenge.username,
    challenge.password,
    code,
  );
}

async function crawlSemesterWithCrawler(crawler, semesterStart, totalWeeks) {
  const dates = JwCrawler.generateWeekDates(semesterStart, totalWeeks);
  const weeklyResults = [];

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const html = await crawler.getScheduleRaw(date);
    const courses = crawler.parseSchedule(html);
    weeklyResults.push({
      weekNumber: index + 1,
      date,
      courses,
    });
  }

  const courses = aggregateWeeklyCourses(weeklyResults);
  return {
    courses,
    meta: {
      semesterStart,
      totalWeeks,
      rawWeekCount: weeklyResults.length,
      rawCourseCount: weeklyResults.reduce(
        (sum, item) => sum + (item.courses || []).length,
        0,
      ),
    },
  };
}

function normalizeSyncError(error) {
  const message = String((error && error.message) || "");

  if (error && error.status) return error;

  if (/ETIMEDOUT|ECONNABORTED|timeout|请求超时/i.test(message)) {
    const result = new Error("爬虫请求超时，请稍后重试");
    result.status = 504;
    return result;
  }

  if (/ECONNRESET|ENOTFOUND|EPIPE|network|socket/i.test(message)) {
    const result = new Error("网络异常，暂时无法连接教务系统");
    result.status = 502;
    return result;
  }

  if (/验证码|captcha|OCR/i.test(message)) {
    const result = new Error("验证码识别失败，请稍后重试");
    result.status = 422;
    return result;
  }

  if (/登录失败|账号|密码|请先登录系统/i.test(message)) {
    const result = new Error("教务系统登录失败，请检查账号或密码");
    result.status = 401;
    return result;
  }

  if (/sjmsValue|解析|课表/i.test(message)) {
    const result = new Error("课表数据解析失败，请稍后重试");
    result.status = 502;
    return result;
  }

  const result = new Error(message || "课表同步失败");
  result.status = 500;
  return result;
}

async function syncScheduleFromJw({
  userId,
  username,
  password,
  scheduleStartDate,
}) {
  ensureSyncCooldown(userId);
  activeSyncUsers.add(userId);

  const crawler = buildCrawler();
  const semesterStart =
    normalizeDate(scheduleStartDate) || DEFAULT_SEMESTER_START;

  try {
    try {
      await loginCrawler(crawler, username, password);
    } catch (error) {
      if (!shouldRequireManualCaptcha(error)) throw error;
      const challenge = await createCaptchaChallenge({
        userId,
        username,
        password,
        scheduleStartDate: semesterStart,
      });
      throw makeCaptchaRequiredError(challenge);
    }

    const result = await crawlSemesterWithCrawler(
      crawler,
      semesterStart,
      DEFAULT_TOTAL_WEEKS,
    );
    lastSyncByUser.set(userId, Date.now());
    return result;
  } catch (error) {
    throw normalizeSyncError(error);
  } finally {
    activeSyncUsers.delete(userId);
  }
}

async function submitScheduleCaptcha({ userId, challengeId, code }) {
  pruneCaptchaChallenges();

  const challenge = captchaChallenges.get(String(challengeId || ""));
  if (!challenge) {
    const error = new Error("验证码已过期，请重新同步");
    error.status = 410;
    error.code = "CAPTCHA_EXPIRED";
    throw error;
  }
  if (String(challenge.userId) !== String(userId)) {
    const error = new Error("验证码挑战不属于当前用户");
    error.status = 403;
    error.code = "CAPTCHA_FORBIDDEN";
    throw error;
  }

  const captchaCode = String(code || "").trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(captchaCode)) {
    const error = new Error("验证码必须是 4 位字母或数字");
    error.status = 400;
    error.code = "BAD_CAPTCHA_FORMAT";
    throw error;
  }

  ensureSyncCooldown(userId);
  activeSyncUsers.add(userId);

  try {
    await submitChallengeLogin(challenge, captchaCode);
    const semesterStart =
      normalizeDate(challenge.scheduleStartDate) || DEFAULT_SEMESTER_START;
    const result = await crawlSemesterWithCrawler(
      challenge.crawler,
      semesterStart,
      DEFAULT_TOTAL_WEEKS,
    );
    captchaChallenges.delete(challenge.id);
    lastSyncByUser.set(userId, Date.now());
    return result;
  } catch (error) {
    captchaChallenges.delete(challenge.id);
    throw normalizeSyncError(error);
  } finally {
    activeSyncUsers.delete(userId);
  }
}

module.exports = {
  DEFAULT_SEMESTER_START,
  DEFAULT_TOTAL_WEEKS,
  syncScheduleFromJw,
  submitScheduleCaptcha,
};
