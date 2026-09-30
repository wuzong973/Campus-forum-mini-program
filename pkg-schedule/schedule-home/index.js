const app = getApp();
const api = require("../../utils/api");
const { runPullDownRefresh } = require("../../utils/refresh");
const scheduleUtils = require("../../utils/schedule");

// 教务系统原生首页：替代原先的 web-view 内嵌方案。
// 数据全部来自服务端抓取后落库的接口（/schedule/*），不依赖 web-view 业务域名。
const TOTAL_WEEKS = 20;
const DEFAULT_START_DATE = "2026-09-07";

// 教务系统官网地址（页面展示口径，务必带结尾斜杠：
// 不带斜杠时官网返回 302 跳转，带斜杠直接 200）。
const JW_WEBSITE_URL = "https://jw.gdipu.edu.cn/jsxsd/";

// 小程序内打开官网走本站同源反代（服务器 nginx：location /jsxsd/ → jw.gdipu.edu.cn/jsxsd/，
// 并 proxy_hide_header X-Frame-Options）。原因：
//   1) 官网响应头带 `X-Frame-Options: SAMEORIGIN`，禁止第三方页面 iframe 内嵌；
//   2) `jw.gdipu.edu.cn` 不是（也无法申请为）小程序业务域名，web-view 不能直连。
// 反代后 `payun01.cn` 已是业务域名，web-view 可直接打开（登录/查课表成绩均实测可用）。
// 如需回退：把此常量置空，入口会自动改走「复制链接 + 浏览器打开」兜底。
const JW_WEBSITE_PROXY_URL = "https://payun01.cn/jsxsd/";

