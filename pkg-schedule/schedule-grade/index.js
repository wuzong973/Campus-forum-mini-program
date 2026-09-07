const api = require("../../utils/api");
const { runPullDownRefresh } = require("../../utils/refresh");

Page({
  data: {
    grades: [],
    semesters: [],
    selectedSemester: "all",
    filtered: [],
    summary: { courseCount: 0, creditTotal: "", gpa: "" },
    syncedAtText: "",
    loading: false,
  },

  onLoad() {
    this.loadCache();
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.refresh());
  },

  loadCache() {
    const cached = wx.getStorageSync("jw_grades");
    if (cached && cached.length) {
      this.buildView(cached, this.data.selectedSemester);
    }
  },

  // 读取服务端缓存（不访问教务系统）
  loadData() {
    api
      .getGradeList()
      .then((list) => {
        if (list && list.length) {
          wx.setStorageSync("jw_grades", list);
          wx.setStorageSync("jw_grades_synced_at", Date.now());
          this.buildView(list, this.data.selectedSemester);
        }
      })
      .catch(() => {});
  },

  buildView(grades, selectedSemester) {
    const semesters = [];
    (grades || []).forEach((g) => {
      const s = String(g.semester || "").trim();
      if (s && semesters.indexOf(s) === -1) semesters.push(s);
    });
    // 学期倒序（新学期在前）
    semesters.sort((a, b) => String(b).localeCompare(String(a)));

    const filtered =
      selectedSemester === "all"
        ? (grades || []).slice()
        : (grades || []).filter(
            (g) => String(g.semester || "").trim() === selectedSemester,
          );

    this.setData({
      grades: grades || [],
      semesters,
      selectedSemester,
      filtered,
      summary: this.calcSummary(filtered),
      syncedAtText: this.formatSyncedAt(),
    });
  },

  // 汇总：课程数 / 总学分 / 平均绩点（学分加权，仅有绩点数据时计算）
  calcSummary(list) {
    let creditTotal = 0;
    let hasCredit = false;
    let weightedGpa = 0;
    let gpaCredit = 0;

    (list || []).forEach((g) => {
      const credit = parseFloat(g.credit);
      if (Number.isFinite(credit) && credit > 0) {
        creditTotal += credit;
        hasCredit = true;
        const gpa = parseFloat(g.gpa);
        if (Number.isFinite(gpa)) {
          weightedGpa += gpa * credit;
          gpaCredit += credit;
        }
      }
    });

    return {
      courseCount: (list || []).length,
      creditTotal: hasCredit ? creditTotal.toFixed(1) : "",
      gpa: gpaCredit > 0 ? (weightedGpa / gpaCredit).toFixed(2) : "",
    };
  },

  formatSyncedAt() {
    const ts = Number(wx.getStorageSync("jw_grades_synced_at") || 0);
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 同步`;
  },

  onSemesterTap(e) {
    const value = e.currentTarget.dataset.semester;
    this.buildView(this.data.grades, value);
  },

  // 导入成绩：统一走教务同步入口（已绑定会自动同步并跳回本页）
  onImport() {
    wx.navigateTo({ url: "/pkg-schedule/schedule-login/index?target=grade" });
  },

  // 手动刷新：直接免密同步最新数据
  refresh() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    return api
      .refreshJwData()
      .then((result) => {
        this.setData({ loading: false });
        const grades = (result && result.grades) || [];
        wx.setStorageSync("jw_grades", grades);
        wx.setStorageSync("jw_grades_synced_at", Date.now());
        this.buildView(grades, this.data.selectedSemester);
        wx.showToast({ title: "已刷新", icon: "success" });
      })
      .catch((err) => {
        this.setData({ loading: false });
        this.handleRefreshError(err);
      });
  },

  handleRefreshError(err) {
    const code = err && err.code;
    const data = (err && err.data) || {};
    if (
      code === "CAPTCHA_REQUIRED" ||
      data.code === "CAPTCHA_REQUIRED" ||
      code === "JW_NOT_BOUND" ||
      code === "JW_CREDENTIAL_INVALID"
    ) {
      wx.showModal({
        title: "需要重新同步",
        content: "请到教务同步页面完成验证后同步",
        confirmText: "去同步",
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: "/pkg-schedule/schedule-login/index?target=grade" });
          }
        },
      });
      return;
    }
    wx.showToast({
      title: err && err.message ? err.message : "刷新失败，请稍后重试",
      icon: "none",
    });
  },
});
