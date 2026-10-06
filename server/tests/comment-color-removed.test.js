/**
 * 评论/通知「随机配色」移除回归（2026-10-06 用户需求）
 *
 * 现象：帖子详情评论框、消息页通知条、消息详情内容条各带一种「按 id 哈希散开」的随机色。
 * 用户要求三处全删 —— 评论框统一为中性底色，不再随评论 id 变色。
 *
 * 判据（静态，按源码字符串断言；每条都经反向验证：改回旧写法必须 FAIL）：
 *   A. 三处页面 JS 不再 require utils/comment-color，也不再下发 color/contentColor 字段；
 *   B. WXML 不再出现 --cb/--cbg CSS 变量与 {{item.color.*}} / {{contentColor.*}} 内联色；
 *   C. WXSS 不再使用 var(--cb...) / var(--cbg...)；
 *   D. utils/comment-color.js 已删除（死模块），且无任何调用点残留。
 *
 * 注意：`.comment-item.anchored`（从消息定位进来的琥珀色高亮）是「定位」功能、
 * 不是随机配色，**必须保留** —— 本测试不断言它、也不得被误删。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

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

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 按大括号平衡取出方法定义体（`name(x) {` 形式）。
 *  ⚠ 不能用 indexOf/lastIndexOf 盲取：同一个方法名既有调用处、也可能多次出现。
 *  正解：扫描所有 `name(` 出现点，取「紧接参数括号后是 {」的那一处 = 定义。 */
function sliceFunctionBody(src, name) {
  let idx = -1
  let from = 0
  while (true) {
    const at = src.indexOf(name + '(', from)
    if (at < 0) return ''
    // 找该调用/定义的参数括号收口
    const open = src.indexOf('(', at)
    let pdepth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') pdepth++
      else if (src[i] === ')') { pdepth--; if (pdepth === 0) { close = i; break } }
    }
    if (close < 0) { from = at + 1; continue }
    // 跳过空白后若是 `{`，即为方法定义
    let j = close + 1
    while (j < src.length && /\s/.test(src[j])) j++
    if (src[j] === '{') { idx = at; break }
    from = at + 1
  }
  if (idx < 0) return ''
  const open = src.indexOf('{', idx)
  if (open < 0) return ''
  let depth = 0
  let inStr = null
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open)
}

// 三处曾用随机配色的页面
const PAGES = {
  'pages/post-detail/index': ['js', 'wxml', 'wxss'],
  'pages/my-messages/index': ['js', 'wxml'],
  'pages/message-detail/index': ['js', 'wxml'],
}

check(() => {
  Object.keys(PAGES).forEach((base) => {
    const js = read(base + '.js')
    assert.ok(
      js.indexOf('comment-color') === -1,
      base + '.js 不得再 require utils/comment-color'
    )
    assert.ok(
      !/commentColor\s*\./.test(js),
      base + '.js 不得再调用 commentColor.*'
    )
  })
}, 'A. 页面 JS 不再引用 comment-color')

check(() => {
  // 页面 JS 不得再下发颜色字段（color / contentColor）
  const postDetail = read('pages/post-detail/index.js')
  assert.ok(!/^\s*color:\s*commentColor/m.test(postDetail),
    'post-detail 不得再给评论挂 color 字段')
  // 回复继承父色的那行（color: thread.color）也必须清掉 —— 否则留下 undefined 的 color 键
  assert.ok(!/color:\s*thread\.color/.test(postDetail),
    'post-detail 不得再让回复继承父评论配色（color: thread.color）')
  assert.ok(!/\bcoloredReplies\b/.test(postDetail),
    'post-detail 不得再有 coloredReplies 中间量')
  const myMessages = read('pages/my-messages/index.js')
  assert.ok(!/^\s*color:\s*commentColor/m.test(myMessages),
    'my-messages 不得再给通知挂 color 字段')
  const msgDetail = read('pages/message-detail/index.js')
  assert.ok(!/contentColor\s*:/.test(msgDetail),
    'message-detail 不得再下发 contentColor')
}, 'A2. 页面 JS 不再下发颜色字段')

