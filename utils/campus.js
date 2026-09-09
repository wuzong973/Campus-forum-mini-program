// 校区维度：与后台/服务端取值保持一致；'' = 全部校区（所有校区可见）
const CAMPUS_OPTIONS = ['广州校区', '佛山校区', '南海南校区', '南海北校区']

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

// 页面默认校区：优先取设置中选择的校区，未设置时默认第一个
function getDefaultCampus() {
  const campus = getProfileCampus()
  return CAMPUS_OPTIONS.indexOf(campus) >= 0 ? campus : CAMPUS_OPTIONS[0]
}

module.exports = { CAMPUS_OPTIONS, getProfileCampus, getDefaultCampus }
