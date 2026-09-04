const app = getApp();
const api = require("../../utils/api");
const request = require("../../utils/request");

Page({
  data: {
    username: "",
    password: "",
    captchaCode: "",
    captchaChallenge: null,
    captchaImage: "",
    loading: false,
  },

  onLoad() {
    const userInfo =
      app.globalData.userInfo || wx.getStorageSync("userInfo") || {};
    if (userInfo.studentId) {
      this.setData({ username: String(userInfo.studentId) });
    }
  },

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

    if (request.USE_MOCK) {
      wx.showModal({
        title: "演示模式",
        content: "课表同步需要连接教务系统，请部署后端服务后使用",
        showCancel: false,
      });
      return;
    }

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
      .then((result) => this.handleSyncSuccess(result))
      .catch((err) => this.handleSyncError(err));
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
      .then((result) => this.handleSyncSuccess(result))
      .catch((err) => this.handleSyncError(err));
  },

  refreshCaptcha() {
    if (this.data.loading) return;
    this.setData({
      captchaChallenge: null,
      captchaImage: "",
      captchaCode: "",
    });
    this.onLogin();
  },

  handleSyncSuccess(result) {
    this.setData({ loading: false });
    const courses = (result && result.courses) || [];
    const startDate = result && result.startDate;
    wx.setStorageSync("schedule_courses", courses);
    if (startDate) {
      app.saveScheduleConfig({ startDate });
    }
    this.setData({
      captchaChallenge: null,
      captchaImage: "",
      captchaCode: "",
    });
    wx.showToast({
      title: courses.length ? "课表同步成功" : "已完成同步",
      icon: "success",
    });
    setTimeout(() => {
      wx.navigateBack();
    }, 1500);
  },

  handleSyncError(err) {
    const data = (err && err.data) || {};
    if (
      err &&
      (err.code === "CAPTCHA_REQUIRED" || data.code === "CAPTCHA_REQUIRED")
    ) {
      this.setData({
        loading: false,
        captchaChallenge: data,
        captchaImage: data.captcha && data.captcha.dataUrl,
        captchaCode: "",
      });
      wx.showToast({ title: "请输入验证码后继续", icon: "none" });
      return;
    }

    this.setData({ loading: false });
    wx.showModal({
      title: "同步失败",
      content:
        err && err.message ? err.message : "同步异常，请稍后重试",
      showCancel: false,
    });
  },
});