Page({
  data: {
    // 账号绑定状态
    bound: false,
    bindUsername: "",
    lastSyncText: "",

    // 教务系统官网（入口文案展示用，与跳转共用同一常量）
    jwWebsiteUrl: JW_WEBSITE_URL,

    // 数据概览
    courseCount: 0,
    todayCount: 0,
    examCount: 0,
    gradeCount: 0,
    currentWeek: 0,
    totalWeeks: TOTAL_WEEKS,
    loading: false,
    syncing: false,

    // 未绑定时的登录表单
    username: "",
    password: "",

    userAvatar: "",
  },

  onLoad() {
    const userInfo =
      app.globalData.userInfo || wx.getStorageSync("userInfo") || {};
    if (userInfo.studentId) {
      this.setData({ username: String(userInfo.studentId) });
    }
    if (userInfo.avatarUrl) {
      this.setData({ userAvatar: String(userInfo.avatarUrl) });
    }
    this.initPage();
  },

  onShow() {
    const userInfo =
      app.globalData.userInfo || wx.getStorageSync("userInfo") || {};
    const avatarUrl = String(userInfo.avatarUrl || "");
    if (avatarUrl && avatarUrl !== this.data.userAvatar) {
      this.setData({ userAvatar: avatarUrl });
    }
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadOverview());
  },

  initPage() {
    // 未登录：只展示登录引导，不发起鉴权请求
    if (!app.globalData.token) {
      this.setData({ bound: false });
      return;
    }
    this.checkBinding();
  },

  // ===== 绑定状态 =====

  checkBinding() {
    // getJwBindStatus 内部已 catch 并返回 {bound:false}，不会 reject
    api.getJwBindStatus().then((status) => {
      if (status && status.bound) {
        this.setData({ bound: true, bindUsername: status.username || "" });
        this.loadOverview();
      } else {
        this.setData({ bound: false, bindUsername: "" });
      }
    });
  },

  // ===== 数据概览（读已落库数据，不触发抓取） =====

  loadOverview() {
    if (!app.globalData.token) return;
    this.setData({ loading: true });

    Promise.all([
      api.getScheduleList({ silent: true }).catch(() => []),
      api.getExamList().catch(() => []),
      api.getGradeList().catch(() => []),
      api.getScheduleConfig().catch(() => null),
    ])
      .then(([courses, exams, grades, config]) => {
        const list = courses || [];
        const startDate = this.resolveStartDate(config);
        const currentWeek = this.resolveCurrentWeek(startDate);

        this.setData({
          courseCount: list.length,
          todayCount: this.countTodayCourses(list, currentWeek),
          examCount: (exams || []).length,
          gradeCount: (grades || []).length,
          currentWeek,
          totalWeeks: TOTAL_WEEKS,
          lastSyncText: this.formatSyncText(
            Math.max(
              Number(wx.getStorageSync("jw_schedule_synced_at") || 0),
              Number(wx.getStorageSync("jw_exams_synced_at") || 0),
              Number(wx.getStorageSync("jw_grades_synced_at") || 0),
            ),
          ),
          loading: false,
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  // 起始日期优先取服务端配置，其次全局/本地缓存，最后回退默认值
  resolveStartDate(config) {
    const fromServer = config && config.startDate ? String(config.startDate) : "";
    if (fromServer) return fromServer;
    const global = app.globalData.scheduleConfig || {};
    if (global.startDate) return String(global.startDate);
    const local = wx.getStorageSync("scheduleConfig") || {};
    return local.startDate ? String(local.startDate) : DEFAULT_START_DATE;
  },

  // 与课程表页同口径：统一走 utils/schedule.computeAcademicWeek（含「周一锚点」规整，
  // 起始日配成周日时不会多算一周）。此处曾自己用 new Date(字符串) 算，口径容易漂移。
  resolveCurrentWeek(startDate) {
    return scheduleUtils.computeAcademicWeek(startDate, TOTAL_WEEKS).currentWeek;
  },

  // 统计当天课程（周次区间 + 单双周过滤）
  countTodayCourses(list, currentWeek) {
    const weekDay = new Date().getDay() || 7;
    return (list || []).filter((course) => {
      if (Number(course.weekDay) !== weekDay) return false;
      const startWeek = Number(course.startWeek) || 1;
      const endWeek = Number(course.endWeek) || startWeek;
      const weekType = course.weekType || "all";
      if (currentWeek < startWeek || currentWeek > endWeek) return false;
      if (weekType === "odd") return currentWeek % 2 === 1;
      if (weekType === "even") return currentWeek % 2 === 0;
      return true;
    }).length;
  },

  formatSyncText(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (v) => String(v).padStart(2, "0");
    return `上次同步：${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  // ===== 手动同步（免密刷新） =====

  onSync() {
    if (this.data.syncing) return;
    wx.vibrateShort({ type: "light" });
    this.setData({ syncing: true });

    api
      .refreshJwData()
      .then((result) => {
        this.setData({ syncing: false });
        this.applySyncResult(result);
        wx.showToast({ title: "同步成功", icon: "success" });
      })
      .catch((err) => {
        this.setData({ syncing: false });
        this.handleSyncError(err, true);
      });
  },

  // 同步成功后：写入本地缓存（供展示页读取）并刷新概览
  applySyncResult(result) {
    const courses = (result && result.courses) || [];
    const exams = (result && result.exams) || null;
    const grades = (result && result.grades) || null;
    const startDate = result && result.startDate;

    wx.setStorageSync("schedule_courses", courses);
    wx.setStorageSync("jw_schedule_synced_at", Date.now());
    if (Array.isArray(exams)) {
      wx.setStorageSync("jw_exams", exams);
      wx.setStorageSync("jw_exams_synced_at", Date.now());
    }
    if (Array.isArray(grades)) {
      wx.setStorageSync("jw_grades", grades);
      wx.setStorageSync("jw_grades_synced_at", Date.now());
    }
    if (startDate) app.saveScheduleConfig({ startDate });

    this.loadOverview();
  },

  handleSyncError(err, auto) {
    const data = (err && err.data) || {};
    // 业务码优先取服务端 data.code（utils/request.js 已解析为 err.bizCode）。
    // 注意：err.code 是 HTTP 状态码（如 409/400），拿它当业务码会导致
    // CAPTCHA_REQUIRED 永远匹配不上——表现就是「点了绑定并同步只弹一句
    // 需要输入教务系统验证码，却不跳转验证码页」。
    const code = (err && err.bizCode) || (data && data.code) || "";

    // 需要人工验证码：本页不展示验证码界面，转交「教务同步」页处理，
    // 并把服务端已创建的挑战（含验证码图片）一并带过去，用户无需重填学号密码。
    // CAPTCHA_INVALID（验证码输错）同样转交：该页会重新拉一张验证码。
    if (code === "CAPTCHA_REQUIRED") {
      this.setData({ loading: false, syncing: false });
      this.gotoSyncPage(data, err && err.message);
      return;
    }
    if (code === "CAPTCHA_INVALID") {
      this.setData({ loading: false, syncing: false });
      this.gotoSyncPage(null, err && err.message);
      return;
    }

    // 验证码挑战过期：说明同步链路仍在验证码阶段，同样转交同步页重新发起
    if (code === "CAPTCHA_EXPIRED" || (err && err.statusCode === 410)) {
      this.setData({ loading: false, syncing: false });
      this.gotoSyncPage(null, err && err.message);
      return;
    }

    // 绑定凭证失效 / 未绑定 / 教务系统拒绝账号密码：退回登录表单重新绑定
    if (
      code === "JW_NOT_BOUND" ||
      code === "JW_CREDENTIAL_INVALID" ||
      (err && err.statusCode === 400 && /教务|账号|密码/.test(err.message || ""))
    ) {
      this.setData({
        bound: false,
        bindUsername: "",
        loading: false,
        syncing: false,
        password: "",
      });
      wx.showToast({
        title: (err && err.message) || "教务账号或密码有误，请重新输入",
        icon: "none",
        duration: 3000,
      });
      return;
    }

    this.setData({ loading: false, syncing: false });
    wx.showToast({
      title: (err && err.message) || "同步失败，请稍后重试",
      icon: "none",
    });
  },

  // 转交「教务同步」页处理验证码：
  // 该页进入后会自动发起同步并自行渲染验证码输入界面。
  // 若服务端本次已经生成了挑战，则通过全局变量带过去直接渲染，
  // 避免用户在两个页面各输入一次学号密码。
  gotoSyncPage(challenge, message) {
    if (this._redirecting) return;
    this._redirecting = true;

    if (challenge && challenge.challengeId && app.globalData) {
      app.globalData.jwCaptchaHandoff = {
        challengeId: challenge.challengeId,
        captchaImage: (challenge.captcha && challenge.captcha.dataUrl) || "",
        username: this.data.username,
        message: message || "需要输入教务系统验证码",
        expiresAt: challenge.expiresAt || 0,
      };
    }

    wx.navigateTo({
      url: "/pkg-schedule/schedule-login/index",
      complete: () => {
        this._redirecting = false;
      },
    });
  },

  // ===== 登录绑定（未绑定时） =====

  onUsernameInput(e) {
    this.setData({ username: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onLogin() {
    if (this.data.loading) return;

    const { username, password } = this.data;
    if (!username) {
      wx.showToast({ title: "请输入学号", icon: "none" });
      return;
    }
    if (!password) {
      wx.showToast({ title: "请输入密码", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    api
      .syncSchedule(username, password)
      .then((result) => {
        this.setData({ loading: false, bound: true, bindUsername: username });
        this.applySyncResult(result);
        wx.showToast({ title: "绑定并同步成功", icon: "success" });
      })
      .catch((err) => {
        this.setData({ loading: false });
        this.handleSyncError(err, false);
      });
  },

  // ===== 快捷入口 =====

  goSchedule() {
    wx.switchTab({ url: "/pages/schedule/index" });
  },

  goExam() {
    wx.navigateTo({ url: "/pkg-schedule/schedule-exam/index" });
  },

  goGrade() {
    wx.navigateTo({ url: "/pkg-schedule/schedule-grade/index" });
  },

  // 教务系统官网：经本站同源反代（payun01.cn/jsxsd/）在小程序内直接打开。
  // 官网带 `X-Frame-Options: SAMEORIGIN` 且域名无法申请业务域名，直连/内嵌都不可行；
  // 反代关闭时（JW_WEBSITE_PROXY_URL 为空）回退到 web-view 的「复制链接 + 浏览器打开」兜底页。
  goJwWebsite() {
    const target = JW_WEBSITE_PROXY_URL || JW_WEBSITE_URL;
    wx.navigateTo({
      url:
        "/pages/webview/index?title=" +
        encodeURIComponent("教务系统官网") +
        "&url=" +
        encodeURIComponent(target),
    });
  },
});
