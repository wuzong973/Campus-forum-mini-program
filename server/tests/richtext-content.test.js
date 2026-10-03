// 后台自定义页面正文的标记渲染护栏（utils/richtext.js + components/richtext-content）
//
// 为什么要有这个文件：正文标记是**存储格式**，五个消费端（banner-detail / campus-service /
// driving-school.guide / driving-school.landing / market）共用一个解析器。
// 任何一处漏接，管理员在工具栏点的样式就会在某个页面上以裸记号（**粗体**、## 标题）示人。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const rt = require(path.join(root, 'utils', 'richtext.js'))

let testCount = 0
function check(name, fn) {
  try {
    fn()
    testCount++
  } catch (err) {
    console.error('FAILED:', name)
    throw err
  }
}

// ============ 解析器行为 ============

check('纯文本与改造前的逐行切段等价', () => {
  const legacy = (s) => String(s || '').split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const content = '第一段\n第二段\n\n  第三段  \n\n\n第四段'
  const blocks = rt.parseBlocks(content)
  assert.deepStrictEqual(blocks.map((b) => b.type), ['p', 'p', 'p', 'p'], '空行必须像以前一样被丢弃')
  assert.deepStrictEqual(blocks.map((b) => b.runs.map((r) => r.t).join('')), legacy(content))
})

check('块级标记解析', () => {
  const types = rt.parseBlocks('# 一\n## 二\n### 三\n- 甲\n1. 乙\n> 注\n---').map((b) => b.type)
  assert.deepStrictEqual(types, ['h1', 'h2', 'h3', 'li', 'li-ol', 'quote', 'hr'])
  const numbered = rt.parseBlocks('3. 丙')[0]
  assert.strictEqual(numbered.start, 3, '有序列表要保留原编号，不能统一重排成 1')
  assert.strictEqual(rt.parseBlocks('#### 四级')[0].type, 'p', '超过三级的井号按普通文本处理，不猜语义')
})

check('行内标记解析成带类名的 run', () => {
  const runs = rt.parseBlocks('前**粗**中*斜*后__划__末~~删~~尾')[0].runs
  const byClass = runs.filter((r) => r.cls).map((r) => r.cls)
  assert.deepStrictEqual(byClass, ['rt-b', 'rt-i', 'rt-u', 'rt-s'])
  assert.strictEqual(runs.map((r) => r.t).join(''), '前粗中斜后划末删尾', '标记符号本身不得出现在文字里')
})

