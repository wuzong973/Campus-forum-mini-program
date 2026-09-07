const app = getApp();
const api = require("../../utils/api");
const request = require("../../utils/request");
const scheduleUtils = require("../../utils/schedule");
const auth = require("../../utils/auth");
const { runPullDownRefresh } = require("../../utils/refresh");

const WEEK_DAYS = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
];

const WEEK_DAY_SHORT = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// 20种预设背景颜色（包含纯色和渐变色）
const BG_COLOR_PALETTE = [
  "#F5F7FA",
  "#E8F0FF",
  "#FFF7E6",
  "#F6FFED",
  "#FFF0F6",
  "#F0F5FF",
  "#F9F0FF",
  "#E6FFFB",
  "#FFFBE6",
  "#FFF1F0",
  "linear-gradient(135deg, #E8F0FF 0%, #F0F4FF 100%)",
  "linear-gradient(135deg, #FFF7E6 0%, #FFFBE6 100%)",
  "linear-gradient(135deg, #F6FFED 0%, #F0FFF4 100%)",
  "linear-gradient(135deg, #FFF0F6 0%, #FBF0FF 100%)",
  "linear-gradient(135deg, #E6FFFB 0%, #E6F7FF 100%)",
  "linear-gradient(135deg, #FFF1F0 0%, #FFF7E8 100%)",
  "linear-gradient(135deg, #F0F5FF 0%, #E8F0FF 100%)",
  "linear-gradient(135deg, #F9F0FF 0%, #F0FAFF 100%)",
  "linear-gradient(135deg, #F5F0FF 0%, #FFF7E6 100%)",
  "linear-gradient(135deg, #E8FFF0 0%, #F0F0FF 100%)",
];

// 课程颜色调色板（用于随机分配给课程）
const COURSE_RANDOM_PALETTE = [
  {
    color: "#4A7AFF",
    soft: "rgba(74,122,255,0.20)",
    border: "rgba(74,122,255,0.30)",
    text: "#1a2a5e",
  },
  {
    color: "#FA8C16",
    soft: "rgba(250,140,22,0.20)",
    border: "rgba(250,140,22,0.30)",
    text: "#5c3400",
  },
  {
    color: "#52C41A",
    soft: "rgba(82,196,26,0.20)",
    border: "rgba(82,196,26,0.30)",
    text: "#1b4d00",
  },
  {
    color: "#722ED1",
    soft: "rgba(114,46,209,0.20)",
    border: "rgba(114,46,209,0.30)",
    text: "#2b0d5e",
  },
  {
    color: "#13C2C2",
    soft: "rgba(19,194,194,0.20)",
    border: "rgba(19,194,194,0.30)",
    text: "#004d4d",
  },
  {
    color: "#EB2F96",
    soft: "rgba(235,47,150,0.20)",
    border: "rgba(235,47,150,0.30)",
    text: "#5e0036",
  },
  {
    color: "#2F54EB",
    soft: "rgba(47,84,235,0.20)",
    border: "rgba(47,84,235,0.30)",
    text: "#0d1a5e",
  },
  {
    color: "#F5222D",
    soft: "rgba(245,34,45,0.20)",
    border: "rgba(245,34,45,0.30)",
    text: "#5e0000",
  },
  {
    color: "#FAAD14",
    soft: "rgba(250,173,20,0.20)",
    border: "rgba(250,173,20,0.30)",
    text: "#5c4000",
  },
  {
    color: "#7B61FF",
    soft: "rgba(123,97,255,0.20)",
    border: "rgba(123,97,255,0.30)",
    text: "#2b1a5e",
  },
  {
    color: "#36CFC9",
    soft: "rgba(54,207,201,0.20)",
    border: "rgba(54,207,201,0.30)",
    text: "#004d4a",
  },
  {
    color: "#FF7A45",
    soft: "rgba(255,122,69,0.20)",
    border: "rgba(255,122,69,0.30)",
    text: "#5e2200",
  },
  {
    color: "#597EF7",
    soft: "rgba(89,126,247,0.20)",
    border: "rgba(89,126,247,0.30)",
    text: "#1a2560",
  },
  {
    color: "#A0D911",
    soft: "rgba(160,217,17,0.20)",
    border: "rgba(160,217,17,0.30)",
    text: "#3d5200",
  },
  {
    color: "#FF85C0",
    soft: "rgba(255,133,192,0.20)",
    border: "rgba(255,133,192,0.30)",
    text: "#5e0030",
  },
];