check(() => {
  const postWxml = read('pages/post-detail/index.wxml')
  assert.ok(!/--cb\s*:/.test(postWxml), 'post-detail.wxml 不得再注入 --cb 变量')
  assert.ok(!/--cbg\s*:/.test(postWxml), 'post-detail.wxml 不得再注入 --cbg 变量')
  assert.ok(!/item\.color\./.test(postWxml), 'post-detail.wxml 不得再用 item.color.*')
  assert.ok(!/reply\.color\./.test(postWxml), 'post-detail.wxml 不得再用 reply.color.*')

  const msgWxml = read('pages/my-messages/index.wxml')
  assert.ok(!/item\.color\./.test(msgWxml), 'my-messages.wxml 不得再用 item.color.*')
  assert.ok(!/msg-colored/.test(msgWxml), 'my-messages.wxml 不得再挂 msg-colored 类')

  const detailWxml = read('pages/message-detail/index.wxml')
  assert.ok(!/contentColor/.test(detailWxml), 'message-detail.wxml 不得再用 contentColor')
}, 'B. WXML 不再注入随机色')

check(() => {
  const postWxss = read('pages/post-detail/index.wxss')
  assert.ok(!/var\(\s*--cb/.test(postWxss), 'post-detail.wxss 不得再用 var(--cb/--cbg)')
  // 「定位高亮」是独立功能，必须保留
  assert.ok(/\.comment-item\.anchored/.test(postWxss), '定位高亮 .comment-item.anchored 必须保留')
  assert.ok(/\.reply-item\.anchored/.test(postWxss), '定位高亮 .reply-item.anchored 必须保留')
}, 'C. WXSS 不再使用色变量（且保留锚点高亮）')

check(() => {
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'utils', 'comment-color.js')),
    'utils/comment-color.js 已删除，不得复活'
  )
}, 'D. 死模块 comment-color.js 已删除')

// ---------- F. 高亮只能在「消息定位评论」时出现 ----------
// 用户明确要求：只有从消息/通知点进来定位某条评论时才加颜色并高亮；
// 正常浏览评论、点赞、发布、编辑等任何其它路径都不得触发 anchored。
check(() => {
  const js = read('pages/post-detail/index.js')

  // 「点亮」高亮（赋非空值）必须唯一 —— 清空操作（赋 ''）可以有多处，不算触发
  const lightLines = js
    .split('\n')
    .filter((l) => /commentHighlight\s*:\s*[^'"]/.test(l) && !/commentHighlight\s*:\s*''/.test(l))
  assert.strictEqual(lightLines.length, 1,
    'commentHighlight 只允许被「点亮」一次（pulseCommentHighlight 内），实际 ' + lightLines.length + ' 处：' + lightLines.join(' | '))

  // 点亮语句必须在 pulseCommentHighlight 函数体内
  const pulseBody = sliceFunctionBody(js, 'pulseCommentHighlight')
  assert.ok(pulseBody, '应能取到 pulseCommentHighlight 函数体')
  assert.ok(/commentHighlight\s*:\s*anchor/.test(pulseBody),
    '点亮 commentHighlight 的语句必须在 pulseCommentHighlight 内（anchor 为定位目标 id）')
}, 'F. 高亮点亮点唯一，只能在 pulseCommentHighlight 内')

check(() => {
  const js = read('pages/post-detail/index.js')
  const body = sliceFunctionBody(js, 'applyPendingCommentAnchor')
  assert.ok(body, '应能取到 applyPendingCommentAnchor 函数体')
  // 只有带 pendingCommentAnchor 时才走定位；为空必须直接 return（否则正常进页面也会高亮）
  assert.ok(/if \(!this\._pendingCommentAnchor\) return/.test(body),
    'applyPendingCommentAnchor 必须首行短路：没有待定位评论时不得做任何高亮/滚动')
  // 定位源只能是 options.commentId（消息/通知跳入时携带）
  assert.ok(/_pendingCommentAnchor = Number\(options\.commentId\)/.test(js),
    '_pendingCommentAnchor 只能来自 options.commentId（消息定位入口），不得由其它交互写入')
}, 'F2. 定位入口唯一（options.commentId）')

check(() => {
  // 全仓库（排除 node_modules / 工作区暂存）不得再有任何引用点
  const dirs = ['pages', 'components', 'utils', 'server']
  const hits = []
  const walk = (abs) => {
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.workbuddy') continue
        walk(p)
      } else if (/\.(js|wxml|wxss)$/.test(name)) {
        // 排除本测试自身（文件名与断言文本必然含 comment-color）
        if (path.resolve(p) === path.resolve(__filename)) continue
        const txt = fs.readFileSync(p, 'utf8')
        if (/comment-color|commentColor/.test(txt)) {
          hits.push(path.relative(ROOT, p))
        }
      }
    }
  }
  dirs.forEach((d) => walk(path.join(ROOT, d)))
  assert.deepStrictEqual(hits, [], '不得有任何 comment-color 残留引用，实际：' + hits.join(', '))
}, 'E. 全仓库无残留引用')

console.log(testCount + ' tests passed.')