check('字色只认登记过的颜色名', () => {
  const known = rt.parseBlocks('a{蓝|蓝字}b')[0].runs.find((r) => r.style)
  assert.ok(known && known.t === '蓝字' && /color:#2e6bff/.test(known.style), '已登记颜色要产出内联色')
  const unknown = rt.parseBlocks('{紫|文字}')[0].runs.map((r) => r.t).join('')
  assert.strictEqual(unknown, '{紫|文字}', '未登记的颜色名必须原样输出，不能吞掉记号也不能显示裸样式')
})

check('链接与图片只接受 http(s)', () => {
  const evil = rt.parseBlocks('[点我](javascript:alert(1))')[0].runs
  assert.ok(!evil.some((r) => r.href), 'javascript: 不得被解析成可点链接')
  assert.strictEqual(evil.map((r) => r.t).join(''), '[点我](javascript:alert(1))', '不认识的记号原样留作文本')
  const link = rt.parseBlocks('[官网](https://a.cn/x)')[0].runs.find((r) => r.href)
  assert.strictEqual(link.href, 'https://a.cn/x')
  const imgBlock = rt.parseBlocks('![场地](https://cdn.io/a.jpg)')[0]
  assert.strictEqual(imgBlock.type, 'img', '整行图片应升格为独立图片块')
  assert.strictEqual(imgBlock.src, 'https://cdn.io/a.jpg')
  assert.ok(rt.parseBlocks('看![小图](https://cdn.io/b.png)这里')[0].runs.some((r) => r.img), '行内图片要留在段落里')
})

check('stripMarks 不残留任何记号', () => {
  const cleaned = rt.stripMarks('## 标题：**重点** 与 *斜* 和 [点我](https://a.cn) 及 ![图](https://b.cn/c.png)')
  assert.ok(!/[*_~#\[\]{}|]/.test(cleaned), '剥完不该还剩记号，实际：' + cleaned)
  assert.ok(cleaned.indexOf('点我') >= 0 && cleaned.indexOf('标题') >= 0, '链接与标题的文字要保留')
  assert.ok(cleaned.indexOf('https://') < 0, 'URL 不应进摘要')
})

check('被换行劈开的标记自动续接，记号不漏到前台', () => {
  // 成因：套上标记后，把光标移到文字中间敲了回车 → `**你好` / `世界**`。
  // 按行解析找不到配对标记，就会把 ** 当普通文字输出，前台看到「**你好」。
  const MARK_RE = /[*_~{}]/
  const plain = (blocks) => blocks.map((b) => (b.runs || []).map((r) => r.t).join('')).join(' | ')
  const clsOf = (blocks) => blocks.map((b) => (b.runs || []).map((r) => r.cls).filter(Boolean).join(','))

  const bold = rt.parseBlocks('**你好\n世界**')
  assert.strictEqual(bold.length, 2, '换行必须保留，不能被合并成一段')
  assert.ok(!MARK_RE.test(plain(bold)), '跨行加粗不得露出 **：' + plain(bold))
  assert.deepStrictEqual(clsOf(bold), ['rt-b', 'rt-b'], '两行都应保持加粗')

  ;['~~你好\n世界~~', '__你好\n世界__', '{蓝|**你好\n世界**}', '## **标题\n继续**', '|c| **居中\n跨行**']
    .forEach((src) => {
      const blocks = rt.parseBlocks(src)
      assert.ok(!MARK_RE.test(plain(blocks)),
        '跨行劈开后仍露出记号：' + JSON.stringify(src) + ' → ' + plain(blocks))
      assert.strictEqual(blocks.length, 2, '换行必须保留：' + JSON.stringify(src))
    })

  const gap = rt.parseBlocks('**你\n\n好**')
  assert.ok(!MARK_RE.test(plain(gap)), '中间夹空行时仍应续接：' + plain(gap))

  // 反向保护：正文里「单独出现」的记号不能被当成劈开的标记而强行闭合
  assert.strictEqual(plain(rt.parseBlocks('* 项目\n2 * 3')), '* 项目 | 2 * 3',
    '正文里单独的 * 不得被改写（例如「2 * 3」）')
  assert.strictEqual(plain(rt.parseBlocks('**孤立的开头')), '**孤立的开头',
    '没有配对续行时不得强行闭合')
})

// ============ 工具栏插入 ============

check('工具栏插入与再次点击可撤销', () => {
  const wrapped = rt.wrapLine('前后', 2, 'bold')
  assert.strictEqual(wrapped.text, '**前后**', '应整行包裹')
  assert.strictEqual(wrapped.cursor, 6, '光标落在包裹后的行尾')
  assert.strictEqual(rt.wrapLine(wrapped.text, wrapped.cursor, 'bold').text, '前后', '同一行再点一次应取消包裹')
  const heading = rt.applyLinePrefix('标题行', 2, 'h2')
  assert.strictEqual(heading.text, '## 标题行')
  assert.strictEqual(rt.applyLinePrefix(heading.text, heading.cursor, 'h3').text, '### 标题行', 'H2 换 H3 是替换不是叠加')
  assert.strictEqual(rt.applyLinePrefix('### 标题行', 3, 'h3').text, '标题行')
  assert.strictEqual(rt.applyLinePrefix('第一\n第二', 4, 'h1').text, '第一\n# 第二', '块级标记只作用于光标所在行')
  assert.strictEqual(rt.insertDivider('甲\n乙', 1).text, '甲\n---\n乙', '分隔线插入不得留下多余空行')
})

check('对齐与缩进是行级指令，与块级标记互不覆盖', () => {
  const centered = rt.applyAlign('一段文字', 0, 'c')
  assert.strictEqual(centered.text, '|c| 一段文字')
  assert.strictEqual(rt.applyAlign(centered.text, centered.cursor, 'c').text, '一段文字', '再点同一个对齐应取消')
  assert.strictEqual(rt.applyAlign('|c| 一段文字', 0, 'r').text, '|r| 一段文字', '换对齐是替换不是叠加')

  const indented = rt.applyIndent('一段文字', 0, 1)
  assert.strictEqual(indented.text, '» 一段文字')
  assert.strictEqual(rt.applyIndent(indented.text, indented.cursor, 1).text, '» » 一段文字')
  assert.strictEqual(rt.applyIndent('» » » 一段文字', 6, 1).text, '» » » 一段文字', '缩进封顶三级，第四级不再生效')
  assert.strictEqual(rt.applyIndent('一段文字', 0, -1).text, '一段文字', '零级再减不得变负')

  // 指令顺序固定为 对齐 → 缩进 → 块级 → 正文，三类标记各自独立开关
  const combo = rt.applyLinePrefix('|c| » » 正文', 6, 'h2')
  assert.strictEqual(combo.text, '|c| » » ## 正文')
  const block = rt.parseBlocks(combo.text)[0]
  assert.strictEqual(block.type, 'h2')
  assert.ok(block.cls.indexOf('rt-h2') === 0, 'cls 以基础类开头：' + block.cls)
  assert.ok(block.cls.indexOf('rt-a-center') > 0 && block.cls.indexOf('rt-i2') > 0, '对齐与缩进都要落到 cls：' + block.cls)
  assert.strictEqual(block.runs.map((r) => r.t).join(''), '正文', '指令不得混进正文文字')
  assert.ok(rt.stripMarks(combo.text).indexOf('|c|') < 0 && rt.stripMarks(combo.text).indexOf('»') < 0,
    '摘要必须剥掉对齐与缩进指令：' + rt.stripMarks(combo.text))
})

// ============ 九个消费端接线 ============
// 两种喂法都要覆盖到：改数据流的用 blocks，只换标签的用 content（组件内部解析）
const CONSUMERS = [
  ['pages/banner-detail/index', 'blocks'],
  ['pages/campus-service/index', 'blocks'],
  ['pages/driving-school/guide', 'blocks'],
  ['pages/driving-school/landing', 'blocks'],
  ['pages/market/index', 'blocks'],
  ['pages/activity/detail', 'content'],
  ['pages/driving-school/detail', 'content'],
  ['pages/club/club-detail', 'content'],
  ['pages/group-chat/detail', 'content']
]

CONSUMERS.forEach(([base, mode]) => {
  check(base + ' 接入标记渲染', () => {
    const wxml = read(base + '.wxml')
    const json = JSON.parse(read(base + '.json'))
    assert.ok(wxml.indexOf('<richtext-content') >= 0, base + ' 模板未挂渲染组件')
    assert.ok(wxml.indexOf(mode + '=') >= 0, base + ' 未按 ' + mode + ' 方式喂数据')
    assert.strictEqual(json.usingComponents && json.usingComponents['richtext-content'], '/components/richtext-content/richtext-content',
      base + '.json 未注册组件（漏了会整块静默不渲染，且开发者工具外无报错）')
    if (mode === 'blocks') {
      assert.ok(read(base + '.js').indexOf('parseBlocks(') >= 0, base + ' 声明用 blocks，就必须真的调 parseBlocks')
    }
    assert.ok(read(base + '.js').indexOf('onRichLink') < 0 && read(base + '.js').indexOf('onRichImage') < 0,
      base + ' 又自己抄了一份链接/图片处理 —— 这两个行为已收进组件，抄回来就是两套口径')
  })
})

check('原先自带 user-select 的正文位仍可选字', () => {
  // 这几处改造前是 <text user-select>，换成组件后必须靠 selectable 保住，否则长按复制静默失效
  ;['pages/market/index.wxml', 'pages/driving-school/landing.wxml', 'pages/group-chat/detail.wxml',
    'pages/club/club-detail.wxml', 'pages/activity/detail.wxml'].forEach((f) => {
    const wxml = read(f)
    const tag = /<richtext-content[^>]*>/.exec(wxml)
    assert.ok(tag, f + ' 找不到 richtext-content 标签')
    assert.ok(tag[0].indexOf('selectable') >= 0, f + ' 丢了 selectable，正文将无法长按选中')
  })
})

check('各页排印通过组件变量交回宿主，不被组件写死', () => {
  const css = read('components/richtext-content/richtext-content.wxss')
  assert.ok(/\.richtext-content\s*\{[^}]*var\(--rt-size/.test(css), '组件字号必须走 --rt-size，否则会把各页字号统一改掉')
  assert.ok(/\.richtext-content\s*\{[^}]*var\(--rt-color/.test(css), '组件颜色必须走 --rt-color（群公告原本是棕字）')
  // 棕色公告卡、藏蓝正文这些差异必须留在页面侧
  assert.ok(/\.notice-text[^}]*--rt-color: #6b5423/.test(read('pages/group-chat/detail.wxss')), '群公告的棕色不能丢')
})

check('复制正文类出口要剥标记', () => {
  const js = read('pages/club/club-detail.js')
  assert.ok(js.indexOf('richtext.stripMarks(club.intro)') >= 0 || js.indexOf('stripMarks(club.intro)') >= 0,
    '社团介绍的「复制」不能把 ** 这类记号一起复制出去')
})

check('组件内部统一处理链接与图片，宿主无需再抄', () => {
  const compJs = read('components/richtext-content/richtext-content.js')
  const compWxml = read('components/richtext-content/richtext-content.wxml')
  assert.ok(compJs.indexOf('richtext.openLink(') >= 0, '链接必须由组件统一按站内/webview/复制兜底处理')
  assert.ok(compJs.indexOf('wx.previewImage(') >= 0 && compJs.indexOf('imageGroup') >= 0,
    '图片预览要在组件内完成，且能并入宿主传的 imageGroup 以便左右滑动')
  assert.ok(compWxml.indexOf('catchtap="onLinkTap"') >= 0, '链接要用 catchtap，避免冒泡到段落的预览手势')
  assert.ok(compWxml.indexOf('<template is="rtRuns"') >= 0, '行内 run 应由模板复用，避免每种块级都抄一遍')
  assert.ok(compWxml.indexOf('user-select=\"{{selectable}}\"') >= 0, '可选中性由 selectable 控制并透传到每个文字节点')
})

console.log('richtext content tests passed. (' + testCount + ')')
