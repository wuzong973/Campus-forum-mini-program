const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const wechat = require('../../../utils/wechat')
const { CAMPUS_GROUPS } = require('../../../utils/campus')
const couple = require('../../utils/couple')

const FALLBACK_AVATAR = '/assets/icons/avatar.png'

function buildCampusOptions() {
  const options = [{ label: '请选择', value: '' }]
  CAMPUS_GROUPS.forEach((group) => {
    options.push({ label: group.name, value: group.name })
    ;(group.subs || []).forEach((sub) => options.push({ label: sub, value: sub }))
  })
  return options
}

const CAMPUS_OPTIONS = buildCampusOptions()
const GRADE_OPTIONS = [{ label: '请选择', value: '' }].concat(couple.GRADES.map((item) => ({ label: item, value: item })))
const MBTI_OPTIONS = [{ label: '不填', value: '' }].concat(couple.MBTI.map((item) => ({ label: item, value: item })))

function pickIndex(options, value) {
  const index = options.findIndex((item) => String(item.value) === String(value))
  return index > -1 ? index : 0
}

function tagStates(selected) {
  const set = {}
  ;(selected || []).forEach((tag) => { set[tag] = true })
  return couple.TAGS.map((name) => ({ name, active: !!set[name] }))
}

function mbtiStates(selected) {
  const set = {}
  ;(selected || []).forEach((item) => { set[String(item).toUpperCase()] = true })
  return couple.MBTI.map((name) => ({ name, active: !!set[name] }))
}

function expectText(signup) {
  if (!signup) return ''
  const parts = []
  if (signup.expectCampus) parts.push(signup.expectCampus)
  if (signup.expectHeightMin && signup.expectHeightMax) {
    parts.push(signup.expectHeightMin + '–' + signup.expectHeightMax + 'cm')
  }
  if (signup.expectMbti && signup.expectMbti.length) parts.push('MBTI ' + signup.expectMbti.join('/'))
  if (signup.expectGender === 1) parts.push('男生')
  if (signup.expectGender === 2) parts.push('女生')
  return parts.length ? parts.join(' · ') : '不限'
}

