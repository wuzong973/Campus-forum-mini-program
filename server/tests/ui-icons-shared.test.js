/**
 * 功能图标共享层（ui-icons）静态护栏（无需数据库）
 *
 * 背景（2026-10-06）：统一替换七处功能图标并保持视觉风格一致
 *   · 个人中心页 6 处：我的帖子 / 点赞我的 / 评论我的 / 消息通知 / 个人中心 / 意见(必回)
 *   · 首页功能栏 1 处：校园市场
 *
 * 为什么必须有这层护栏：
 *   ① 小程序 <image> 不认 .svg 文件，图标只能以「内联 SVG data-uri 写进 WXSS」的形式存在。
 *      一旦有人为了"优化"把它改回 <image src="xxx.svg">，图标会在真机上整片消失，
 *      而开发者工具里因为缓存还可能是好的 —— 这种回归必须被测试挡住。
 *   ② 七枚图标必须共用一套口径（24×24 网格 / 2px 线宽 / 圆角端点 / 双色调 / 主色走 CSS 变量）。
 *      少写一个类、或把某枚图标漏在某个渲染分支外，都会造成"六个人有图标、一个没有"。
 *   ③ 后台可配置 iconPath 优先级高于内置 uiIcon：网格/横排两处都必须先判 iconPath。
 *      顺序写反了就会把后台配置的图片顶掉。
 *   ④ data-uri 里的 `#` 必须写成 %23，否则 URL 在这里就被截断（颜色丢失）。
 *   ⑤ 动效必须保留 prefers-reduced-motion 兜底，且不能与 .spring-btn 的按压缩放抢 transform。
 *
 * 做法：纯静态读文件断言，不 require 任何控制器。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/**
 * 取出某枚图标的「图形规则块」（即含 background-image 的那一块）。
 *
 * 注意：同一枚图标在共享层里有两个块 —— 先一行主色 `.ui-icon--post { --ui-icon-accent: ... }`，
 * 再下面的图形块 `.ui-icon--post { background-image: url(...) }`。
 * 所以不能简单地取「第一个同名块」，否则永远匹配到只有主色的那行（曾踩）。
 */
function iconGraphicBlock(css, name) {
  const re = new RegExp(`\\.ui-icon--${name}\\s*\\{([\\s\\S]*?)\\}`, 'g')
  let m
  while ((m = re.exec(css)) !== null) {
    if (/background-image\s*:/.test(m[1])) return m[0]
  }
  return null
}

/** 取出某枚图标的主色块（含 --ui-icon-accent 的那一块）。 */
function iconAccentBlock(css, name) {
  const re = new RegExp(`\\.ui-icon--${name}\\s*\\{([\\s\\S]*?)\\}`, 'g')
  let m
  while ((m = re.exec(css)) !== null) {
    if (/--ui-icon-accent\s*:/.test(m[1])) return m[0]
  }
  return null
}

/**
 * 取出 CSS 里全部内联 SVG data-uri（**到 url(...) 的右括号为止**）。
 *
 * ⚠ 千万不要写成 /data:image\/svg\+xml,[^"']*​/ —— SVG 内部必然含单引号
 * （`viewBox='0 0 24 24'`），[^"']* 会在第一个单引号处截断，只取到 32 字符的
 * `data:image/svg+xml,%3Csvg xmlns=`，导致后续断言全部作用在空片段上 = 空判据
 * 假绿灯（2026-10-06 发现：B4 自建立起就因此失效）。
 * 正确做法：以 `url("` / `url('` 起始锚定，一路取到下一个配对引号或 `)`。
 */
