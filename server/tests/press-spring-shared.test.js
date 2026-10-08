// 按钮弹性按压反馈的接入护栏（与 card-fx-shared.test.js 同款源码断言思路）。
// 按压/回弹属于「漏接不报错、只是静默没手感」的接线：元素少挂 spring-btn、
// hover 类没按压样式、页面级 transition 顶掉弹性过渡，都会无声失效。
// 设计说明见 docs/02_前端与UI交互.md §六。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(p, 'utf8')

// 根目录边界校验（护栏只读项目内固定目录，防御性断言）
function safeJoin(base, rel) {
  const p = path.resolve(base, rel)
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error('path outside root: ' + rel)
  return p
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const app = strip(read(path.join(root, 'app.wxss')))

// ===== 共享层 =====

// 基础态：释放回弹的弹性贝塞尔（y1 > 1 才有超调，>1.45 回弹过猛）
const springBezier = app.match(/\.spring-btn\s*\{[^}]*cubic-bezier\(([^)]*)\)/)
assert.ok(springBezier, '.spring-btn 必须定义弹性回弹 transition')
const pts = springBezier[1].split(',').map(Number)
assert.ok(pts.length === 4 && pts[1] > 1 && pts[1] <= 1.45,
  '.spring-btn 弹性曲线 y1 应在 (1, 1.45]：≤1 没有超调回弹，过大显得弹跳')

// 按压态：物理压缩 + 深度内阴影 + 快速压缩时长
assert.ok(/\.press-spring\s*\{[^}]*transform:\s*scale\(0\.96\)/.test(app),
  '.press-spring 按压态必须 scale(0.96)')
assert.ok(/\.press-spring\s*\{[^}]*box-shadow:\s*inset/.test(app),
  '.press-spring 缺 inset 内阴影，按压没有凹陷质感')
assert.ok(/\.press-spring\s*\{[^}]*transition-duration:\s*0\.12s/.test(app),
  '.press-spring 按压应走 0.12s 快速压缩；走 0.35s 弹性时长按压会发"糯"')
assert.ok(/transition:\s*\n?\s*transform[^;]*box-shadow[^;]*;/.test(app),
  '.spring-btn transition 必须同时覆盖 transform 与 box-shadow')

// 减弱动效兜底：spring-btn / press-spring 都要停过渡
assert.ok(/prefers-reduced-motion[^{]*\{[\s\S]*\.spring-btn,\s*\.press-spring\s*\{[^}]*transition:\s*none/.test(app),
  '缺 prefers-reduced-motion 下停按压过渡的兜底')

// 交错进场必须用 backwards：both 会把末帧 transform 永久钉在元素上，
// keyframes 的 transform 压过 transition，交错项同时可按压时 scale 永远不生效
assert.ok(/\.anim-stagger\s*\{[^}]*backwards/.test(app) && !/\.anim-stagger\s*\{[^}]*both/.test(app),
  '.anim-stagger 必须用 backwards 结尾：both 会锁死 transform，压掉按压 scale')

// ===== 全站接入扫描 =====

const DIRS = ['pages', 'pkg-feature', 'pkg-admin', 'pkg-schedule', 'components']

function walkFiles(baseRel, ext, o) {
  const base = safeJoin(root, baseRel)
  let entries
  try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch (e) { return o }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(base, e.name)
    if (e.isDirectory()) walkFiles(path.relative(root, p), ext, o)
    else if (p.endsWith(ext)) o.push(p)
  }
  return o
}

const hoverNames = new Set()
let springCount = 0
let pressCount = 0

for (const dir of DIRS) {
  for (const file of walkFiles(dir, '.wxml', [])) {
    const rel = path.relative(root, file)
    const text = read(file)
    // 标签边界尊重引号（attr 里有 {{a > b}}）
    let i = 0
    while (i < text.length) {
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i); i = e === -1 ? text.length : e + 3; continue }
      if (text[i] === '<' && /[a-zA-Z]/.test(text[i + 1] || '')) {
        let j = i + 1
        let q = null
        while (j < text.length) {
          const c = text[j]
          if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
          else if (c === '>') break
          j++
        }
        const tag = text.slice(i, j + 1)
        const name = (tag.match(/^<([a-zA-Z0-9-]+)/) || [])[1] || ''
        const interactive = ['view', 'button', 'navigator'].indexOf(name) !== -1
        if (interactive && /hover-class=/.test(tag)) {
          const m = tag.match(/hover-class="([^"]*)"/)
          const val = m ? m[1].trim() : ''
          if (val && val !== 'none') {
            const names = val.indexOf('{{') !== -1
              ? (val.match(/'([^']*)'/g) || []).map(s => s.slice(1, -1)).filter(x => x && x !== 'none' && x !== 'press-spring')
              : val.split(/\s+/).filter(x => x && x !== 'press-spring')
            names.forEach(x => hoverNames.add(x))
            if (val.indexOf('{{') === -1) {
              assert.ok(val.split(/\s+/).indexOf('press-spring') !== -1,
                rel + ' hover-class 缺 press-spring: ' + val)
              pressCount++
            }
            const classVal = (tag.match(/\sclass="([^"]*)"/) || ['', ''])[1]
            assert.ok(/(^|\s)spring-btn(\s|"|$)/.test(classVal),
              rel + ' 交互元素 class 缺 spring-btn（释放回弹过渡挂它上面）: ' + tag.slice(0, 100))
            springCount++
            // 默认 400ms hover-stay-time 会把回弹拖住；必须显式给短值
            assert.ok(/hover-stay-time=/.test(tag), rel + ' 缺 hover-stay-time（默认 400ms 拖住回弹）: ' + tag.slice(0, 100))
          }
        }
        // 原生 button 是最典型的"按钮"，不允许完全没有按压反馈（显式 none 除外）
        if (name === 'button' && !/hover-class=/.test(tag)) {
          assert.fail(rel + ' 存在没接 hover-class 的 <button>，按压无反馈: ' + tag.slice(0, 100))
        }
        i = j + 1
        continue
      }
      i++
    }
  }
}

assert.ok(springCount > 250, 'spring-btn 接入量异常（应 280 左右，实际 ' + springCount + '）')

// 每个 hover 类都必须有按压样式定义（scale 0.96）
const cssBodies = [path.join(root, 'app.wxss')]
  .concat(...DIRS.map(d => walkFiles(d, '.wxss', [])))
  .map(f => strip(read(f)))

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
for (const name of hoverNames) {
  if (name === 'press-spring') continue
  const ok = cssBodies.some(css => {
    const re = new RegExp('\\.' + esc(name) + '(?![\\w-])[^{}]*\\{')
    const m = css.match(re)
    return m && /scale\(0\.96\)/.test(css.slice(m.index, m.index + m[0].length + 400))
  })
  assert.ok(ok, 'hover 类 .' + name + ' 的定义缺 scale(0.96) 按压样式')
}

console.log('press-spring shared layer test passed. (' +
  springCount + ' interactive tags, ' + pressCount + ' press-spring, ' + hoverNames.size + ' hover classes)')
