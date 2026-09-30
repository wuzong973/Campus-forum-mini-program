/**
 * 登录状态时效性管理
 *
 * 两条独立的失效判定，任一命中就清除本地登录凭证：
 *   1) token 自身的有效期（JWT_EXPIRES，服务端签发时写死在 exp 里）—— 主判据；
 *   2) 用户超过 90 天未使用小程序 —— 产品侧的账号安全策略，比 token 更宽。
 *
 * ⚠️ 历史缺陷：此前只判第 2 条，而服务端 JWT 只有 7 天，于是「7 天 ~ 90 天」
 * 之间是僵尸登录态（本地有 token → 守卫放行 → 服务端全 401）。现在按 exp
 * 先判 token，这个窗口就消失了。
 *
 * 性能说明：所有操作均为同步本地存储读写 + 一次 base64 解码，单次耗时 < 5ms。
 */

const tokenUtil = require('./token')

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
 * 判断登录是否已过期（仅按「90 天未活跃」口径，不含 token 有效期）
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
 * - 本地无 token：直接记录活跃时间，无需清理
 * - token 自身已过期（exp 到期）：清除并返回 { reason: 'token-expired' }
 * - 超过 90 天未使用：清除并返回 { reason: 'inactive' }
 * - 仍有效：刷新活跃时间并返回 false
 *
 * @returns {false | { reason: 'token-expired' | 'inactive' }} 非 false 表示已清理
 */
function checkLoginExpiry() {
  try {
    const token = wx.getStorageSync('token')
    if (!token) {
      // 未登录用户也记录活跃时间，便于后续登录后立即生效
      recordActiveTime()
      return false
    }

    // 主判据：token 自己带的有效期。先判它，避免在「token 已过期但未满 90 天」
    // 的僵尸窗口里把「本地有 token」误当成「已登录」。
    if (tokenUtil.isTokenExpired(token)) {
      clearLoginData()
      return { reason: 'token-expired' }
    }

    if (isLoginExpired()) {
      clearLoginData()
      return { reason: 'inactive' }
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
