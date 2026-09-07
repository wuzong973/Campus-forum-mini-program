const path = require("path");
const crypto = require("crypto");
const Module = require("module");
const cheerio = require("cheerio");
const qs = require("querystring");
const tough = require("tough-cookie");
const pool = require("../config/pool");

const SERVER_NODE_MODULES = path.resolve(__dirname, "..", "node_modules");
if (!Module.globalPaths.includes(SERVER_NODE_MODULES)) {
  process.env.NODE_PATH = [process.env.NODE_PATH, SERVER_NODE_MODULES]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

const JwCrawler = require(
  path.join(__dirname, "..", "..", "jw-crawler", "crawler"),
);

const CRAWLER_ROOT = path.resolve(__dirname, "..", "..", "jw-crawler");
const DEFAULT_SEMESTER_START =
  process.env.SCHEDULE_DEFAULT_START_DATE ||
  process.env.JW_SEMESTER_START ||
  "2026-09-07";
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
const INITIAL_SYNC_WEEKS = clampNumber(
  process.env.JW_INITIAL_SYNC_WEEKS,
  1,
  1,
  4,
);
const USE_SERVER_OCR = /^(1|true|yes|on)$/i.test(
  String(process.env.JW_USE_OCR || "1"),
);
const FAST_SEMESTER_CONCURRENCY = clampNumber(
  process.env.JW_FAST_SEMESTER_CONCURRENCY,
  6,
  1,
  10,
);

const lastSyncByUser = new Map();
const activeSyncUsers = new Set();
const captchaChallenges = new Map();

// ===== 教务账号验证（骑手认证用）：复用登录能力，密码仅用于本次验证、不落库 =====
const jwVerifyLastAttemptByUser = new Map();
const activeVerifyUsers = new Set();
const JW_VERIFY_COOLDOWN_MS = clampNumber(
  process.env.JW_VERIFY_COOLDOWN_MS,
  60000,
  0,
  10 * 60 * 1000,
);

function normalizeVerifyError(error) {
  const message = String((error && error.message) || "");

  if (error && error.status) return error;

  if (/ETIMEDOUT|ECONNABORTED|timeout|请求超时/i.test(message)) {
    const result = new Error("教务系统连接超时，请稍后重试");
    result.status = 504;
    return result;
  }

  if (/ECONNRESET|ENOTFOUND|EPIPE|network|socket/i.test(message)) {
    const result = new Error("网络异常，暂时无法连接教务系统");
    result.status = 502;
    return result;
  }

  if (/验证码|captcha|OCR/i.test(message)) {
    const result = new Error("教务系统验证码识别失败，请稍后重试");
    result.status = 422;
    return result;
  }

  // 教务系统明确拒绝：视为学号或密码错误
  // 注意：不能返回 401，小程序端全局拦截 401 视为登录过期并清空会话
  if (/登录失败|账号|密码|用户名|请先登录系统|randomcode/i.test(message)) {
    const result = new Error("学号或密码错误，教务系统登录失败");
    result.status = 400;
    return result;
  }

  const result = new Error(message || "教务系统验证失败");
  result.status = 500;
  return result;
}

async function verifyJwAccount({ userId, username, password }) {
  const now = Date.now();
  if (activeVerifyUsers.has(userId)) {
    const error = new Error("教务验证正在进行中，请稍候");
    error.status = 429;
    throw error;
  }
  const lastAttemptAt = jwVerifyLastAttemptByUser.get(userId) || 0;
  if (
    JW_VERIFY_COOLDOWN_MS > 0 &&
    now - lastAttemptAt < JW_VERIFY_COOLDOWN_MS
  ) {
    const seconds = Math.ceil(
      (JW_VERIFY_COOLDOWN_MS - (now - lastAttemptAt)) / 1000,
    );
    const error = new Error(`操作过于频繁，请 ${seconds} 秒后再试`);
    error.status = 429;
    throw error;
  }

  activeVerifyUsers.add(userId);
  const crawler = buildCrawler();

  try {
    await loginCrawler(crawler, username, password);
    jwVerifyLastAttemptByUser.set(userId, Date.now());
    return true;
  } catch (error) {
    // 失败同样计入冷却，防止借助本接口暴力尝试教务系统密码
    jwVerifyLastAttemptByUser.set(userId, Date.now());
    throw normalizeVerifyError(error);
  } finally {
    activeVerifyUsers.delete(userId);
  }
}

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
    useOcr: USE_SERVER_OCR,
    captchaPath: null,
    maxCaptchaAttempts: clampNumber(process.env.JW_CAPTCHA_ATTEMPTS, 1, 1, 3),
    minOcrConfidence: clampNumber(process.env.JW_OCR_MIN_CONFIDENCE, 0, 0, 100),
    baseDelay: clampNumber(process.env.JW_BASE_DELAY_MS, 0, 0, 5000),
    jitter: clampNumber(process.env.JW_JITTER_MS, 0, 0, 2000),
    timeout: clampNumber(process.env.JW_TIMEOUT_MS, 8000, 3000, 120000),
    maxRetries: clampNumber(process.env.JW_MAX_RETRIES, 0, 0, 3),
    retryBackoffBase: clampNumber(process.env.JW_RETRY_BACKOFF_MS, 300, 0, 5000),
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
  const useOcr = USE_SERVER_OCR;

  if (loginMode === "unified") {
    return crawler.loginWithCaptcha(username, password, { useOcr });
  }

  if (loginMode === "auto") {
    try {
      return await crawler.loginWithCaptcha(username, password, {
        useOcr,
      });
    } catch (error) {
      return crawler.loginJsxsdWithCaptcha(username, password, {
        useOcr,
      });
    }
  }

  return crawler.loginJsxsdWithCaptcha(username, password, { useOcr });
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
  // pm2 cluster 多实例部署：挑战必须落库共享，否则提交验证码的请求
  // 被负载均衡到另一个实例时会因内存无挑战而误报 410 验证码已过期
  await persistCaptchaChallenge(challenge).catch((e) => {
    console.error("[jw] 验证码挑战落库失败:", e.message);
  });
  return challenge;
}

