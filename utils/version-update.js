const request = require('./request')

const APP_VERSION_API = '/config/app-version'
const DISMISSED_STORAGE_KEY = 'app_update_dismissed'
const SEMVER_RE = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/
let checking = false
let onNeedUpdate = null
let updateManager = null
let packageUpdateReady = false

function readStorage(key, fallback) {
  try { return wx.getStorageSync(key) || fallback } catch (e) { return fallback }
}

function writeStorage(key, value) {
  try { wx.setStorageSync(key, value) } catch (e) {}
}

function isLoggedIn() {
  try {
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    return !!(token && userInfo && userInfo.id)
  } catch (e) { return false }
}

function getLocalVersion() {
  try {
    const info = typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync().miniProgram
      : {}
    return String(info.version || '').trim()
  } catch (e) { return '' }
}

function normalizeVersion(value) {
  const version = String(value || '').trim()
  return SEMVER_RE.test(version) ? version : ''
}

function compareVersion(left, right) {
  const normalize = (part) => Number(part || 0) || 0
  const a = String(left || '').split('-')[0].split('.')
  const b = String(right || '').split('-')[0].split('.')
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const diff = normalize(a[i]) - normalize(b[i])
    if (diff) return diff > 0 ? 1 : -1
  }
  return 0
}

function getRemoteVersion() {
  return request.get(APP_VERSION_API, {}, true, { silent: true, retries: 0 }).then((data) => {
    const version = normalizeVersion(typeof data === 'string' ? data : (data || {}).version)
    if (!version) throw new Error('版本号无效')
    return version
  })
}

function shouldPromptForVersion(latestVersion) {
  const dismissed = readStorage(DISMISSED_STORAGE_KEY, {})
  return !(dismissed && dismissed.version === latestVersion && dismissed.localVersion === getLocalVersion())
}

function markVersionDismissed(latestVersion) {
  writeStorage(DISMISSED_STORAGE_KEY, {
    version: latestVersion,
    localVersion: getLocalVersion(),
    dismissedAt: Date.now()
  })
}

function emitUpdate(info) {
  if (typeof onNeedUpdate !== 'function') return false
  if (!shouldPromptForVersion(info.latestVersion)) return false
  onNeedUpdate(info)
  return true
}

function handlePackageReady() {
  packageUpdateReady = true
  tryNotify()
}

function ensureManager() {
  if (updateManager) return updateManager
  if (typeof wx.getUpdateManager !== 'function') return null
  updateManager = wx.getUpdateManager()
  updateManager.onUpdateReady(handlePackageReady)
  updateManager.onUpdateFailed(() => {
    wx.showToast({ title: '新版本下载失败，请稍后重试', icon: 'none' })
  })
  return updateManager
}

function tryNotify() {
  const localVersion = getLocalVersion()
  return getRemoteVersion().then((latestVersion) => {
    // “已准备就绪”必须等微信下载完更新包。远端版本号仅用于展示；
    // 若服务端版本配置滞后，仍以微信官方 ready 状态为准。
    if (!packageUpdateReady) return false
    const displayVersion = localVersion && compareVersion(latestVersion, localVersion) > 0
      ? latestVersion
      : 'package'
    return emitUpdate({ source: 'package', latestVersion: displayVersion, localVersion })
  }).catch(() => {
    // 服务端版本号暂不可用时，微信 onUpdateReady 本身已经证明新包可用。
    if (!packageUpdateReady) return false
    return emitUpdate({ source: 'package', latestVersion: 'package', localVersion })
  })
}

function checkForUpdate(callback) {
  if (typeof callback === 'function') onNeedUpdate = callback
  if (checking || !isLoggedIn()) return Promise.resolve(false)

  const manager = ensureManager()
  if (!manager) return Promise.resolve(false)

  checking = true
  return tryNotify().then((shown) => {
    checking = false
    return shown
  }).catch(() => {
    checking = false
    return false
  })
}

function restart() {
  const manager = ensureManager()
  // applyUpdate 是微信官方更新重启 API；只有更新包 ready 后才会被调用。
  if (manager && typeof manager.applyUpdate === 'function') {
    manager.applyUpdate()
    return
  }
  wx.showToast({ title: '当前微信版本不支持自动重启', icon: 'none' })
}

module.exports = {
  APP_VERSION_API,
  DISMISSED_STORAGE_KEY,
  isLoggedIn,
  getLocalVersion,
  normalizeVersion,
  compareVersion,
  getRemoteVersion,
  shouldPromptForVersion,
  markVersionDismissed,
  ensureManager,
  checkForUpdate,
  restart
}
