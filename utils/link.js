// 站内跳转的统一入口。
//
// 为什么需要这个文件：本项目把 35 个页面放在 pkg-feature 分包里（另有 pkg-user /
// pkg-schedule / pkg-admin），真实路径是 `/pkg-feature/pages/xxx`，**不是** `/pages/xxx`。
// 站内链接只要写成「以 /pages/ 开头就 navigateTo」，分包页面就会静默失效 ——
// 要么被当成外链复制进剪贴板，要么点了完全没反应（最典型的是首页轮播配了活动页）。
//
// 两条硬规则：
//   1. 站内路径 = `/pages/...` 或 `/pkg-<名字>/pages/...`
//   2. tabBar 页面只能用 switchTab；对它调 navigateTo 会直接报错，跳不过去
//
// 注意：本文件顶层不得引用 wx / getApp / getCurrentPages，
// 否则 server/tests 下的 Node 单测无法 require 它。
// tabBar 列表与 app.json 的一致性由 server/tests/miniprogram-link-routing.test.js 守卫。

// 页面清单（自动纠错时用来判断「主包里有没有这个页面、分包里有没有」）
const { PAGES, PAGE_PATH_SET } = require('./page-list')

const TAB_BAR_PAGES = [
  '/pages/index/index',
  '/pages/schedule/index',
  '/pages/errand/index',
  '/pages/user/index'
]

// 站内路径：主包 /pages/...，或分包 /pkg-xxx/pages/...
const INNER_PATH_RE = /^\/(?:pages|pkg-[A-Za-z0-9_-]+)\//
const WEB_URL_RE = /^https?:\/\//i

// 小程序页面路径**不带文件后缀**：/pkg-feature/pages/activity/index ✔
//                                  /pkg-feature/pages/activity/index.html ✘
// 前缀对、后缀错是最难自己发现的一类：校验只看前缀会放行，端上 navigateTo 直接失败，
// 用户只看到一句「该页面暂不可用」（2026-10-08 实测）。
const PAGE_FILE_EXT_RE = /\.(html?|wxml|wxss|js|json|php|aspx?|jsp)$/i

// 可跳转链接 = 站内路径 或 http(s) 外链。
// ⚠ `#小程序://xxx/yyy` 不是可跳转目标：那是微信「小程序短链」，只能粘进微信聊天里点开
// （服务端 services/groupBroadcastService.js 的群发就靠它），小程序内部没有 API 能用它跳转。
// 曾经有管理员把它填进首页轮播的跳转路径 → 用户点了只弹「链接已复制」。
const WX_CHAT_SHORT_LINK_RE = /^#小程序:\/\//

const LINK_FORMAT_TIP = '跳转链接需以 /pages/ 或 /pkg-xxx/pages/ 或 https:// 开头'
const WX_CHAT_SHORT_LINK_TIP = '「#小程序://」是微信群发用的短链，只能粘进微信聊天里点开，'
  + '小程序内部点了跳不了；请改填页面路径，例如 /pkg-feature/pages/activity/index'
const PAGE_FILE_EXT_TIP = '小程序页面路径不带文件后缀，去掉 .html 即可，'
  + '例如 /pkg-feature/pages/activity/index'

function normalize(url) {
  return String(url === undefined || url === null ? '' : url).trim()
}

// 去掉 query 与 hash，只留路径部分
function pathOf(url) {
  return normalize(url).split('?')[0].split('#')[0]
}

function isInnerPath(url) {
  return INNER_PATH_RE.test(normalize(url))
}

function isWebUrl(url) {
  return WEB_URL_RE.test(normalize(url))
}

// 空串表示通过，否则返回给管理员看的原因。
// isNavigableLink 由它推导，保证「判定」与「原因」永远同源、不会各写一套。
// 与 server/utils/link.js 同规则，两边一致性由 tests/miniprogram-link-routing.test.js 守卫。
function linkRejectReason(url) {
  const v = normalize(url)
  if (!v) return ''
  if (WX_CHAT_SHORT_LINK_RE.test(v)) return WX_CHAT_SHORT_LINK_TIP
  // 外链不查后缀：网址以 .html 结尾很正常
  if (WEB_URL_RE.test(v)) return ''
  if (INNER_PATH_RE.test(v)) {
    // 只查路径部分，`/pages/a/index?x=1.html` 这种 query 里带点的不该误判
    return PAGE_FILE_EXT_RE.test(pathOf(v)) ? PAGE_FILE_EXT_TIP : ''
  }
  return LINK_FORMAT_TIP
}

function isNavigableLink(url) {
  return !linkRejectReason(url)
}

