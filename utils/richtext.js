// 后台自定义页面的正文标记语法（存储仍是纯文本字符串，老内容零迁移）
//
// 块级（写在行首）：
//   # 一级标题   ## 二级   ### 三级
//   - 无序列表项        1. 有序列表项
//   > 引用行
//   ---                 分隔线
// 行级指令（写在块级标记之前，顺序固定为 对齐 → 缩进 → 块级 → 正文）：
//   |l| 左   |c| 居中   |r| 右
//   »  每写一个缩进一级，最多三级
//   例：|c| » ## 居中且缩进一级的二级标题
// 行内（成对包裹）：
//   **粗体**  *斜体*  __下划线__  ~~删除线~~  {蓝|着色文字}
//   [文字](https://…)  ![说明](https://…)
//
// 不含任何记号的行会落到 p 分支，渲染结果与引入本模块之前逐行切段的效果一致。
// 纯函数、不依赖 wx / getApp，便于 Node 侧直接 require 做单元测试。

const COLOR_MAP = { 蓝: '#2e6bff', 红: '#e5484d', 绿: '#1a9d5a', 橙: '#f5a70a' }

// 顺序即优先级：图片要先于链接（两者都含 ]( ），*** 先于 ** 先于 *（长标记必须抢先匹配）
const INLINE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|__([^_\n]+)__|\*([^*\n]+)\*|\{([^|}\n]+)\|([^}\n]+)\}/g

function plainRun(text) {
  return { t: text, cls: '', style: '' }
}

function pushRun(runs, run) {
  if (run.t) runs.push(run)
}

// 同一个 run 上的两个类名合并（顺序稳定，便于断言与去重）
function mergeCls(outer, inner) {
  if (!inner || inner === outer) return outer || ''
  return outer ? outer + ' ' + inner : inner
}

// 把「被某个标记包住的内容」递归解析，再把外层标记/字色合并到内层每个 run 上。
//
// 必须递归：不递归时 `~~**粗**~~` 会把 `**粗**` 当成普通文字渲染，
// 管理员在前台看到的就是裸记号 —— 这正是「点了按钮却显示错误内容」的主因之一。
// 递归同时天然支持 `{蓝|**粗**}` 这类「字色在外、行内标记在内」的组合。
function pushWrapped(runs, innerText, cls, style) {
  parseInline(innerText).forEach((r) => {
    if (!r.t && !r.img) return
    // 图片与链接有自己的渲染分支，不参与外层的类名合并
    if (r.img) { runs.push(r); return }
    if (r.href) {
      runs.push(Object.assign({}, r, {
        cls: mergeCls(cls, r.cls),
        style: style || r.style || ''
      }))
      return
    }
    runs.push(Object.assign({}, r, {
      cls: mergeCls(cls, r.cls),
      style: style || r.style || ''
    }))
  })
}