Page({
  data: {
    loading: true,
    loadError: false,
    maintenance: false,
    feature: null,
    signup: null,
    window: null,
    currentMatch: null,
    historyCount: 0,
    editing: false,
    newRound: false,
    showForm: false,
    showRules: false,
    submitting: false,
    photoUploading: false,
    countdown: '',
    submitText: '开始匹配',
    signupExpectText: '',
    signupTagsText: '',
    myNickName: '同学',
    myAvatar: FALLBACK_AVATAR,
    windowUsed: 0,
    windowRemaining: 10,
    windowActive: false,
    windowEnded: false,
    windowFull: false,
    form: {
      gender: 0,
      campus: '',
      grade: '',
      height: 0,
      mbti: '',
      photoUrl: '',
      intro: '',
      tags: [],
      expectGender: 0,
      expectCampusMode: 'any',
      expectHeightMin: couple.DEFAULT_EXPECT_MIN,
      expectHeightMax: couple.DEFAULT_EXPECT_MAX,
      expectMbti: [],
      consent: false
    },
    heightUnlimited: false,
    expectMbtiAny: true,
    tagOptions: tagStates([]),
    expectMbtiOptions: mbtiStates([]),
    campusOptions: CAMPUS_OPTIONS,
    campusLabels: CAMPUS_OPTIONS.map((item) => item.label),
    campusIndex: 0,
    gradeOptions: GRADE_OPTIONS,
    gradeLabels: GRADE_OPTIONS.map((item) => item.label),
    gradeIndex: 0,
    heightOptions: couple.HEIGHT_OPTIONS,
    heightLabels: couple.HEIGHT_OPTIONS.map((item) => item.label),
    heightIndex: 0,
    mbtiOptions: MBTI_OPTIONS,
    mbtiLabels: MBTI_OPTIONS.map((item) => item.label),
    mbtiIndex: 0,
    expectHeightOptions: couple.EXPECT_HEIGHT_OPTIONS,
    expectHeightLabels: couple.EXPECT_HEIGHT_OPTIONS.map((item) => item.label),
    expectMinIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, couple.DEFAULT_EXPECT_MIN),
    expectMaxIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, couple.DEFAULT_EXPECT_MAX),
    fallbackAvatar: FALLBACK_AVATAR
  },

  onShow() {
    this.load()
  },

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    const allowed = await auth.requireFeatureAccess('一周CP', { autoBack: true })
    if (!allowed) return
    this.setData({ loading: true, loadError: false })
    try {
      const state = await api.getCoupleCurrent()
      const feature = state.feature || null
      if (!feature) throw new Error('feature unavailable')
      const signup = state.signup || null
      const form = this.buildForm(state, signup)
      const window = state.window || null
      const currentMatch = state.currentMatch || null
      const windowActive = !!window && window.status === 'active'
      const windowEnded = !!window && window.status !== 'active'
      const windowFull = windowActive && Number(window.remaining) <= 0
      const editing = this.data.editing && !!signup
      const newRound = this.data.newRound && !!signup
      const showForm = !currentMatch && !windowFull && (!signup || editing)
      const profile = (getApp().globalData && getApp().globalData.userInfo) || wx.getStorageSync('userInfo') || {}
      this.setData({
        loading: false,
        loadError: false,
        maintenance: Number(feature.status) !== 1,
        feature,
        signup,
        window,
        currentMatch,
        historyCount: Number(state.historyCount) || 0,
        editing,
        newRound,
        showForm,
        submitText: editing ? (newRound ? '开始新一轮' : '保存资料') : '开始匹配',
        signupExpectText: expectText(signup),
        signupTagsText: signup && Array.isArray(signup.tags) ? signup.tags.join(' · ') : '',
        myNickName: profile.nickName || '同学',
        myAvatar: profile.avatarUrl || FALLBACK_AVATAR,
        windowUsed: window ? window.used : 0,
        windowRemaining: window ? window.remaining : 10,
        windowActive,
        windowEnded,
        windowFull,
        ...form
      })
      this.startTimer()
    } catch (e) {
      this.setData({ loading: false, loadError: true, maintenance: false, feature: null })
    }
  },

  buildForm(state, signup) {
    const profile = (getApp().globalData && getApp().globalData.userInfo) || wx.getStorageSync('userInfo') || {}
    const source = signup || {}
    // 新报名默认展示 165–175cm 区间（产品要求字段必须可见）；只有已保存资料
    // 明确选择过“不限身高”（min/max 都为 0）时才隐藏区间选择器。
    const heightUnlimited = !!signup && !source.expectHeightMin && !source.expectHeightMax
    const expectMin = source.expectHeightMin || couple.DEFAULT_EXPECT_MIN
    const expectMax = source.expectHeightMax || couple.DEFAULT_EXPECT_MAX
    const expectMbti = Array.isArray(source.expectMbti) ? source.expectMbti : []
    const form = {
      gender: source.gender || Number(profile.gender) || 0,
      campus: source.campus || profile.campus || '',
      grade: source.grade || '',
      height: Number(source.height) || 0,
      mbti: source.mbti || '',
      photoUrl: source.photoUrl || '',
      intro: source.intro || '',
      tags: Array.isArray(source.tags) ? source.tags : [],
      expectGender: Number(source.expectGender) || 0,
      expectCampusMode: source.expectCampus ? 'same' : 'any',
      expectHeightMin: expectMin,
      expectHeightMax: expectMax,
      expectMbti,
      consent: false
    }
    return {
      form,
      heightUnlimited,
      expectMbtiAny: !expectMbti.length,
      tagOptions: tagStates(form.tags),
      expectMbtiOptions: mbtiStates(expectMbti),
      campusIndex: pickIndex(CAMPUS_OPTIONS, form.campus),
      gradeIndex: pickIndex(GRADE_OPTIONS, form.grade),
      heightIndex: pickIndex(couple.HEIGHT_OPTIONS, form.height),
      mbtiIndex: pickIndex(MBTI_OPTIONS, form.mbti),
      expectMinIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, expectMin),
      expectMaxIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, expectMax)
    }
  },

  startTimer() {
    this.stopTimer()
    this.tick()
    this.timer = setInterval(() => this.tick(), 1000)
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  tick() {
    const window = this.data.window
    if (!window || !this.data.windowActive) return this.setData({ countdown: '' })
    const remain = (Number(window.endAt) || 0) - Date.now()
    if (remain <= 0) {
      this.setData({ countdown: '00:00:00' })
      if (!this._expireRefreshing) {
        this._expireRefreshing = true
        this.load().finally(() => { this._expireRefreshing = false })
      }
      return
    }
    this.setData({ countdown: couple.formatRemain(window.endAt) })
  },

  onGenderTap(e) {
    this.setData({ 'form.gender': Number(e.currentTarget.dataset.value) })
  },

  onCampusChange(e) {
    const index = Number(e.detail.value)
    const option = CAMPUS_OPTIONS[index]
    this.setData({ campusIndex: index, 'form.campus': option ? option.value : '' })
  },

  onGradeChange(e) {
    const index = Number(e.detail.value)
    const option = GRADE_OPTIONS[index]
    this.setData({ gradeIndex: index, 'form.grade': option ? option.value : '' })
  },

  onHeightChange(e) {
    const index = Number(e.detail.value)
    const option = couple.HEIGHT_OPTIONS[index]
    this.setData({ heightIndex: index, 'form.height': option ? option.value : 0 })
  },

  onMbtiChange(e) {
    const index = Number(e.detail.value)
    const option = MBTI_OPTIONS[index]
    this.setData({ mbtiIndex: index, 'form.mbti': option ? option.value : '' })
  },

  onTagTap(e) {
    const name = e.currentTarget.dataset.name
    const tags = (this.data.form.tags || []).slice()
    const index = tags.indexOf(name)
    if (index > -1) tags.splice(index, 1)
    else if (tags.length >= 6) return wx.showToast({ title: '最多选择 6 个兴趣标签', icon: 'none' })
    else tags.push(name)
    this.setData({ 'form.tags': tags, tagOptions: tagStates(tags) })
  },

  onIntroInput(e) {
    this.setData({ 'form.intro': e.detail.value })
  },

  onExpectGenderTap(e) {
    this.setData({ 'form.expectGender': Number(e.currentTarget.dataset.value) })
  },

  onExpectCampusTap(e) {
    this.setData({ 'form.expectCampusMode': e.currentTarget.dataset.value })
  },

  onHeightUnlimitedTap() {
    this.setData({ heightUnlimited: !this.data.heightUnlimited })
  },

  onExpectHeightMinChange(e) {
    const index = Number(e.detail.value)
    const option = couple.EXPECT_HEIGHT_OPTIONS[index]
    let min = option ? option.value : couple.DEFAULT_EXPECT_MIN
    let max = this.data.form.expectHeightMax
    if (min >= max) max = Math.min(min + 5, 200)
    this.setData({
      expectMinIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, min),
      expectMaxIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, max),
      'form.expectHeightMin': min,
      'form.expectHeightMax': max
    })
  },

  onExpectHeightMaxChange(e) {
    const index = Number(e.detail.value)
    const option = couple.EXPECT_HEIGHT_OPTIONS[index]
    let max = option ? option.value : couple.DEFAULT_EXPECT_MAX
    let min = this.data.form.expectHeightMin
    if (max <= min) min = Math.max(max - 5, 150)
    this.setData({
      expectMinIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, min),
      expectMaxIndex: pickIndex(couple.EXPECT_HEIGHT_OPTIONS, max),
      'form.expectHeightMin': min,
      'form.expectHeightMax': max
    })
  },

  onExpectMbtiTap(e) {
    const name = e.currentTarget.dataset.name
    if (name === '不限') {
      this.setData({
        'form.expectMbti': [],
        expectMbtiAny: true,
        expectMbtiOptions: mbtiStates([])
      })
      return
    }
    const list = (this.data.form.expectMbti || []).slice()
    const index = list.indexOf(name)
    if (index > -1) list.splice(index, 1)
    else if (list.length >= 4) return wx.showToast({ title: 'MBTI 最多选择 4 个', icon: 'none' })
    else list.push(name)
    this.setData({
      'form.expectMbti': list,
      expectMbtiAny: !list.length,
      expectMbtiOptions: mbtiStates(list)
    })
  },

  onConsentTap() {
    this.setData({ 'form.consent': !this.data.form.consent })
  },

  choosePhoto() {
    if (this.data.photoUploading) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        this.setData({ photoUploading: true })
        try {
          const urls = await wechat.uploadImages([file.tempFilePath])
          this.setData({ 'form.photoUrl': urls[0] || '' })
          wx.showToast({ title: '照片已上传', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: e.message || '照片上传失败', icon: 'none' })
        } finally {
          this.setData({ photoUploading: false })
        }
      }
    })
  },

  previewPhoto() {
    if (!this.data.form.photoUrl) return
    wx.previewImage({ urls: [this.data.form.photoUrl] })
  },

  removePhoto() {
    this.setData({ 'form.photoUrl': '' })
  },

  editSignup() {
    this.setData({ editing: true, newRound: false, showForm: true, submitText: '保存资料' })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  startNewRound() {
    this.setData({ editing: true, newRound: true, showForm: true, submitText: '开始新一轮' })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  async submit() {
    if (this.data.submitting) return
    const form = this.data.form
    if (!form.gender) return wx.showToast({ title: '请选择性别', icon: 'none' })
    if (!form.campus) return wx.showToast({ title: '请选择校区', icon: 'none' })
    if (!form.grade) return wx.showToast({ title: '请选择年级', icon: 'none' })
    if ((form.tags || []).length < 2) return wx.showToast({ title: '至少选择 2 个兴趣标签', icon: 'none' })
    if (!form.intro || form.intro.trim().length < 10) return wx.showToast({ title: '一句话介绍至少写 10 个字', icon: 'none' })
    if (!form.consent) return wx.showToast({ title: '请先阅读并同意一周CP规则', icon: 'none' })
    if (!this.data.heightUnlimited && form.expectHeightMin >= form.expectHeightMax) {
      return wx.showToast({ title: '最高身高需大于最低身高', icon: 'none' })
    }
    this.setData({ submitting: true })
    try {
      const payload = {
        gender: form.gender,
        campus: form.campus,
        grade: form.grade,
        height: form.height,
        mbti: form.mbti,
        photoUrl: form.photoUrl,
        intro: form.intro.trim(),
        tags: form.tags,
        expectGender: form.expectGender,
        expectCampus: form.expectCampusMode === 'same' ? form.campus : '',
        expectHeightMin: this.data.heightUnlimited ? 0 : form.expectHeightMin,
        expectHeightMax: this.data.heightUnlimited ? 0 : form.expectHeightMax,
        expectMbti: form.expectMbti,
        consent: !!form.consent
      }
      await api.submitCoupleSignup(payload)
      const wasNewRound = this.data.newRound
      const hadSignup = !!this.data.signup
      this.setData({ editing: false, newRound: false, submitting: false })
      wx.showToast({
        title: wasNewRound ? '已开始新一轮' : (hadSignup ? '资料已保存' : '已进入匹配池'),
        icon: 'success'
      })
      await this.load()
    } catch (e) {
      this.setData({ submitting: false })
    }
  },

  goResult() {
    const match = this.data.currentMatch
    if (!match) return
    wx.navigateTo({ url: '/pkg-feature/pages/couple/result?matchId=' + match.id })
  },

  goChat() {
    const match = this.data.currentMatch
    if (!match) return
    wx.navigateTo({ url: '/pkg-feature/pages/couple/chat?matchId=' + match.id })
  },

  goHistory() {
    wx.navigateTo({ url: '/pkg-feature/pages/couple/history' })
  },

  toggleRules() {
    this.setData({ showRules: !this.data.showRules })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
