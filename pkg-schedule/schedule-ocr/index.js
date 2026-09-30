const request = require("../../utils/request");
const api = require("../../utils/api");
const scheduleUtils = require("../../utils/schedule");
const { runPullDownRefresh } = require("../../utils/refresh");
const auth = require("../../utils/auth");

const COURSE_COLORS = ['#4A7AFF', '#52C41A', '#FAAD14', '#FF4D4F', '#722ED1', '#13C2C2', '#EB2F96', '#FA8C16', '#2F54EB', '#A0D911', '#F759AB', '#36CFC9'];

function normalizeRecognizedCourses(list) {
  return (list || [])
    .map((item, index) =>
      scheduleUtils.normalizeCourse(
        Object.assign(
          {
            startWeek: 1,
            endWeek: 16,
            color: COURSE_COLORS[index % COURSE_COLORS.length],
          },
          item,
        ),
        index,
      ),
    )
    .sort((a, b) => {
      if (a.weekDay !== b.weekDay) return a.weekDay - b.weekDay;
      return a.startTime.localeCompare(b.startTime);
    });
}

Page({
  data: {
    imageUrl: "",
    recognizing: false,
    recognizedCourses: [],
    showResult: false,
    colorList: COURSE_COLORS,
    qualityTips: [],
  },

  onPullDownRefresh() {
    runPullDownRefresh(this);
  },

  onUpload() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["original", "compressed"],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        this.setData({ imageUrl: path });
        this.prepareImage(path).then((prepared) => {
          this.setData({ imageUrl: prepared.path, qualityTips: prepared.tips });
          this.recognize(prepared.path);
        }).catch(() => {
          this.recognize(path);
        });
      },
    });
  },

  prepareImage(path) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: (info) => {
          const tips = [];
          const minSide = Math.min(info.width || 0, info.height || 0);
          const maxSide = Math.max(info.width || 0, info.height || 0);
          if (minSide < 720 || maxSide < 1200) {
            tips.push("截图分辨率偏低，建议重新上传完整原图");
          }
          wx.compressImage({
            src: path,
            quality: maxSide > 2400 ? 82 : 92,
            success: (res) => resolve({ path: res.tempFilePath || path, tips }),
            fail: () => resolve({ path, tips }),
          });
        },
        fail: reject,
      });
    });
  },

  // 识别：调用后端 OCR 接口
  recognize(path) {
    this.setData({ recognizing: true, showResult: false });
    wx.showLoading({ title: "识别中...", mask: true });

    wx.uploadFile({
      url: request.BASE_URL + "/schedule/ocr",
      filePath: path,
      name: "image",
      header: { Authorization: "Bearer " + (wx.getStorageSync("token") || "") },
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (data.code && data.code !== 200) {
            throw new Error(data.message || "识别失败");
          }
          const payload = data.data || data;
          this.setData({
            recognizedCourses: normalizeRecognizedCourses(payload.courses || []),
            recognizing: false,
            showResult: true,
            qualityTips: (this.data.qualityTips || []).concat(payload.tips || []),
          });
          wx.hideLoading();
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: e.message || "识别失败，请重试", icon: "none" });
          this.setData({ recognizing: false });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "网络错误", icon: "none" });
        this.setData({ recognizing: false });
      },
    });
  },

  // 编辑单条课程
  onCourseInput(e) {
    const idx = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const courses = this.data.recognizedCourses;
    const nextValue =
      field === "weekDay"
        ? Math.max(1, Math.min(7, Number(e.detail.value) || 1))
        : e.detail.value;
    courses[idx][field] = nextValue;
    courses[idx] = scheduleUtils.normalizeCourse(courses[idx], idx);
    this.setData({ recognizedCourses: courses });
  },

  // 删除某条
  onRemoveCourse(e) {
    const idx = e.currentTarget.dataset.index;
    const courses = this.data.recognizedCourses;
    courses.splice(idx, 1);
    this.setData({ recognizedCourses: courses });
  },

  // 确认导入
  onConfirmImport() {
    const courses = this.data.recognizedCourses;
    if (!courses.length) {
      wx.showToast({ title: "没有可导入的课程", icon: "none" });
      return;
    }
    // 由服务端事务性替换整份课表，避免逐条写入失败后留下半份数据。
    wx.showLoading({ title: "正在导入...", mask: true });
    const syncTask = api.replaceSchedule(courses);

    syncTask.then(() => {
      wx.setStorageSync("schedule_courses", courses);
      wx.showToast({
        title: "已导入 " + courses.length + " 门课程",
        icon: "success",
      });
      setTimeout(() => wx.switchTab({ url: "/pages/schedule/index" }), 1500);
    }).catch((error) => {
      wx.showToast({ title: error.message || "导入失败，原课表未变更", icon: "none" });
    }).finally(() => wx.hideLoading());
  },

  // 重新识别
  onRetry() {
    this.setData({ showResult: false, recognizedCourses: [], imageUrl: "" });
  },

  onShow() {
    // 未登录：弹窗引导去登录（取消则退回上一页）
    if (!auth.guardPage("该功能需要登录后使用")) return;
  },
})
