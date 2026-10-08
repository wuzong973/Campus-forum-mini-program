/**
 * WXML 内联样式的开发者工具 lint 护栏（无需真机）
 *
 * 背景（2026-10-07 实测）：`pages/post-detail/index.wxml` 的投票进度条
 *   style="width: {{option._pct}}%"
 * 在「问题」面板报 `semi-colon expected css(css-semicolonexpected)`，
 * 而同一文件里 `bottom: {{keyboardHeight}}px;` 不报 —— 触发点是
 * **mustache 收尾的 `}}` 紧跟百分号**，不是 px/vh 这类单位。
 *
 * 为什么值得锁：
 *   · 运行时其实正常（进度条照填），所以没人会去修 —— 但「问题」面板长红，
 *     真正的新问题会被它淹掉；
 *   · 开发者工具只 lint **打开过的文件**，所以同类写法会静默扩散
 *     （本次就捞到 pkg-schedule 里两处从没被打开过、一打开就会报的同款写法）。
 *
 * 正确写法：把单位挪进 mustache 里做字符串拼接 —— `{{x + '%'}}`，
 * WXML 支持该表达式，运行时结果与 `{{x}}%` 完全一致，且不需要动 JS。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const SKIP_DIR = ['node_modules', '.git', 'server', 'docs', 'jw-crawler', 'broadcast-bot',
  '.workbuddy', '.workbuddy-ai', '.claude', '.mimosa', '.video_agent', '.v2c', '.tmp_icons',
  '__pycache__', 'logs']
const NL = String.fromCharCode(10)

const wxmlFiles = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (e.name.slice(-5) === '.wxml') wxmlFiles.push(p)
  }
})(ROOT)

const offenders = []
wxmlFiles.forEach((file) => {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  fs.readFileSync(file, 'utf8').split(NL).forEach((line, i) => {
    const si = line.indexOf('style=')
    if (si < 0) return
    // 只看 style 属性内部：`}}` 之后紧跟 % 且这个 % 不在引号里（在引号里就是已挪进去的正确写法）
    const after = line.slice(line.indexOf('}}', si) + 2)
    if (after.charAt(0) === '%') offenders.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 88))
  })
})

assert.ok(wxmlFiles.length > 50, '只扫到 ' + wxmlFiles.length + ' 个 wxml，扫描范围可能错了')
assert.deepStrictEqual(offenders, [],
  'WXML 内联样式里出现 `}}` 紧跟百分号，开发者工具会报 css-semicolonexpected。' +
  '改成 {{表达式 + ' + String.fromCharCode(39) + '%' + String.fromCharCode(39) + '}}：' + String.fromCharCode(10) +
  offenders.join(String.fromCharCode(10)))

console.log('wxml style lint guard passed. (' + wxmlFiles.length + ' 个 wxml，0 处 `}}%`)')
