const app = getApp();
const api = require("../../utils/api");
const { runPullDownRefresh } = require("../../utils/refresh");

// 进入页面自动同步的最小间隔：教务全量爬取很重（整学期 20 周），且服务端有 60s 冷却。
// 冷却内重复进入只会拿到 429，故端上先按此间隔节流：距上次成功同步不足此间隔时跳过自动爬取，
// 用户仍可点「刷新」/下拉强制同步。
const AUTO_SYNC_STORAGE_KEY = "jw_last_sync_at"
const AUTO_SYNC_MIN_INTERVAL_MS = 30 * 60 * 1000

// 服务端可信 OCR 结果自动提交的上限；验证码输错时服务端会带新图返回，最多再试两次。
const AUTO_CAPTCHA_MAX_ATTEMPTS = 3

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
    captchaOcrStatus: "",
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

    // 「教务系统」页点「绑定并同步」时若已触发验证码，会把服务端创建好的挑战带过来，
    // 这里直接进入验证码输入态：用户只填验证码即可，不必重新输入学号密码
    // （本次登录凭据已随挑战保存在服务端）。
    const handoff = (app.globalData && app.globalData.jwCaptchaHandoff) || null;
    if (handoff && handoff.challengeId) {
      app.globalData.jwCaptchaHandoff = null;
      this.pendingHandoff = true;
      this.setData({
        username: handoff.username || this.data.username,
        captchaChallenge: { challengeId: handoff.challengeId },
        captchaImage: handoff.captchaImage || "",
        captchaCode: "",
        captchaOcrStatus: "请输入验证码",
      });
      if (handoff.message) {
        wx.showToast({ title: handoff.message, icon: "none" });
      }
      this.autoCaptchaRetries = 0;
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
        const lastSyncAt = Number(wx.getStorageSync(AUTO_SYNC_STORAGE_KEY) || 0)
        this.setData({
          bound: true,
          bindUsername: status.username || "",
          lastSyncText: lastSyncAt ? this.formatSyncTime(lastSyncAt) : "",
        });
        // 距上次成功同步仍新鲜时跳过自动全量爬取（避免打开即重负载 + 冷却内 429）；
        // 过期或从未同步才自动同步。手动「刷新」/下拉刷新不受此限制。
        // 带验证码挑战进来时也不自动同步：那会另起一次登录并覆盖当前挑战。
        const fresh = lastSyncAt && Date.now() - lastSyncAt < AUTO_SYNC_MIN_INTERVAL_MS
        if (!fresh && !this.pendingHandoff) {
          this.doRefresh(true)
        }
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

  // 展示挑战图片，并把服务端给出的 OCR 结果按置信度预填/自动提交。
  // autoSubmit 只在“拿到新挑战”或“验证码输错换图”时开启；用户点“换一张”时不自动提交。
  applyCaptchaChallenge(challenge, options = {}) {
    const ocr = challenge && challenge.captcha && challenge.captcha.ocr;
    const text = ocr && ocr.valid ? String(ocr.text || "") : "";
    let captchaOcrStatus = "自动识别失败，请手动输入";
    const canAutoSubmit =
      !!ocr &&
      !!ocr.autoFill &&
      (this.autoCaptchaRetries || 0) < AUTO_CAPTCHA_MAX_ATTEMPTS;
    if (ocr && ocr.valid) {
      captchaOcrStatus = canAutoSubmit
        ? "已自动识别验证码"
        : "已自动填充，请确认后提交";
    } else if (!ocr) {
      captchaOcrStatus = "未启用自动识别，请手动输入";
    }

    this.setData({
      captchaChallenge: challenge,
      captchaImage:
        (challenge && challenge.captcha && challenge.captcha.dataUrl) || "",
      captchaCode: text,
      captchaOcrStatus,
    });

    if (options.autoSubmit && canAutoSubmit) {
      this.autoSubmitCaptchaIfPossible();
    }
  },

  autoSubmitCaptchaIfPossible() {
    const challenge = this.data.captchaChallenge;
    const ocr = challenge && challenge.captcha && challenge.captcha.ocr;
    if (
      !ocr ||
      !ocr.autoFill ||
      !/^[a-z0-9]{4}$/.test(String(ocr.text || ""))
    ) {
      return false;
    }
    if ((this.autoCaptchaRetries || 0) >= AUTO_CAPTCHA_MAX_ATTEMPTS) {
      return false;
    }

    this.autoCaptchaRetries = (this.autoCaptchaRetries || 0) + 1;
    this.submitCaptcha();
    return true;
  },

  onRefreshCaptchaTap() {
    this.refreshCaptcha();
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

  refreshCaptcha(options = {}) {
    if (this.data.loading) return;

    // 已有挑战（含从「教务系统」页带过来的）：让服务端复用挑战内保存的凭据换一张，
    // 未绑定态下用户还没输入密码也能刷新，不再出现「请输入密码」的死路
    const challenge = this.data.captchaChallenge;
    if (challenge && challenge.challengeId) {
      this.setData({ loading: true });
      api
        .refreshScheduleCaptcha(challenge.challengeId)
        .then((data) => {
          this.setData({ loading: false });
          this.applyCaptchaChallenge(data || challenge, {
            autoSubmit: !!options.autoSubmit,
          });
        })
        .catch((err) => {
          this.setData({ loading: false });
          this.handleSyncError(err, false);
        });
      return;
    }

    this.setData({
      captchaChallenge: null,
      captchaImage: "",
      captchaCode: "",
      captchaOcrStatus: "",
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
    this.autoCaptchaRetries = 0;
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
    wx.setStorageSync(AUTO_SYNC_STORAGE_KEY, Date.now())
    this.setData({
      captchaChallenge: null,
      captchaImage: "",
      captchaCode: "",
      captchaOcrStatus: "",
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
    // 业务码在服务端响应的 data.code 里（utils/request.js 解析为 err.bizCode）；
    // err.code 是 HTTP 状态码（409/400/422…），不能当业务码用。
    const code = (err && err.bizCode) || (data && data.code) || "";

    if (code === "CAPTCHA_REQUIRED") {
      this.pendingHandoff = false;
      this.setData({ loading: false });
      this.applyCaptchaChallenge(data, { autoSubmit: true });
      wx.showToast({
        title: (err && err.message) || "请输入验证码后继续",
        icon: "none",
      });
      return;
    }

    // 验证码输错：服务端会直接下发一张新验证码，这里兜底清掉旧图等待新图
    if (code === "CAPTCHA_INVALID") {
      // 服务端已生成新挑战并重新 OCR；这里允许自动识别继续重试，
      // autoCaptchaRetries 不重置，防止低质量验证码导致无限循环。
      this.setData({ loading: false });
      if (data && data.challengeId) {
        this.applyCaptchaChallenge(data, { autoSubmit: true });
      } else {
        this.setData({
          captchaChallenge: null,
          captchaImage: "",
          captchaCode: "",
          captchaOcrStatus: "",
        });
      }
      wx.showToast({
        title: (err && err.message) || "验证码不正确，请重新输入",
        icon: "none",
      });
      return;
    }

    // 验证码挑战过期（提交超时/服务多实例切换等）：
    // 自动重新发起同步获取新挑战，最多自动重试 2 次，避免用户手动重来
    if (
      err &&
      (err.statusCode === 410 ||
        code === "CAPTCHA_EXPIRED")
    ) {
      this.setData({
        loading: false,
        captchaChallenge: null,
        captchaImage: "",
        captchaCode: "",
        captchaOcrStatus: "",
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

    // 绑定凭证失效 / 未绑定 / 教务系统明确拒绝账号密码：退回登录表单重新绑定
    if (code === "JW_NOT_BOUND" || code === "JW_CREDENTIAL_INVALID") {
      this.pendingHandoff = false;
      this.setData({
        bound: false,
        bindUsername: "",
        loading: false,
        password: "",
        captchaChallenge: null,
        captchaImage: "",
        captchaCode: "",
        captchaOcrStatus: "",
      });
      if (!auto) {
        wx.showModal({
          title: code === "JW_NOT_BOUND" ? "需要重新绑定" : "账号或密码有误",
          content: err.message || "教务账号验证已失效，请重新输入学号密码",
          showCancel: false,
        });
      }
      return;
    }

    this.setData({ loading: false });
    if (auto) {
      // 自动同步遇服务端节流（429 冷却/进行中）：静默跳过，不弹「操作过于频繁」打扰用户
      if (err && err.statusCode === 429) return
      // 其余自动同步失败静默降级：仅提示，不弹阻断弹窗
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

  formatSyncTime(ts) {
    const d = new Date(Number(ts) || 0);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return "上次同步：" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
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
