// L1b 回归：校园地图校区范围高亮此前用 polygon.fillColor:'#315CFF14'（微信 map 不支持带 alpha 的
// 十六进制填充）导致高亮缺失。现改为「透明 polygon + 深蓝虚线 polyline 描边」，需保证：
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'campus-map', 'index.js'), 'utf8')

// 1) 不再出现带 alpha 的十六进制 fillColor（微信 map polygon.fillColor 只认 #RRGGBB）
assert.ok(!/fillColor:\s*'#?[0-9A-Fa-f]{8}'/.test(src), '不应再用 8 位十六进制 fillColor')
assert.ok(!/fillColor/.test(src), '应已移除 polygon.fillColor 用法')

// 2) 校区边界改由 polyline 绘制，颜色为合法 #RRGGBBAA
const overlay = src.slice(src.indexOf('function buildCampusOverlays'), src.indexOf('Page({'))
assert.ok(/polylines:\s*\[/.test(overlay) && /dottedLine:\s*true/.test(overlay), '应用虚线 polyline 描绘校区边界')
assert.ok(/color:\s*'#2B5FD9E6'/.test(overlay), 'polyline 颜色应为合法 8 位十六进制')

// 3) 切换校区时 overlay 生效（selectCampus 展开 buildCampusOverlays）
assert.ok(/\.\.\.buildCampusOverlays\(campus\)/.test(src), '切换校区应重建覆盖物')

console.log('Campus map boundary (L1b) test passed.')