// 旧版编辑器把新字色套在旧字色外面，会产出 {蓝|{红|文字}} 这类套娃，
// 而正则不支持套娃（会在第一个 } 处截断，漏出一个裸 }）。这里先折叠成外层字色，
// 保证历史内容同样干净渲染；新逻辑已不会再产出这种写法。
function collapseNestedColor(text) {
  let out = String(text || '')
  for (let i = 0; i < 4 && /\{[^|}{\n]+\|\{/.test(out); i++) {
    out = out.replace(/\{([^|}{\n]+)\|\{([^|}{\n]+)\|([^}{\n]+)\}\}/g, '{$1|$3}')
  }
  return out
}

// 把一行文字拆成渲染就绪的 run 列表
function parseInline(text) {
  const runs = []
  const rest = collapseNestedColor(text)
  let lastIndex = 0
  let m
  // 每次调用都用独立的正则实例：本函数会递归，共享 lastIndex 会让外层循环跳到错误位置
  const re = new RegExp(INLINE_RE.source, 'g')
  while ((m = re.exec(rest)) !== null) {
    if (m.index > lastIndex) pushRun(runs, plainRun(rest.slice(lastIndex, m.index)))
    lastIndex = m.index + m[0].length
    if (m[1] !== undefined) {
      runs.push({ t: '', img: m[2], alt: m[1] || '图片', cls: 'rt-img', style: '' })
    } else if (m[3] !== undefined) {
      // 链接文字也递归：`[**粗**](url)` 要渲染成加粗链接，而不是把 ** 当文字
      parseInline(m[3]).forEach((r) => {
        if (!r.t) return
        runs.push(Object.assign({}, r, { href: m[4], cls: mergeCls('rt-link', r.cls) }))
      })
    } else if (m[5] !== undefined) {
      pushWrapped(runs, m[5], 'rt-b rt-i', '')
    } else if (m[6] !== undefined) {
      pushWrapped(runs, m[6], 'rt-b', '')
    } else if (m[7] !== undefined) {
      pushWrapped(runs, m[7], 'rt-s', '')
    } else if (m[8] !== undefined) {
      pushWrapped(runs, m[8], 'rt-u', '')
    } else if (m[9] !== undefined) {
      pushWrapped(runs, m[9], 'rt-i', '')
    } else {
      // 字色：{蓝|文字}，未登记的颜色名按原样输出，避免把标记直接暴露给用户
      const color = COLOR_MAP[String(m[10]).trim()]
      if (!color) {
        pushRun(runs, plainRun(m[0]))
      } else {
        pushWrapped(runs, m[11], '', 'color:' + color)
      }
    }
  }
  if (lastIndex < rest.length) pushRun(runs, plainRun(rest.slice(lastIndex)))
  return runs.length ? runs : [plainRun('')]
}

// 整行只有一个图片时升格成独立图片块，排版比塞在段落里好看
function aloneImage(line) {
  const m = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/.exec(line)
  return m ? { src: m[2], alt: m[1] || '图片' } : null
}

const ALIGN_CLASS = { l: 'rt-a-left', c: 'rt-a-center', r: 'rt-a-right' }

// ===== 跨行续接 =====
// 标记被换行劈开时（套上标记后，又把光标移到文字中间敲了回车），按行解析找不到配对的标记，
// 就会把 ** 当普通文字输出 —— 用户在前台看到的就是「**你好」。这里把「行首未闭合的标记」
// 在本行补齐、并把开标记续到下一行行首，于是两行各自成为一层完整标记：
// 换行保留、样式不丢、记号不外露。
//
// 只在两个条件同时成立时才动手，避免误伤正文里单独出现的记号（例如「2 * 3」）：
//   1) 未闭合的标记必须紧贴行首 —— 编辑器是整行包裹，被劈开必然发生在行首；
//   2) 紧随其后的下一个非空行必须以对应的闭标记结尾 —— 确实存在续接对象。
const INLINE_PAIRS_BY_LEN = [
  { open: '***', close: '***' },
  { open: '**', close: '**' },
  { open: '~~', close: '~~' },
  { open: '__', close: '__' },
  { open: '*', close: '*' }
]

// 位置 i 上的行内开标记（长标记优先，与 INLINE_RE 的优先级一致）
function inlineOpenerAt(s, i) {
  for (const p of INLINE_PAIRS_BY_LEN) {
    if (s.startsWith(p.open, i)) return p
  }
  if (s[i] === '{') {
    const m = /^\{([^|}{\n]+)\|/.exec(s.slice(i))
    if (m && COLOR_MAP[m[1].trim()]) return { open: m[0], close: '}' }
  }
  return null
}

// 行首连续未闭合的行内标记（含字色），按打开顺序返回
function leadingDanglingMarkers(body) {
  const s = String(body || '')
  const opens = []
  let i = 0
  while (i < s.length) {
    const hit = inlineOpenerAt(s, i)
    if (!hit) break
    // 开标记后面没有可见内容 → 不是「包裹内容的标记被劈开」（例如整行就是一个 *** 分隔线）
    if (!s.slice(i + hit.open.length).trim()) break
    // 本行内已能找到闭标记 → 没有劈开
    if (s.indexOf(hit.close, i + hit.open.length) >= 0) break
    opens.push(hit)
    i += hit.open.length
  }
  return opens
}

// content → 块列表 [{ type, runs | src/alt | start, cls }]
// cls 是给组件直接挂的样式类（基础类 + 对齐 + 缩进），wxml 里不做任何拼接判断
function parseBlocks(content) {
  const prepared = String(content || '').split(/\r?\n/).map((rawLine) => {
    const trimmed = String(rawLine).trim()
    return trimmed ? { parts: splitLine(trimmed) } : { parts: null }
  })

  // 跨行续接：本行补齐闭标记，开标记续到下一个非空行
  for (let i = 0; i < prepared.length; i++) {
    const cur = prepared[i]
    if (!cur.parts) continue
    const opens = leadingDanglingMarkers(cur.parts.body)
    if (!opens.length) continue
    const closers = opens.map((p) => p.close).reverse().join('')
    let next = null
    for (let j = i + 1; j < prepared.length; j++) {
      if (prepared[j].parts) { next = prepared[j]; break }
    }
    if (!next || next.parts.body.slice(-closers.length) !== closers) continue
    cur.parts.body += closers
    next.parts.body = opens.map((p) => p.open).join('') + next.parts.body
  }

  const blocks = []
  prepared.forEach((item) => {
    if (!item.parts) return
    const parts = item.parts
    const body = parts.body
    let block = null
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(body) && !parts.marker) {
      block = { type: 'hr' }
    } else if (/^#{1,3}\s+$/.test(parts.marker)) {
      block = { type: 'h' + (parts.marker.trim().length), runs: parseInline(body) }
    } else if (/^>\s*$/.test(parts.marker)) {
      block = { type: 'quote', runs: parseInline(body) }
    } else if (/^[-•]\s+$/.test(parts.marker)) {
      block = { type: 'li', runs: parseInline(body) }
    } else if (/^\d{1,2}[.、)]\s+$/.test(parts.marker)) {
      block = { type: 'li-ol', start: Number(parts.marker), runs: parseInline(body) }
    } else if (!parts.marker) {
      const img = aloneImage(body)
      block = img ? { type: 'img', src: img.src, alt: img.alt } : { type: 'p', runs: parseInline(body) }
    } else {
      // 认不出的行首组合（例如 |c| 后面直接跟 ---）按普通段落处理，不把记号漏给用户
      block = { type: 'p', runs: parseInline(parts.marker + body) }
    }
    const extra = [ALIGN_CLASS[parts.align], parts.indent ? 'rt-i' + parts.indent : '']
      .filter(Boolean).join(' ')
    block.cls = (block.type === 'li-ol' ? 'rt-li' : 'rt-' + block.type) + (extra ? ' ' + extra : '')
    blocks.push(block)
  })
  return blocks
}

// 摘要用：剥掉所有记号，只留可读文字（列表/标题行会丢掉行首符号，链接留文字）
function stripMarks(text) {
  return String(text || '')
    .replace(/^\|[lcr]\|\s+/, '')
    .replace(/^(?:»\s+)+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,3}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/^[-•]\s+/, '')
    .replace(/^\d{1,2}[.、)]\s+/, '')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\{[^|}]+\|([^}]+)\}/g, '$1')
    .trim()
}