// 节次结构：每节包含序号、时间段、所属时段（上午/午休/下午/晚上）
const SECTIONS = [
  { period: "早读", section: "早", time: "07:30-07:45" },
  { period: "上午", section: 1, time: "08:30-09:10" },
  { period: "上午", section: 2, time: "09:15-09:55" },
  { period: "上午", section: 3, time: "10:15-10:55" },
  { period: "上午", section: 4, time: "11:00-11:40" },
  { period: "午休", section: 5, time: "11:45-12:25" },
  { period: "午休", section: 6, time: "13:15-13:55" },
  { period: "下午", section: 7, time: "14:00-14:40" },
  { period: "下午", section: 8, time: "14:45-15:25" },
  { period: "下午", section: 9, time: "15:45-16:25" },
  { period: "下午", section: 10, time: "16:30-17:10" },
  { period: "晚上", section: 11, time: "19:30-20:10" },
];

// 将课程 startTime 映射到节次索引（0-based）
function timeToSectionIdx(startTime) {
  if (!startTime) return -1;
  const parts = String(startTime).split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const minutes = h * 60 + m;
  for (let i = SECTIONS.length - 1; i >= 0; i--) {
    const startStr = SECTIONS[i].time.split("-")[0];
    const sp = startStr.split(":");
    const sh = parseInt(sp[0], 10);
    const sm = parseInt(sp[1], 10);
    if (minutes >= sh * 60 + sm) return i;
  }
  return 0;
}

