/**
 * 小程序「接线完整性」护栏（静态断言，无需真机 / 无需数据库）
 *
 * 背景（2026-10-07 全量体检）：
 *   本项目的评价页复刻评论区时，同一批漂移出 4 个问题（漏 `.comment-actions`、
 *   `.comment-head` 类名撞车、`catchtap` 抄成 `bindtap`、头像卡片整块缺失）。
 *   它们的共同特征是 —— **不报错、不崩溃，只表现为「点了没反应」或「行为不对」**，
 *   靠人工看代码极难发现，而当时的 100+ 个测试文件一个都没覆盖到。
 *
 * 本护栏锁住三类「静默失效」：
 *   A. 事件绑定 ↔ JS 方法存在性：wxml 绑了 `bindtap="onX"` 但页面/组件 JS 里没有 `onX`
 *      → 点击/输入/长按**无任何反应**（微信不报错）。
 *   B. 自定义组件注册完整性：wxml 用了 `<xxx-yyy>` 但页面 json 的 `usingComponents` 没注册，
 *      或注册的路径文件不存在 → 组件不渲染（`Component is not found in path` 只在开发者工具里红）。
 *   C. 跳转目标可达性：`navigateTo/switchTab/redirectTo/reLaunch` 与 `<navigator url>` 指向的
 *      页面未在 app.json 注册 → 跳转失败。
 *
 * ⚠ 断言纪律（本项目踩过的坑，务必保留）：
 *   · 取 JS 方法名时**必须容忍 `async` 前缀**（`async onSend() {`），否则大面积误报；
 *   · 剥离注释/字符串时**必须识别正则字面量** —— 否则 `/["']/` 这类正则会把后续源码整段吞掉；
 *   · 判断「wxml 用了某自定义标签」要排除内置组件（`scroll-view`/`cover-view`/`checkbox-group` …）；
 *   · 「动态拼接的跳转」（`'/x/' + id`）不能直接判失败，只能列出供人工核对。
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

/* ---------- 页面清单 ---------- */
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
const pages = []
;(app.pages || []).forEach((p) => pages.push(p))
;(app.subPackages || app.subpackages || []).forEach((sp) => {
  const root = sp.root.endsWith('/') ? sp.root : sp.root + '/'
  ;(sp.pages || []).forEach((p) => pages.push((root + p).replace(/^\/+/, '')))
})
const pageSet = new Set(pages.map((p) => '/' + p))

/* ---------- 词法剥离：注释 / 字符串 / 模板串 / 正则字面量 → 空格 ---------- */
function mask(src) {
  const out = src.split('')
  const n = src.length
  let i = 0
  let lastSig = ''
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { const s = i; while (i < n && src[i] !== '\n') i++; blank(s, i); continue }
    if (c === '/' && src[i + 1] === '*') { const s = i; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; blank(s, Math.min(i, n)); continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; const s = i; i++
      while (i < n) { if (src[i] === '\\') { i += 2; continue } if (src[i] === q) { i++; break } i++ }
      blank(s, Math.min(i, n)); lastSig = q; continue
    }
    if (c === '/' && !')]}'.includes(lastSig) && !/[\w$]/.test(lastSig)) {
      const s = i; i++
      let inClass = false
      while (i < n) {
        const ch = src[i]
        if (ch === '\\') { i += 2; continue }
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) { i++; break }
        else if (ch === '\n') break
        i++
      }
      while (i < n && /[a-z]/.test(src[i])) i++
      blank(s, i); lastSig = '/'; continue
    }
    if (!/\s/.test(c)) lastSig = c
    i++
  }
  return out.join('')
}

function balanced(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  return ''
}