// ===== 工具栏插入（放在共享模块里，页面只负责取值与回填，逻辑可在 Node 侧直接测） =====

// 行内成对标记。placeholder 用于无选区时给出可见占位，并把光标选中它，方便直接改字
const LINK_URL = 'https://payun01.cn'
const INLINE_MARKS = {
  bold: { open: '**', close: '**', placeholder: '加粗文字' },
  italic: { open: '*', close: '*', placeholder: '斜体文字' },
  underline: { open: '__', close: '__', placeholder: '下划线文字' },
  strike: { open: '~~', close: '~~', placeholder: '删除文字' },
  // 占位 URL 必须是合法的：正则要求 // 之后还有字符，写 https:// 会让刚插入的链接
  // 根本不被识别（预览里仍是裸文本），管理员以为没生效
  link: { open: '[', close: '](' + LINK_URL + ')', placeholder: '链接文字' }
}

// 行内样式的类名、固定顺序与互斥关系：
// 粗体与斜体可叠加成 ***粗斜***（解析器已支持）；下划线/删除线与其它行内样式互斥。
const INLINE_KINDS = { bold: 'rt-b', italic: 'rt-i', underline: 'rt-u', strike: 'rt-s' }
const INLINE_ORDER = ['bold', 'italic', 'underline', 'strike']
const EXCLUSIVE_MARKS = ['underline', 'strike']

// 行首块级标记
const LINE_PREFIXES = {
  h1: '# ', h2: '## ', h3: '### ', quote: '> ', bullet: '- ', number: '1. '
}

