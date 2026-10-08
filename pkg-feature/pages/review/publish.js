const {
  REVIEW_CAMPUS_MAIN_OPTIONS,
  REVIEW_FLOORS,
  GENERAL_COURSE_TAB,
  getCourseTabs,
  levelsForGrade,
  parentMainOf,
  normalizeLegacyReviewCampus
} = require('../../utils/review')
const api = require('../../../utils/api')
const wechat = require('../../../utils/wechat')
const auth = require('../../../utils/auth')

Page({
  data: {
    category: 'course',
    mode: 'root',
    parentId: 0,
    parentName: '',
    avatarUrl: '',
    name: '',
    nameCount: 0,
    // 所属分类（三套：课程=通识课+年级；根级=主校区（广州/佛山）；子级=楼层）
    gradeOptions: [],
    selectedGrade: '',
    campusOptions: REVIEW_CAMPUS_MAIN_OPTIONS,
    selectedCampus: '',
    floorOptions: REVIEW_FLOORS,
    selectedFloor: '',
    submitting: false
  },

  onLoad(options) {
    const category = ['course', 'canteen', 'business'].indexOf(options.category) >= 0
      ? options.category
      : 'course'
    const parentId = Number(options.parentId) || 0
    const mode = category === 'course' ? 'course' : (parentId ? 'child' : 'root')
    const data = { category, mode, parentId, parentName: decodeURIComponent(options.parentName || '') }

    if (mode === 'course') {
      const level = decodeURIComponent(options.level || '') || '本科'
      data.gradeOptions = getCourseTabs(level)
      const grade = decodeURIComponent(options.grade || '')
      data.selectedGrade = data.gradeOptions.indexOf(grade) >= 0 ? grade : GENERAL_COURSE_TAB
    } else if (mode === 'root') {
      // 校区只区分主校区；分校区入参（历史链接）归入所属主校区
      const campus = parentMainOf(normalizeLegacyReviewCampus(decodeURIComponent(options.campus || '')))
      data.selectedCampus = campus || REVIEW_CAMPUS_MAIN_OPTIONS[0]
    } else {
      const floor = decodeURIComponent(options.floor || '')
      data.selectedFloor = REVIEW_FLOORS.indexOf(floor) >= 0 ? floor : REVIEW_FLOORS[0]
    }
    this.setData(data)
  },

  onNameInput(e) {
    const name = String(e.detail.value || '').slice(0, 20)
    this.setData({ name, nameCount: name.length })
  },

  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([path]).then((urls) => {
          wx.hideLoading()
          if (urls && urls[0]) this.setData({ avatarUrl: urls[0] })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '头像上传失败', icon: 'none' })
        })
      }
    })
  },

  onRemoveAvatar() {
    this.setData({ avatarUrl: '' })
  },

  onGradeTap(e) {
    const grade = e.currentTarget.dataset.grade
    if (!grade) return
    this.setData({ selectedGrade: grade })
  },

  onCampusTap(e) {
    const campus = e.currentTarget.dataset.campus
    if (!campus) return
    this.setData({ selectedCampus: campus })
  },

  onFloorTap(e) {
    const floor = e.currentTarget.dataset.floor
    if (!floor) return
    this.setData({ selectedFloor: floor })
  },

  onSubmit() {
    if (this.data.submitting) return
    const name = String(this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入评分对象名称', icon: 'none' })
      return
    }
    if (!auth.requireLogin('发布需要先登录')) return

    const payload = { category: this.data.category, name, avatar: this.data.avatarUrl }
    if (this.data.mode === 'course') {
      payload.grade = this.data.selectedGrade
      // 校验所选分类的适用学历层次齐全（通识课对三类全适用）
      if (!levelsForGrade(payload.grade).length) {
        wx.showToast({ title: '课程分类不合法', icon: 'none' })
        return
      }
    } else if (this.data.mode === 'root') {
      payload.campus = this.data.selectedCampus
    } else {
      payload.parentId = this.data.parentId
      payload.floor = this.data.selectedFloor
    }

    this.setData({ submitting: true })
    api.createReviewTarget(payload).then((res) => {
      this.setData({ submitting: false })
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.redirectTo({ url: '/pkg-feature/pages/review/list?category=' + this.data.category })
        })
      }, 600)
    }).catch(() => {
      this.setData({ submitting: false })
    })
  }
})
