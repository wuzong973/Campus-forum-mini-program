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

// ===== 课表网格：节次口径统一在 utils/schedule.js（与官方教务系统一致）=====
// 行 = 节次对（1-2 / 3-4 / 5-6 / 7-8 / 9-10 / 11-12），列 = 星期（隐藏周末时只留周一到周五）。
const CLASS_ROWS = scheduleUtils.CLASS_ROWS;
const HEADER_ROW_COUNT = 2; // 第 1 行日期、第 2 行星期
const PERIOD_COL = 1; // 午别列
const TIME_COL = 2; // 节次 + 上课时间列
const FIRST_DAY_COL = 3; // 星期列起始列号

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
    // 空态区分用：本学期总课程数 / 首个有课的教学周。
    // 只有课程数 > 0 时才说明「数据在，只是本周没课」，避免把
    // 「本周无课」误报成「暂无课程（课表是空的）」。
    semesterCourseCount: 0,
    firstCourseWeek: 0,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(1)
    // 点击「课程表」tab 进入时自动展开左侧功能栏（标记由自定义 tabBar 写入）；
    // 仅在课表尚未同步（未绑定教务系统）时弹出引导，已同步用户不再打扰；
    // 从教务同步/考试/成绩页返回时仍收起，避免转场闪烁
    const autoOpen = !!(app.globalData && app.globalData.scheduleDrawerAutoOpen)
    if (app.globalData) app.globalData.scheduleDrawerAutoOpen = false
    if (autoOpen) {
      // 未登录/请求失败时 getJwBound 返回 false → 照常弹出，保证同步入口可达
      auth.getJwBound().then((bound) => this.setData({ showDrawer: !bound }))
    } else {
      this.setData({ showDrawer: false });
    }
    // 手动添加课程后带过来的定位意图：先摘走再拉数据，避免下次 onShow 重复触发
    const pending = (app.globalData && app.globalData.scheduleJumpToWeek) || null
    if (app.globalData) app.globalData.scheduleJumpToWeek = null
    if (pending) this._pendingJumpCourse = pending
    this.initFromConfig();
    this.applyCurrentWeekCourses(this.data.allCourses);
    this.loadSchedule();
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadSchedule());
  },

  initFromConfig() {
    const config = app.globalData.scheduleConfig || {};
    // 周次统一走 computeAcademicWeek：超出学期总周数时夹到最后一周并给出过期标记，
    // 避免像旧逻辑那样算出「第 28 周」并把日期表头推到学期之外。
    // 起始日一律过 parseSemesterStart（周一锚点）——若配置里存的是周日值（历史缓存写过
    // 2026-09-06），不锚定会让这里算出的周次与表头列日期各差一天甚至一周。
    const academicWeek = scheduleUtils.computeAcademicWeek(
      config.startDate,
      this.data.totalWeeks,
    );
    const currentWeek = academicWeek.currentWeek;
    const isExpired = academicWeek.isExpired;

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      hideWeekend: config.hideWeekend,
      reminder: config.reminder,
      bgColor: config.bgColor,
      currentWeek,
      isExpired,
      currentWeekText: this.weekDateText(currentWeek),
    });
  },

  // 「本周课表」标题下的日期区间。与 buildGridItems 的表头列共用同一份起始日口径，
  // 因此任何改变 currentWeek 的地方都必须重算它（见 switchWeek / onJumpToFirstCourseWeek），
  // 否则会出现「标题第 3 周、表头 9/21、卡片却还写着上一周 9.14-9.20」的三处不一致。
  weekDateText(week) {
    const config = app.globalData.scheduleConfig || {};
    return this.formatWeekText(
      scheduleUtils.parseSemesterStart(config.startDate),
      week,
    );
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
    // 用 auth.isLoggedIn() 而不是直接看 token 字符串：token 已过期时它是 false，
    // 否则会带着废 token 打服务端拿 401，再把 catch 分支的空数组渲染成「暂无课程」。
    if (!auth.isLoggedIn()) {
      this.setData({ allCourses: [], semesterCourseCount: 0, firstCourseWeek: 0 });
      this.applyCurrentWeekCourses([]);
      return;
    }

    api.getScheduleList({ silent: true }).then((courses) => {
      const list = (courses || []).map((item, index) =>
        scheduleUtils.normalizeCourse(item, index),
      );
      this.setData({ allCourses: list });
      this.applyCurrentWeekCourses(list);
      this.maybeJumpToCourseWeek(list);
    }).catch(() => {
      this.setData({ allCourses: [], semesterCourseCount: 0, firstCourseWeek: 0 });
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
    const source = list || [];
    const visibleCourses = source.filter((course) => {
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
      // 供空态区分「本学期没有课」与「只是本周没课」：后者要引导用户跳到有课的周，
      // 而不是让他以为课表压根没导入成功。
      semesterCourseCount: source.length,
      firstCourseWeek: this.resolveFirstCourseWeek(source),
    });
  },

  // 单门课在给定周次是否上课（含单双周）
  isCourseActiveInWeek(course, week) {
    const startWeek = Number(course && course.startWeek) || 1;
    const endWeek = Number(course && course.endWeek) || startWeek;
    const weekType = (course && course.weekType) || "all";
    if (week < startWeek || week > endWeek) return false;
    if (weekType === "odd") return week % 2 === 1;
    if (weekType === "even") return week % 2 === 0;
    return true;
  },

  // 从某门课的开始周起，找到它第一个真正上课的周（跳过单双周不匹配的周）
  resolveFirstActiveWeek(course) {
    const startWeek = Math.max(1, Number(course && course.startWeek) || 1);
    const endWeek = Math.min(
      this.data.totalWeeks,
      Number(course && course.endWeek) || startWeek,
    );
    for (let week = startWeek; week <= endWeek; week += 1) {
      if (this.isCourseActiveInWeek(course, week)) return week;
    }
    return 0;
  },

  // 整张课表里最早有课的教学周（0 = 本学期没有任何课）
  resolveFirstCourseWeek(list) {
    let earliest = 0;
    (list || []).forEach((course) => {
      const week = this.resolveFirstActiveWeek(course);
      if (!week) return;
      if (!earliest || week < earliest) earliest = week;
    });
    return earliest;
  },

  /**
   * 自动定位到「有课的周」。
   *
   * 两种触发：
   *  1) 刚手动添加了课程（_pendingJumpCourse）→ 无条件跳到该课所在周，
   *     否则用户选了 13-19 周却停在当前周，只会看到空课表并以为保存失败；
   *  2) 首次进入时本周恰好没课（如大一军训期）→ 跳到本学期首个有课周。
   *     只自动跳一次，之后用户手动翻到空周不会被反复拽走。
   */
  maybeJumpToCourseWeek(list) {
    if (!list || !list.length) return;

    const pending = this._pendingJumpCourse;
    if (pending) this._pendingJumpCourse = null;

    if (!pending && this._autoJumpedToCourseWeek) return;
    if (!pending && this.data.courses.length > 0) {
      this._autoJumpedToCourseWeek = true;
      return;
    }

    const target = pending
      ? this.resolveFirstActiveWeek(pending)
      : this.resolveFirstCourseWeek(list);
    this._autoJumpedToCourseWeek = true;
    if (!target || target === this.data.currentWeek) return;

    this.switchWeek(target);
    // 自动跳（本周原本没课）时说明原因，否则用户会以为是自己误触了周次
    wx.showToast({
      title: pending ? "已切到第 " + target + " 周" : "本周无课，已切到第 " + target + " 周",
      icon: "none",
    });
  },

  // 空态里的「跳到第 N 周查看」按钮
  onJumpToFirstCourseWeek() {
    const target = Number(this.data.firstCourseWeek) || 0;
    if (!target) return;
    this._autoJumpedToCourseWeek = true;
    this.switchWeek(target);
  },

  /**
   * 点击顶部「第 N 周」→ 打开全周次总览（与本学期课表按钮同一个视图）。
   * 目的是让用户一眼看到整个学期每周几门课、哪一周开始有课，
   * 不用一周一周地点「下一周」去试。
   */
  onWeekTextTap() {
    if (!this.data.semesterCourseCount) {
      // 学期里一门课都没有时，视图没有内容可展开，如实告知而不是"点了没反应"
      wx.showToast({ title: "还没有课表，可手动添加或同步教务", icon: "none" });
      return;
    }
    this.toggleSemesterView();
  },

  // 构建图例颜色（按午别取该时段第一门课的颜色）
  buildLegendColors(courses) {
    const periodMap = {};
    (courses || []).forEach((course) => {
      const period = this.getPeriod(course.startTime);
      if (!periodMap[period] && course.courseColor) {
        periodMap[period] = course.courseColor;
      }
    });
    return [
      { label: "上午课程", color: periodMap["上午"] || "#4A7AFF" },
      { label: "下午课程", color: periodMap["下午"] || "#52C41A" },
      { label: "晚上课程", color: periodMap["晚上"] || "#722ED1" },
    ];
  },

  // 根据上课时间获取午别：与作息表同口径（12 点前上午、18 点前下午、其后晚上）
  getPeriod(time) {
    return scheduleUtils.getDayPeriod(time);
  },

  // 构建 CSS Grid 所需的所有格子：日期/星期表头 + 午别列 + 节次时间列 + 课程格 + 空格
  buildGridItems(courses, hideWeekend) {
    const items = [];
    const dayCount = hideWeekend ? 5 : 7;
    const rowCount = CLASS_ROWS.length;

    // 本周各天的日期（学期起始日 = 第 1 教学周的周一，统一走 parseSemesterStart 锚定）
    const config = app.globalData.scheduleConfig || {};
    const startDate = scheduleUtils.parseSemesterStart(config.startDate);
    const weekStart = new Date(
      startDate.getTime() +
        ((Number(this.data.currentWeek) || 1) - 1) * 7 * 86400000,
    );
    const dayDates = [];
    for (let i = 0; i < dayCount; i += 1) {
      const d = new Date(weekStart.getTime() + i * 86400000);
      dayDates.push(d.getMonth() + 1 + "/" + d.getDate());
    }

    // 1. 日期行（grid row 1）
    items.push({ id: "hd-period", type: "header-date", text: "", rowStart: 1, rowEnd: 2, col: PERIOD_COL });
    items.push({ id: "hd-time", type: "header-date", text: "", rowStart: 1, rowEnd: 2, col: TIME_COL });
    for (let i = 0; i < dayCount; i += 1) {
      items.push({
        id: "hd-date-" + i,
        type: "header-date",
        text: dayDates[i],
        rowStart: 1,
        rowEnd: 2,
        col: FIRST_DAY_COL + i,
      });
    }

    // 2. 星期行（grid row 2）
    items.push({ id: "h-period", type: "header", text: "午别", rowStart: 2, rowEnd: 3, col: PERIOD_COL });
    items.push({ id: "h-time", type: "header", text: "节次", rowStart: 2, rowEnd: 3, col: TIME_COL });
    for (let i = 0; i < dayCount; i += 1) {
      items.push({
        id: "h-day-" + i,
        type: "header",
        text: WEEK_DAY_SHORT[i],
        rowStart: 2,
        rowEnd: 3,
        col: FIRST_DAY_COL + i,
      });
    }

    // 3. 午别列：同一午别的连续行合并成一格
    let groupStart = 0;
    while (groupStart < rowCount) {
      let groupEnd = groupStart;
      while (
        groupEnd + 1 < rowCount &&
        CLASS_ROWS[groupEnd + 1].period === CLASS_ROWS[groupStart].period
      ) {
        groupEnd += 1;
      }
      items.push({
        id: "period-" + groupStart,
        type: "period",
        text: CLASS_ROWS[groupStart].period,
        rowStart: HEADER_ROW_COUNT + groupStart + 1,
        rowEnd: HEADER_ROW_COUNT + groupEnd + 2,
        col: PERIOD_COL,
      });
      groupStart = groupEnd + 1;
    }

    // 4. 节次 + 上课时间列
    CLASS_ROWS.forEach((row, idx) => {
      items.push({
        id: "time-" + idx,
        type: "time",
        text: row.label,
        sub: row.startTime + "-" + row.endTime,
        rowStart: HEADER_ROW_COUNT + idx + 1,
        rowEnd: HEADER_ROW_COUNT + idx + 2,
        col: TIME_COL,
      });
    });

    // 5. 课程格：按天分列后，对同一列内时间重叠的课程做「泳道」并排。
    //    旧逻辑靠插入额外行避让冲突，会把后面的时间轴整体顶偏，这里改成同格并排。
    const placed = [];
    const occupied = {};
    for (let col = 0; col < dayCount; col += 1) {
      const dayCourses = [];
      (courses || []).forEach((c) => {
        if (Number(c.weekDay) - 1 !== col) return;
        dayCourses.push({ course: c, slot: scheduleUtils.resolveCourseSlot(c) });
      });
      dayCourses.sort(
        (a, b) =>
          a.slot.rowIndex - b.slot.rowIndex ||
          b.slot.rowSpan - a.slot.rowSpan ||
          String(a.course.startTime).localeCompare(String(b.course.startTime)),
      );

      let cluster = [];
      let clusterEnd = -1;
      const flush = () => {
        if (!cluster.length) return;
        const laneEnds = []; // 每条泳道占用的最后一行（含）
        cluster.forEach((entry) => {
          let lane = -1;
          for (let i = 0; i < laneEnds.length; i += 1) {
            if (laneEnds[i] < entry.slot.rowIndex) {
              lane = i;
              break;
            }
          }
          if (lane === -1) lane = laneEnds.length;
          const span = Math.max(
            1,
            Math.min(entry.slot.rowSpan, rowCount - entry.slot.rowIndex),
          );
          laneEnds[lane] = entry.slot.rowIndex + span - 1;
          entry.lane = lane;
          entry.span = span;
        });
        const laneCount = laneEnds.length;
        const share = 100 / laneCount;
        cluster.forEach((entry) => {
          const c = entry.course;
          placed.push({
            id: "course-" + c.id,
            type: "course",
            course: c,
            locationClass: this.getLocationClass(c.location),
            courseStyle: this.getCourseCardStyle(c),
            courseBg: c.courseColorSoft ? "background:" + c.courseColorSoft + ";" : "",
            narrow: laneCount > 1,
            cellStyle:
              laneCount > 1
                ? "width:" + share + "%;margin-left:" + share * entry.lane + "%;"
                : "",
            rowStart: HEADER_ROW_COUNT + entry.slot.rowIndex + 1,
            rowEnd: HEADER_ROW_COUNT + entry.slot.rowIndex + entry.span + 1,
            col: FIRST_DAY_COL + col,
          });
          for (
            let r = entry.slot.rowIndex;
            r < entry.slot.rowIndex + entry.span;
            r += 1
          ) {
            occupied[r + "-" + col] = true;
          }
        });
        cluster = [];
        clusterEnd = -1;
      };

      dayCourses.forEach((entry) => {
        if (cluster.length && entry.slot.rowIndex >= clusterEnd) flush();
        cluster.push(entry);
        clusterEnd = Math.max(clusterEnd, entry.slot.rowIndex + entry.slot.rowSpan);
      });
      flush();
    }

    // 6. 空格子（保持默认虚线样式）
    const emptyItems = [];
    for (let r = 0; r < rowCount; r += 1) {
      for (let c = 0; c < dayCount; c += 1) {
        if (occupied[r + "-" + c]) continue;
        emptyItems.push({
          id: "empty-" + r + "-" + c,
          type: "empty",
          rowStart: HEADER_ROW_COUNT + r + 1,
          rowEnd: HEADER_ROW_COUNT + r + 2,
          col: FIRST_DAY_COL + c,
        });
      }
    }

    return items.concat(placed, emptyItems);
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
    // currentWeekText 必须与 currentWeek 同批更新：此前只 setData({ currentWeek })，
    // 于是「下一周 / 自动跳到有课周」之后标题与表头都进了新周，卡片日期还停在上周。
    this.setData({ currentWeek: week, currentWeekText: this.weekDateText(week) });
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
    const config = app.globalData.scheduleConfig || {};
    const startDate = scheduleUtils.parseSemesterStart(config.startDate);
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
      placeholderText: "格式：2026-09-07",
      success: (res) => {
        if (
          res.confirm &&
          res.content &&
          scheduleUtils.isRealDate(res.content)
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
                // 与「手动添加」同一原则：必须等服务端真删掉再提示成功。
                // 原先是 fire-and-forget + 立刻提示「课表已清空」，一旦 401/断网，
                // 用户以为清空了、刷新后课程又全部回来。
                api
                  .clearSchedule()
                  .then(() => {
                    this.setData({
                      allCourses: [],
                      semesterCourseCount: 0,
                      firstCourseWeek: 0,
                    });
                    this.applyCurrentWeekCourses([]);
                    wx.showToast({ title: "课表已清空", icon: "success" });
                  })
                  .catch(() => {
                    // 失败原因由 utils/request.js 统一提示（401 会引导重新登录），
                    // 这里保持课表原样，不制造"已清空"的假象
                  });
              }
            },
          });
        }
      },
    });
  },
});
