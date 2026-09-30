const app = getApp()
const request = require('../../utils/request')
const scheduleUtils = require('../../utils/schedule')
const { runPullDownRefresh } = require('../../utils/refresh')
const auth = require("../../utils/auth");

const COURSE_COLORS = ['#4A7AFF', '#52C41A', '#FAAD14', '#FF4D4F', '#722ED1', '#13C2C2', '#EB2F96', '#FA8C16', '#2F54EB', '#A0D911', '#F759AB', '#36CFC9']

// 节次模板：与官方教务系统作息表同口径（唯一来源见 utils/schedule.js 的 CLASS_ROWS）
const CLASS_ROWS = scheduleUtils.CLASS_ROWS
const TIME_PRESETS = CLASS_ROWS.map((row) => ({
  label: row.label,
  startTime: row.startTime,
  endTime: row.endTime,
}))
  .concat([
    {
      label: '1-4节',
      startTime: CLASS_ROWS[0].startTime,
      endTime: CLASS_ROWS[1].endTime,
    },
    {
      label: '5-8节',
      startTime: CLASS_ROWS[2].startTime,
      endTime: CLASS_ROWS[3].endTime,
    },
    {
      label: '9-12节',
      startTime: CLASS_ROWS[4].startTime,
      endTime: CLASS_ROWS[5].endTime,
    },
  ])

Page({
  data: {
    name: '',
    location: '',
    teacher: '',
    weekDay: 0,
    weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    startTime: CLASS_ROWS[0].startTime,
    endTime: CLASS_ROWS[0].endTime,
    timePresets: TIME_PRESETS,
    activePreset: -1,
    startWeek: 1,
    endWeek: 16,
    weeks: Array.from({ length: 20 }, (_, i) => i + 1),
    colors: COURSE_COLORS,
    selectedColor: COURSE_COLORS[0],
    loading: false
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onWeekDay(e) {
    this.setData({ weekDay: parseInt(e.detail.value, 10) })
  },

  onStartTime(e) {
    this.setData({ startTime: e.detail.value, activePreset: -1 })
  },

  onEndTime(e) {
    this.setData({ endTime: e.detail.value, activePreset: -1 })
  },

  onPresetTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    const preset = this.data.timePresets[index]
    if (!preset) return
    this.setData({
      startTime: preset.startTime,
      endTime: preset.endTime,
      activePreset: index
    })
  },

  onStartWeek(e) {
    this.setData({ startWeek: this.data.weeks[e.detail.value] })
  },

  onEndWeek(e) {
    this.setData({ endWeek: this.data.weeks[e.detail.value] })
  },

  onColor(e) {
    this.setData({ selectedColor: e.currentTarget.dataset.color })
  },

  onSave() {
    if (this.data.loading) return
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请输入课程名称', icon: 'none' })
      return
    }
    const course = scheduleUtils.normalizeCourse({
      id: Date.now(),
      name: this.data.name.trim(),
      location: this.data.location.trim(),
      teacher: this.data.teacher.trim(),
      weekDay: this.data.weekDay + 1,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      startWeek: this.data.startWeek,
      endWeek: this.data.endWeek,
      color: this.data.selectedColor
    })

    // ⚠️ 必须等接口真正成功再提示「保存成功」。
    // 课表页与编辑课表页读的都是服务端 /schedule/list，本地 schedule_courses
    // 只是没人读的死缓存；此前的 fire-and-forget + catch(() => {}) 会在
    // 401 / 断网时照样弹「保存成功」，用户以为存上了、其实数据已经丢了。
    this.setData({ loading: true })
    request
      .post(
        '/schedule/add',
        {
          name: course.name,
          location: course.location,
          teacher: course.teacher,
          weekDay: course.weekDay,
          startTime: course.startTime,
          endTime: course.endTime,
          startWeek: course.startWeek,
          endWeek: course.endWeek,
          color: course.color
        },
        true,
        // 失败提示由本页统一给出（401 除外，那条由 utils/request.js 统一弹）
        { silent: true }
      )
      .then(() => {
        this.setData({ loading: false })
        // 让课表页定位到这门课所在周：用户把课排在 13-19 周、页面却停在当前周时，
        // 「保存成功」之后什么都看不到，等于白存。
        if (app && app.globalData) {
          app.globalData.scheduleJumpToWeek = {
            startWeek: course.startWeek,
            endWeek: course.endWeek,
            weekType: course.weekType
          }
        }
        wx.showToast({ title: '保存成功', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 900)
      })
      .catch((err) => {
        this.setData({ loading: false })
        // 401 已由 utils/request.js 统一提示并引导重新登录，这里不重复弹窗
        if (err && err.statusCode === 401) return
        wx.showModal({
          title: '保存失败',
          content: (err && err.message) || '网络异常，请稍后重试',
          showCancel: false
        })
      })
  },

  onShow() {
    // 未登录：弹窗引导去登录（取消则退回上一页）
    if (!auth.guardPage("该功能需要登录后使用")) return;
  },
})
