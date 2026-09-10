// 校区维度（两级）：主校区 → 分校区；'' = 全部校区（所有校区可见）
// 与后台 pkg-admin（CAMPUS_SELECT_OPTIONS）及服务端各控制器的 CAMPUS_MAIN_MAP 保持一致
const CAMPUS_GROUPS = [
  { name: '广州校区', subs: ['新港校区', '琶洲校区'] },
  { name: '佛山校区', subs: ['南海南校区', '南海北校区'] }
]

// 申请创建群聊等表单使用：仅主校区层级（含全部校区）
const MAIN_CAMPUS_OPTIONS = ['广州校区', '佛山校区']
const APPLY_CAMPUS_OPTIONS = [
  { label: '全部校区', value: '' },
  { label: '广州校区', value: '广州校区' },
  { label: '佛山校区', value: '佛山校区' }
]

// 用户在「设置」中选择的校区（账号资料 campus，广州校区/佛山校区）
function getProfileCampus() {
  try {
    const app = getApp()
    const info = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {}
    return String(info.campus || '').trim()
  } catch (e) {
    return ''
  }
}

// 页面默认校区：优先取设置中选择的校区（主校区），未设置时默认广州校区
function getDefaultCampus() {
  const campus = getProfileCampus()
  const main = CAMPUS_GROUPS.find((group) => group.name === campus)
  return main ? main.name : CAMPUS_GROUPS[0].name
}

// 指定校区是否为合法取值（主校区或分校区）
function isValidCampus(campus) {
  if (!campus) return false
  if (CAMPUS_GROUPS.some((group) => group.name === campus)) return true
  return CAMPUS_GROUPS.some((group) => group.subs.indexOf(campus) >= 0)
}

// 取某主校区的分校区列表
function getSubCampus(mainName) {
  const group = CAMPUS_GROUPS.find((item) => item.name === mainName)
  return group ? group.subs : []
}

module.exports = {
  CAMPUS_GROUPS,
  MAIN_CAMPUS_OPTIONS,
  APPLY_CAMPUS_OPTIONS,
  getProfileCampus,
  getDefaultCampus,
  isValidCampus,
  getSubCampus
}