// 计算课程跨越的节次数
function calcSpan(startTime, endTime) {
  if (!startTime || !endTime) return 1;
  const startIdx = timeToSectionIdx(startTime);
  const endIdx = timeToSectionIdx(endTime);
  return Math.max(1, endIdx - startIdx + 1);
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    currentWeek: 1,
    isExpired: false,
    showDrawer: false,
    hideWeekend: false,
    reminder: false,
    bgColor: "#F5F7FA",
    allCourses: [],
    courses: [],
    weekDays: WEEK_DAYS,
    currentWeekText: "",
    legendThemes: Object.keys(scheduleUtils.COURSE_THEME_PRESETS).map(
      (key) => scheduleUtils.COURSE_THEME_PRESETS[key],
    ),
    legendColors: [],
    // grid 布局的所有格子（表头 + 时间 + 课程 + 空格）
    gridItems: [],
    totalWeeks: 20,
    showSemesterView: false,
    semesterWeeks: [],
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(1)
    // 从教务同步/考试/成绩页返回时收起抽屉（跳转时不再提前收起，避免转场闪烁）
    if (this.data.showDrawer) this.setData({ showDrawer: false });
    this.initFromConfig();
    this.applyCurrentWeekCourses(this.data.allCourses);
    this.loadSchedule();
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadSchedule());
  },

  initFromConfig() {
    const config = app.globalData.scheduleConfig;
    const startDate = new Date(config.startDate || "2026-03-02");
    const now = new Date();
    const diffDays = Math.floor((now - startDate) / 86400000);
    const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);
    const isExpired = currentWeek > 20;

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      hideWeekend: config.hideWeekend,
      reminder: config.reminder,
      bgColor: config.bgColor,
      currentWeek,
      isExpired,
      currentWeekText: this.formatWeekText(startDate, currentWeek),
    });
  },

  // 格式化周次显示文本
  formatWeekText(startDate, week) {
    const start = new Date(startDate);
    const weekStart = new Date(start.getTime() + (week - 1) * 7 * 86400000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    const fmt = (d) => {
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return m + "." + day;
    };
    return fmt(weekStart) + " - " + fmt(weekEnd);
  },

  loadSchedule() {
    // The schedule is private data. Guests can open this tab without sending
    // an authenticated request or being redirected away from it.
    if (!app.globalData.token) {
      this.setData({ allCourses: [] });
      this.applyCurrentWeekCourses([]);
      return;
    }

    api.getScheduleList({ silent: true }).then((courses) => {
      const list = (courses || []).map((item, index) =>
        scheduleUtils.normalizeCourse(item, index),
      );
      this.setData({ allCourses: list });
      this.applyCurrentWeekCourses(list);
    }).catch(() => {
      this.setData({ allCourses: [] });
      this.applyCurrentWeekCourses([]);
    });
  },

  // 为课程分配差异化颜色并填充到课程对象
  applyCourseColors(list) {
    const colorMap = scheduleUtils.buildCourseColorMap(list);
    list.forEach((course) => {
      const c = colorMap[String(course.id)];
      if (c) {
        course.courseColor = c.color;
        course.courseColorSoft = c.soft;
        course.courseColorBorder = c.border;
        course.courseColorText = c.text;
      }
    });
  },

  applyCurrentWeekCourses(list) {
    const currentWeek = Number(this.data.currentWeek) || 1;
    const visibleCourses = (list || []).filter((course) => {
      const startWeek = Number(course.startWeek) || 1;
      const endWeek = Number(course.endWeek) || startWeek;
      const weekType = course.weekType || "all";

      if (currentWeek < startWeek || currentWeek > endWeek) {
        return false;
      }
      if (weekType === "odd") return currentWeek % 2 === 1;
      if (weekType === "even") return currentWeek % 2 === 0;
      return true;
    });

    this.applyCourseColors(visibleCourses);

    this.setData({
      courses: visibleCourses,
      isExpired: visibleCourses.length === 0 && this.data.isExpired,
      gridItems: this.buildGridItems(visibleCourses, this.data.hideWeekend),
      legendColors: this.buildLegendColors(visibleCourses),
    });
  },

  // 构建图例颜色（使用实际课程颜色）
  buildLegendColors(courses) {
    const periodMap = {};
    courses.forEach((course) => {
      const period = this.getPeriod(course.startTime);
      if (!periodMap[period] && course.courseColor) {
        periodMap[period] = course.courseColor;
      }
    });
    return [
      { label: "上午课程", color: periodMap["上午"] || "#4A7AFF" },
      { label: "午休时段", color: periodMap["午休"] || "#FA8C16" },
      { label: "下午课程", color: periodMap["下午"] || "#52C41A" },
      { label: "晚上课程", color: periodMap["晚上"] || "#722ED1" },
    ];
  },

  // 根据时间获取时段
  getPeriod(time) {
    if (!time) return "上午";
    const parts = time.split(":");
    const hour = parseInt(parts[0], 10);
    if (hour < 12) return "上午";
    if (hour < 14) return "午休";
    if (hour < 18) return "下午";
    return "晚上";
  },

  // 构建 CSS Grid 所需的所有格子
  buildGridItems(courses, hideWeekend) {
    const items = [];
    const dayCount = hideWeekend ? 5 : 7;

    // 计算本周各天的日期
    const config = app.globalData.scheduleConfig;
    const startDate = new Date(config.startDate || "2026-03-02");
    const weekStart = new Date(
      startDate.getTime() + (this.data.currentWeek - 1) * 7 * 86400000,
    );
    const dayDates = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(weekStart.getTime() + i * 86400000);
      dayDates.push(d.getMonth() + 1 + "/" + d.getDate());
    }

    // 1. 日期行（row 1）
    items.push({
      id: "h-time-date",
      type: "header-date",
      text: "",
      rowStart: 1,
      rowEnd: 2,
      col: 1,
    });
    for (let i = 0; i < dayCount; i++) {
      items.push({
        id: "h-date-" + i,
        type: "header-date",
        text: dayDates[i],
        rowStart: 1,
        rowEnd: 2,
        col: i + 2,
      });
    }

    // 2. 星期行（row 2）
    items.push({
      id: "h-time",
      type: "header",
      text: "时间",
      rowStart: 2,
      rowEnd: 3,
      col: 1,
    });
    for (let i = 0; i < dayCount; i++) {
      items.push({
        id: "h-day-" + i,
        type: "header",
        text: WEEK_DAY_SHORT[i],
        rowStart: 2,
        rowEnd: 3,
        col: i + 2,
      });
    }

    // 3. 时间列（每行一个）
    SECTIONS.forEach((s, idx) => {
      const row = idx + 3; // row 1=日期, row 2=星期, 数据从 row 3 开始
      items.push({
        id: "time-" + idx,
        type: "time",
        text: s.time,
        rowStart: row,
        rowEnd: row + 1,
        col: 1,
      });
    });

    // 3. 课程格子 + 空白格子
    // 冲突检测：同一时间段多门课程时，自动插入额外行
    const filtered = hideWeekend
      ? courses.filter((c) => c.weekDay <= 5)
      : courses.slice();

    // 按 (startRow, col) 分组
    const courseByCell = {};
    filtered.forEach((c) => {
      const startRow = timeToSectionIdx(c.startTime);
      const col = c.weekDay - 1;
      if (
        startRow < 0 ||
        startRow >= SECTIONS.length ||
        col < 0 ||
        col >= dayCount
      )
        return;
      const key = startRow + "-" + col;
      if (!courseByCell[key]) courseByCell[key] = [];
      courseByCell[key].push(c);
    });

    // 计算每个原始行需要多少额外行（冲突数 - 1）
    const extraRows = {}; // key: original row index, value: number of extra rows needed
    Object.keys(courseByCell).forEach((key) => {
      const [rowStr] = key.split("-");
      const row = parseInt(rowStr);
      const count = courseByCell[key].length;
      if (count > 1) {
        extraRows[row] = Math.max(extraRows[row] || 0, count - 1);
      }
    });

    // 构建行偏移映射：originalRow -> gridRow (1-based, 1=日期行, 2=星期行)
    // 表头占 row 1-2，数据从 row 3 开始
    const rowOffset = {};
    let offset = 0;
    for (let r = 0; r < SECTIONS.length; r++) {
      rowOffset[r] = r + 3 + offset; // +3: 2 for header rows, 1 for 0-based to 1-based
      if (extraRows[r]) offset += extraRows[r];
    }
    const totalGridRows = SECTIONS.length + 3 + offset; // +3 for 2 header rows

    // 更新午别跨行范围
    items.forEach((item) => {
      if (item.type === "period") {
        // 找到该时段覆盖的原始行范围
        let firstRow = -1,
          lastRow = -1;
        for (let r = 0; r < SECTIONS.length; r++) {
          if (SECTIONS[r].period === item.text) {
            if (firstRow === -1) firstRow = r;
            lastRow = r;
          }
        }
        if (firstRow >= 0) {
          item.rowStart = rowOffset[firstRow];
          item.rowEnd = rowOffset[lastRow] + 1 + (extraRows[lastRow] || 0);
        }
      }
    });

    // 放置课程
    const courseItems = [];
    const placedCells = {}; // 记录已放置课程的格子

    Object.keys(courseByCell).forEach((key) => {
      const [rowStr, colStr] = key.split("-");
      const row = parseInt(rowStr);
      const col = parseInt(colStr);
      const coursesInCell = courseByCell[key];
      const gridRow = rowOffset[row];
      const extras = extraRows[row] || 0;

      if (coursesInCell.length === 1) {
        // 单门课程，正常放置
        const c = coursesInCell[0];
        const span = calcSpan(c.startTime, c.endTime);
        courseItems.push({
          id: "course-" + c.id,
          type: "course",
          course: c,
          locationClass: this.getLocationClass(c.location),
          courseStyle: this.getCourseCardStyle(c),
          courseBg: c.courseColorSoft
            ? "background:" + c.courseColorSoft + ";"
            : "",
          rowStart: gridRow,
          rowEnd: gridRow + span,
          col: col + 2,
        });
        for (let r = row; r < Math.min(SECTIONS.length, row + span); r++) {
          placedCells[r + "-" + col] = true;
        }
      } else {
        // 多门课程冲突，平均分配额外行
        coursesInCell.forEach((c, idx) => {
          const span = calcSpan(c.startTime, c.endTime);
          const start = gridRow + idx;
          const end = start + Math.max(1, span);
          courseItems.push({
            id: "course-" + c.id,
            type: "course",
            course: c,
            locationClass: this.getLocationClass(c.location),
            courseStyle: this.getCourseCardStyle(c),
            courseBg: c.courseColorSoft
              ? "background:" + c.courseColorSoft + ";"
              : "",
            rowStart: start,
            rowEnd: end,
            col: col + 2,
          });
        });
        const maxSpan = coursesInCell.reduce(
          (max, c) => Math.max(max, calcSpan(c.startTime, c.endTime)),
          1,
        );
        for (let r = row; r < Math.min(SECTIONS.length, row + maxSpan); r++) {
          placedCells[r + "-" + col] = true;
        }
      }
    });

    // 空白格子（保持默认样式，不添加颜色）
    const emptyItems = [];
    for (let r = 0; r < SECTIONS.length; r++) {
      for (let c = 0; c < dayCount; c++) {
        if (!placedCells[r + "-" + c]) {
          const gridRow = rowOffset[r];
          const extras = extraRows[r] || 0;
          emptyItems.push({
            id: "empty-" + r + "-" + c,
            type: "empty",
            rowStart: gridRow,
            rowEnd: gridRow + 1 + extras,
            col: c + 2,
          });
        }
      }
    }

    return items.concat(courseItems, emptyItems);
  },

  // 根据教室名称返回颜色 class
  getLocationClass(location) {
    if (!location) return "";
    // B604 / B605 等实训楼 → 橙色
    if (/B\d{3}/i.test(location)) return "location-orange";
    // 操场 → 绿色
    if (location.indexOf("操场") > -1) return "location-green";
    // 2301 / 2302 等 → 紫色
    if (/^2\d{3}$/.test(location)) return "location-purple";
    // 1124 / 1122 等 → 蓝色
    if (/^11\d{2}$/.test(location)) return "location-blue";
    // 1305 / 1203 / 1205 / 1213 等 → 红色
    if (/^\d{3,4}$/.test(location)) return "location-red";
    return "";
  },

  getCourseCardStyle(course) {
    const bg =
      course.courseColorSoft || course.themeSoft || "rgba(74, 122, 255, 0.14)";
    const border =
      course.courseColorBorder ||
      course.themeBorder ||
      "rgba(74, 122, 255, 0.2)";
    return "background:" + bg + ";border-color:" + border + ";";
  },

  // 获取课程专属文字颜色
  getCourseTextColor(course) {
    return course.courseColorText || "#1f2a44";
  },

  toggleDrawer() {
    this.setData({ showDrawer: !this.data.showDrawer });
  },

  closeDrawer() {
    this.setData({ showDrawer: false });
  },

  onHideWeekend(e) {
    const val = e.detail.value;
    this.setData({ hideWeekend: val });
    app.saveScheduleConfig({ hideWeekend: val });
    this.setData({ gridItems: this.buildGridItems(this.data.courses, val) });
  },

  onReminder(e) {
    const val = e.detail.value;
    this.setData({ reminder: val });
    app.saveScheduleConfig({ reminder: val });
    if (val) {
      wx.showToast({ title: "提醒将在首页展示", icon: "none" });
    }
  },

  goAdd() {
    if (!auth.requireLogin("添加课程前请先登录小程序账号")) return;
    wx.navigateTo({ url: "/pkg-schedule/schedule-add/index" });
  },

  goOcr() {
    if (!auth.requireLogin("识别课表前请先登录小程序账号")) return;
    wx.navigateTo({ url: "/pkg-schedule/schedule-ocr/index" });
  },

  goSyncSchedule() {
    if (!auth.requireLogin("同步课表前请先登录小程序账号")) {
      return;
    }
    // 先导航再反馈：跳转前不做 setData，避免抽屉收起动画
    // 与页面重渲染抢占渲染线程，造成"闪回课表页 + 跳转延迟"
    wx.navigateTo({ url: "/pkg-schedule/schedule-login/index" });
    wx.vibrateShort({ type: "light" });
  },

  // 查询考试安排：与同步课表共用同一教务入口（自动同步后跳转考试页）
  goExamSchedule() {
    if (!auth.requireLogin("查询考试安排前请先登录小程序账号")) {
      return;
    }
    wx.navigateTo({ url: "/pkg-schedule/schedule-login/index?target=exam" });
    wx.vibrateShort({ type: "light" });
  },

  // 查询我的成绩：与同步课表共用同一教务入口（自动同步后跳转成绩页）
  goMyGrades() {
    if (!auth.requireLogin("查询成绩前请先登录小程序账号")) {
      return;
    }
    wx.navigateTo({ url: "/pkg-schedule/schedule-login/index?target=grade" });
    wx.vibrateShort({ type: "light" });
  },

  onRefresh() {
    this.initFromConfig();
    this.applyCurrentWeekCourses(this.data.allCourses);
    this.loadSchedule();
    wx.showToast({ title: "已刷新", icon: "success" });
  },

  // 上一周
  onPrevWeek() {
    if (this.data.currentWeek <= 1) return;
    this.switchWeek(this.data.currentWeek - 1);
  },

  // 下一周
  onNextWeek() {
    if (this.data.currentWeek >= this.data.totalWeeks) return;
    this.switchWeek(this.data.currentWeek + 1);
  },

  // 切换周次
  switchWeek(week) {
    if (week < 1 || week > this.data.totalWeeks) return;
    this.setData({ currentWeek: week });
    this.applyCurrentWeekCourses(this.data.allCourses);
    this.buildSemesterWeeks();
  },

  // 切换学期课表视图
  toggleSemesterView() {
    const show = !this.data.showSemesterView;
    this.setData({ showSemesterView: show });
    if (show) {
      this.buildSemesterWeeks();
    }
  },

  // 点击学期视图中的某一周
  onSemesterWeekTap(e) {
    const week = e.currentTarget.dataset.week;
    this.switchWeek(week);
    this.setData({ showSemesterView: false });
  },

  // 构建学期周次数据
  buildSemesterWeeks() {
    const config = app.globalData.scheduleConfig;
    const startDate = new Date(config.startDate || "2026-03-02");
    const weeks = [];
    for (let i = 1; i <= this.data.totalWeeks; i++) {
      const weekStart = new Date(startDate.getTime() + (i - 1) * 7 * 86400000);
      const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
      const fmt = (d) => d.getMonth() + 1 + "." + d.getDate();
      const dateRange = fmt(weekStart) + " - " + fmt(weekEnd);

      // 计算该周的课程数
      const weekCourses = this.data.allCourses.filter((course) => {
        const startWeek = Number(course.startWeek) || 1;
        const endWeek = Number(course.endWeek) || startWeek;
        const weekType = course.weekType || "all";
        if (i < startWeek || i > endWeek) return false;
        if (weekType === "odd") return i % 2 === 1;
        if (weekType === "even") return i % 2 === 0;
        return true;
      });

      weeks.push({
        week: i,
        dateRange,
        courseCount: weekCourses.length,
        isCurrent: i === this.data.currentWeek,
        isExpired: i > 20,
      });
    }
    this.setData({ semesterWeeks: weeks });
  },

  goSetDate() {
    wx.showModal({
      title: "设置开始日期",
      editable: true,
      placeholderText: "格式：2026-03-02",
      success: (res) => {
        if (
          res.confirm &&
          res.content &&
          /^\d{4}-\d{2}-\d{2}$/.test(res.content)
        ) {
          app.saveScheduleConfig({ startDate: res.content });
          this.initFromConfig();
          this.applyCurrentWeekCourses(this.data.allCourses);
          wx.showToast({ title: "日期已更新", icon: "success" });
        } else if (res.confirm) {
          wx.showToast({ title: "日期格式不正确", icon: "none" });
        }
      },
    });
  },

  // 随机切换课表背景颜色
  onBgColor() {
    const currentBg = this.data.bgColor;
    let newBg;
    // 确保不重复选择当前颜色
    do {
      newBg =
        BG_COLOR_PALETTE[Math.floor(Math.random() * BG_COLOR_PALETTE.length)];
    } while (newBg === currentBg);

    this.setData({ bgColor: newBg });
    app.saveScheduleConfig({ bgColor: newBg });

    // 同时随机切换课程颜色
    this.randomizeCourseColors();
  },

  // 为所有课程随机分配颜色
  randomizeCourseColors() {
    const courses = this.data.allCourses;
    const nameColorMap = {}; // 相同课程名称保持相同颜色

    courses.forEach((course) => {
      const name = course.name;
      if (!nameColorMap[name]) {
        // 为新课程随机选择颜色
        const randomColor =
          COURSE_RANDOM_PALETTE[
            Math.floor(Math.random() * COURSE_RANDOM_PALETTE.length)
          ];
        nameColorMap[name] = randomColor;
      }

      // 应用颜色到课程对象
      const colors = nameColorMap[name];
      course.courseColor = colors.color;
      course.courseColorSoft = colors.soft;
      course.courseColorBorder = colors.border;
      course.courseColorText = colors.text;
    });

    // 重新应用当前周次的课程
    this.applyCurrentWeekCourses(courses);
  },

  // 清空/编辑课表
  onEditSchedule() {
    if (!auth.requireLogin("管理课表前请先登录小程序账号")) return;
    this.setData({ showDrawer: false });
    wx.showActionSheet({
      itemList: ["编辑课程", "清空全部课表"],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 编辑课程：跳转到编辑页面
          wx.navigateTo({ url: "/pkg-schedule/schedule-edit/index" });
        } else if (res.tapIndex === 1) {
          // 清空全部课表
          wx.showModal({
            title: "确认清空",
            content: "确定要清空所有课程吗？此操作不可恢复。",
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.setStorageSync("schedule_courses", []);
                api.clearSchedule().catch(() => {});
                this.setData({ allCourses: [] });
                this.loadSchedule();
                wx.showToast({ title: "课表已清空", icon: "success" });
              }
            },
          });
        }
      },
    });
  },
});
