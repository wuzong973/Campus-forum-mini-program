const request = require('./request')
const loginExpiry = require('./login-expiry')
const syncQueue = require('./syncQueue')
const avatar = require('./avatar')
const tokenUtil = require('./token')

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

/**
 * 本地「已登录」判定 = 有 token 且 token 自身未过期。
 *
 * ⚠️ 只判 `globalData.token` 是不是非空字符串是不够的：服务端 JWT 有有效期，
 * 过期后所有鉴权接口都返回 401，但守卫仍会放行，用户就卡在「页面能进、数据全空」
 * 的僵尸态里（典型表现：点「绑定并同步」只弹一句「未登录」）。
 * 这里一旦发现 token 已过期，就地清理登录态，让守卫立刻按未登录处理。
 */
function isLoggedIn() {
  const app = getAppSafe()
  const token = (app && app.globalData.token) || ''
  if (!token) return false
  if (!tokenUtil.isTokenExpired(token)) return true
  logout()
  return false
}

function requireLogin(message) {
  if (isLoggedIn()) return true
  wx.showModal({
    title: '提示',
    content: message || '请先登录后再操作',
    confirmText: '去登录',
    cancelText: '取消',
    success(res) {
      if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
    }
  })
  return false
}

// 页面级登录守卫：功能页入口统一拦截未登录用户。
// 已登录直接放行（返回 true），不影响正常使用；
// 未登录弹窗引导去登录，取消则退回上一页，避免停留在不可用的功能页。
function guardPage(message) {
  if (isLoggedIn()) return true
  wx.showModal({
    title: '提示',
    content: message || '该功能需要登录后使用',
    confirmText: '去登录',
    cancelText: '返回',
    success(res) {
      if (res.confirm) {
        wx.navigateTo({ url: '/pages/login/index' })
      } else {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/index/index' })
        })
      }
    }
  })
  return false
}