// ===== 验证码挑战跨实例共享（MySQL 存储） =====

async function persistCaptchaChallenge(challenge) {
  let cookieJarJson = "";
  try {
    cookieJarJson = JSON.stringify(challenge.crawler.jar.serializeSync());
  } catch (e) {
    cookieJarJson = "";
  }
  await pool.query(
    `INSERT INTO jw_captcha_challenge
      (id, user_id, username, password_enc, schedule_start_date, mode, factor, captcha_data, cookie_jar, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [
      challenge.id,
      challenge.userId,
      String(challenge.username || ""),
      encryptCredential(challenge.password),
      String(challenge.scheduleStartDate || ""),
      challenge.mode,
      String(challenge.factor || ""),
      challenge.captchaBuffer.toString("base64"),
      cookieJarJson,
      new Date(challenge.expiresAt),
    ],
  );
}

async function removeCaptchaChallengeRow(challengeId) {
  try {
    await pool.query("DELETE FROM jw_captcha_challenge WHERE id = ?", [
      challengeId,
    ]);
  } catch (e) {}
}

// 从共享表恢复挑战：重建爬虫实例并还原登录会话 Cookie
async function loadCaptchaChallengeFromDb(challengeId) {
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id, user_id, username, password_enc, schedule_start_date, mode, factor,
              captcha_data, cookie_jar, created_at, expires_at
       FROM jw_captcha_challenge WHERE id = ? LIMIT 1`,
      [challengeId],
    );
  } catch (e) {
    return null;
  }
  if (!rows.length) return null;

  const row = rows[0];
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    await removeCaptchaChallengeRow(challengeId);
    return null;
  }

  const crawler = buildCrawler({ useOcr: false, captchaPath: null });
  try {
    const jarData = JSON.parse(row.cookie_jar || "null");
    if (jarData) {
      const jar = tough.CookieJar.deserializeSync(jarData);
      crawler.jar = jar;
      if (crawler.instance && crawler.instance.defaults) {
        crawler.instance.defaults.jar = jar;
      }
    }
  } catch (e) {
    // Cookie 还原失败则挑战不可用（登录会话丢失），按过期处理
    await removeCaptchaChallengeRow(challengeId);
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    username: String(row.username || ""),
    password: decryptCredential(row.password_enc),
    scheduleStartDate: row.schedule_start_date || "",
    crawler,
    mode: row.mode === "unified" ? "unified" : "direct",
    factor: String(row.factor || ""),
    captchaBuffer: Buffer.from(row.captcha_data || "", "base64"),
    createdAt: new Date(row.created_at).getTime(),
    expiresAt,
  };
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

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

async function crawlSemesterFastWithCrawler(crawler, semesterStart, totalWeeks) {
  const dates = JwCrawler.generateWeekDates(semesterStart, totalWeeks);
  const pageHtml = await crawler.getSchedulePage();
  const $page = cheerio.load(pageHtml);
  const sjmsValue = $page("#sjms").val();

  if (!sjmsValue) {
    throw new Error("无法从课表主页提取 sjmsValue，可能未登录或登录已过期");
  }

  const weeklyResults = await mapWithConcurrency(
    dates,
    FAST_SEMESTER_CONCURRENCY,
    async (date, index) => {
      const params = { rq: date, sjmsValue };
      const res = await crawler.requestWithRetry(
        () =>
          crawler.instance.post(
            "/jsxsd/framework/main_index_loadkb.jsp",
            qs.stringify(params),
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Referer: `${crawler.options.baseURL}/jsxsd/framework/xsMain_new.jsp?t1=1`,
                "X-Requested-With": "XMLHttpRequest",
              },
            },
          ),
        `课表数据 ${date}`,
      );

      return {
        weekNumber: index + 1,
        date,
        courses: crawler.parseSchedule(res.data),
      };
    },
  );

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
      fast: true,
      concurrency: FAST_SEMESTER_CONCURRENCY,
    },
  };
}

