const request = require('../../utils/request')
const scheduleUtils = require('../../utils/schedule')
const { runPullDownRefresh } = require('../../utils/refresh')

const COURSE_COLORS = ['#4A7AFF', '#52C41A', '#FAAD14', '#FF4D4F', '#722ED1', '#13C2C2', '#EB2F96', '#FA8C16', '#2F54EB', '#A0D911', '#F759AB', '#36CFC9']

const TIME_PRESETS = [
  { label: '1-2节', startTime: '08:30', endTime: '09:55' },
  { label: '3-4节', startTime: '10:15', endTime: '11:40' },
  { label: '5-6节', startTime: '11:45', endTime: '13:55' },
  { label: '7-8节', startTime: '14:00', endTime: '15:25' },
  { label: '7-10节', startTime: '14:00', endTime: '17:10' },
  { label: '9-10节', startTime: '15:45', endTime: '17:10' },
  { label: '晚课', startTime: '19:30', endTime: '20:10' }
]

Page({
  data: {
    name: '',
    location: '',
    teacher: '',
    weekDay: 0,
    weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    startTime: '08:00',
    endTime: '09:40',
    timePresets: TIME_PRESETS,
    activePreset: -1,
    startWeek: 1,
    endWeek: 16,
    weeks: Array.from({ length: 20 }, (_, i) => i + 1),
    colors: COURSE_COLORS,
    selectedColor: COURSE_COLORS[0]
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
    const courses = wx.getStorageSync('schedule_courses') || []
    courses.push(course)
    wx.setStorageSync('schedule_courses', courses)

    request.post('/schedule/add', {
      name: course.name,
      location: course.location,
      teacher: course.teacher,
      weekDay: course.weekDay,
      startTime: course.startTime,
      endTime: course.endTime,
      startWeek: course.startWeek,
      endWeek: course.endWeek,
      color: course.color
    }, true).catch(() => {})

    wx.showToast({ title: '保存成功', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 1200)
  }
})
