const mock = require("../../utils/mock");
const request = require("../../utils/request");
const api = require("../../utils/api");
const scheduleUtils = require("../../utils/schedule");
const { runPullDownRefresh } = require("../../utils/refresh");

function normalizeRecognizedCourses(list) {
  return (list || [])
    .map((item, index) =>
      scheduleUtils.normalizeCourse(
        Object.assign(
          {
            startWeek: 1,
            endWeek: 16,
            color: mock.courseColors[index % mock.courseColors.length],
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
    colorList: mock.courseColors,
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

  // 识别：调用后端 OCR 接口；USE_MOCK 时返回示例课表
  recognize(path) {
    this.setData({ recognizing: true, showResult: false });
    wx.showLoading({ title: "识别中...", mask: true });

    if (request.USE_MOCK) {
      // Mock 模式：返回 J25092 班级真实课表作为识别结果
      setTimeout(() => {
        const baseId = Date.now();
        const makeCourse = (offset, name, weekDay, startTime, endTime, teacher, location) => ({
          id: baseId + offset,
          name,
          location: location || "",
          teacher: teacher || "",
          weekDay,
          startTime,
          endTime,
        });
        const courses = [
          makeCourse(1, "早集合", 1, "07:30", "07:45"),
          makeCourse(2, "早集合", 2, "07:30", "07:45"),
          makeCourse(3, "早集合", 3, "07:30", "07:45"),
          makeCourse(4, "早集合", 4, "07:30", "07:45"),
          makeCourse(5, "早集合", 5, "07:30", "07:45"),
          makeCourse(6, "军体课", 1, "08:30", "09:55", "潘岐辉", "操场"),
          makeCourse(7, "大学语文", 2, "10:15", "11:40", "袁鸿", "1305"),
          makeCourse(8, "大学生安全教育", 3, "08:30", "09:55", "袁鸿", "1213"),
          makeCourse(9, "计算机应用基础教程2", 3, "10:15", "11:40", "周杭声", "第四实训楼B604"),
          makeCourse(10, "民航主要机型安全设备与应急处置", 4, "08:30", "11:40", "刘香云", "1205"),
          makeCourse(11, "J25092主题班会", 5, "08:30", "09:55", "吴丽婷", "1203"),
          makeCourse(12, "大学英语(下)", 1, "14:00", "15:25", "周立平", "1305"),
          makeCourse(13, "大学英语(下)", 1, "15:45", "17:10", "周立平", "1305"),
          makeCourse(14, "机械制图", 2, "14:00", "15:25", "艾雄", "第四实训楼B605"),
          makeCourse(15, "机械制图", 2, "15:45", "17:10", "艾雄", "第四实训楼B605"),
          makeCourse(16, "飞行原理", 3, "14:00", "15:25", "刘香云", "1124"),
          makeCourse(17, "飞行原理", 3, "15:45", "17:10", "刘香云", "1124"),
          makeCourse(18, "民航安全管理", 4, "14:00", "15:25", "刘香云", "1122"),
          makeCourse(19, "晚训", 1, "19:30", "20:10", "潘岐辉", "操场"),
          makeCourse(20, "晚自习", 2, "19:30", "20:10", "吴丽婷", "2301"),
          makeCourse(21, "晚训", 3, "19:30", "20:10", "潘岐辉", "操场"),
        ];
        this.setData({
          recognizedCourses: normalizeRecognizedCourses(courses),
          recognizing: false,
          showResult: true,
        });
        wx.hideLoading();
      }, 1500);
      return;
    }

    // 真实模式：调用后端 OCR 接口
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
    wx.setStorageSync("schedule_courses", courses);

    let syncTask = Promise.resolve();
    if (!request.USE_MOCK) {
      // 同步到后端：先清空旧课表，避免上次导入残留造成显示不一致
      wx.showLoading({ title: "正在导入...", mask: true });
      syncTask = api.clearSchedule().catch(() => {}).then(() =>
        Promise.all(courses.map((c) =>
          request.post(
            "/schedule/add",
            {
              name: c.name,
              location: c.location,
              teacher: c.teacher,
              weekDay: c.weekDay,
              startTime: c.startTime,
              endTime: c.endTime,
              startWeek: c.startWeek,
              endWeek: c.endWeek,
              color: c.color,
            },
            true,
          ).catch(() => null),
        )),
      );
    }

    syncTask.then(() => {
      wx.hideLoading();
      wx.showToast({
        title: "已导入 " + courses.length + " 门课程",
        icon: "success",
      });
      setTimeout(() => wx.switchTab({ url: "/pages/schedule/index" }), 1500);
    });
  },

  // 重新识别
  onRetry() {
    this.setData({ showResult: false, recognizedCourses: [], imageUrl: "" });
  },
});
