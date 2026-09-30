// 校历页：展示学校教务处发布的学年校历原图，并依据图中教学周起止日期
// 自动定位「当前是第几周 / 处于假期还是学期内」。
//
// 数据来源：pkg-schedule/assets/school-calendar.jpg（2026-2027 学年校历）图中「备注」栏。
// 教学周数据在此硬编码 —— 小程序运行时无法解析图片文字，且教务处每学年
// 才会更新一次，维护成本极低。
const app = getApp();

// 学年切换周期：把两个学期都写进数组，日期区间不重叠，靠区间判定即可。
//
// ⚠️ 周次算法说明（换学年时务必重新核对，不要照抄公式）
// 全校统一按「周一」锚定教学周，与课表页 / 教务爬虫 / 后端学期起始日保持一致：
//   2026-2027 学年（当前）：开学注册日为 9/6(周日)，第 1 教学周周一 = 9/7
//       第1周 = 9/7(一) ~ 9/13(日)
//       第2周 = 9/14(一) ~ 9/20(日)   ← 原图备注④「第2周」= 9/14-18 ✓
//       第12周 = 11/23(一) ~ 11/29(日) ← 原图备注⑥「第12周」= 11/26-27 ✓
//       → 公式：floor((today - 第1周周一) / 7) + 1（见 weekOfSemester）
// firstWeekSunday 保留开学注册周日，weekOfSemester 内部 +1 天推得第 1 周周一，
// 从而与课表页对「边界周日属于哪一周」的判定完全一致（旧实现以周日为周首，会差一周）。
const SEMESTERS = [
  {
    key: "first",
    name: "第一学期",
    label: "上学期",
    year: "2026-2027学年",
    startDate: "2026-09-06", // 图中备注①：教学周 2026年9月6日 起
    endDate: "2027-01-23", // 图中备注①：至 2027年1月23日 止（共 20 周）
    // 第 1 周首日（周日）。本学年 9/6 本身即周日，故与 startDate 相同（无残周）。
    firstWeekSunday: "2026-09-06",
    totalWeeks: 20,
    examWeek: 20, // 第 20 周为复习考试周
    note: "共 20 周",
  },
  {
    key: "second",
    name: "第二学期",
    label: "下学期",
    year: "2026-2027学年",
    startDate: "2027-02-21", // 图中备注①：教学周 2027年2月21日 起
    endDate: "2027-07-10", // 图中备注①：至 2027年7月10日 止（共 20 周）
    // 2027-02-21 也是周日，第 1 周同样是完整周
    firstWeekSunday: "2027-02-21",
    totalWeeks: 20,
    examWeek: 20,
    note: "共 20 周",
  },
];

// 假期区间
//   备注⑦：学生寒假时间 2027年1月24日 - 2027年2月20日
//   备注③：学生暑假时间 2027年7月11日 - 2027年8月28日
const VACATIONS = [
  {
    name: "寒假",
    startDate: "2027-01-24",
    endDate: "2027-02-20",
  },
  {
    name: "暑假",
    startDate: "2027-07-11",
    endDate: "2027-08-28",
  },
];

// 图中「备注」栏的关键节点，按日期排序展示
const KEY_DATES = [
  { date: "2026-09-06", title: "2024、2025 级学生注册 / 第一学期开学", type: "注册" },
  { date: "2026-09-12", title: "2026 级新生报到", type: "报到" },
  { date: "2026-09-14", title: "新生体检及入学教育（至 9 月 18 日，第 2 周）", type: "教育" },
  { date: "2026-10-25", title: "新生军训（第一批，至 11 月 7 日，第 8-9 周）", type: "军训" },
  { date: "2026-11-08", title: "新生军训（第二批，至 11 月 22 日，第 10-11 周）", type: "军训" },
  { date: "2026-11-26", title: "校运动会（第 12 周，26-27 日）", type: "活动" },
  { date: "2027-01-24", title: "寒假开始（至 2 月 20 日）", type: "假期" },
  { date: "2027-02-21", title: "注册日 / 第二学期开学", type: "注册" },
  { date: "2027-07-10", title: "第二学期教学周结束", type: "教学" },
  { date: "2027-07-11", title: "暑假开始（至 8 月 28 日）", type: "假期" },
];