function getMissingProfileFields() {
  const app = getAppSafe()
  const user = (app && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {}
  const required = [
    { key: 'avatarUrl', label: '头像' },
    { key: 'nickName', label: '昵称' },
    { key: 'campus', label: '校区' },
    { key: 'gender', label: '性别' },
    { key: 'phone', label: '手机号' }
  ]
  return required.filter((item) => {
    const value = user[item.key]
    if (item.key === 'gender') return value === undefined || value === null || value === 0 || value === ''
    return !value
  })
}

function requirePublishReady() {
  if (!requireLogin('发帖需要先登录')) return false
  const missing = getMissingProfileFields()
  if (!missing.length) return true
  wx.showModal({
    title: '请完善个人信息',
    content: '发帖前需先补充：' + missing.map((item) => item.label).join('、'),
    confirmText: '去编辑',
    success(res) {
      if (res.confirm) wx.navigateTo({ url: '/pages/account-settings/index' })
    }
  })
  return false
}

function getRunnerVerification() {
  const verification = wx.getStorageSync('runner_verification') || {}
  const app = getAppSafe()
  const user = (app && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {}
  return {
    campusVerified: !!verification.campusVerified,
    phoneBound: !!user.phone,
    verificationStatus: verification.verificationStatus || 'none',
    reviewNote: verification.reviewNote || ''
  }
}

function requireRunnerReady() {
  if (!requireLogin('接单需要先登录')) return false
  const status = getRunnerVerification()
  if (status.verificationStatus === 'approved' && status.phoneBound) return true
  wx.showModal({
    title: '接单提示',
    content: '认证以后马上就能接单赚钱 💰 前往认证>>>',
    cancelText: '取消',
    confirmText: '前往',
    success(res) {
      if (res.confirm) wx.navigateTo({ url: '/pages/rider-verify/index' })
    }
  })
  return false
}

// ===== 校园功能统一访问控制（校园活动 / 广轻群聊 / 社团&组织 / 校园评价） =====
// 规则：已登录 且（已登录过教务系统 或 已完成骑手认证）任一条件满足即可使用。
// 教务登录状态以服务端绑定凭证为准（/schedule/bind），骑手认证以本地认证记录为准。

// 已完成骑手认证（本地记录，同步判断）
function isRiderApproved() {
  return getRunnerVerification().verificationStatus === 'approved'
}

// 教务系统绑定状态（服务端已保存加密凭证 = 已登录过教务系统）
function getJwBound() {
  return request
    .get('/schedule/bind', {}, true, { silent: true })
    .then((d) => !!(d && d.bound))
    .catch(() => false)
}

// 通过校验后的短时缓存（只缓存"通过"）：首页宫格入口与功能页守卫先后各查一次，
// 避免同一秒内打两次 /schedule/bind。不缓存"不通过"——用户刚在登录页完成
// 教务绑定/骑手认证返回时，必须立刻按新状态放行。
let featureAccessOkUntil = 0
const FEATURE_ACCESS_CACHE_MS = 60 * 1000

function isFeatureAccessCached() {
  return Date.now() < featureAccessOkUntil
}

/**
 * 统一功能入口守卫：校园活动 / 广轻群聊 / 社团&组织 / 校园评价 四个功能共用。
 * - 未登录：弹窗引导去登录
 * - 已登录但既未绑定教务系统也未通过骑手认证：弹窗说明，确认后二选一
 *   （登录教务系统 → pkg-schedule/schedule-login，骑手认证 → pages/rider-verify）
 * - 通过：resolve(true)
 *
 * options.autoBack：不通过且用户点「返回」时是否自动退出当前页面。
 *   功能页内守卫传 true（取消则退回上一页，避免停留在不可用的功能页）；
 *   首页宫格/服务列表等入口处传 false（取消留在原页面即可）。
 * @returns {Promise<boolean>}
 */
function requireFeatureAccess(featureName, options) {
  const autoBack = !options || options.autoBack !== false
  const name = featureName || '该功能'
  const leaveIfCancelled = () => {
    if (!autoBack) return
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) })
  }
  return new Promise((resolve) => {
    // 未登录：不看缓存，直接拦截（退出登录后立即恢复拦截）
    if (!isLoggedIn()) {
      wx.showModal({
        title: '提示',
        content: '使用「' + name + '」需要先登录',
        confirmText: '去登录',
        cancelText: '返回',
        success(res) {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
          else leaveIfCancelled()
          resolve(false)
        }
      })
      return
    }
    if (isFeatureAccessCached() || isRiderApproved()) {
      featureAccessOkUntil = Date.now() + FEATURE_ACCESS_CACHE_MS
      resolve(true)
      return
    }
    getJwBound().then((bound) => {
      if (bound) {
        featureAccessOkUntil = Date.now() + FEATURE_ACCESS_CACHE_MS
        resolve(true)
        return
      }
      wx.showModal({
        title: '访问受限',
        content: '使用「' + name + '」前，请先完成「教务系统登录」或「骑手认证」任意一项',
        confirmText: '去完成',
        cancelText: '返回',
        success(res) {
          if (res.confirm) {
            wx.showActionSheet({
              itemList: ['登录教务系统', '完成骑手认证'],
              success(choice) {
                wx.navigateTo({
                  url: choice.tapIndex === 0
                    ? '/pkg-schedule/schedule-login/index'
                    : '/pages/rider-verify/index'
                })
              }
            })
          } else {
            leaveIfCancelled()
          }
          resolve(false)
        }
      })
    })
  })
}