// ===== 路径自动纠错 =====
// 管理员不该被要求记住「分包前缀 + 不带 .html + 开头要有斜杠」这些规则。
// 保存前先跑一遍归一化，把最常见的几种写错自动修掉，修不动才报错。
//
// 覆盖的四种错法（都是实际踩过的）：
//   1. 整条站点网址      https://payun01.cn/pkg-feature/pages/activity/index  → 只留路径
//   2. 缺开头的斜杠      pkg-feature/pages/activity/index                    → 补 /
//   3. 带了文件后缀      /pkg-feature/pages/activity/index.html              → 去掉 .html
//   4. 主包前缀写错      /pages/activity/index（其实在 pkg-feature 分包）     → 补分包前缀
//
// 返回 { value, changed, notes }：notes 是给管理员看的「改了什么」，
// 后台据此提示「已自动修正为 …」，而不是默默改掉。
const BARE_INNER_RE = /^(?:pages|pkg-[A-Za-z0-9_-]+)\//
const PAGE_FILE_EXT_STRIP_RE = /\.(?:html?|wxml|wxss|js|json|php|aspx?|jsp)(?=\?|#|$)/i

// 主包前缀写错、但页面其实在某个分包里 → 补上分包前缀。
//
// ⚠ 不能靠「拼 /pkg-xxx + 原路径」猜：各分包的内层结构并不一致 ——
//   pkg-feature 是 `/pkg-feature/pages/activity/index`（带 pages/）
//   pkg-schedule 是 `/pkg-schedule/schedule-home/index`（不带 pages/）
//   pkg-user    是 `/pkg-user/pages/settings/index`（带 pages/）
// 所以改为「按清单建尾巴索引」：把每个分包页去掉 root 后的尾巴记下来，
// 输入命中尾巴就还原成完整路径。只在唯一匹配时才改，避免歧义。
function buildSubpackageTailIndex() {
  const buckets = {}
  PAGES.forEach((p) => {
    const m = p.path.match(/^\/pkg-[A-Za-z0-9_-]+\/(.+)$/)
    if (!m) return
    const tail = '/' + m[1]
    const keys = [tail]
    // 再登记一个「/pages/ + 尾巴」的写法：管理员常按主包习惯写成 /pages/xxx
    if (tail.indexOf('/pages/') !== 0) keys.push('/pages' + tail)
    keys.forEach((k) => {
      if (!buckets[k]) buckets[k] = []
      buckets[k].push(p.path)
    })
  })
  // 只保留唯一命中的（两个分包有同名尾巴时不猜，交给校验去报错）
  const index = {}
  Object.keys(buckets).forEach((k) => {
    if (buckets[k].length === 1) index[k] = buckets[k][0]
  })
  return index
}

const SUBPACKAGE_TAIL_INDEX = buildSubpackageTailIndex()

function fixSubpackagePrefix(value) {
  const bare = pathOf(value)
  if (PAGE_PATH_SET[bare]) return value
  const hit = SUBPACKAGE_TAIL_INDEX[bare]
  if (!hit) return value
  return hit + value.slice(bare.length)
}

function normalizePagePath(url) {
  const raw = String(url === undefined || url === null ? '' : url).trim()
  if (!raw) return { value: '', changed: false, notes: [] }
  let v = raw
  const notes = []

  // 1) 整条本站网址 → 只留路径（管理员常从后台/浏览器地址栏整条复制）
  //
  // ⚠ 只有「去掉域名后确实是个小程序页面路径」才改写。
  // 否则会把运营有意配的**本站外链**改坏：
  // `https://payun01.cn/xxx.html`（本意是走 webview 打开这个网页）
  // 会被改成 `/xxx.html` —— 变成一个不存在的站内路径，再被校验拦下，
  // 表现成「明明是合法外链却保存不了」。（2026-10-08 冒烟测试实测抓到）
  const host = v.match(/^https?:\/\/(?:www\.)?payun01\.cn(\/.*)?$/i)
  if (host) {
    const rest = host[1] || ''
    if (INNER_PATH_RE.test(rest)) {
      v = rest
      notes.push('已去掉站点域名')
    }
  }

  // 2) 缺开头的斜杠
  if (v && v.charAt(0) !== '/' && BARE_INNER_RE.test(v)) {
    v = '/' + v
    notes.push('已补上开头的 /')
  }

  // 3) 页面路径不带文件后缀（补完斜杠再判，否则 INNER_PATH_RE 匹配不上）
  if (INNER_PATH_RE.test(v) && PAGE_FILE_EXT_STRIP_RE.test(pathOf(v))) {
    v = v.replace(PAGE_FILE_EXT_STRIP_RE, '')
    notes.push('已去掉文件后缀')
  }

  // 4) 主包前缀写错但页面在分包里
  const fixed = fixSubpackagePrefix(v)
  if (fixed !== v) {
    v = fixed
    notes.push('已补上分包前缀')
  }

  return { value: v, changed: v !== raw, notes }
}

// 按路径（忽略 query）比对，避免 /pages/index/index?from=1 被漏判成非 tabBar
function isTabBarPage(url) {
  return TAB_BAR_PAGES.indexOf(pathOf(url)) > -1
}

// 站内跳转。返回 true 表示已接管，false 表示不是站内路径（交给调用方兜底，例如复制到剪贴板）。
// tabBar 页面走 switchTab 且必须剥掉 query —— switchTab 不接受参数，带了会直接失败。
function openPath(url, options) {
  const target = normalize(url)
  if (!target) return false
  const opts = options || {}
  if (isTabBarPage(target)) {
    wx.switchTab({ url: pathOf(target), fail: opts.fail })
    return true
  }
  if (isInnerPath(target)) {
    wx.navigateTo({ url: target, fail: opts.fail })
    return true
  }
  return false
}

module.exports = {
  TAB_BAR_PAGES,
  LINK_FORMAT_TIP,
  WX_CHAT_SHORT_LINK_TIP,
  PAGE_FILE_EXT_TIP,
  isInnerPath,
  isWebUrl,
  isNavigableLink,
  linkRejectReason,
  normalizePagePath,
  isTabBarPage,
  pathOf,
  openPath
}