// 日历覆盖范围标签：用于「校历已过期」提示，从 SEMESTERS / VACATIONS 自动推导，
// 换学年时无需再手改文案（避免文案与数据脱节）。
const CALENDAR_LABEL = (SEMESTERS[0] && SEMESTERS[0].year) || "";
const CALENDAR_END = (function () {
  const dates = [];
  SEMESTERS.forEach((s) => dates.push(s.endDate));
  VACATIONS.forEach((v) => dates.push(v.endDate));
  return dates.sort().pop() || "";
})();

function parseDate(value) {
  // iOS 不支持 "2024-03-01" 直接构造，需替换分隔符
  const date = new Date(String(value).replace(/-/g, "/"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// 天数差：返回「to - from」。
//   正数 = to 在 from 之后；负数 = to 在 from 之前；0 = 同一天。
// 判定「now 落在 [start, end] 区间内」应写：
//   diffDays(start, now) >= 0 && diffDays(now, end) >= 0
function diffDays(from, to) {
  return Math.floor((toDayStart(to) - toDayStart(from)) / 86400000);
}

function formatCn(date) {
  if (!date) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 周次计算：与课表 / 教务爬虫统一按「周一」锚定教学周。
// 校历官方备注「第 2 周 = 9/14-18」即周一为周首；firstWeekSunday 是开学注册周日，
// 其 +1 天就是第 1 教学周的周一。此前以周日为锚点，导致边界周日与课表页「第几周」差一周。
function weekOfSemester(semester, now) {
  const sunday = parseDate(semester.firstWeekSunday || semester.startDate);
  if (!sunday) return 1;
  const week1Monday = new Date(
    sunday.getFullYear(),
    sunday.getMonth(),
    sunday.getDate() + 1,
  );
  const elapsed = diffDays(week1Monday, now);
  // 第 1 周周一之前（开学注册周日）计入第 1 周
  if (elapsed < 0) return 1;
  return Math.min(Math.floor(elapsed / 7) + 1, semester.totalWeeks);
}

Page({
  data: {
    // 当前状态
    phase: "", // "semester" | "vacation" | "unknown"
    phaseLabel: "", // 如「第一学期 · 第 3 周」
    phaseSub: "", // 如「2026-2027学年」
    weekNo: 0,
    totalWeeks: 0,
    weekProgress: 0, // 进度百分比，用于进度条
    isExamWeek: false,
    isWeekend: false,
    monthDay: "", // 今天的月日，如「9月11日」
    weekDayName: "", // 今天星期几

    // 语义色：随状态切换主题
    themeKey: "semester",

    // 两学期卡片
    semesterCards: [],
    // 关键日期
    keyDates: [],
    // 校历图片
    calendarImage: "/pkg-schedule/assets/school-calendar.jpg",
    thumbImage: "/pkg-schedule/assets/school-calendar-thumb.jpg",
  },

  onLoad() {
    this.resolveStatus();
  },

  // ===== 状态判定 =====

  resolveStatus() {
    const now = new Date();
    const weekDay = now.getDay() || 7;
    const weekDayNames = ["", "一", "二", "三", "四", "五", "六", "日"];

    const todayText = formatCn(now);
    const matched = this.matchSemester(now);
    const vacation = this.matchVacation(now);

    if (matched) {
      const { semester, weekNo } = matched;
      const isExamWeek = weekNo >= semester.examWeek;
      this.setData({
        phase: "semester",
        phaseLabel: `${semester.name} · 第 ${weekNo} 周`,
        phaseSub: `日常教学周 · 今天是星期${weekDayNames[weekDay]}`,
        weekNo,
        totalWeeks: semester.totalWeeks,
        weekProgress: Math.round((weekNo / semester.totalWeeks) * 100),
        isExamWeek,
        isWeekend: weekDay >= 6,
        monthDay: `${now.getMonth() + 1}月${now.getDate()}日`,
        weekDayName: weekDayNames[weekDay],
        themeKey: "semester",
      });
    } else if (vacation) {
      const days = diffDays(now, parseDate(vacation.endDate)) + 1;
      this.setData({
        phase: "vacation",
        phaseLabel: `假期中 · ${vacation.name}`,
        phaseSub: `开学还有 ${days} 天 · 今天是星期${weekDayNames[weekDay]}`,
        weekNo: 0,
        totalWeeks: 0,
        weekProgress: 0,
        isExamWeek: false,
        isWeekend: weekDay >= 6,
        monthDay: `${now.getMonth() + 1}月${now.getDate()}日`,
        weekDayName: weekDayNames[weekDay],
        themeKey: "vacation",
      });
    } else {
      // 超出校历覆盖范围（校历过期），不猜测，明确提示
      this.setData({
        phase: "unknown",
        phaseLabel: "不在本学年校历范围内",
        phaseSub: `今天 ${todayText} · ${CALENDAR_LABEL}校历数据截至 ${CALENDAR_END}`,
        weekNo: 0,
        totalWeeks: 0,
        weekProgress: 0,
        isExamWeek: false,
        isWeekend: weekDay >= 6,
        monthDay: `${now.getMonth() + 1}月${now.getDate()}日`,
        weekDayName: weekDayNames[weekDay],
        themeKey: "unknown",
      });
    }

    this.buildSemesterCards(now);
    this.buildKeyDates(now);
  },

  // 返回命中的学期与周次
  matchSemester(now) {
    for (const semester of SEMESTERS) {
      const start = parseDate(semester.startDate);
      const end = parseDate(semester.endDate);
      if (!start || !end) continue;
      // 区间包含判定：diffDays 返回「后者 - 前者」，见下方注释，
      // 不要写成 diffDays(end, now) < 0 —— 那会把整个学期都排除掉。
      if (diffDays(start, now) < 0 || diffDays(now, end) < 0) continue;
      return { semester, weekNo: weekOfSemester(semester, now) };
    }
    return null;
  },

  matchVacation(now) {
    for (const vacation of VACATIONS) {
      const start = parseDate(vacation.startDate);
      const end = parseDate(vacation.endDate);
      if (!start || !end) continue;
      if (diffDays(start, now) >= 0 && diffDays(now, end) >= 0) return vacation;
    }
    return null;
  },

  // 两学期卡片（含每学期的日期范围与进度）
  buildSemesterCards(now) {
    const cards = SEMESTERS.map((semester) => {
      const start = parseDate(semester.startDate);
      const end = parseDate(semester.endDate);
      const before = diffDays(now, start) > 0;
      const after = diffDays(end, now) > 0;
      let status = "已结束";
      if (before) status = "未开始";
      else if (!after) status = "进行中";

      let progress = 0;
      if (after) progress = 100;
      else if (!before) {
        // 按「当前第几周 / 总周数」算进度，与顶部状态卡口径一致
        progress = Math.min(
          Math.round((weekOfSemester(semester, now) / semester.totalWeeks) * 100),
          100,
        );
      }

      return {
        key: semester.key,
        name: semester.name,
        range: `${formatCn(start)} ~ ${formatCn(end)}`,
        note: semester.note,
        status,
        progress,
        active: status === "进行中",
      };
    });
    this.setData({ semesterCards: cards });
  },

  // 关键日期：标注已过 / 今天 / 临近
  buildKeyDates(now) {
    const list = KEY_DATES.map((item) => {
      const date = parseDate(item.date);
      const delta = date ? diffDays(now, date) : 0;
      let state = "past";
      if (delta === 0) state = "today";
      else if (delta > 0 && delta <= 14) state = "soon";
      else if (delta > 0) state = "future";
      return {
        date: item.date,
        monthDay: date ? `${date.getMonth() + 1}月${date.getDate()}日` : "",
        title: item.title,
        type: item.type,
        state,
      };
    });
    this.setData({ keyDates: list });
  },

  // ===== 图片查看 =====

  // 调起系统级图片查看器：支持双指缩放、长按保存/转发
  onPreview() {
    const url = this.data.calendarImage;
    wx.previewImage({
      urls: [url],
      current: url,
      fail: () => {
        wx.showToast({ title: "图片打开失败，请重试", icon: "none" });
      },
    });
  },

  onBackHome() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});
