const { REVIEW_CATEGORIES, normalizeLegacyReviewCampus, parentMainOf } = require('../../utils/review')
const { getProfileCampus } = require('../../../utils/campus')
const auth = require('../../../utils/auth')

const CAMPUS_STORAGE_KEY = 'review_campus'

Page({
  data: {
    categories: REVIEW_CATEGORIES,
    campus: '广州校区',
    showCampusPanel: false
  },

  onLoad() {
    // 校区只区分主校区（广州/佛山）：上次选择 → 个人设置校区（分校区归入所属主校区）→ 广州校区
    let campus = ''
    try { campus = normalizeLegacyReviewCampus(wx.getStorageSync(CAMPUS_STORAGE_KEY)) } catch (e) { campus = '' }
    let main = parentMainOf(campus)
    if (!main) main = parentMainOf(getProfileCampus())
    this.setData({ campus: main || '广州校区' })
  },

  onShow() {
    // 统一访问控制：已登录且（已登录过教务系统 或 已完成骑手认证）才可使用
    auth.requireFeatureAccess('校园评价', { autoBack: true })
  },

  // ===== 校区选择（仅广州校区 / 佛山校区两个主校区，不细分南北区） =====
  onToggleCampus() {
    this.setData({ showCampusPanel: !this.data.showCampusPanel })
  },

  onCloseCampus() {
    this.setData({ showCampusPanel: false })
  },

  onCampusChange(e) {
    // 面板只展示主校区；对任何传入值防御性归一（分校区 → 所属主校区）
    const campus = parentMainOf(e.detail.value)
    if (!campus || campus === this.data.campus) {
      this.setData({ showCampusPanel: false })
      return
    }
    wx.vibrateShort({ type: 'light' })
    this.setData({ campus, showCampusPanel: false })
    try { wx.setStorageSync(CAMPUS_STORAGE_KEY, campus) } catch (e) { /* 存储失败不阻塞 */ }
  },

  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    wx.vibrateShort({ type: 'light' })
    // 课程评价不区分校区；食堂 / 商圈按主校区区分（服务端主校区命中其全部分校区数据）
    let url = '/pkg-feature/pages/review/list?category=' + key
    if (key !== 'course') url += '&campus=' + encodeURIComponent(this.data.campus)
    wx.navigateTo({ url })
  }
})
