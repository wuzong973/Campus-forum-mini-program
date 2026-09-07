const app = getApp();
const api = require("../../utils/api");
const { runPullDownRefresh } = require("../../utils/refresh");

// target: exam = 同步后跳考试安排页；grade = 同步后跳我的成绩页；空 = 同步后返回
Page({
  data: {
    // 教务账号绑定状态：已绑定（同步过）则免密自动同步，未绑定展示登录表单
    bound: false,
    bindUsername: "",
    target: "",
    autoSyncing: false,
    lastSyncText: "",
    username: "",
    password: "",
    captchaCode: "",
    captchaChallenge: null,
    captchaImage: "",
    loading: false,
    // 页面顶部头像：跟随当前登录用户，未登录时回退默认头像
    userAvatar: "",
  },

  onLoad(options) {
    const target = options && options.target ? String(options.target) : "";
    this.setData({ target });

    const userInfo =
      app.globalData.userInfo || wx.getStorageSync("userInfo") || {};
    if (userInfo.studentId) {
      this.setData({ username: String(userInfo.studentId) });
    }
    if (userInfo.avatarUrl) {
      this.setData({ userAvatar: String(userInfo.avatarUrl) });
    }

    this.checkBinding();
  },

  onShow() {
    // 返回页面时同步最新头像（可能刚在资料页更换过）
    const userInfo =
      app.globalData.userInfo || wx.getStorageSync("userInfo") || {};
    const avatarUrl = String(userInfo.avatarUrl || "");
    if (avatarUrl && avatarUrl !== this.data.userAvatar) {
      this.setData({ userAvatar: avatarUrl });
    }
  },

  onPullDownRefresh() {
    if (this.data.bound) {
      runPullDownRefresh(this, () => this.doRefresh());
    } else {
      runPullDownRefresh(this);
    }
  },

  // ===== 绑定检查与免密自动同步 =====

  checkBinding() {
    api.getJwBindStatus().then((status) => {
      if (status && status.bound) {
        this.setData({
          bound: true,
          bindUsername: status.username || "",
        });
        // 已登录并同步过：进入本入口自动同步课表、考试安排与成绩
        this.doRefresh(true);
      } else {
        this.setData({ bound: false, bindUsername: "" });
      }
    });
  },

  doRefresh(auto = false) {
    if (this.data.autoSyncing) return;

    this.setData({ autoSyncing: true });
    api
      .refreshJwData()
      .then((result) => {
        this.setData({ autoSyncing: false });
        this.applySyncResult(result, auto);
      })
      .catch((err) => {
        this.setData({ autoSyncing: false });
        this.handleSyncError(err, auto);
      });
  },

  // 手动刷新按钮
  onManualRefresh() {
    wx.vibrateShort({ type: "light" });
    this.doRefresh(false);
  },

  // ===== 登录表单同步（未绑定 / 重新绑定） =====

  onUsernameInput(e) {
    this.setData({ username: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onCaptchaInput(e) {
    this.setData({ captchaCode: e.detail.value });
  },

  onLogin() {
    if (this.data.loading) return;

    if (this.data.captchaChallenge) {
      this.submitCaptcha();
      return;
    }

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
        this.applySyncResult(result, false);
      })
      .catch((err) => this.handleSyncError(err, false));
  },

  submitCaptcha() {
    const challenge = this.data.captchaChallenge;
    const code = String(this.data.captchaCode || "").trim().toLowerCase();

    if (!challenge || !challenge.challengeId) {
      wx.showToast({ title: "请重新获取验证码", icon: "none" });
      return;
    }
    if (!/^[a-z0-9]{4}$/.test(code)) {
      wx.showToast({ title: "请输入4位验证码", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    api
      .submitScheduleCaptcha(challenge.challengeId, code)
      .then((result) => {
        this.setData({
          loading: false,
          bound: true,
          bindUsername: this.data.username,
        });
        this.applySyncResult(result, false);
      })
      .catch((err) => this.handleSyncError(err, false));
  },

  refreshCaptcha() {
    if (this.data.loading) return;
    this.setData({
      captchaChallenge: null,
      captchaImage: "",
      captchaCode: "",
    });
    if (this.data.bound) {
      this.doRefresh(false);
    } else {
      this.onLogin();
    }
  },

  // ===== 同步结果处理 =====

  applySyncResult(result, auto) {
    this.captchaRetries = 0;
    const courses = (result && result.courses) || [];
    const startDate = result && result.startDate;
    const exams = (result && result.exams) || null;
    const grades = (result && result.grades) || null;
    const warnings = (result && result.warnings) || [];

    wx.setStorageSync("schedule_courses", courses);
    if (Array.isArray(exams)) {
      wx.setStorageSync("jw_exams", exams);
      wx.setStorageSync("jw_exams_synced_at", Date.now());
    }
    if (Array.isArray(grades)) {
      wx.setStorageSync("jw_grades", grades);
      wx.setStorageSync("jw_grades_synced_at", Date.now());
    }
    if (startDate) {
      app.saveScheduleConfig({ startDate });
    }
    this.setData({
      captchaChallenge: null,
      captchaImage: "",
      captchaCode: "",
      lastSyncText: this.formatNow() + " 已完成同步",
    });

    const summary = warnings.length
      ? warnings[0]
      : courses.length
        ? "课表同步成功"
        : "已完成同步";

    // 带 target 进入（查询考试安排 / 查询我的成绩）：同步完成后直接跳转对应页面。
    // 用 navigateTo 而非 redirectTo：redirectTo 会先销毁本页，转场期间露出底层课表页，
    // 造成"闪回课表"的观感；navigateTo 转场底层保持本页，且返回键可回到同步中心
    if (this.data.target === "exam" && Array.isArray(exams)) {
      wx.showToast({ title: summary, icon: warnings.length ? "none" : "success" });
      setTimeout(() => {
        this.jumpToTargetPage("/pkg-schedule/schedule-exam/index", "schedule-exam");
      }, 800);
      return;
    }
    if (this.data.target === "grade" && Array.isArray(grades)) {
      wx.showToast({ title: summary, icon: warnings.length ? "none" : "success" });
      setTimeout(() => {
        this.jumpToTargetPage("/pkg-schedule/schedule-grade/index", "schedule-grade");
      }, 800);
      return;
    }

    if (auto) {
      // 自动同步静默完成，不打扰用户
      wx.showToast({ title: summary, icon: warnings.length ? "none" : "success" });
      return;
    }

    wx.showToast({ title: summary, icon: warnings.length ? "none" : "success" });
    setTimeout(() => {
      wx.navigateBack();
    }, 1200);
  },

  handleSyncError(err, auto) {
    const data = (err && err.data) || {};
    if (
      err &&
      (err.code === "CAPTCHA_REQUIRED" || data.code === "CAPTCHA_REQUIRED")
    ) {
      this.captchaRetries = 0;
      this.setData({
        loading: false,
        captchaChallenge: data,
        captchaImage: data.captcha && data.captcha.dataUrl,
        captchaCode: "",
      });
      wx.showToast({ title: "请输入验证码后继续", icon: "none" });
      return;
    }

    // 验证码挑战过期（提交超时/服务多实例切换等）：
    // 自动重新发起同步获取新挑战，最多自动重试 2 次，避免用户手动重来
    if (
      err &&
      (err.statusCode === 410 ||
        err.code === "CAPTCHA_EXPIRED" ||
        data.code === "CAPTCHA_EXPIRED")
    ) {
      this.setData({
        loading: false,
        captchaChallenge: null,
        captchaImage: "",
        captchaCode: "",
      });
      this.captchaRetries = (this.captchaRetries || 0) + 1;
      if (this.captchaRetries <= 2) {
        wx.showToast({ title: "验证码已过期，正在重新获取", icon: "none" });
        if (this.data.bound) {
          this.doRefresh(false);
        } else {
          this.onLogin();
        }
      } else {
        this.captchaRetries = 0;
        wx.showToast({ title: "验证码已过期，请稍后重试", icon: "none" });
      }
      return;
    }

    // 绑定凭证失效 / 未绑定：退回登录表单重新绑定
    if (
      err &&
      (err.code === "JW_NOT_BOUND" || err.code === "JW_CREDENTIAL_INVALID")
    ) {
      this.setData({
        bound: false,
        bindUsername: "",
        loading: false,
        password: "",
      });
      if (!auto) {
        wx.showModal({
          title: "需要重新绑定",
          content: err.message || "教务账号验证已失效，请重新输入学号密码",
          showCancel: false,
        });
      }
      return;
    }

    this.setData({ loading: false });
    if (auto) {
      // 自动同步失败静默降级：仅提示，不弹阻断弹窗
      wx.showToast({
        title: err && err.message ? err.message : "自动同步失败，可手动刷新",
        icon: "none",
      });
      return;
    }
    wx.showModal({
      title: "同步失败",
      content:
        err && err.message ? err.message : "同步异常，请稍后重试",
      showCancel: false,
    });
  },

  formatNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 跳转到目标数据页：栈内已有该页（如从考试页点"导入"再次进入本页）时回退返回，
  // 避免页面栈重复堆积触及 10 层上限；否则正常压栈
  jumpToTargetPage(url, routeKeyword) {
    const pages = getCurrentPages();
    for (let i = pages.length - 2; i >= 0; i--) {
      if (pages[i] && pages[i].route && pages[i].route.indexOf(routeKeyword) > -1) {
        wx.navigateBack({ delta: pages.length - 1 - i });
        return;
      }
    }
    wx.navigateTo({ url });
  },

  // 已绑定状态下仍可直达数据页（无需重复同步）
  goExamPage() {
    this.jumpToTargetPage("/pkg-schedule/schedule-exam/index", "schedule-exam");
  },

  goGradePage() {
    this.jumpToTargetPage("/pkg-schedule/schedule-grade/index", "schedule-grade");
  },
});
