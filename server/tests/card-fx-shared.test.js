// 卡片动效共享层（styles/card-fx.wxss）的接入护栏。
//
// 为什么用源码断言而不是行为测试：描边和背光属于「漏接不报错、只是静默没效果」的接线 ——
// 页面少写一层 view、忘了 @import、或把背光放进 overflow:hidden 的容器里，
// 效果就整块消失且控制台一片安静。这与 home-banner-press.test.js 锁的是同一类问题。
//
// 铺开每一波时，往下方 SURFACES 增加对应条目即可。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
// 注释不参与断言：解释「为什么不用 blur」的散文会被整文件扫描误判成违规
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const fx = strip(read('styles/card-fx.wxss'))

// ===== 共享层自身 =====

assert.ok(/\.fx-ring\s*\{[^}]*overflow:\s*hidden/.test(fx), '描边环必须自带 overflow:hidden：3D 变换后的父级不保证按圆角裁切动画后代')
assert.ok(/\.fx-ring-spin\s*\{[^}]*background:\s*linear-gradient[^;]*;[^}]*background:\s*conic-gradient/.test(fx),
  'conic-gradient 必须写在 linear-gradient 兜底之后，顺序反了老内核就整圈无边框')
assert.ok(/\.fx-ring-spin\s*\{[^}]*padding-bottom:\s*\d+%/.test(fx),
  '描边方块边长要用百分比 padding 推导；写死 rpx 换一张比例不同的卡就会在角上露缺口')
assert.ok(/@keyframes\s+fx-spin/.test(fx) && /@keyframes\s+fx-breathe/.test(fx), '缺自转或呼吸关键帧')
assert.ok(/\.fx-off[^{]*\{[^}]*animation:\s*none/.test(fx),
  '降级只停动画、不撤效果：静态描边与静态背光必须保留')
assert.ok(/prefers-reduced-motion/.test(fx), '缺 OS 级减弱动效兜底')
assert.ok(!/(^|[^-])filter:\s*blur/.test(fx),
  '共享层禁止实时 blur：它会被每一个接入页面继承，一处 blur 等于全站掉帧')

// token 默认值必须是自定义属性声明（靠继承下发），不能只写在 var(--x, 4rpx) 的回退里：
// 长度单位的回退在本项目没有已上线先例，颜色才有
assert.ok(/--fx-w:\s*\d+rpx/.test(fx) && /--fx-r:\s*\d+rpx/.test(fx),
  'token 默认值要写成 --fx-* 声明，不要依赖 var() 的长度回退')

// ===== 接入清单 =====
// glow: 该面有弥散背光（背光必须在卡片外面，见设计文档 §2.5）
// live: 该面开无限自转。只有单实例主卡能开；列表项一律 false（§2.7）
// entry: 列表项开「进场转一圈」。静态 conic 在扁宽卡上上下两条长边各自几乎是纯色，
//        看不出是渐变扫光，所以列表项必须至少给一次运动，见 §2.7
// noLive: 该文件内不得出现任何 is-live —— 只在整页都是列表项时使用
const SURFACES = [
  { file: 'pages/index/index', name: '轮播卡', glow: true, live: true },
  { file: 'pkg-feature/pages/wallet/index', name: '余额卡', glow: true, live: true },
  { file: 'pkg-admin/admin/index', name: '后台 hero', glow: false, live: true },
  { file: 'pages/hot-rank/index', name: '热榜海报', glow: false, live: true },
  // promo 开无限自转、school-card 是列表项只开进场一圈，同文件所以不能用 noLive
  { file: 'pkg-feature/pages/driving-school/index', name: 'promo + 驾校卡', glow: true, live: true, entry: true },
  { file: 'pkg-feature/pages/club/index', name: '社团卡（列表）', glow: false, entry: true, noLive: true },
  { file: 'pkg-feature/pages/group-chat/index', name: '群聊卡（列表）', glow: false, entry: true, noLive: true },
  { file: 'pkg-feature/pages/activity/index', name: '活动卡（列表）', glow: false, entry: true, noLive: true },
  { file: 'pages/campus-service/index', name: '服务条目（列表）', glow: false, entry: true, noLive: true }
]

SURFACES.forEach((s) => {
  const wxml = read(s.file + '.wxml')
  const wxss = read(s.file + '.wxss')
  const label = s.file + '(' + s.name + ')'

  assert.ok(/@import\s+"[^"]*styles\/card-fx\.wxss"/.test(wxss), label + ' 没有 @import 共享层，样式整块不会生效')
  assert.ok(wxml.indexOf('fx-card') >= 0, label + ' 卡片根节点没挂 fx-card，拿不到 token 与圆角')
  assert.ok(wxml.indexOf('fx-ring-spin') >= 0, label + ' 缺少自转层 fx-ring-spin')
  assert.ok(wxml.indexOf('fx-body') >= 0, label + ' 缺少 fx-body：内容会盖住描边，等于没有描边')

  if (s.glow) {
    assert.ok(wxml.indexOf('fx-glow-layer') >= 0, label + ' 声明了背光却缺 fx-glow-layer（背光必须在卡片外面）')
    assert.ok(wxml.indexOf('fx-glow-pulse') >= 0, label + ' 背光缺内层 pulse：淡入淡出与脉动必须分在两层，否则互相覆盖')
  }
  if (s.live) {
    assert.ok(wxml.indexOf('is-live') >= 0, label + ' 声明了自转但没挂 is-live，描边不会转')
  }
  if (s.entry) {
    assert.ok(wxml.indexOf('is-entry') >= 0, label + ' 列表项缺 is-entry：静态 conic 在扁宽卡上读不出扫光效果')
    // 进场自转必须限量，否则一屏十几张同时起转，瞬时开销反超首页单卡
    assert.ok(/index\s*<\s*\d+\s*\?\s*'is-entry'/.test(wxml),
      label + ' 的 is-entry 没有按 index 限量（应写成 {{index < 6 ? \'is-entry\' : \'\'}}）')
  }
  if (s.noLive) {
    assert.ok(wxml.indexOf('is-live') < 0, label + ' 是列表页，不得挂 is-live：N 个无限自转合成层同时滚动')
  }
})

console.log('card-fx shared layer test passed. (' + SURFACES.length + ' surface(s))')
