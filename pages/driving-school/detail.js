// 找驾校：驾校详情页（场地实景 + 驾校信息 + 报名流程 + 场地展示 + 简介 + 服务保障）
// 数据源：服务端 driving_school 表（管理后台「找驾校内容管理」维护）
const ds = require('../../utils/driving-school')
const api = require('../../utils/api')

Page({
  data: {
    school: null,
    steps: ds.ENROLL_STEPS,
    // 报名流程进度：进入详情页时停在第一步「选驾校」
    activeStep: 0,
    images: [],
    heroSrc: '',
    stepTip: '当前阶段：选驾校 —— 对比价格、距离与口碑，确认后点下方「立即咨询」',
    loading: true
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0)
    if (!id) return this.failBack()
    return api.getDrivingSchoolDetail(id).then((raw) => {
      if (!raw) return this.failBack()
      const school = ds.buildSchoolCard(raw, 0)
      const images = Array.isArray(raw.images) ? raw.images : []
      this.setData({
        school,
        images,
        // 顶部实景与列表卡片同源：优先封面，其次首张场地照，都没有才走配色兜底
        heroSrc: school.cover || images[0] || '',
        loading: false
      })
    }).catch(() => this.failBack())
  },

  failBack() {
    wx.showToast({ title: '驾校不存在或已下架', icon: 'none' })
    setTimeout(() => {
      wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/driving-school/index' }) })
    }, 900)
  },

  // 报名流程：点击某一步查看该阶段说明（交互上允许回看，不做强制顺序）
  onStepTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= this.data.steps.length) return
    const tips = [
      '当前阶段：选驾校 —— 对比价格、距离与口碑，确认后点下方「立即咨询」',
      '当前阶段：预报名 —— 提交姓名与联系方式，由驾校确认名额与班型',
      '当前阶段：签合同 —— 逐条确认费用明细（补考费、模拟费、学时费是否包含）',
      '当前阶段：缴学费 —— 走对公账户并保留凭证，避免私下转账',
      '当前阶段：体检/面签 —— 完成学车体检后由驾校统一到车管所建档'
    ]
    this.setData({ activeStep: index, stepTip: tips[index] })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: this.data.images.length ? this.data.images : [url], current: url })
  },

  // 报名材料与常见问题：进入学车指南
  goGuide() {
    wx.navigateTo({ url: '/pages/driving-school/guide' })
  },

  // 微信原生地图查看训练场位置（坐标为 gcj02，与腾讯地理编码同源，无需转换）
  onOpenLocation() {
    const school = this.data.school || {}
    const latitude = Number(school.latitude)
    const longitude = Number(school.longitude)
    if (!latitude || !longitude) return
    wx.openLocation({
      latitude,
      longitude,
      name: school.name || '训练场',
      address: school.addressText || school.address || '',
      scale: 16
    })
  },

  onShareAppMessage() {
    const school = this.data.school || {}
    return {
      title: (school.name || '驾校') + ' · 通过率 ' + (school.passRateText || '') + ' · ' + (school.intro || ''),
      path: '/pages/driving-school/detail?id=' + (school.id || '')
    }
  }
})
