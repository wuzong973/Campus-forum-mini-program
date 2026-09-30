const COURSE_THEME_PRESETS = {
  theory: {
    key: "theory",
    label: "理论课",
    color: "#4A7AFF",
    soft: "rgba(74, 122, 255, 0.14)",
    border: "rgba(74, 122, 255, 0.22)",
  },
  practice: {
    key: "practice",
    label: "实训课",
    color: "#FA8C16",
    soft: "rgba(250, 140, 22, 0.16)",
    border: "rgba(250, 140, 22, 0.24)",
  },
  sports: {
    key: "sports",
    label: "体育课",
    color: "#52C41A",
    soft: "rgba(82, 196, 26, 0.16)",
    border: "rgba(82, 196, 26, 0.24)",
  },
  lab: {
    key: "lab",
    label: "实验课",
    color: "#722ED1",
    soft: "rgba(114, 46, 209, 0.14)",
    border: "rgba(114, 46, 209, 0.22)",
  },
  activity: {
    key: "activity",
    label: "活动",
    color: "#13C2C2",
    soft: "rgba(19, 194, 194, 0.15)",
    border: "rgba(19, 194, 194, 0.22)",
  },
  evening: {
    key: "evening",
    label: "晚课",
    color: "#EB2F96",
    soft: "rgba(235, 47, 150, 0.14)",
    border: "rgba(235, 47, 150, 0.22)",
  },
};

// 差异化颜色调色板：为每门不同课程分配专属颜色
const COURSE_COLOR_PALETTE = [
  {
    color: "#4A7AFF",
    soft: "rgba(74,122,255,0.18)",
    border: "rgba(74,122,255,0.28)",
    text: "#1a2a5e",
  },
  {
    color: "#FA8C16",
    soft: "rgba(250,140,22,0.18)",
    border: "rgba(250,140,22,0.28)",
    text: "#5c3400",
  },
  {
    color: "#52C41A",
    soft: "rgba(82,196,26,0.18)",
    border: "rgba(82,196,26,0.28)",
    text: "#1b4d00",
  },
  {
    color: "#722ED1",
    soft: "rgba(114,46,209,0.18)",
    border: "rgba(114,46,209,0.28)",
    text: "#2b0d5e",
  },
  {
    color: "#13C2C2",
    soft: "rgba(19,194,194,0.18)",
    border: "rgba(19,194,194,0.28)",
    text: "#004d4d",
  },
  {
    color: "#EB2F96",
    soft: "rgba(235,47,150,0.18)",
    border: "rgba(235,47,150,0.28)",
    text: "#5e0036",
  },
  {
    color: "#2F54EB",
    soft: "rgba(47,84,235,0.18)",
    border: "rgba(47,84,235,0.28)",
    text: "#0d1a5e",
  },
  {
    color: "#F5222D",
    soft: "rgba(245,34,45,0.18)",
    border: "rgba(245,34,45,0.28)",
    text: "#5e0000",
  },
  {
    color: "#FAAD14",
    soft: "rgba(250,173,20,0.18)",
    border: "rgba(250,173,20,0.28)",
    text: "#5c4000",
  },
  {
    color: "#7B61FF",
    soft: "rgba(123,97,255,0.18)",
    border: "rgba(123,97,255,0.28)",
    text: "#2b1a5e",
  },
  {
    color: "#36CFC9",
    soft: "rgba(54,207,201,0.18)",
    border: "rgba(54,207,201,0.28)",
    text: "#004d4a",
  },
  {
    color: "#FF7A45",
    soft: "rgba(255,122,69,0.18)",
    border: "rgba(255,122,69,0.28)",
    text: "#5e2200",
  },
];

// 为每门不同课程分配唯一颜色（按课程名称映射）
function buildCourseColorMap(courses) {
  const nameMap = {};
  let paletteIdx = 0;
  const result = {};
  courses.forEach((course) => {
    const key = String(course.id);
    if (result[key]) return;
    if (!nameMap[course.name]) {
      nameMap[course.name] =
        COURSE_COLOR_PALETTE[paletteIdx % COURSE_COLOR_PALETTE.length];
      paletteIdx++;
    }
    result[key] = nameMap[course.name];
  });
  return result;
}

// 从颜色生成浅色背景（用于时段格子同步显示）
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substr(0, 2), 16),
    g: parseInt(h.substr(2, 2), 16),
    b: parseInt(h.substr(4, 2), 16),
  };
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function normalizeTime(value, fallback) {
  if (!value) return fallback;
  const raw = String(value).trim().replace("：", ":");
  const match = raw.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return pad2(hour) + ":" + pad2(minute);
}

