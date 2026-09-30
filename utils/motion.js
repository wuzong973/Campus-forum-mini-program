// ===== 卡片动效（旋转描边 / 呼吸背光）总开关 =====
// 样式见 styles/card-fx.wxss。命中降级时页面挂 .fx-off：只停动画，
// 静态描边与静态背光保留 —— 降级不该把效果做成"什么都没有"。

const CARD_FX_PREF_KEY = 'cardFx_by_user'

// 微信设备评测分：数值越大性能越好，-1 表示取不到（iOS 恒为 -1）。
// 低于该分数按低端机处理：常驻合成动画在低配安卓机上掉帧明显。
const LOW_END_BENCHMARK = 25

function currentPrefUserId() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    const userInfo = (app && app.globalData && app.globalData.userInfo) || null
    return (userInfo && userInfo.id) || 'guest'
  } catch (e) {
    return 'guest'
  }
}

let _benchmarkLevel = null

function getBenchmarkLevel() {
  if (_benchmarkLevel !== null) return _benchmarkLevel
  try {
    // getDeviceInfo 需 2.20.1+；老基础库回落到 getSystemInfoSync
    const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    const level = typeof info.benchmarkLevel === 'number' ? info.benchmarkLevel : -1
    _benchmarkLevel = level
  } catch (e) {
    _benchmarkLevel = -1
  }
  return _benchmarkLevel
}

function isLowEndDevice() {
  const level = getBenchmarkLevel()
  // -1 = 未知（含全部 iOS 机型）：未知就按能跑得动处理，只认明确的低分
  return level > -1 && level < LOW_END_BENCHMARK
}

// 用户偏好：未设置过默认开启；一旦手动切换则严格遵循（与 hot-rank 的 dailyHot 一致）
function isCardFxPreferred() {
  const map = wx.getStorageSync(CARD_FX_PREF_KEY) || {}
  const value = map[currentPrefUserId()]
  return value === undefined ? true : !!value
}

function setCardFxPreferred(enabled) {
  const map = wx.getStorageSync(CARD_FX_PREF_KEY) || {}
  map[currentPrefUserId()] = !!enabled
  wx.setStorageSync(CARD_FX_PREF_KEY, map)
}

// 页面用这个：返回 true 表示该挂 .fx-off
function isCardFxOff() {
  return !isCardFxPreferred() || isLowEndDevice()
}

module.exports = {
  isCardFxPreferred,
  setCardFxPreferred,
  isCardFxOff,
  isLowEndDevice,
  getBenchmarkLevel
}