function iconDataUris(css = ICONS_WXSS) {
  const out = []
  const re = /url\(\s*(["'])(data:image\/svg\+xml,[\s\S]*?)\1\s*\)/g
  let m
  while ((m = re.exec(css)) !== null) out.push(m[2])
  return out
}

/**
 * 在 css 中找出「选择器匹配 selRe 且规则体里含关键字 kw」的那一块。
 *
 * 为什么需要它：同一条悬停链路上有多个规则块（底座阴影 / filter 阴影 / 本体放大），
 * 其中 filter 那一块也写了 transform: scale(0.96)，直接取第一个匹配会误判（曾踩）。
 */
function blockContaining(css, selRe, kw) {
  const re = new RegExp(`${selRe.source}\\{[\\s\\S]*?\\}`, 'g')
  let m
  while ((m = re.exec(css)) !== null) {
    if (kw.test(m[0])) return m[0]
  }
  return null
}

const ICONS_WXSS = read('styles/ui-icons.wxss')
const APP_WXSS = read('app.wxss')
const USER_JS = read('pages/user/index.js')
const USER_WXML = read('pages/user/index.wxml')
const USER_WXSS = read('pages/user/index.wxss')
const INDEX_JS = read('pages/index/index.js')
const GRID_WXML = read('components/service-grid/service-grid.wxml')
const GRID_WXSS = read('components/service-grid/service-grid.wxss')

// 七枚图标：类名后缀 → 语义（同时是个人中心页 / 首页里出现的名字）
const ICONS = ['post', 'like', 'comment', 'notice', 'profile', 'feedback', 'market']

// 个人中心页六处：类名 → 条目名（顺序即页面顺序）
const USER_ICON_NAMES = {
  post: '我的帖子',
  like: '点赞我的',
  comment: '评论我的',
  notice: '消息通知',
  profile: '个人中心',
  feedback: '意见(必回)'
}

// ===== A. 共享层文件存在且接入 app.wxss =====
console.log('\n[A] 共享层文件与引入')

check(() => {
  assert.ok(fs.existsSync(path.join(ROOT, 'styles/ui-icons.wxss')), 'styles/ui-icons.wxss 不存在')
}, 'A1 styles/ui-icons.wxss 必须存在')

check(() => {
  // 允许单/双引号，只要指向同一个文件
  assert.ok(
    /@import\s+["']styles\/ui-icons\.wxss["']\s*;/.test(APP_WXSS),
    'app.wxss 未通过 @import 引入 styles/ui-icons.wxss'
  )
}, 'A2 app.wxss 必须 @import styles/ui-icons.wxss')

check(() => {
  const idxIconFont = APP_WXSS.indexOf('styles/iconfont.wxss')
  const idxUiIcons = APP_WXSS.indexOf('styles/ui-icons.wxss')
  assert.ok(idxIconFont >= 0 && idxUiIcons >= 0, 'app.wxss 缺少 @import')
  assert.ok(idxUiIcons > idxIconFont, 'ui-icons.wxss 应排在 iconfont.wxss 之后（后者是基础层）')
}, 'A3 ui-icons.wxss 应位于 @import 顶部区域且排在 iconfont 之后')

// ===== B. 七枚图标类与统一口径 =====
console.log('\n[B] 七枚图标类与统一风格口径')

check(() => {
  ICONS.forEach((name) => {
    assert.ok(
      new RegExp(`\\.ui-icon--${name}\\s*\\{`).test(ICONS_WXSS),
      `styles/ui-icons.wxss 缺少 .ui-icon--${name} 规则`
    )
  })
}, 'B1 七枚 .ui-icon--* 类必须全部定义')

check(() => {
  // 基础类必须给出默认主色变量 + 尺寸 + 不参与 flex 收缩
  const base = ICONS_WXSS.match(/\.ui-icon\s*\{[\s\S]*?\}/)
  assert.ok(base, '缺少 .ui-icon 基础类')
  const body = base[0]
  assert.ok(/--ui-icon-accent\s*:/.test(body), '.ui-icon 未定义 --ui-icon-accent')
  assert.ok(/--ui-icon-base\s*:/.test(body), '.ui-icon 未定义 --ui-icon-base')
  assert.ok(/width\s*:\s*\d+rpx/.test(body), '.ui-icon 未使用 rpx 设定宽度')
  assert.ok(/height\s*:\s*\d+rpx/.test(body), '.ui-icon 未使用 rpx 设定高度')
  assert.ok(/background-size\s*:\s*contain/.test(body), '.ui-icon 必须 background-size: contain 才能换尺寸不裁切')
  assert.ok(/background-repeat\s*:\s*no-repeat/.test(body), '.ui-icon 必须 no-repeat')
  assert.ok(/flex-shrink\s*:\s*0/.test(body), '.ui-icon 必须 flex-shrink: 0（宫格里被挤扁会变形）')
}, 'B2 .ui-icon 基础类必须含主色变量 / rpx 尺寸 / contain / no-repeat / flex-shrink:0')

check(() => {
  ICONS.forEach((name) => {
    const block = iconGraphicBlock(ICONS_WXSS, name)
    assert.ok(
      block && /background-image\s*:\s*url\(["']?data:image\/svg\+xml,/.test(block),
      `.ui-icon--${name} 必须用内联 SVG data-uri（小程序 <image> 不支持 .svg 文件）`
    )
    // viewBox 统一 24×24
    assert.ok(/viewBox='0 0 24 24'|viewBox="0 0 24 24"/.test(block), `.ui-icon--${name} viewBox 必须是 0 0 24 24`)
  })
}, 'B3 七枚图标必须都是 24×24 的内联 SVG data-uri')

check(() => {
  // data-uri 里的 # 必须编码成 %23，否则 URL 在此截断
  const rawHex = iconDataUris()
  assert.ok(rawHex.length >= 7, `data-uri 数量异常：${rawHex.length}`)
  rawHex.forEach((uri) => {
    assert.ok(!/#/.test(uri), 'data-uri 里出现了未编码的 #，必须写成 %23')
  })
  assert.ok(/%23/.test(ICONS_WXSS), 'data-uri 里应当使用 %23 表示颜色')
}, 'B4 data-uri 中 # 必须编码为 %23')

check(() => {
  // ⚠ 2026-10-06 实机踩坑：微信小程序 WXSS 的 background-image 对内联 SVG 解析
  // 不如浏览器宽容 —— 数据里一旦出现 <g> 或 transform=，整张图会「静默渲染失败」
  // （格子里空白、控制台无任何报错），极易被误判成「图标没配 / 数据没下发」。
  // 本项目所有可正常工作的内联 SVG 先例（post-card 星标 / post-detail 点赞）
  // 一律是 `<svg>` 直接包 `<path>` 的扁平结构，从无 <g> / transform。
  // 需要缩放坐标系时，必须把坐标真正算好，而不是套一层 transform。
  const uris = iconDataUris()
  assert.ok(uris.length >= 7, `data-uri 数量异常：${uris.length}`)
  uris.forEach((uri, i) => {
    const decoded = decodeURIComponent(uri.slice('data:image/svg+xml,'.length))
    assert.ok(
      !/<g[\s>]/.test(decoded) && !/<\/g>/.test(decoded),
      `第 ${i + 1} 个 data-uri 含 <g> 标签 —— 微信会静默不渲染，请把坐标算好改成扁平结构`
    )
    assert.ok(
      !/transform\s*=/.test(decoded),
      `第 ${i + 1} 个 data-uri 含 transform 属性 —— 微信会静默不渲染，请把坐标算好改成扁平结构`
    )
  })
}, 'B4b 内联 SVG 必须是扁平结构（禁用 <g> / transform，微信会静默不渲染）')

check(() => {
  // 每枚图标都要用 CSS 变量取主色，才能做到"同一份图形换色复用"
  ICONS.forEach((name) => {
    const block = iconAccentBlock(ICONS_WXSS, name)
    assert.ok(block, `.ui-icon--${name} 缺少主色块`)
    assert.ok(/--ui-icon-accent\s*:\s*#[0-9a-fA-F]{3,8}/.test(block), `.ui-icon--${name} 必须设定自己的 --ui-icon-accent`)
  })
}, 'B5 七枚图标必须各自设定一条主色（保持页面原有色彩语义）')

// ===== C. 个人中心页六处接线 =====
console.log('\n[C] 个人中心页六处接线')

check(() => {
  Object.entries(USER_ICON_NAMES).forEach(([icon, label]) => {
    // 同一行里同时出现 uiIcon: 'x' 与 name: '名称'
    const line = USER_JS.split(/\r?\n/).find((l) => l.includes(`uiIcon: '${icon}'`))
    assert.ok(line, `pages/user/index.js 没有 uiIcon: '${icon}' 的条目`)
    assert.ok(line.includes(`name: '${label}'`), `uiIcon: '${icon}' 应与 name: '${label}' 同行`)
  })
}, 'C1 六处条目必须改用 uiIcon 且与条目名一一对应')

check(() => {
  // uiLive 必须显式给出（true/false），不允许靠 undefined 蒙
  const userIconLines = USER_JS.split(/\r?\n/).filter((l) => /uiIcon: '(post|like|comment|notice|profile|feedback)'/.test(l))
  assert.strictEqual(userIconLines.length, 6, `个人中心页应恰好 6 条 uiIcon 条目，实际 ${userIconLines.length}`)
  userIconLines.forEach((l) => {
    assert.ok(/uiLive:\s*(true|false)/.test(l), `uiLive 未显式声明：${l.trim()}`)
  })
}, 'C2 每条 uiIcon 条目必须显式声明 uiLive (true|false)')

check(() => {
  // 同一屏 4 列宫格里不应有多个常驻动画同时跑（会显得零乱）
  const liveOn = USER_JS.split(/\r?\n/).filter((l) => /uiLive:\s*true/.test(l))
  assert.ok(liveOn.length <= 3, `个人中心页常驻动画条目 ${liveOn.length} 个，超过 3 个会显得零乱`)
}, 'C3 个人中心页常驻动画条目不得超过 3 个')

check(() => {
  // WXML 必须是三态：uiIcon → fontIcon → <image>，且 uiIcon 分支在最前
  assert.ok(/wx:if="\{\{feature\.uiIcon\}\}"/.test(USER_WXML), 'WXML 缺少 feature.uiIcon 首态判断')
  assert.ok(/wx:elif="\{\{feature\.fontIcon\}\}"/.test(USER_WXML), 'WXML 缺少 feature.fontIcon 兜底分支')
  const idxUiIcon = USER_WXML.indexOf('{{feature.uiIcon}}')
  const idxFontIcon = USER_WXML.indexOf('{{feature.fontIcon}}')
  const idxImage = USER_WXML.indexOf('feature.icon')
  assert.ok(idxUiIcon >= 0 && idxFontIcon >= idxImage || idxImage < 0 || idxUiIcon < idxFontIcon, 'uiIcon 分支必须排在 fontIcon 之前')
}, 'C4 个人中心页 WXML 必须按 uiIcon → fontIcon → image 三态渲染')

check(() => {
  // 图标类拼接 + 动效开关必须同时出现在 class 上
  assert.ok(
    /class="ui-icon ui-icon--\{\{feature\.uiIcon\}\}[^"]*ui-icon--live/.test(USER_WXML) ||
      /ui-icon--\{\{feature\.uiIcon\}\}\s*\{\{feature\.uiLive/.test(USER_WXML),
    'WXML 未按 feature.uiIcon / feature.uiLive 拼 class'
  )
}, 'C5 WXML class 必须用插值拼 ui-icon--{{feature.uiIcon}} 与 uiLive 开关')

check(() => {
  // 宫格里的图标尺寸必须在页面 WXSS 里被显式放大，否则只有 44rpx 显得过小
  assert.ok(
    /\.feature-icon-wrap\s+\.ui-icon\s*\{[\s\S]*?width\s*:\s*\d+rpx/.test(USER_WXSS),
    'pages/user/index.wxss 未为 .feature-icon-wrap .ui-icon 设定尺寸'
  )
}, 'C6 个人中心页必须为宫格图标设定适配尺寸')

// ===== D. 首页「校园市场」接线 =====
console.log('\n[D] 首页功能栏「校园市场」接线')

check(() => {
  // 注意：文件里第一次出现「校园市场」是注释行，必须取真正定义条目的那一行
  const line = INDEX_JS.split(/\r?\n/).find((l) => /name:\s*'校园市场'/.test(l))
  assert.ok(line, 'pages/index/index.js 找不到 name: \'校园市场\' 条目')
  assert.ok(/uiIcon:\s*'market'/.test(line), `「校园市场」必须改用 uiIcon: 'market'，实际：${line.trim()}`)
}, 'D1 首页 row2 的「校园市场」必须改用 uiIcon')

check(() => {
  // 后台可配置 iconPath 优先级高于内置 uiIcon：服务端分支（bottom.iconPath = ...）与
  // 默认分支（内联对象字面量）两处都必须写成 `iconPath ? '' : (def.uiIcon || '')`。
  // 只看同时含 uiIcon 与 iconPath 的行，避免把 `bottom.iconPath = ...` 那行算进来。
  const guards = INDEX_JS.split(/\r?\n/).filter((l) => /uiIcon\s*[:=]/.test(l) && /iconPath/.test(l))
  assert.ok(guards.length >= 2, `应有 ≥2 处「iconPath 优先于 uiIcon」的判定，实际 ${guards.length}`)
  guards.forEach((g) => {
    assert.ok(
      /iconPath\s*\?\s*''\s*:/.test(g),
      `iconPath 优先判定必须是 \`iconPath ? '' : (def.uiIcon || '')\`，实际：${g.trim()}`
    )
    assert.ok(/uiIcon/.test(g), `判定行未涉及 uiIcon：${g.trim()}`)
  })
}, 'D2 服务端下发的 iconPath 必须优先于内置 uiIcon（网格 + 横排两处）')

check(() => {
  assert.ok(/wx:if="\{\{item\.iconPath\}\}"/.test(GRID_WXML), 'service-grid 缺少 iconPath 首态')
  const idxPath = GRID_WXML.indexOf('{{item.iconPath}}')
  const idxUi = GRID_WXML.indexOf('{{item.uiIcon}}')
  assert.ok(idxPath >= 0 && idxUi >= 0, 'service-grid 三态不全')
  assert.ok(idxPath < idxUi, 'service-grid 必须先判 iconPath 再判 uiIcon')
}, 'D3 service-grid WXML 必须先判 iconPath 再判 uiIcon')

check(() => {
  // 滚动条与宫格两条渲染分支都要覆盖到（两处 wx:elif 已在上方 grep 中确认为 2 处）
  const hits = GRID_WXML.match(/ui-icon--\{\{item\.uiIcon\}\}/g) || []
  assert.ok(hits.length >= 2, `service-grid 两条渲染分支都应渲染 uiIcon，实际 ${hits.length} 处`)
}, 'D4 service-grid 的两条渲染分支都必须渲染 uiIcon')

check(() => {
  assert.ok(
    /\.icon-wrap\s+\.ui-icon\s*\{[\s\S]*?width\s*:\s*\d+rpx/.test(GRID_WXSS),
    'components/service-grid/service-grid.wxss 未为 .icon-wrap .ui-icon 设定尺寸'
  )
}, 'D5 service-grid 必须为图标设定适配尺寸')

check(() => {
  // 只断言「有尺寸」挡不住这次的 bug：尺寸在组件自己的 wxss 里，
  // 而 background-image 在 app.wxss 引入的共享层里 —— 组件样式隔离让它进不来。
  // @import 不会被本套护栏的其它正则解析，所以必须显式锁这一条。
  assert.ok(
    /@import\s+["'][.\/]*styles\/ui-icons\.wxss["']\s*;/.test(GRID_WXSS),
    'components/service-grid/service-grid.wxss 必须自己 @import styles/ui-icons.wxss —— ' +
    'app.wxss 的类选择器进不了自定义组件，宫格图标会整格空白'
  )
  const importAt = GRID_WXSS.indexOf('@import')
  const firstRuleAt = GRID_WXSS.indexOf('.service-grid {')
  assert.ok(importAt >= 0 && firstRuleAt > importAt, '@import 必须写在其它规则之前，否则不生效')
}, 'D6 service-grid 必须自带 ui-icons 共享层（组件样式隔离）')

// ===== E. 动态交互效果 =====
console.log('\n[E] 动态交互效果')

check(() => {
  // 至少四枚图标带常驻微动效
  const lives = ICONS_WXSS.match(/\.ui-icon--[a-z]+\.ui-icon--live/g) || []
  assert.ok(lives.length >= 4, `常驻微动效图标数 ${lives.length}，应 ≥4`)
}, 'E1 至少 4 枚图标必须有常驻微动效')

check(() => {
  const kf = ICONS_WXSS.match(/@keyframes\s+ui-[a-z-]+/g) || []
  assert.ok(kf.length >= 4, `@keyframes 数量 ${kf.length}，应 ≥4`)
  ;['ui-bell-swing', 'ui-heart-beat', 'ui-mail-nudge', 'ui-market-bob'].forEach((k) => {
    assert.ok(ICONS_WXSS.includes(`@keyframes ${k}`), `缺少 @keyframes ${k}`)
  })
}, 'E2 四组 ui-* 关键帧必须齐备')

check(() => {
  // 铃铛摇动用 transform-origin 指定轴心，否则会整体平移
  assert.ok(/transform-origin\s*:\s*50%\s+12%/.test(ICONS_WXSS), '铃铛摇动必须指定 transform-origin（否则不像摇铃）')
}, 'E3 铃铛动效必须指定旋转轴心')

check(() => {
  assert.ok(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation\s*:\s*none/.test(ICONS_WXSS),
    '缺少 prefers-reduced-motion 兜底'
  )
}, 'E4 必须提供 prefers-reduced-motion 降级')

check(() => {
  // 悬停弹一下：个人中心页与首页两处都要有 ui-icon-pop
  assert.ok(/@keyframes\s+ui-icon-pop/.test(USER_WXSS), 'pages/user/index.wxss 缺少 ui-icon-pop')
  assert.ok(/@keyframes\s+ui-icon-pop/.test(GRID_WXSS), 'service-grid.wxss 缺少 ui-icon-pop')
}, 'E5 两处宫格都必须有悬停弹出动效')

check(() => {
  // 悬停动效必须是 animation，不能写成 transform —— 否则会被 press-spring 的 scale(0.96) 顶掉。
  // 注意：两个文件的 hover 段落里有多块同名选择器，其中 filter 阴影块也写了 transform，
  // 必须精确取「规则体里含 animation」的那一块，不能取第一个匹配（曾踩）。
  const userHover = blockContaining(USER_WXSS, /\.fx-hover[^{}]*\.ui-icon\s*/, /animation\s*:/)
  const gridHover = blockContaining(GRID_WXSS, /\.service-item--hover[^{}]*\.ui-icon\s*/, /animation\s*:/)
  assert.ok(userHover, 'pages/user/index.wxss 未找到含 animation 的 `.fx-hover ... .ui-icon {}` 悬停规则')
  assert.ok(gridHover, 'service-grid.wxss 未找到含 animation 的 `.service-item--hover ... .ui-icon {}` 悬停规则')
  assert.ok(/animation\s*:\s*ui-icon-pop/.test(userHover), 'personal 悬停必须用 ui-icon-pop 动画')
  assert.ok(/animation\s*:\s*ui-icon-pop/.test(gridHover), 'home 悬停必须用 ui-icon-pop 动画')
}, 'E6 悬停弹出必须用 animation 而非 transform')

check(() => {
  // 两处的 :hover 规则都要把 ui-icon 一起带上（.fx-hover / .service-item--hover 选择器里出现 .ui-icon）
  assert.ok(/\.fx-hover[^{]*\.ui-icon/.test(USER_WXSS), 'personal hover 选择器未覆盖 .ui-icon')
  assert.ok(/\.service-item--hover[^{]*\.ui-icon/.test(GRID_WXSS), 'home hover 选择器未覆盖 .ui-icon')
}, 'E7 悬停选择器必须覆盖 .ui-icon')

// ===== F. 不得回退成 <image src="*.svg"> =====
console.log('\n[F] 防回退')

check(() => {
  const allMini = [USER_WXML, GRID_WXML]
  allMini.forEach((src, i) => {
    const bad = src.match(/(src|iconPath)="[^"]*\.svg"/g)
    assert.ok(!bad, `第 ${i + 1} 个 WXML 里出现了 .svg 引用 —— 小程序真机不显示，必须改成 ui-icon 类`)
  })
}, 'F1 WXML 不得引用 .svg 文件')

check(() => {
  // 七枚图标的类名不得在共享层之外被重复定义（避免样式分叉）
  const others = [USER_WXSS, GRID_WXSS]
  others.forEach((src, i) => {
    ICONS.forEach((name) => {
      assert.ok(
        !new RegExp(`\\.ui-icon--${name}\\s*\\{`).test(src),
        `第 ${i + 1} 个页面 WXSS 重复定义了 .ui-icon--${name}，应只在共享层定义`
      )
    })
  })
}, 'F2 .ui-icon--* 图形规则只允许在共享层定义')

console.log(`\nui-icons-shared.test.js OK — ${testCount} 项断言全部通过\n`)