function getCurrentWeekNumber(semesterStart, totalWeeks) {
  const start = new Date(`${semesterStart}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), totalWeeks);
}

async function crawlInitialWeeksWithCrawler(crawler, semesterStart, totalWeeks) {
  const dates = JwCrawler.generateWeekDates(semesterStart, totalWeeks);
  const currentWeek = getCurrentWeekNumber(semesterStart, totalWeeks);
  const startIndex = Math.max(0, currentWeek - 1);
  const selected = dates
    .map((date, index) => ({ date, weekNumber: index + 1 }))
    .slice(startIndex, startIndex + INITIAL_SYNC_WEEKS);
  const weeklyResults = [];

  for (const item of selected) {
    const html = await crawler.getScheduleRaw(item.date);
    const courses = crawler.parseSchedule(html);
    weeklyResults.push({
      weekNumber: item.weekNumber,
      date: item.date,
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
      partial: true,
      currentWeek,
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

// ===== 教务凭证加密存储：登录同步成功后保存，供「自动同步/刷新」免密复用 =====
const CRED_SECRET =
  process.env.JW_CRED_KEY ||
  process.env.APP_SECRET ||
  "gdipu-jw-credential-default-secret-key";
const CRED_KEY = crypto.createHash("sha256").update(String(CRED_SECRET)).digest();

function encryptCredential(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", CRED_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decryptCredential(payload) {
  const [ivB64, tagB64, dataB64] = String(payload || "").split(":");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      CRED_KEY,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    return "";
  }
}

async function saveJwCredential(userId, username, password) {
  try {
    const enc = encryptCredential(password);
    await pool.query(
      `INSERT INTO jw_credential (user_id, username, password_enc)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE username = VALUES(username), password_enc = VALUES(password_enc)`,
      [userId, String(username), enc],
    );
  } catch (e) {
    // 凭证保存失败不影响同步本身，仅失去免密刷新能力
    console.error("[jw] 保存教务凭证失败:", e.message);
  }
}

async function removeJwCredential(userId) {
  try {
    await pool.query("DELETE FROM jw_credential WHERE user_id = ?", [userId]);
  } catch (e) {}
}

async function getStoredJwCredential(userId) {
  try {
    const [rows] = await pool.query(
      "SELECT username, password_enc FROM jw_credential WHERE user_id = ? LIMIT 1",
      [userId],
    );
    if (!rows.length || !rows[0].password_enc) return null;
    const password = decryptCredential(rows[0].password_enc);
    if (!password) return null;
    return { username: String(rows[0].username || ""), password };
  } catch (e) {
    return null;
  }
}

async function getJwBinding(userId) {
  try {
    const [rows] = await pool.query(
      "SELECT username FROM jw_credential WHERE user_id = ? LIMIT 1",
      [userId],
    );
    return { bound: rows.length > 0, username: rows.length ? String(rows[0].username || "") : "" };
  } catch (e) {
    return { bound: false, username: "" };
  }
}

// 使用已登录的爬虫会话继续抓取考试安排与成绩；失败不阻断主流程，只记录警告
async function fetchExamsAndGradesWithCrawler(crawler) {
  const exams = [];
  const grades = [];
  const warnings = [];

  try {
    (await crawler.getExamSchedule()).forEach((item) => exams.push(item));
  } catch (e) {
    warnings.push("考试安排获取失败：" + String(e.message || e));
  }

  try {
    (await crawler.getGrades()).forEach((item) => grades.push(item));
  } catch (e) {
    warnings.push("成绩获取失败：" + String(e.message || e));
  }

  return { exams, grades, warnings };
}

// 登录教务系统；OCR 失败时创建人工验证码挑战并以 CAPTCHA_REQUIRED 抛出
async function loginOrChallenge(crawler, userId, username, password, scheduleStartDate) {
  try {
    await loginCrawler(crawler, username, password);
  } catch (error) {
    if (!shouldRequireManualCaptcha(error)) throw error;
    const challenge = await createCaptchaChallenge({
      userId,
      username,
      password,
      scheduleStartDate,
    });
    throw makeCaptchaRequiredError(challenge);
  }
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
    await loginOrChallenge(crawler, userId, username, password, semesterStart);

    const result = await crawlSemesterFastWithCrawler(
      crawler,
      semesterStart,
      DEFAULT_TOTAL_WEEKS,
    );
    const extras = await fetchExamsAndGradesWithCrawler(crawler);
    lastSyncByUser.set(userId, Date.now());
    await saveJwCredential(userId, username, password);
    return {
      ...result,
      exams: extras.exams,
      grades: extras.grades,
      warnings: extras.warnings,
    };
  } catch (error) {
    throw normalizeSyncError(error);
  } finally {
    activeSyncUsers.delete(userId);
  }
}

// 已绑定教务账号后的免密刷新：自动同步课表 + 考试安排 + 成绩
async function refreshFromJw({ userId, scheduleStartDate }) {
  const credential = await getStoredJwCredential(userId);
  if (!credential || !credential.username) {
    const error = new Error("尚未绑定教务账号，请先输入学号密码完成同步");
    error.status = 409;
    error.code = "JW_NOT_BOUND";
    throw error;
  }

  ensureSyncCooldown(userId);
  activeSyncUsers.add(userId);

  const crawler = buildCrawler();
  const semesterStart =
    normalizeDate(scheduleStartDate) || DEFAULT_SEMESTER_START;

  try {
    try {
      await loginCrawler(crawler, credential.username, credential.password);
    } catch (error) {
      const message = String((error && error.message) || "");
      // OCR 识别失败：用已存凭证创建人工验证码挑战继续本流程，不清除绑定
      if (/验证码|captcha|OCR|randomcode/i.test(message)) {
        const challenge = await createCaptchaChallenge({
          userId,
          username: credential.username,
          password: credential.password,
          scheduleStartDate: semesterStart,
        });
        throw makeCaptchaRequiredError(challenge);
      }
      // 教务明确拒绝（账号密码错误）：清除绑定，要求重新输入
      if (!/登录失败|账号|密码|用户名|请先登录系统/i.test(message)) {
        // 网络超时等临时故障保留凭证，避免用户被迫重新绑定
        const result = new Error("教务系统暂时无法连接，请稍后刷新重试");
        result.status = 502;
        throw result;
      }
      await removeJwCredential(userId);
      const result = new Error("教务账号验证已失效，请重新输入学号密码绑定");
      result.status = 400;
      result.code = "JW_CREDENTIAL_INVALID";
      throw result;
    }

    const result = await crawlSemesterFastWithCrawler(
      crawler,
      semesterStart,
      DEFAULT_TOTAL_WEEKS,
    );
    const extras = await fetchExamsAndGradesWithCrawler(crawler);
    lastSyncByUser.set(userId, Date.now());
    return {
      ...result,
      exams: extras.exams,
      grades: extras.grades,
      warnings: extras.warnings,
      username: credential.username,
    };
  } catch (error) {
    if (error.code === "JW_CREDENTIAL_INVALID") throw error;
    throw normalizeSyncError(error);
  } finally {
    activeSyncUsers.delete(userId);
  }
}

async function submitScheduleCaptcha({ userId, challengeId, code }) {
  pruneCaptchaChallenges();

  const key = String(challengeId || "");
  let challenge = captchaChallenges.get(key);
  if (!challenge) {
    // 本实例内存无挑战：可能创建与提交被 pm2 cluster 分到不同实例，从共享表恢复
    challenge = await loadCaptchaChallengeFromDb(key);
    if (challenge) captchaChallenges.set(key, challenge);
  }
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
    const result = await crawlSemesterFastWithCrawler(
      challenge.crawler,
      semesterStart,
      DEFAULT_TOTAL_WEEKS,
    );
    const extras = await fetchExamsAndGradesWithCrawler(challenge.crawler);
    captchaChallenges.delete(challenge.id);
    removeCaptchaChallengeRow(challenge.id).catch(() => {});
    lastSyncByUser.set(userId, Date.now());
    await saveJwCredential(userId, challenge.username, challenge.password);
    return {
      ...result,
      exams: extras.exams,
      grades: extras.grades,
      warnings: extras.warnings,
    };
  } catch (error) {
    captchaChallenges.delete(challenge.id);
    removeCaptchaChallengeRow(challenge.id).catch(() => {});
    throw normalizeSyncError(error);
  } finally {
    activeSyncUsers.delete(userId);
  }
}

module.exports = {
  DEFAULT_SEMESTER_START,
  DEFAULT_TOTAL_WEEKS,
  syncScheduleFromJw,
  refreshFromJw,
  submitScheduleCaptcha,
  verifyJwAccount,
  getJwBinding,
};
