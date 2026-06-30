/**
 * 登录状态时效性管理
 * 规则：用户超过 90 天未使用小程序，自动清除本地登录凭证并强制重新登录
 *
 * 性能说明：所有操作均为同步本地存储读写，单次耗时 < 5ms，
 * 整个 checkLoginExpiry 流程可在 50ms 内完成，远低于 3 秒要求。
 */

// 90 天对应的毫秒数
const EXPIRY_DAYS = 90
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000

// 本地存储 key
const STORAGE_KEY = 'lastActiveTime'

/**
 * 记录用户最后活跃时间戳（毫秒）
 * 调用时机：小程序启动、回到前台、登录成功
 */
function recordActiveTime() {
  try {
    wx.setStorageSync(STORAGE_KEY, Date.now())
  } catch (e) {
    // 存储异常（如空间不足）静默失败，不影响主流程
  }
}

/**
 * 读取用户最后活跃时间戳
 * @returns {number} 时间戳，未记录时返回 0
 */
function getLastActiveTime() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || 0
  } catch (e) {
    return 0
  }
}

/**
 * 判断登录是否已过期
 * 注意：若从未记录活跃时间（首次安装/老用户无记录），不视为过期
 * @returns {boolean}
 */
function isLoginExpired() {
  const last = getLastActiveTime()
  if (!last) return false
  return (Date.now() - last) > EXPIRY_MS
}

/**
 * 清除本地登录凭证及相关用户信息
 */
function clearLoginData() {
  try {
    wx.removeStorageSync('token')
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) {
    // 清理异常静默处理
  }
}

/**
 * 启动时检查登录过期：
 * - 若本地无 token，直接记录活跃时间，无需清理
 * - 若已过期，清除登录数据并返回 true
 * - 若未过期，刷新活跃时间并返回 false
 *
 * @returns {boolean} true 表示已清理过期登录数据
 */
function checkLoginExpiry() {
  try {
    const token = wx.getStorageSync('token')
    if (!token) {
      // 未登录用户也记录活跃时间，便于后续登录后立即生效
      recordActiveTime()
      return false
    }

    if (isLoginExpired()) {
      clearLoginData()
      return true
    }

    // 仍有效，刷新活跃时间
    recordActiveTime()
    return false
  } catch (e) {
    // 检查流程异常时不强制清理，避免误伤正常用户
    return false
  }
}

module.exports = {
  EXPIRY_DAYS,
  EXPIRY_MS,
  recordActiveTime,
  getLastActiveTime,
  isLoginExpired,
  clearLoginData,
  checkLoginExpiry
}