function topLevelKeys(bodySrc) {
  const src = bodySrc
  const keys = []
  let depth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{' || c === '[' || c === '(') { depth++; continue }
    if (c === '}' || c === ']' || c === ')') { depth--; continue }
    if (depth !== 1) continue
    // 必须容忍 `async` 前缀：`async onSend() {` 否则被判为「方法不存在」
    const m = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?=[(:])/.exec(src.slice(i))
    if (m) {
      let j = i - 1
      while (j >= 0 && /\s/.test(src[j])) j--
      if (j < 0 || src[j] === '{' || src[j] === ',') { keys.push(m[1]); i += m[0].length - 1 }
    }
  }
  return keys
}

function collectHandlers(jsSrc) {
  const names = new Set()
  const masked = mask(jsSrc)
  const re = /(?:Page|Component|Behavior)\s*\(\s*\{/g
  let m
  while ((m = re.exec(masked))) {
    const openIdx = masked.indexOf('{', m.index + m[0].length - 1)
    const body = balanced(masked, openIdx)
    topLevelKeys(body).forEach((k) => names.add(k))
    const mi = body.search(/\bmethods\s*:/)
    if (mi >= 0) {
      const mo = body.indexOf('{', mi)
      if (mo >= 0) topLevelKeys(balanced(body, mo)).forEach((k) => names.add(k))
    }
  }
  return names
}

/* ---------- wxml 扫描 ---------- */
const BUILTIN_TAGS = new Set(['scroll-view', 'cover-view', 'cover-image', 'movable-view', 'movable-area',
  'swiper-item', 'rich-text', 'web-view', 'picker-view', 'picker-view-column', 'functional-page-navigator',
  'page-container', 'share-element', 'keyboard-accessory', 'match-media', 'page-meta', 'navigation-bar',
  'root-portal', 'open-data', 'official-account', 'ad-custom', 'live-player', 'live-pusher',
  'channel-live', 'channel-video', 'inline-payment-panel', 'voip-room',
  'checkbox-group', 'radio-group', 'label', 'form'])

function scanWxml(file) {
  const src = fs.readFileSync(file, 'utf8')
  const res = { handlers: [], tags: new Set(), navs: [] }
  const hre = /\b(?:capture-)?(?:bind|catch)[:]?([a-zA-Z]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = hre.exec(src))) {
    const val = m[2].trim()
    if (!val || val.includes('{{')) continue
    res.handlers.push({ ev: m[1], name: val })
  }
  const tre = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]/g
  while ((m = tre.exec(src))) if (!BUILTIN_TAGS.has(m[1])) res.tags.add(m[1])
  const nre = /<navigator\b[^>]*\burl\s*=\s*"([^"]*)"/g
  while ((m = nre.exec(src))) if (!m[1].includes('{{')) res.navs.push({ from: 'navigator', url: m[1] })
  return res
}

/* ================= A / B / C 三项检查 ================= */
const badHandlers = []
const badTags = []
const badNavs = []
const dynamicNavs = []

