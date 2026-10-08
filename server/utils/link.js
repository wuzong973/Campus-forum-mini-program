// 服务端「可跳转链接」的统一校验，与端上 utils/link.js 同口径。
//
// 合法形态只有两种：
//   1. 站内页面路径 —— 主包 `/pages/...` 或分包 `/pkg-<名字>/pages/...`
//   2. 外链 —— `http(s)://...`
//
// ⚠ 只写 `/pages/` 会漏掉全部分包页面：本项目 35 个页面在 `pkg-feature` 分包里，
// 真实路径是 `/pkg-feature/pages/activity/index`。
//
// ⚠ 小程序页面路径**不带文件后缀**：`/pkg-feature/pages/activity/index` ✔
//                                        `/pkg-feature/pages/activity/index.html` ✘
// 前缀对、后缀错是最难自己发现的一类：只查前缀会放行，端上 navigateTo 直接失败，
// 用户只看到一句「该页面暂不可用」（2026-10-08 实测）。
//
// ⚠ `#小程序://xxx/yyy` 不是合法跳转目标：那是微信「小程序短链」，
// **只能粘进微信聊天里点开**（`services/groupBroadcastService.js` 的群发就靠它），
// 小程序内部没有任何 API 能用这种字符串跳转。曾经有管理员把它填进首页轮播的
// 跳转路径，保存时不报错，用户点了只弹「链接已复制」——所以这里单列一条提示。
//
// 白名单式校验（而不是黑名单拦 javascript:）是刻意的：只放行明确认识的两种形态，
// 其余（含 javascript:、data:、自定义 scheme）一律不落库。
const INNER_PATH_RE = /^\/(?:pages|pkg-[A-Za-z0-9_-]+)\//
const WEB_URL_RE = /^https?:\/\//i
const PAGE_FILE_EXT_RE = /\.(html?|wxml|wxss|js|json|php|aspx?|jsp)$/i
const WX_CHAT_SHORT_LINK_RE = /^#小程序:\/\//

const NAVIGABLE_LINK_RE = /^\/(?:pages|pkg-[A-Za-z0-9_-]+)\/|^https?:\/\//i
const NAVIGABLE_LINK_TIP = '跳转链接需以 /pages/ 或 /pkg-xxx/pages/ 或 https:// 开头'
const WX_CHAT_SHORT_LINK_TIP = '「#小程序://」是微信群发用的短链，只能粘进微信聊天里点开，'
  + '小程序内部点了跳不了；请改填页面路径，例如 /pkg-feature/pages/activity/index'
const PAGE_FILE_EXT_TIP = '小程序页面路径不带文件后缀，去掉 .html 即可，'
  + '例如 /pkg-feature/pages/activity/index'

// 去掉 query 与 hash，只留路径部分
function pathOf(url) {
  return String(url === undefined || url === null ? '' : url).trim().split('?')[0].split('#')[0]
}

// 返回空串表示通过，否则返回给管理员看的原因。
// isNavigableLink 由它推导，保证「判定」与「原因」永远同源、不会各写一套。
function linkRejectReason(url) {
  const v = String(url === undefined || url === null ? '' : url).trim()
  if (!v) return ''
  if (WX_CHAT_SHORT_LINK_RE.test(v)) return WX_CHAT_SHORT_LINK_TIP
  // 外链不查后缀：网址以 .html 结尾很正常
  if (WEB_URL_RE.test(v)) return ''
  if (INNER_PATH_RE.test(v)) {
    // 只查路径部分，`/pages/a/index?x=1.html` 这种 query 里带点的不该误判
    return PAGE_FILE_EXT_RE.test(pathOf(v)) ? PAGE_FILE_EXT_TIP : ''
  }
  return NAVIGABLE_LINK_TIP
}

function isNavigableLink(url) {
  return !linkRejectReason(url)
}

module.exports = {
  NAVIGABLE_LINK_RE,
  NAVIGABLE_LINK_TIP,
  WX_CHAT_SHORT_LINK_RE,
  WX_CHAT_SHORT_LINK_TIP,
  PAGE_FILE_EXT_TIP,
  isNavigableLink,
  linkRejectReason
}