function saveUser(user) {
  const app = getAppSafe()
  if (!app) return
  if (user.token) {
    app.globalData.token = user.token
    wx.setStorageSync('token', user.token)
  }
  const current = app.globalData.userInfo || wx.getStorageSync('userInfo') || {}
  const sameUser = user && user.id && String(current.id) === String(user.id)
  const defaultProfile = avatar.getDefaultProfile()
  const currentAvatar = sameUser && avatar.isStoredAvatar(current.avatarUrl) ? current.avatarUrl : ''
  const rawServerAvatar = avatar.normalizeLegacyAvatar(user.avatarUrl || user.avatar_url)
  const serverAvatar = avatar.isStoredAvatar(rawServerAvatar) ? rawServerAvatar : ''
  const avatarUrl = serverAvatar || currentAvatar || defaultProfile.avatarUrl
  const serverNickName = user.nickName || user.nick_name || ''
  const nickName = !avatar.isDefaultName(serverNickName)
    ? serverNickName
    : (sameUser && !avatar.isDefaultName(current.nickName)
      ? current.nickName
      : defaultProfile.nickName)
  const info = {
    id: user.id,
    nickName,
    avatarUrl,
    studentId: user.studentId || user.student_id || '',
    gender: user.gender,
    campus: user.campus,
    phone: user.phone,
    school: user.school || '广东轻工职业技术大学',
    isVerified: user.isVerified || user.is_verified,
    // 保留已有 role：某些局部更新的响应体不含 role，若无条件写成 'user'，
    // 管理员会在改完昵称/头像后被悄悄降级，管理端入口（如评论「删除」）随之消失
    role: user.role || current.role || 'user'
  }
  app.globalData.userInfo = info
  wx.setStorageSync('userInfo', info)
  // 服务端缺少有效头像/昵称时（新用户或历史脏数据），把本地展示用的头像昵称回传服务器，
  // 保证私信、帖子等场景其他用户能看到真实头像，而不是默认图标
  if (user.id && (!serverAvatar || avatar.isDefaultName(serverNickName))) {
    // 去重标记必须持久化：此前存在内存对象上，重启小程序即失效并重复上报，
    // 一旦某次上报失败（静默 catch）就再也不会重试，服务端头像永久为空。
    const syncKey = 'profile_synced_' + user.id
    const alreadySynced = wx.getStorageSync(syncKey)
    if (!alreadySynced && avatar.isStoredAvatar(avatarUrl)) {
      const payload = {
        avatarUrl: avatar.isDefaultName(serverNickName) ? avatarUrl : avatarUrl
      }
      if (avatar.isDefaultName(serverNickName)) payload.nickName = nickName
      syncProfile(payload)
        .then(() => wx.setStorageSync(syncKey, true))
        .catch((error) => {
          // 不静默吞掉：保留可重试状态，下次登录/启动会再次补报
          console.warn('[profile-sync] 资料补报失败，将在下次登录重试:', error && error.message)
        })
    }
  }
  // 登录成功后记录活跃时间，启动 90 天时效计时
  loginExpiry.recordActiveTime()
  return info
}

function logout() {
  const app = getAppSafe()
  if (app) {
    // 先断开 WebSocket / 清未读徽标，再清身份，避免旧 socket 以旧身份继续收消息
    if (typeof app.onLogout === 'function') app.onLogout()
    app.globalData.token = ''
    app.globalData.userInfo = null
  }
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
  wx.removeStorageSync('pm_unread_total')
  // 退出登录后立即恢复功能访问拦截（清除"已通过"短缓存）
  featureAccessOkUntil = 0
}

function syncProfile(fields) {
  if (!isLoggedIn()) {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return Promise.resolve({ queued: false, offline: true })
  }
  const payload = {
    nickName: fields.nickName,
    avatarUrl: fields.avatarUrl,
    gender: fields.gender,
    campus: fields.campus
  }
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key])
  return request.put('/user/info', payload, true, { retryable: true, idempotencyKey: `profile_${Date.now()}` }).then(() => {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return { queued: false }
  }).catch((error) => {
    if (!error.isNetwork) throw error
    // 网络异常时入队重试；queued=true 表示"尚未真正落库"，
    // 调用方不应据此认为服务端资料已补齐
    syncQueue.queueProfile(payload)
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return { queued: true }
  })
}

module.exports = { isLoggedIn, requireLogin, guardPage, requirePublishReady, requireRunnerReady, getRunnerVerification, getMissingProfileFields, saveUser, logout, syncProfile, isRiderApproved, getJwBound, requireFeatureAccess }