// 行级指令：对齐 |c| / |r| / |l|，缩进每级一个 »（最多 3 级）。
// 一行里的固定顺序是「对齐 → 缩进 → 块级标记 → 正文」，三类标记各自独立开关、互不覆盖。
const ALIGN_RE = /^\|(l|c|r)\|\s+/
const INDENT_RE = /^(?:»\s+)+/
const LINE_MARKER_RE = /^(#{1,3}\s+|>\s*|[-•]\s+|\d{1,2}[.、)]\s+)/
const MAX_INDENT = 3

// 把一行拆成可重排的四段，供工具栏增删指令后再原样拼回
function splitLine(line) {
  let rest = String(line || '')
  let align = ''
  let indent = 0
  let marker = ''
  const alignMatch = ALIGN_RE.exec(rest)
  if (alignMatch) {
    align = alignMatch[1]
    rest = rest.slice(alignMatch[0].length)
  }
  const indentMatch = INDENT_RE.exec(rest)
  if (indentMatch) {
    indent = Math.min(MAX_INDENT, indentMatch[0].split('»').length - 1)
    rest = rest.slice(indentMatch[0].length)
  }
  const markerMatch = LINE_MARKER_RE.exec(rest)
  if (markerMatch) {
    marker = markerMatch[0]
    rest = rest.slice(marker.length)
  }
  return { align, indent, marker, body: rest }
}

function joinLine(parts) {
  let out = ''
  if (parts.align) out += '|' + parts.align + '| '
  for (let i = 0; i < parts.indent; i++) out += '» '
  if (parts.marker) out += parts.marker
  return out + parts.body
}

function editLine(text, cursor, mutate) {
  const src = String(text || '')
  const lineStart = src.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  let lineEnd = src.indexOf('\n', lineStart)
  if (lineEnd < 0) lineEnd = src.length
  const line = src.slice(lineStart, lineEnd)
  const parts = splitLine(line)
  const beforeLen = line.length
  mutate(parts)
  parts.indent = Math.max(0, Math.min(MAX_INDENT, parts.indent))
  const nextLine = joinLine(parts)
  const next = src.slice(0, lineStart) + nextLine + src.slice(lineEnd)
  const shift = nextLine.length - beforeLen
  return { text: next, cursor: Math.max(lineStart, cursor + shift), selectStart: -1, selectEnd: -1 }
}

// 块级标记作用于「正文」那一层，所以切换标题/列表不会碰已经设好的对齐与缩进
function applyLinePrefix(text, cursor, kind) {
  const prefix = LINE_PREFIXES[kind]
  if (!prefix) return { text: String(text || ''), cursor }
  return editLine(text, cursor, (parts) => {
    parts.marker = parts.marker === prefix ? '' : prefix
  })
}

// ===== 行内样式的「单层规范化」 =====
//
// 判定完全交给解析器（渲染的唯一事实来源），不再用首尾字符串去猜。
// 曾经用 `s.indexOf(open) === 0 && s.slice(-close.length) === close` 判定「已包裹」，
// 于是 `*`（斜体）把 `**粗**` 也认成已包裹，`~~`（删除线）套在 `**粗**` 外面，
// 拼出 `***粗***`、`~~**粗**~~` 这类**渲染时会露出裸记号**的组合 ——
// 用户看到的就是「点了按钮却显示错误内容」。规范化后每次产出都是可解析的单层组合。

function colorKeyOf(style) {
  const m = /color:\s*(#[0-9a-fA-F]{3,8})/.exec(String(style || ''))
  if (!m) return ''
  const hex = m[1].toLowerCase()
  return Object.keys(COLOR_MAP).filter((k) => COLOR_MAP[k].toLowerCase() === hex)[0] || ''
}

// 一行的样式层：只在「整行恰好是一层包裹」时才认定样式已应用。
// 返回 source（剥掉样式层后的正文，链接还原成 [文字](地址) 以便继续参与包裹）
// 与 text（纯文字，用于取消勾选时还原）。
function styleState(body) {
  const trimmed = String(body || '').trim()
  const none = { detected: false, marks: [], colorKey: '', linkHref: '', source: trimmed, text: trimmed }
  if (!trimmed) return { detected: false, marks: [], colorKey: '', linkHref: '', source: '', text: '' }
  const runs = parseInline(trimmed)
  if (runs.length !== 1 || runs[0].img) return none
  const run = runs[0]
  const cells = String(run.cls || '').split(/\s+/)
  const marks = INLINE_ORDER.filter((k) => cells.indexOf(INLINE_KINDS[k]) >= 0)
  const colorKey = colorKeyOf(run.style)
  const linkHref = run.href || ''
  if (!marks.length && !colorKey && !linkHref) return none
  return {
    detected: true,
    marks,
    colorKey,
    linkHref,
    source: linkHref ? '[' + run.t + '](' + linkHref + ')' : run.t,
    text: run.t
  }
}

// 依据样式层拼回一行正文：行内标记在内、字色在外（`{蓝|**粗**}` 是解析器支持的组合方向）
function buildStyled(source, marks, colorKey) {
  const has = (k) => marks.indexOf(k) >= 0
  let open = ''
  let close = ''
  if (has('underline')) { open = '__'; close = '__' }
  else if (has('strike')) { open = '~~'; close = '~~' }
  else if (has('bold') && has('italic')) { open = '***'; close = '***' }
  else if (has('bold')) { open = '**'; close = '**' }
  else if (has('italic')) { open = '*'; close = '*' }
  const text = open + source + close
  return colorKey && COLOR_MAP[colorKey] ? '{' + colorKey + '|' + text + '}' : text
}

// 行内按钮：把整个行正文包成一层目标标记；再点同一个按钮取消。
// 叠加规则：粗体/斜体可共存；下划线/删除线互斥（后点者替换先点者）；字色始终保留在最外层。
function applyInlineMark(body, kind) {
  const mark = INLINE_MARKS[kind]
  if (!mark) return String(body || '')
  const trimmed = String(body || '').trim()
  if (!trimmed) return mark.open + mark.placeholder + mark.close
  const st = styleState(trimmed)
  if (kind === 'link') {
    if (st.linkHref === LINK_URL && !st.marks.length && !st.colorKey) return st.text
    const label = st.detected ? buildStyled(st.text, st.marks, st.colorKey) : trimmed
    return '[' + label + '](' + LINK_URL + ')'
  }
  let marks
  if (st.detected && st.marks.indexOf(kind) >= 0) {
    marks = st.marks.filter((k) => k !== kind)
  } else if (st.detected) {
    marks = EXCLUSIVE_MARKS.indexOf(kind) >= 0
      ? [kind]
      : st.marks.filter((k) => EXCLUSIVE_MARKS.indexOf(k) < 0).concat(kind)
  } else {
    marks = [kind]
  }
  const source = st.detected ? st.source : trimmed
  const colorKey = st.detected ? st.colorKey : ''
  return buildStyled(source, marks, colorKey)
}

// 把行内标记作用于「光标所在行的正文」：有字就整行包住，空行才落占位词。
// 刻意不再用「插入空标记 + 把光标塞进中间」那套 —— 小程序 textarea 的 cursor 属性
// 在部分机型不会重定位，一旦不生效，用户留下的就是「你好****」这种半截标记。
// 按行包裹只改这一行的内容，无论光标是否被正确恢复，结果都是完整成对的标记。
function wrapLine(text, cursor, kind) {
  const mark = INLINE_MARKS[kind]
  if (!mark) return { text: String(text || ''), cursor }
  return editLineBody(text, cursor, (body) => applyInlineMark(body, kind))
}

function colorLine(text, cursor, colorKey) {
  if (!COLOR_MAP[colorKey]) return { text: String(text || ''), cursor }
  return editLineBody(text, cursor, (body) => {
    const trimmed = String(body || '').trim()
    if (!trimmed) return '{' + colorKey + '|着色文字}'
    const st = styleState(trimmed)
    const source = st.detected ? st.source : trimmed
    const marks = st.detected ? st.marks : []
    // 再点同一个颜色：只摘掉字色层，行内标记原样保留
    if (st.detected && st.colorKey === colorKey) return buildStyled(source, marks, '')
    return buildStyled(source, marks, colorKey)
  })
}

// 只改一行的「正文」那一段，行首的对齐/缩进/块级标记原样保留
function editLineBody(text, cursor, mutate) {
  const src = String(text || '')
  const lineStart = src.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  let lineEnd = src.indexOf('\n', lineStart)
  if (lineEnd < 0) lineEnd = src.length
  const parts = splitLine(src.slice(lineStart, lineEnd))
  parts.body = mutate(parts.body)
  const nextLine = joinLine(parts)
  return { text: src.slice(0, lineStart) + nextLine + src.slice(lineEnd), cursor: lineStart + nextLine.length }
}

// 对齐：再点同一个按钮取消；l 是默认值，显式写出来只为了覆盖掉之前的 |c|/|r|
function applyAlign(text, cursor, key) {
  if (['l', 'c', 'r'].indexOf(key) < 0) return { text: String(text || ''), cursor }
  return editLine(text, cursor, (parts) => {
    parts.align = parts.align === key ? '' : key
  })
}

// 缩进：delta 为 +1 / -1，超出上下限就停在边界（不给负数或第四级留活口）
function applyIndent(text, cursor, delta) {
  // 小程序的 dataset 里数字可能退化成字符串（"-1"），不归一化会变成字符串拼接：
  // 1 + "-1" = "1-1" → Math.min/max 得到 NaN → 缩进层级被静默清空
  const step = Number(delta)
  if (!Number.isFinite(step) || step === 0) return { text: String(text || ''), cursor }
  return editLine(text, cursor, (parts) => {
    parts.indent += step
  })
}

// 在光标所在行之后另起一行插入独立块（分隔线 / 整行图片共用）
function insertStandaloneLine(text, cursor, snippet) {
  const src = String(text || '')
  let lineEnd = src.indexOf('\n', Math.max(0, cursor))
  if (lineEnd < 0) lineEnd = src.length
  const inserted = '\n' + snippet
  return { text: src.slice(0, lineEnd) + inserted + src.slice(lineEnd), cursor: lineEnd + inserted.length, selectStart: -1, selectEnd: -1 }
}

function insertDivider(text, cursor) {
  return insertStandaloneLine(text, cursor, '---')
}

// 图片写成 ![说明](url)，与 parseBlocks 的独立图片块分支一一对应
function insertImage(text, cursor, url, alt) {
  return insertStandaloneLine(text, cursor, '![' + (alt || '图片') + '](' + url + ')')
}

// 正文链接的点击约定：站内路径直接跳转，http(s) 走 webview 页，其余退化为复制。
// 与 pages/banner-detail 顶部横幅的 onOpenLink 同一套行为，三个消费端共用一份。
function copyRichLink(text) {
  wx.setClipboardData({
    data: text,
    success() { wx.showToast({ title: '链接已复制', icon: 'none' }) }
  })
}

function openLink(href) {
  const url = String(href || '').trim()
  if (!url) return
  if (url.indexOf('/pages/') === 0) {
    wx.navigateTo({ url, fail: () => copyRichLink(url) })
    return
  }
  if (/^https?:\/\//i.test(url)) {
    wx.navigateTo({ url: '/pages/webview/index?url=' + encodeURIComponent(url), fail: () => copyRichLink(url) })
    return
  }
  copyRichLink(url)
}

// 工具栏唯一的分发表：按钮的 (kind, cmd) 在这里决定调用哪个函数。
// 组件与测试都走它 —— 之前组件写一串 if/else、测试里又抄一遍同样分支，
// 两边一旦不同步就是「点了没反应 / 套错标记」这类映射错乱的来源。
function applyCommand(text, cursor, kind, cmd) {
  if (kind === 'inline') return wrapLine(text, cursor, cmd)
  if (kind === 'line') return applyLinePrefix(text, cursor, cmd)
  if (kind === 'align') return applyAlign(text, cursor, cmd)
  if (kind === 'indent') return applyIndent(text, cursor, cmd)
  if (kind === 'divider') return insertDivider(text, cursor)
  if (kind === 'color') return colorLine(text, cursor, cmd)
  return null
}

module.exports = {
  COLOR_MAP,
  INLINE_MARKS,
  LINE_PREFIXES,
  parseBlocks,
  parseInline,
  stripMarks,
  applyCommand,
  wrapLine,
  colorLine,
  applyLinePrefix,
  applyAlign,
  applyIndent,
  insertDivider,
  insertImage,
  openLink
}
