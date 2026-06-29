const api = require('../../utils/api')
const request = require('../../utils/request')
const mock = require('../../utils/mock')
const scheduleUtils = require('../../utils/schedule')

const WEEK_DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']

Page({
  data: {
    courses: [],
    conflictGroups: [],
    reminderOffset: wx.getStorageSync('schedule_reminder_offset') || 10,
    editingIndex: -1,
    showForm: false,
    form: {
      name: '',
      teacher: '',
      location: '',
      weekDay: 1,
      startTime: '08:30',
      endTime: '09:55',
      startWeek: 1,
      endWeek: 16,
      color: '#4A7AFF'
    },
    weekDays: WEEK_DAYS,
    colors: mock.courseColors
  },

  onLoad() {
    this.loadCourses()
  },

  loadCourses() {
    api.getScheduleList().then((courses) => {
      const list = this.enrichCourses(courses || [])
      this.setData({ courses: list, conflictGroups: this.detectConflicts(list) })
    })
  },

  enrichCourses(courses) {
    return courses.map((course) => Object.assign({}, course, {
      weekTypeLabel: course.weekType === 'odd' ? '单周' : (course.weekType === 'even' ? '双周' : '每周')
    }))
  },

  detectConflicts(courses) {
    const toMin = (time) => {
      const parts = String(time || '00:00').split(':').map(Number)
      return parts[0] * 60 + parts[1]
    }
    const groups = []
    courses.forEach((a, i) => {
      courses.forEach((b, j) => {
        if (j <= i || a.weekDay !== b.weekDay) return
        const overlapWeek = Math.max(a.startWeek || 1, b.startWeek || 1) <= Math.min(a.endWeek || 16, b.endWeek || 16)
        const overlapTime = toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime)
        if (overlapWeek && overlapTime) groups.push([a.name, b.name])
      })
    })
    return groups
  },

  getWeekType(course) {
    if (course.weekType) return course.weekType
    return 'all'
  },

  // 添加课程
  onAdd() {
    this.setData({
      editingIndex: -1,
      showForm: true,
      form: {
        name: '',
        teacher: '',
        location: '',
        weekDay: 1,
        startTime: '08:30',
        endTime: '09:55',
        startWeek: 1,
        endWeek: 16,
        color: this.data.colors[Math.floor(Math.random() * this.data.colors.length)]
      }
    })
  },

  // 编辑课程
  onEdit(e) {
    const idx = e.currentTarget.dataset.index
    const c = this.data.courses[idx]
    this.setData({
      editingIndex: idx,
      showForm: true,
      form: {
        name: c.name || '',
        teacher: c.teacher || '',
        location: c.location || '',
        weekDay: c.weekDay || 1,
        startTime: c.startTime || '08:30',
        endTime: c.endTime || '09:55',
        startWeek: c.startWeek || 1,
        endWeek: c.endWeek || 16,
        color: c.color || '#4A7AFF'
      }
    })
  },

  // 删除课程
  onDelete(e) {
    const idx = e.currentTarget.dataset.index
    wx.showModal({
      title: '确认删除',
      content: '确定删除「' + this.data.courses[idx].name + '」？',
      success: (res) => {
        if (!res.confirm) return
        const courses = this.data.courses.slice()
        courses.splice(idx, 1)
        wx.setStorageSync('schedule_courses', courses)
        if (!request.USE_MOCK) {
          api.clearSchedule().then(() => {
            courses.forEach((c) => request.post('/schedule/add', c, true).catch(() => {}))
          })
        }
        this.setData({ courses, conflictGroups: this.detectConflicts(courses) })
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  // 表单输入
  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    const form = this.data.form
    form[field] = e.detail.value
    this.setData({ form })
  },

  // 选择颜色
  onColorSelect(e) {
    const form = this.data.form
    form.color = e.currentTarget.dataset.color
    this.setData({ form })
  },

  // 保存课程
  onSave() {
    const f = this.data.form
    if (!f.name.trim()) {
      wx.showToast({ title: '请输入课程名', icon: 'none' })
      return
    }
    const course = scheduleUtils.normalizeCourse({
      name: f.name.trim(),
      teacher: f.teacher.trim(),
      location: f.location.trim(),
      weekDay: Number(f.weekDay),
      startTime: f.startTime,
      endTime: f.endTime,
      startWeek: Number(f.startWeek),
      endWeek: Number(f.endWeek),
      color: f.color
    })

    const courses = this.data.courses.slice()

    if (this.data.editingIndex >= 0) {
      // 编辑模式
      courses[this.data.editingIndex] = Object.assign(courses[this.data.editingIndex], course)
    } else {
      // 新增模式
      course.id = Date.now()
      courses.push(course)
    }

    wx.setStorageSync('schedule_courses', courses)

    if (!request.USE_MOCK) {
      request.post('/schedule/add', course, true).catch(() => {})
    }

    this.setData({ courses, conflictGroups: this.detectConflicts(courses), showForm: false })
    wx.showToast({ title: this.data.editingIndex >= 0 ? '已更新' : '已添加', icon: 'success' })
  },

  onExport() {
    wx.setClipboardData({
      data: JSON.stringify(this.data.courses, null, 2),
      success: () => wx.showToast({ title: '已复制课表JSON', icon: 'success' })
    })
  },

  onImport() {
    wx.showModal({
      title: '导入课表JSON',
      editable: true,
      placeholderText: '粘贴导出的课表JSON',
      success: (res) => {
        if (!res.confirm || !res.content) return
        try {
          const list = this.enrichCourses(JSON.parse(res.content).map((item, index) => scheduleUtils.normalizeCourse(item, index)))
          wx.setStorageSync('schedule_courses', list)
          this.setData({ courses: list, conflictGroups: this.detectConflicts(list) })
          wx.showToast({ title: '导入成功', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: 'JSON格式错误', icon: 'none' })
        }
      }
    })
  },

  onReminderOffset() {
    wx.showActionSheet({
      itemList: ['提前5分钟', '提前10分钟', '提前15分钟', '提前30分钟'],
      success: (res) => {
        const values = [5, 10, 15, 30]
        const reminderOffset = values[res.tapIndex]
        wx.setStorageSync('schedule_reminder_offset', reminderOffset)
        this.setData({ reminderOffset })
      }
    })
  },

  // 取消编辑
  onCancel() {
    this.setData({ showForm: false })
  },

  // Picker 回调
  onWeekDayChange(e) {
    const form = this.data.form
    form.weekDay = Number(e.detail.value) + 1
    this.setData({ form })
  },

  onStartTimeChange(e) {
    const form = this.data.form
    form.startTime = e.detail.value
    this.setData({ form })
  },

  onEndTimeChange(e) {
    const form = this.data.form
    form.endTime = e.detail.value
    this.setData({ form })
  },

  // 一键清空
  onClearAll() {
    wx.showModal({
      title: '确认清空',
      content: '确定清空全部 ' + this.data.courses.length + ' 门课程？',
      success: (res) => {
        if (!res.confirm) return
        wx.setStorageSync('schedule_courses', [])
        if (!request.USE_MOCK) {
          api.clearSchedule().catch(() => {})
        }
        this.setData({ courses: [], conflictGroups: [] })
        wx.showToast({ title: '已清空', icon: 'success' })
      }
    })
  }
})