function parseTimeMinutes(value) {
  const normalized = normalizeTime(value, "");
  if (!normalized) return 0;
  const parts = normalized.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

// ===== 校定作息时间表（课表页 / 录入模板 / OCR 解析共用唯一口径） =====
// 依据官方教务系统（jw.gdipu.edu.cn）课表页的节次时间，实测为：
//   1-2 节 08:30-09:55    3-4 节 10:15-11:40    5-6 节 14:00-15:25
//   7-8 节 15:45-17:10    9-10 节 18:30-19:55  11-12 节 20:00-21:25
// 拆到单节即：每节 40 分钟，同一节次对内休息 5 分钟，上午/下午/晚上大节间
// 休息 20 分钟（晚间 9-10 与 11-12 之间只休息 5 分钟）。
// 修复说明：旧课表页把 5-6 节当成午休（11:45-13:55）、整体下移两节，导致
// 9-10 节的课渲染到 16:30 行、并与 7-8 节的课叠在一起，时间轴整体错位。
const CLASS_PERIODS = [
  { section: 1, startTime: "08:30", endTime: "09:10" },
  { section: 2, startTime: "09:15", endTime: "09:55" },
  { section: 3, startTime: "10:15", endTime: "10:55" },
  { section: 4, startTime: "11:00", endTime: "11:40" },
  { section: 5, startTime: "14:00", endTime: "14:40" },
  { section: 6, startTime: "14:45", endTime: "15:25" },
  { section: 7, startTime: "15:45", endTime: "16:25" },
  { section: 8, startTime: "16:30", endTime: "17:10" },
  { section: 9, startTime: "18:30", endTime: "19:10" },
  { section: 10, startTime: "19:15", endTime: "19:55" },
  { section: 11, startTime: "20:00", endTime: "20:40" },
  { section: 12, startTime: "20:45", endTime: "21:25" },
];

const TOTAL_SECTIONS = CLASS_PERIODS.length;

// 课表行 = 节次对（两节一行，与官方教务课表一致）
const ROW_PERIOD_LABELS = ["上午", "上午", "下午", "下午", "晚上", "晚上"];
const CLASS_ROWS = [];
for (let pairIndex = 0; pairIndex + 1 < CLASS_PERIODS.length; pairIndex += 2) {
  const first = CLASS_PERIODS[pairIndex];
  const second = CLASS_PERIODS[pairIndex + 1];
  CLASS_ROWS.push({
    key: first.section + "-" + second.section,
    label: first.section + "-" + second.section + "节",
    period: ROW_PERIOD_LABELS[CLASS_ROWS.length] || "上午",
    startSection: first.section,
    endSection: second.section,
    startTime: first.startTime,
    endTime: second.endTime,
  });
}

function clampSection(value) {
  const n = Math.round(Number(value) || 0);
  if (!n) return 0;
  return Math.min(Math.max(n, 1), TOTAL_SECTIONS);
}

// 取某一节的上课/下课时间
function sectionTime(section, which) {
  const target = clampSection(section);
  const item = CLASS_PERIODS.filter((p) => p.section === target)[0];
  if (!item) return "";
  return which === "endTime" ? item.endTime : item.startTime;
}

// 上课时间 -> 小节序号：按「离哪一节上课时间最近」归位。
// 既能精确命中 14:00/15:45 这类标准起点，也能把历史脏数据
// （如旧模板里的 13:15）自动吸附到最近的一节，不再整体错位。
function sectionOfStartTime(value) {
  const minutes = parseTimeMinutes(value);
  if (!minutes) return CLASS_PERIODS[0].section;
  let best = CLASS_PERIODS[0];
  let bestGap = Infinity;
  CLASS_PERIODS.forEach((item) => {
    const gap = Math.abs(minutes - parseTimeMinutes(item.startTime));
    if (gap < bestGap) {
      bestGap = gap;
      best = item;
    }
  });
  return best.section;
}

// 下课时间 -> 小节序号：取第一个「下课时间 >= 该时间」的小节，保证不截断课程
function sectionOfEndTime(value) {
  const minutes = parseTimeMinutes(value);
  if (!minutes) return 0;
  for (let i = 0; i < CLASS_PERIODS.length; i += 1) {
    if (parseTimeMinutes(CLASS_PERIODS[i].endTime) >= minutes) {
      return CLASS_PERIODS[i].section;
    }
  }
  return TOTAL_SECTIONS;
}

// 课程 -> 课表行列定位：优先用教务返回的节次号，其次按上课/下课时间归位
function resolveCourseSlot(course) {
  const source = course || {};
  const startSection =
    clampSection(source.startSection) || sectionOfStartTime(source.startTime);
  let endSection =
    clampSection(source.endSection) || sectionOfEndTime(source.endTime);
  if (endSection < startSection) endSection = startSection;
  if (endSection > TOTAL_SECTIONS) endSection = TOTAL_SECTIONS;
  const firstRow = Math.floor((startSection - 1) / 2);
  const lastRow = Math.floor((endSection - 1) / 2);
  return {
    startSection,
    endSection,
    rowIndex: Math.min(Math.max(firstRow, 0), CLASS_ROWS.length - 1),
    rowSpan: Math.max(1, lastRow - firstRow + 1),
  };
}

// 上课时间 -> 午别（上午/下午/晚上），与 CLASS_ROWS 同口径
function getDayPeriod(startTime) {
  const rowIndex = Math.floor((sectionOfStartTime(startTime) - 1) / 2);
  return (CLASS_ROWS[rowIndex] && CLASS_ROWS[rowIndex].period) || "上午";
}

// 节次文字，如「5-6节」「9节」
function formatSectionLabel(startSection, endSection) {
  const from = clampSection(startSection);
  const to = Math.max(clampSection(endSection) || from, from);
  if (!from) return "";
  return from === to ? from + "节" : from + "-" + to + "节";
}

function inferCourseTheme(course) {
  const name =
    ((course && course.name) || "") + " " + ((course && course.location) || "");
  const text = name.toLowerCase();
  const startMinutes = parseTimeMinutes(course && course.startTime);

  if (/军体|体育|体能|操场|篮球|足球|羽毛球|跑步/.test(text)) {
    return COURSE_THEME_PRESETS.sports;
  }
  if (/实验|机房|实训|绘图|制图|工作坊|第四实训楼|b\d{3}/.test(text)) {
    return /实验/.test(text)
      ? COURSE_THEME_PRESETS.lab
      : COURSE_THEME_PRESETS.practice;
  }
  if (/班会|讲座|社团|活动|思政|晚训|自习/.test(text)) {
    return COURSE_THEME_PRESETS.activity;
  }
  if (startMinutes >= 18 * 60) {
    return COURSE_THEME_PRESETS.evening;
  }
  return COURSE_THEME_PRESETS.theory;
}

function normalizeCourse(course, index) {
  const theme = inferCourseTheme(course);
  const startTime = normalizeTime(course.startTime, "08:30");
  const rawEndTime = normalizeTime(course.endTime, "");
  // 结束时间缺失或不合法（<= 上课时间）时，按作息表回落到所在节次的下课时间，
  // 否则课程会被画到错误的行上。
  const slot = resolveCourseSlot(
    Object.assign({}, course, { startTime, endTime: rawEndTime }),
  );
  const endTime =
    rawEndTime && rawEndTime > startTime
      ? rawEndTime
      : sectionTime(slot.endSection, "endTime") || startTime;
  return Object.assign({}, course, {
    id: course.id || Date.now() + (index || 0),
    name: course.name || "未命名课程",
    teacher: course.teacher || "",
    location: course.location || "",
    weekDay: Number(course.weekDay) || 1,
    startTime,
    endTime,
    startSection: slot.startSection,
    endSection: slot.endSection,
    sectionLabel: formatSectionLabel(slot.startSection, slot.endSection),
    startWeek: Number(course.startWeek) || 1,
    endWeek: Number(course.endWeek) || 16,
    weekType: course.weekType || "all",
    weekTypeLabel:
      course.weekType === "odd"
        ? "单周"
        : course.weekType === "even"
          ? "双周"
          : "",
    color: course.color || theme.color,
    themeKey: theme.key,
    themeLabel: theme.label,
    themeSoft: theme.soft,
    themeBorder: theme.border,
    // 差异化颜色字段（由 buildCourseColorMap 填充）
    courseColor: null,
    courseColorSoft: null,
    courseColorBorder: null,
    courseColorText: null,
  });
}

function getWeekDayText(weekDay) {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return labels[(Number(weekDay) || 1) - 1] || labels[0];
}

// ===== 学期与教学周：全局唯一口径（校历 / 课表 / 教务首页共用） =====
// 教学周按「周一」锚定：与教务爬虫 generateWeekDates（周一为一周首日）、后端
// jwScheduleSyncService 默认学期起始日保持一致；校历官方备注「第 2 周 = 9/14-18」
// 亦以周一为周首。此前前端多处硬编码 2026-03-02（上一学期）导致回填前算出「第 28 周」，
// 且与校历的周日锚点在边界周日相差一周，统一收敛到本函数。
const DEFAULT_SEMESTER_START = "2026-09-07"; // 本学期第 1 教学周的周一
const DEFAULT_TOTAL_WEEKS = 20;

function parseLocalDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const m = String(value || "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 校验「真实日期」：Date 会把 2026-02-30 顺延成 3-02，正则也只管形状，
// 所以必须回读年月日比对；否则非法值会一路打到 MySQL 才报错（服务端同款校验见 scheduleController）
function isRealDate(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
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

// 就地纠正历史脏值：旧版本只校验形状，2026-02-30 这类日期会写进离线队列被服务端一直拒绝。
// 端上本来就会把它顺延显示（parseLocalDate 滚到 3-02），用户无感，所以不能指望用户自己改。
function legalizeStartDate(value) {
  if (value && isRealDate(value)) return value;
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return DEFAULT_SEMESTER_START;
  const pad = (n) => (n < 10 ? "0" : "") + n;
  return (
    date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
  );
}

// 把「周日锚点」的学期起始日规整到周一锚点。
//
// 为什么需要：学期起始日历史上存在两种写法，只差 1 天但结论可能差一周 ——
//   · 周一锚点 2026-09-07（校历备注「第 2 周 = 9/14-18」以周一为周首，现行口径）
//   · 周日锚点 2026-09-06（早期配置/本地缓存里把该周的周日当成了第 1 周首日）
// computeAcademicWeek 用 floor(天数差/7)+1 定周次，在**周日**这个边界上两者会分叉：
// 2026-09-20 用 9/06 起算是第 3 周、用 9/07 起算才是第 2 周。于是同一份课表在两台设备
// （本地缓存值不同）上会显示不同的「本周」日期区间 —— 这正是「手机端 9.20-9.26、
// 电脑端 9.21-9.27」的来源。
//
// 只处理「周日」这一种已知偏差，其余取值原样保留：周一不动，其它非常规值不猜、
// 不悄悄挪走用户配置。
function anchorToMonday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return date;
  if (date.getDay() !== 0) return date;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

// 解析学期起始日并锚定到周一。**所有按起始日推算周次/周日期的代码都必须用它**，
// 不要直接用 parseLocalDate —— 后者只做解析，不做锚定。
function parseSemesterStart(value) {
  return anchorToMonday(parseLocalDate(value || DEFAULT_SEMESTER_START));
}

// 计算「今天是第几周」：以所在教学周周一为基准，floor(天数差/7)+1，并夹在 [1, totalWeeks]。
// isExpired = 真实周次已超过总周数（用于课表过期提示）。
function computeAcademicWeek(startDate, totalWeeks, now) {
  const weeks = Number(totalWeeks) > 0 ? Number(totalWeeks) : DEFAULT_TOTAL_WEEKS;
  // 起始日走 parseSemesterStart（周一锚点），否则配置里的周日值会让边界周日差一周
  const start = parseSemesterStart(startDate);
  const today = parseLocalDate(now || new Date());
  if (!start || !today) return { currentWeek: 1, totalWeeks: weeks, isExpired: false };
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const rawWeek = Math.floor(diffDays / 7) + 1;
  return {
    currentWeek: Math.min(Math.max(rawWeek, 1), weeks),
    totalWeeks: weeks,
    isExpired: rawWeek > weeks,
  };
}
module.exports = {
  DEFAULT_SEMESTER_START,
  DEFAULT_TOTAL_WEEKS,
  parseLocalDate,
  isRealDate,
  legalizeStartDate,
  parseSemesterStart,
  anchorToMonday,
  computeAcademicWeek,
  COURSE_THEME_PRESETS,
  COURSE_COLOR_PALETTE,
  normalizeTime,
  normalizeCourse,
  inferCourseTheme,
  getWeekDayText,
  buildCourseColorMap,
  CLASS_PERIODS,
  CLASS_ROWS,
  TOTAL_SECTIONS,
  sectionTime,
  sectionOfStartTime,
  sectionOfEndTime,
  resolveCourseSlot,
  getDayPeriod,
  formatSectionLabel,
  hexToRgb,
};
