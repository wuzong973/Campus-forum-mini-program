const api = require("../../utils/api");
const { runPullDownRefresh } = require("../../utils/refresh");

function parseExamDate(text) {
  const m = String(text || "").match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 计算考试结束时间：日期 + 时间段（如 09:00-11:00）取结束时刻；无时间段则按当天 23:59
function parseExamEnd(exam) {
  const day = parseExamDate(exam.date);
  const timeText = String(exam.time || exam.date || "");
  if (!day) return null;

  const range = timeText.match(
    /(\d{1,2})[:：](\d{2})\s*[-~至]\s*(\d{1,2})[:：](\d{2})/,
  );
  if (range) {
    return new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      Number(range[3]),
      Number(range[4]),
    );
  }
  const single = timeText.match(/(\d{1,2})[:：](\d{2})/);
  if (single) {
    return new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      Number(single[1]),
      Number(single[2]),
    );
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59);
}

Page({
  data: {
    tab: "ongoing",
    ongoing: [],
    ended: [],
    ongoingCount: 0,
    endedCount: 0,
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

  // 本地缓存优先展示，避免白屏
  loadCache() {
    const cached = wx.getStorageSync("jw_exams");
    if (cached && cached.length) {
      this.splitTabs(cached);
    }
  },

  // 读取服务端缓存（不访问教务系统）
  loadData() {
    api
      .getExamList()
      .then((list) => {
        if (list && list.length) {
          wx.setStorageSync("jw_exams", list);
          wx.setStorageSync("jw_exams_synced_at", Date.now());
          this.splitTabs(list);
        }
      })
      .catch(() => {});
  },

  splitTabs(exams) {
    const now = new Date();
    const ongoing = [];
    const ended = [];

    (exams || []).forEach((exam) => {
      const end = parseExamEnd(exam);
      // 无法解析时间的考试按未结束展示，避免误隐藏
      if (!end || end.getTime() >= now.getTime()) ongoing.push(exam);
      else ended.push(exam);
    });

    ongoing.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    ended.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const syncedAt = Number(wx.getStorageSync("jw_exams_synced_at") || 0);
    const d = syncedAt ? new Date(syncedAt) : null;
    const pad = (n) => String(n).padStart(2, "0");

    this.setData({
      ongoing,
      ended,
      ongoingCount: ongoing.length,
      endedCount: ended.length,
      syncedAtText: d
        ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 同步`
        : "",
    });
  },

  onTabChange(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // 导入考试安排：统一走教务同步入口（已绑定会自动同步并跳回本页）
  onImport() {
    wx.navigateTo({ url: "/pkg-schedule/schedule-login/index?target=exam" });
  },

  // 手动刷新：直接免密同步最新数据
  refresh() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    return api
      .refreshJwData()
      .then((result) => {
        this.setData({ loading: false });
        const exams = (result && result.exams) || [];
        wx.setStorageSync("jw_exams", exams);
        wx.setStorageSync("jw_exams_synced_at", Date.now());
        this.splitTabs(exams);
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
      // 需要验证码或绑定失效：回到统一同步入口处理
      wx.showModal({
        title: "需要重新同步",
        content: "请到教务同步页面完成验证后同步",
        confirmText: "去同步",
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: "/pkg-schedule/schedule-login/index?target=exam" });
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
