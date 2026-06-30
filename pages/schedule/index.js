const app = getApp();
const api = require("../../utils/api");
const request = require("../../utils/request");
const scheduleUtils = require("../../utils/schedule");

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
    courses: [],
    weekDays: WEEK_DAYS,
    currentWeekText: "",
    legendThemes: Object.keys(scheduleUtils.COURSE_THEME_PRESETS).map(
      (key) => scheduleUtils.COURSE_THEME_PRESETS[key],
    ),
    // grid 布局的所有格子（表头 + 时间 + 课程 + 空格）
    gridItems: [],
  },

  onLoad() {
    this.initFromConfig();
    this.loadSchedule();
  },

  onShow() {
    this.loadSchedule();
  },

  initFromConfig() {
    const config = app.globalData.scheduleConfig;
    const startDate = new Date(config.startDate || "2025-09-01");
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
    api.getScheduleList().then((courses) => {
      const list = (courses || []).map((item, index) =>
        scheduleUtils.normalizeCourse(item, index),
      );
      this.setData({
        courses: list,
        isExpired: list.length === 0 && this.data.isExpired,
        gridItems: this.buildGridItems(list, this.data.hideWeekend),
      });
    });
  },

  // 构建 CSS Grid 所需的所有格子
  buildGridItems(courses, hideWeekend) {
    const items = [];
    const dayCount = hideWeekend ? 5 : 7;

    // 计算本周各天的日期
    const config = app.globalData.scheduleConfig;
    const startDate = new Date(config.startDate || "2025-09-01");
    const weekStart = new Date(startDate.getTime() + (this.data.currentWeek - 1) * 7 * 86400000);
    const dayDates = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(weekStart.getTime() + i * 86400000);
      dayDates.push((d.getMonth() + 1) + "/" + d.getDate());
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
            rowStart: start,
            rowEnd: end,
            col: col + 2,
          });
        });
        const maxSpan = coursesInCell.reduce((max, c) => Math.max(max, calcSpan(c.startTime, c.endTime)), 1);
        for (let r = row; r < Math.min(SECTIONS.length, row + maxSpan); r++) {
          placedCells[r + "-" + col] = true;
        }
      }
    });

    // 空白格子
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
    return [
      "background:",
      course.themeSoft || "rgba(74, 122, 255, 0.14)",
      ";border-color:",
      course.themeBorder || "rgba(74, 122, 255, 0.2)",
      ";",
    ].join("");
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
    wx.navigateTo({ url: "/pages/schedule-add/index" });
  },

  goOcr() {
    wx.navigateTo({ url: "/pages/schedule-ocr/index" });
  },

  goSyncSchedule() {
    wx.vibrateShort({ type: "light" });
    wx.navigateTo({
      url:
        "/pages/webview/index?url=" +
        encodeURIComponent("http://jw.gdip.edu.cn/jsxsd") +
        "&title=" +
        encodeURIComponent("教务系统"),
    });
  },

  onRefresh() {
    this.initFromConfig();
    this.loadSchedule();
    wx.showToast({ title: "已刷新", icon: "success" });
  },

  goSetDate() {
    wx.showModal({
      title: "设置开始日期",
      editable: true,
      placeholderText: "格式：2025-09-01",
      success: (res) => {
        if (
          res.confirm &&
          res.content &&
          /^\d{4}-\d{2}-\d{2}$/.test(res.content)
        ) {
          app.saveScheduleConfig({ startDate: res.content });
          this.initFromConfig();
          wx.showToast({ title: "日期已更新", icon: "success" });
        } else if (res.confirm) {
          wx.showToast({ title: "日期格式不正确", icon: "none" });
        }
      },
    });
  },

  onBgColor() {
    const colors = ["#F5F7FA", "#E8F0FF", "#FFF7E6", "#F6FFED"];
    const idx = colors.indexOf(this.data.bgColor);
    const next = colors[(idx + 1) % colors.length];
    this.setData({ bgColor: next });
    app.saveScheduleConfig({ bgColor: next });
  },

  // 清空/编辑课表
  onEditSchedule() {
    this.setData({ showDrawer: false });
    wx.showActionSheet({
      itemList: ["编辑课程", "清空全部课表"],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 编辑课程：跳转到编辑页面
          wx.navigateTo({ url: "/pages/schedule-edit/index" });
        } else if (res.tapIndex === 1) {
          // 清空全部课表
          wx.showModal({
            title: "确认清空",
            content: "确定要清空所有课程吗？此操作不可恢复。",
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.setStorageSync("schedule_courses", []);
                if (!request.USE_MOCK) {
                  api.clearSchedule().catch(() => {});
                }
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