pages.forEach((p) => {
  const dir = path.dirname(path.join(ROOT, p))
  const base = path.basename(p)
  const jsF = path.join(dir, base + '.js')
  const wxmlF = path.join(dir, base + '.wxml')
  const jsonF = path.join(dir, base + '.json')
  if (!fs.existsSync(jsF) || !fs.existsSync(wxmlF)) return

  let json = {}
  try { json = JSON.parse(fs.readFileSync(jsonF, 'utf8')) } catch (e) { return }

  const handlers = collectHandlers(fs.readFileSync(jsF, 'utf8'))
  const w = scanWxml(wxmlF)

  // A. 事件绑定 ↔ JS 方法
  const seen = new Set()
  w.handlers.forEach((h) => {
    if (handlers.has(h.name) || seen.has(h.name)) return
    seen.add(h.name)
    badHandlers.push(p + ' → bind/catch ' + h.ev + '="' + h.name + '" 在 JS 中不存在')
  })

  // B. 自定义组件注册
  const uc = json.usingComponents || {}
  w.tags.forEach((t) => {
    if (!uc[t]) { badTags.push(p + ' → <' + t + '> 未在 usingComponents 注册'); return }
    const rel = uc[t]
    const cp = rel.startsWith('/') ? path.join(ROOT, rel) : path.join(dir, rel)
    if (!fs.existsSync(cp + '.js') && !fs.existsSync(cp + '.wxml')) {
      badTags.push(p + ' → <' + t + '> 指向 ' + rel + '，文件不存在')
    }
  })

  // C. 跳转目标
  w.navs.forEach((nv) => {
    const u = nv.url.split('?')[0]
    const abs = u.startsWith('/') ? u : '/' + path.posix.join(path.posix.dirname(p), u)
    if (!pageSet.has(abs)) badNavs.push(p + ' → <navigator url="' + nv.url + '"> 未注册')
  })
  const jsSrc = fs.readFileSync(jsF, 'utf8')
  const navRe = /wx\.(navigateTo|redirectTo|switchTab|reLaunch)\s*\(\s*\{[^}]*?url\s*:\s*(['"`])([^'"`]*)\2/g
  let nm
  while ((nm = navRe.exec(jsSrc))) {
    const u = nm[3].split('?')[0]
    if (!u || u.includes('${')) { dynamicNavs.push(p + ' → ' + nm[1] + ' ' + nm[3]); continue }
    const abs = u.startsWith('/') ? u : '/' + path.posix.join(path.posix.dirname(p), u)
    if (!pageSet.has(abs)) badNavs.push(p + ' → ' + nm[1] + ' ' + nm[3] + ' 未注册')
  }
})

check(() => {
  assert.ok(pages.length >= 70, '页面清单解析异常：只解析到 ' + pages.length + ' 个页面')
}, 'A0：页面清单解析正常（≥70 个）')

check(() => {
  assert.deepStrictEqual(badHandlers, [],
    '以下 wxml 事件绑定的方法在对应 JS 中不存在（点击/输入将毫无反应）：\n  ' + badHandlers.join('\n  '))
}, 'A：事件绑定 ↔ JS 方法存在性（全部页面）')

check(() => {
  assert.deepStrictEqual(badTags, [],
    '以下自定义组件未注册或路径不存在（组件不会渲染）：\n  ' + badTags.join('\n  '))
}, 'B：自定义组件注册完整性（全部页面）')

check(() => {
  assert.deepStrictEqual(badNavs, [],
    '以下跳转目标未在 app.json 注册（跳转必然失败）：\n  ' + badNavs.join('\n  '))
}, 'C：跳转目标可达性（全部页面）')

// 反向自证：确认三项检查都真的扫到了东西（防止「0 问题」其实是空判据）
check(() => {
  let handlerTotal = 0
  let tagTotal = 0
  let navTagTotal = 0
  let jsNavTotal = 0
  pages.forEach((p) => {
    const dir = path.dirname(path.join(ROOT, p))
    const base = path.basename(p)
    const wxmlF = path.join(dir, base + '.wxml')
    const jsF = path.join(dir, base + '.js')
    if (!fs.existsSync(wxmlF)) return
    const w = scanWxml(wxmlF)
    handlerTotal += w.handlers.length
    tagTotal += w.tags.size
    navTagTotal += w.navs.length
    if (fs.existsSync(jsF)) {
      const jsSrc = fs.readFileSync(jsF, 'utf8')
      jsNavTotal += (jsSrc.match(/wx\.(navigateTo|redirectTo|switchTab|reLaunch)\s*\(/g) || []).length
    }
  })
  assert.ok(handlerTotal > 1000, '事件绑定扫描量异常偏低（' + handlerTotal + '），判据可能是空的')
  assert.ok(tagTotal > 30, '自定义组件扫描量异常偏低（' + tagTotal + '），判据可能是空的')
  // 本项目跳转基本都走 wx.navigateTo（`<navigator>` 标签为 0），所以按 JS 跳转量自证
  assert.ok(jsNavTotal > 100, 'JS 跳转扫描量异常偏低（' + jsNavTotal + '），判据可能是空的')
  console.log('  ℹ 扫描量：事件绑定 ' + handlerTotal + ' / 自定义组件 ' + tagTotal +
    ' / <navigator> 标签 ' + navTagTotal + ' / JS 跳转 ' + jsNavTotal)
}, 'D：判据非空自证（扫描量达到预期量级）')

// 已知的动态拼接跳转只做登记，不判失败（正则抓不到真实目标，需人工核对）
if (dynamicNavs.length) {
  console.log('  ℹ 动态拼接跳转 ' + dynamicNavs.length + ' 处（未参与断言，仅登记）：')
  dynamicNavs.forEach((x) => console.log('      ' + x))
}

console.log(testCount + ' tests passed.')
