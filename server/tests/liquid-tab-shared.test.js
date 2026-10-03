// 液态标签指示条（elastic tab indicator）接入护栏。
// 与 card-fx-shared.test.js 同款源码断言思路：漏接不报错、只是静默没效果。
// 设计文档：docs/2026-09-30_液态标签指示条.md
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const app = strip(read('app.wxss'))
const engine = strip(read('utils/liquid-tab.js'))

// ===== 共享层（app.wxss）=====

// 需求红线：指示条只用 left/width，禁止 transform（scaleX 拉伸会变形圆角）
const indicatorRules = app.match(/\.liquid-indicator[^{]*\{[^}]*\}/g) || []
assert.ok(indicatorRules.length >= 3, '缺 .liquid-indicator / --rush / --chase 相位样式')
indicatorRules.forEach((rule) => {
  assert.ok(!/transform\s*:/.test(rule), '指示条样式禁止 transform（scaleX 拉伸会变形圆角，需求红线）: ' + rule.slice(0, 60))
})

// 相位一：前沿冲刺必须是强 ease-out 贝塞尔；相位二：弹性贝塞尔 y1 > 1（末端超调）
assert.ok(/\.liquid-indicator--rush\s*\{[^}]*left\s+0\.1s\s+cubic-bezier\(([^)]*)\)/.test(app),
  'rush 相位必须用 0.1s（≈6 帧）贝塞尔过渡 left')
assert.ok(/\.liquid-indicator--chase\s*\{[^}]*left\s+0\.3s\s+cubic-bezier\(([^)]*)\)/.test(app),
  'chase 相位必须用 0.3s 贝塞尔过渡 left')
const chase = app.match(/\.liquid-indicator--chase\s*\{[^}]*cubic-bezier\(([^)]*)\)/)
const pts = chase[1].split(',').map(Number)
assert.ok(pts.length === 4 && pts[1] > 1 && pts[1] <= 1.45,
  'chase 弹性曲线 y1 应在 (1, 1.45]：≤1 没有末端超调，过大弹跳过头')

// 减弱动效兜底
assert.ok(/prefers-reduced-motion[^{]*\{[\s\S]*liquid-indicator--rush,\s*\n\s*\.liquid-indicator--chase\s*\{[^}]*transition:\s*none/.test(app) ||
  /prefers-reduced-motion[^{]*\{[\s\S]*liquid-indicator--rush,\s*\.liquid-indicator--chase\s*\{[^}]*transition:\s*none/.test(app),
  '缺 prefers-reduced-motion 下停指示条过渡的兜底')

// ===== 驱动器（utils/liquid-tab.js）=====

assert.ok(/module\.exports\s*=\s*\{\s*create:/.test(engine), '驱动器必须导出 create')
assert.ok(/PHASE1_MS\s*=\s*100/.test(engine), 'PHASE1_MS 必须是 100ms（≈6 帧，后沿延迟时长）')
// 相位推进用一次性定时器（每 2 次 setData），禁止逐帧 rAF/setInterval 驱动（setData 过桥开销大）
assert.ok(/setTimeout\(/.test(engine), '相位推进必须用 setTimeout')
assert.ok(!/requestAnimationFrame|setInterval/.test(engine),
  '禁止逐帧驱动（requestAnimationFrame/setInterval + setData 过桥撑不住 60fps）')

// ===== 接入清单 =====

const SURFACES = [
  { file: 'pages/errand-order/index', track: '.top-tabs', items: '.top-tab', removed: '.top-tab.active::after' },
  { file: 'pages/profile/index', track: '.profile-tabbar', items: '.profile-tab', removed: '.profile-tab.active::after' },
  { file: 'pages/my-messages/index', track: '.tabs', items: '.tab', removed: 'border-bottom: 4rpx solid #4A7AFF' },
  // 横滚栏：指示条随滚动内容移动，scroll-left 联动见页面 syncCategoryScroll
  { file: 'pages/index/index', track: '.category-list', items: '.category-item', removed: '.category-item.active::after' }
]

SURFACES.forEach((s) => {
  const wxml = read(s.file + '.wxml')
  // 注释不参与断言：wxss 里解释"为什么移除旧指示条"的散文会被整文件扫描误判
  const wxss = strip(read(s.file + '.wxss'))
  const js = read(s.file + '.js')
  const label = s.file

  assert.ok(/liquid-tab-track/.test(wxml), label + ' track 容器缺 .liquid-tab-track（绝对定位基准）')
  assert.ok(wxml.indexOf('liquid-indicator {{liquidPhase}}') > -1, label + ' 缺指示条节点')
  assert.ok(js.indexOf('liquid-tab') > -1, label + ' 未引入 utils/liquid-tab')
  assert.ok(/liquidTab\.create\(/.test(js), label + ' 缺 liquidTab.create(...) 驱动器实例化')
  assert.ok(/\.moveTo\(/.test(js), label + ' tab 切换未调用 moveTo（液态动画不生效）')
  assert.ok(/\.destroy\(\)/.test(js) || /onUnload/.test(js) === false, label + ' 建议在 onUnload 调用 destroy 清理定时器')
  assert.ok(wxss.indexOf(s.removed) === -1,
    label + ' 旧静态指示条（' + s.removed + '）未移除，会与液态指示条双重显示')
})

console.log('liquid-tab shared layer test passed. (' + SURFACES.length + ' tab bar(s))')