// 后台正文编辑器组件（components/richtext-editor）的契约护栏
//
// 这个组件是「工具栏 → utils/richtext.js 标记」的唯一入口，后台所有正文框都该走它。
// 它同时约定了一个对外契约：抛 `input` 事件、载荷 { value, cursor }，与原生 textarea 同形状，
// 宿主页面上已有的 bindinput 处理函数才能原样接上。这个契约一旦破了，所有接入点会静默失效。
const assert = require('assert')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => require('fs').readFileSync(path.join(root, p), 'utf8')

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

// 组件依赖 utils/wechat → utils/request（顶层 getApp），所以桩必须给全
const toasts = []
const captured = { options: null }
global.getApp = () => ({ globalData: { token: '' } })
global.wx = {
  showToast: (o) => toasts.push(o && o.title),
  showActionSheet: () => {},
  chooseMedia: () => {},
  showLoading: () => {},
  hideLoading: () => {}
}
global.Component = (opts) => { captured.options = opts }
require(path.join(root, 'components', 'richtext-editor', 'richtext-editor.js'))
const richtext = require(path.join(root, 'utils', 'richtext.js'))

const options = captured.options
const items = options.data.groups.reduce((all, g) => all.concat(g.items), [])

check('工具栏分组与按钮齐备', () => {
  assert.deepStrictEqual(
    options.data.groups.map((g) => g.group),
    ['inline', 'heading', 'align', 'list', 'indent', 'insert', 'view'],
    '分组顺序对应图一的分区 + 末尾的预览开关'
  )
  const labels = items.map((i) => i.label)
  ;['B', 'I', 'U', 'S', 'A', 'H1', 'H2', 'H3', '左', '中', '右', '列表', '编号', '引用', '‹缩进', '缩进›', '链接', '分隔线', '图片', '预览']
    .forEach((label) => assert.ok(labels.indexOf(label) >= 0, '缺按钮：' + label))
  assert.strictEqual(items.length, 20, '按钮总数应为 20，实际 ' + items.length)
})

check('每个按钮走同一条分发路径，点完后重新解析确实产出对应样式', () => {
  // 关键回归点：曾经按钮插入的是空标记（**、~~~~），指望光标停在中间；
  // 小程序 textarea 的 cursor 属性在部分机型不重定位，用户就留下「你好****」这种半截标记。
  // 所以这里不看字符串长相，而是把结果重新喂给解析器，验证「按钮 → 渲染效果」真的成立。
  const EXPECT = { bold: 'rt-b', italic: 'rt-i', underline: 'rt-u', strike: 'rt-s' }
  const cases = [
    ['有正文的行', '。。 你好', '。。 你好'],
    ['带块级标记的行', '## 你好', '你好'],
    ['带对齐缩进的行', '|c| » 你好', '你好']
  ]
  Object.keys(EXPECT).forEach((cmd) => {
    cases.forEach(([label, text, wantText]) => {
      const out = richtext.applyCommand(text, text.length, 'inline', cmd)
      const runs = richtext.parseBlocks(out.text)[0].runs
      const hit = runs.find((r) => r.cls === EXPECT[cmd])
      assert.ok(hit, cmd + ' 在' + label + ' 没能产出 ' + EXPECT[cmd] + '，实际：' + JSON.stringify(out.text))
      assert.strictEqual(hit.t, wantText, cmd + ' 在' + label + ' 包住的文字不对：' + JSON.stringify(hit.t))
    })
    // 空行必须落占位词，不能留空标记
    const empty = richtext.applyCommand('', 0, 'inline', cmd)
    assert.ok(empty.text.length > 4 && richtext.parseBlocks(empty.text)[0].runs[0].t.length > 0,
      cmd + ' 在空行应落下占位文字，实际：' + JSON.stringify(empty.text))
  })

  const link = richtext.applyCommand('你好', 2, 'inline', 'link')
  const linkRun = richtext.parseBlocks(link.text)[0].runs.find((r) => r.href)
  assert.ok(linkRun, '点「链接」后解析不出可点链接，占位 URL 可能不合法：' + JSON.stringify(link.text))
  assert.strictEqual(linkRun.t, '你好', '链接应包住正文')
  const colored = richtext.applyCommand('你好', 2, 'color', '蓝')
  const colorRun = richtext.parseBlocks(colored.text)[0].runs.find((r) => r.style)
  assert.ok(colorRun && /color:#2e6bff/.test(colorRun.style), '字色应作用到整行正文：' + colored.text)

  const lineCases = [['h1', 'rt-h1'], ['h2', 'rt-h2'], ['h3', 'rt-h3'], ['bullet', 'rt-li'], ['quote', 'rt-quote']]
  lineCases.forEach(([cmd]) => {
    const out = richtext.applyCommand('你好', 2, 'line', cmd)
    const block = richtext.parseBlocks(out.text)[0]
    assert.ok(block.type !== 'p', cmd + ' 没被解析成对应块级：' + out.text)
    assert.strictEqual(block.runs.map((r) => r.t).join(''), '你好', cmd + ' 把正文吃掉了')
  })
  const numbered = richtext.parseBlocks(richtext.applyCommand('你好', 2, 'line', 'number').text)[0]
  assert.strictEqual(numbered.type, 'li-ol')
  assert.ok(richtext.parseBlocks(richtext.applyCommand('你好', 2, 'align', 'c').text)[0].cls.indexOf('rt-a-center') > 0, '居中没落到 cls')
  assert.ok(richtext.parseBlocks(richtext.applyCommand('你好', 2, 'indent', 1).text)[0].cls.indexOf('rt-i1') > 0, '缩进没落到 cls')
  assert.strictEqual(richtext.applyCommand('你好', 2, 'indent', -1).text, '你好', '零级缩进再减不应变负')
  const divider = richtext.applyCommand('你好', 2, 'divider')
  assert.ok(richtext.parseBlocks(divider.text).some((b) => b.type === 'hr'), '分隔线没解析出 hr 块')
})

check('按钮语义与标记一一对应', () => {
  // 用户报的「点了 B 出 ~~~~」这类错乱，靠这组断言钉死
  const at = (text, cmd, kind) => richtext.applyCommand(text, text.length, kind || 'inline', cmd).text
  assert.strictEqual(at('你好', 'bold'), '**你好**')
  assert.strictEqual(at('你好', 'italic'), '*你好*')
  assert.strictEqual(at('你好', 'underline'), '__你好__')
  assert.strictEqual(at('你好', 'strike'), '~~你好~~')
  assert.strictEqual(at('你好', 'l', 'align'), '|l| 你好')
  assert.strictEqual(at('你好', 'c', 'align'), '|c| 你好')
  assert.strictEqual(at('你好', 'h2', 'line'), '## 你好')
  assert.strictEqual(at('你好', 'bullet', 'line'), '- 你好')
  assert.strictEqual(at('你好', 1, 'indent'), '» 你好')
  assert.strictEqual(at('你好', '蓝', 'color'), '{蓝|你好}')
  assert.strictEqual(at('你好', 'link'), '[你好](https://payun01.cn)', '占位 URL 必须合法，否则插入的链接不被识别')
  // 再点一次取消，且不影响同一行上其它层的标记
  assert.strictEqual(at('**你好**', 'bold'), '你好')
  assert.strictEqual(at('## 你好', 'h2', 'line'), '你好')
  assert.strictEqual(at('|c| **你好**', 'bold'), '|c| 你好', '取消加粗不能把对齐一起带走')
  assert.strictEqual(at('» ## 你好', 'h3', 'line'), '» ### 你好', '换标题层级不能把缩进丢掉')
})

/** 造一个最小实例：方法全部挂上，才能测方法之间的相互调用 */
function makeInstance(text, cursor) {
  const sets = []
  const events = []
  const inst = {
    data: { text, cursor, maxlength: 5000, uploading: false },
    setData(patch, done) {
      Object.keys(patch).forEach((k) => { this.data[k] = patch[k] })
      sets.push(patch)
      if (done) done()
    },
    triggerEvent(name, detail) { events.push({ name, detail }) }
  }
  Object.keys(options.methods).forEach((name) => { inst[name] = options.methods[name] })
  inst.__sets = sets
  inst.__events = events
  return inst
}

check('对外只抛 input，载荷与原生 textarea 同形状', () => {
  const inst = makeInstance('甲乙', 2)
  options.methods.onInput.call(inst, { detail: { value: '甲乙丙', cursor: 3 } })
  const evt = inst.__events[0]
  assert.strictEqual(evt.name, 'input', '事件名必须是 input，宿主已有的 bindinput 才能直接接')
  assert.strictEqual(evt.detail.value, '甲乙丙')
  assert.strictEqual(evt.detail.cursor, 3, 'cursor 必须透传，组件自己也要跟住光标位置')
})

check('插入后光标交回宿主且受字数上限保护', () => {
  const inst = makeInstance('甲乙', 2)
  options.methods.onCmd.call(inst, { currentTarget: { dataset: { kind: 'inline', cmd: 'bold' } } })
  const last = inst.__events[inst.__events.length - 1]
  assert.strictEqual(last.detail.value, '**甲乙**', '应把整行正文包住，而不是落下空标记')
  assert.strictEqual(last.detail.cursor, 6, '光标应落在包裹后的行尾')

  const full = makeInstance('一二三', 3)
  full.data.maxlength = 3
  const before = full.__events.length
  options.methods.emit.call(full, '一二三四五', 5)
  assert.strictEqual(full.__events.length, before, '超上限时不得抛给宿主')
  assert.ok(toasts.some((t) => /不能超过/.test(t || '')), '超上限要有明确提示，不能静默吞掉')
})

check('后台四处正文框都换成共享编辑器', () => {
  const wxml = read('pkg-feature/pages/banner-detail/index.wxml')
  const json = JSON.parse(read('pkg-feature/pages/banner-detail/index.json'))
  assert.ok(wxml.indexOf('<richtext-editor') >= 0, 'banner-detail 正文框应换成组件，而不是各页自造工具栏')
  assert.strictEqual(json.usingComponents['richtext-editor'], '/components/richtext-editor/richtext-editor',
    '未在 json 注册会整块静默不渲染')

  const adminWxml = read('pkg-admin/admin/edit/index.wxml')
  const adminJson = JSON.parse(read('pkg-admin/admin/edit/index.json'))
  assert.strictEqual(adminJson.usingComponents['richtext-editor'], '/components/richtext-editor/richtext-editor',
    '独立编辑页未注册编辑器组件')
  // 这五个是面向用户的多段正文；reviewNote / signupContent / 帖子 content 等刻意不上
  ;['intro', 'notice', 'detailContent', 'detail', 'content'].forEach((key) => {
    assert.ok(adminWxml.indexOf('<richtext-editor data-key="' + key + '"') >= 0, '后台正文框未接入：' + key)
  })
  // 用总数把关：只换掉三处同名 textarea 里的第一处，也要能被这条抓到
  const editorCount = (adminWxml.match(/<richtext-editor /g) || []).length
  // 第 5 个是「信息推送群」卡片正文，渲染端 = pages/push-group-detail（见 push-group-detail.test.js）
  assert.strictEqual(editorCount, 5, '后台接入编辑器的字段应恰好是 5 个，实际 ' + editorCount + ' 个（多接的字段其渲染端没有解析器）')
  // 这些字段必须保持纯文本 textarea，它们的渲染端没有解析器
  // （intro/content/position/scopeText/featuresText 会同时出现在服务端未覆盖的分支里，故按「存在任一 textarea 版本」为准）
  const plainKept = ['signupContent', 'body', 'reviewNote', 'description']
    .filter((key) => adminWxml.indexOf('<textarea data-key="' + key + '"') < 0)
  assert.deepStrictEqual(plainKept, [], '这些字段必须保持纯文本 textarea，它们的渲染端没有解析器：缺 ' + plainKept.join(', '))
})

check('每个按钮的「标签 → kind/cmd → 渲染效果」一一对应（防按钮映射错乱）', () => {
  // 关键护栏：旧用例只验证「cmd → 标记」，从不验证「按钮 → cmd」。
  // 于是把两个按钮的 cmd 对调（例如 B 与 S），测试依然全绿，
  // 而管理员点「B」得到的就是 ~~~~ —— 这正是用户报的「按钮与功能映射错乱」。
  const EXPECT = {
    B: { kind: 'inline', cmd: 'bold', cls: 'rt-b' },
    I: { kind: 'inline', cmd: 'italic', cls: 'rt-i' },
    U: { kind: 'inline', cmd: 'underline', cls: 'rt-u' },
    S: { kind: 'inline', cmd: 'strike', cls: 'rt-s' },
    A: { kind: 'color' },
    H1: { kind: 'line', cmd: 'h1', block: 'h1' },
    H2: { kind: 'line', cmd: 'h2', block: 'h2' },
    H3: { kind: 'line', cmd: 'h3', block: 'h3' },
    左: { kind: 'align', cmd: 'l', cls: 'rt-a-left', icon: 'align-left' },
    中: { kind: 'align', cmd: 'c', cls: 'rt-a-center', icon: 'align-center' },
    右: { kind: 'align', cmd: 'r', cls: 'rt-a-right', icon: 'align-right' },
    列表: { kind: 'line', cmd: 'bullet', block: 'li', icon: 'bullet' },
    编号: { kind: 'line', cmd: 'number', block: 'li-ol', icon: 'number' },
    引用: { kind: 'line', cmd: 'quote', block: 'quote', icon: 'quote' },
    '‹缩进': { kind: 'indent', cmd: -1, glyph: '←' },
    '缩进›': { kind: 'indent', cmd: 1, cls: 'rt-i1', glyph: '→' },
    链接: { kind: 'inline', cmd: 'link', href: true, glyph: '🔗' },
    分隔线: { kind: 'divider', block: 'hr', icon: 'divider' },
    图片: { kind: 'image' },
    预览: { kind: 'preview' }
  }
  assert.deepStrictEqual(
    items.map((i) => i.label).slice().sort(),
    Object.keys(EXPECT).slice().sort(),
    '工具栏按钮集合变了，请同步本用例（新增/删除按钮都必须在这里登记）'
  )

  items.forEach((item) => {
    const want = EXPECT[item.label]
    assert.strictEqual(item.kind, want.kind, item.label + ' 的 kind 应为 ' + want.kind + '，实际 ' + item.kind)
    if (want.cmd !== undefined) {
      assert.strictEqual(item.cmd, want.cmd,
        item.label + ' 的 cmd 应为 ' + JSON.stringify(want.cmd) + '，实际 ' + JSON.stringify(item.cmd) + '（按钮与功能对调了）')
    }
    // 图标也必须与功能绑定：图标和 cmd 是两个字段，很容易「图标换了、命令没换」
    assert.strictEqual(item.icon, want.icon,
      item.label + ' 的图标应为 ' + JSON.stringify(want.icon) + '，实际 ' + JSON.stringify(item.icon))
    assert.strictEqual(item.glyph, want.glyph,
      item.label + ' 的字形应为 ' + JSON.stringify(want.glyph) + '，实际 ' + JSON.stringify(item.glyph))
    // 真跑一遍分发，确认产出与标签承诺一致
    if (['inline', 'line', 'align', 'divider'].indexOf(item.kind) >= 0) {
      const out = richtext.applyCommand('样例文字', 4, item.kind, item.cmd)
      assert.ok(out, item.label + ' 未走上任何分发分支（点了没反应）')
      const block = richtext.parseBlocks(out.text)[0]
      if (want.block) {
        if (item.kind === 'divider') {
          // 分隔线是另起一行插入的独立块，不在第一块上
          assert.ok(richtext.parseBlocks(out.text).some((b) => b.type === want.block),
            item.label + ' 应产出 ' + want.block + ' 块：' + JSON.stringify(out.text))
        } else {
          assert.strictEqual(block.type, want.block, item.label + ' 应产出 ' + want.block + '，实际 ' + block.type + '：' + out.text)
        }
      }
      if (want.cls) {
        if (item.kind === 'inline') {
          // 行内标记的类名挂在 run 上（块级类名是 rt-p/rt-h1 这类）
          assert.ok((block.runs || []).some((r) => r.cls === want.cls),
            item.label + ' 应产出 ' + want.cls + ' 的 run：' + out.text)
        } else {
          assert.ok(String(block.cls).indexOf(want.cls) > -1, item.label + ' 应产出 ' + want.cls + '，实际 ' + block.cls)
        }
      }
      if (want.href) {
        assert.ok((block.runs || []).some((r) => r.href), item.label + ' 应产出可点链接：' + out.text)
      }
    }
    if (item.kind === 'indent') {
      const out = richtext.applyCommand('样例文字', 4, 'indent', item.cmd)
      if (Number(item.cmd) === 1) {
        assert.ok(richtext.parseBlocks(out.text)[0].cls.indexOf('rt-i1') > -1, item.label + ' 应加一级缩进：' + out.text)
      }
      if (Number(item.cmd) === -1) {
        assert.strictEqual(out.text, '样例文字', item.label + ' 在零级时不得变负')
      }
    }
    if (item.kind === 'color') {
      const out = richtext.applyCommand('样例文字', 4, 'color', '蓝')
      assert.ok((richtext.parseBlocks(out.text)[0].runs || []).some((r) => /color:#2e6bff/.test(r.style)),
        item.label + ' 按钮应产出字色：' + out.text)
    }
  })
})

check('工具栏用图标替代汉字，且图标渲染分支真的接上了', () => {
  // 设计稿：对齐 / 列表 / 引用 / 缩进 / 分隔线 / 链接 用图标；
  // B I U S A 与 H1~H3 本身就是字形预览，保持文字；图片、预览按反馈保持文字。
  const TEXT_KEPT = ['B', 'I', 'U', 'S', 'A', 'H1', 'H2', 'H3', '图片', '预览']
  const ICON_BUTTONS = ['左', '中', '右', '列表', '编号', '引用', '‹缩进', '缩进›', '链接', '分隔线']
  ICON_BUTTONS.forEach((label) => {
    assert.ok(items.some((i) => i.label === label), '图标按钮缺失：' + label)
  })
  items.forEach((item) => {
    if (TEXT_KEPT.indexOf(item.label) >= 0) {
      assert.ok(!item.icon && !item.glyph, item.label + ' 应保持文字按钮，不该带图标字段')
    } else {
      assert.ok(item.icon || item.glyph, item.label + ' 应改成图标：数据里既没有 icon 也没有 glyph')
    }
  })

  const wxml = read('components/richtext-editor/richtext-editor.wxml')
  const wxss = read('components/richtext-editor/richtext-editor.wxss')
  // 渲染分支缺了不会报错，只会变成一片空白按钮 —— 必须断言到位
  assert.ok(wxml.indexOf('rt-glyph') >= 0, 'wxml 缺字形图标分支（←/→/🖼 会变空白按钮）')
  assert.ok(wxml.indexOf('rt-ic-{{item.icon}}') >= 0, 'wxml 缺几何图标分支（对齐图标会变空白按钮）')
  assert.ok(wxml.indexOf("item.icon === 'bullet'") >= 0 && wxml.indexOf("item.icon === 'divider'") >= 0,
    'wxml 缺列表/分隔线的专用图标结构')
  assert.ok(wxml.indexOf("item.icon === 'quote'") >= 0 && wxml.indexOf('rt-quote-bar') >= 0,
    'wxml 缺引用图标的专用结构')
  assert.ok(wxml.indexOf('rt-li-dot') >= 0 && wxml.indexOf('rt-li-n') >= 0,
    'wxml 缺无序列表的圆点节点或有序列表的序号节点')
  assert.ok(wxml.indexOf('{{item.label}}') >= 0, '保留文字的按钮仍需渲染 label')
  assert.ok(wxml.indexOf('aria-label="{{item.label}}"') >= 0, '图标按钮要用 aria-label 保留可读名称')
  assert.ok(wxml.indexOf("item.kind === 'preview' && preview ? 'rt-on'") >= 0,
    '预览按钮要有开启态高亮，否则用户不知道当前是否在预览')
  ;['.rt-ic', '.rt-bar', '.rt-ic-align-left', '.rt-ic-align-center', '.rt-ic-align-right',
    '.rt-ic-list', '.rt-li-dot', '.rt-ic-quote', '.rt-quote-bar', '.rt-ic-divider', '.rt-glyph', '.rt-on'].forEach((cls) => {
    assert.ok(wxss.indexOf(cls) >= 0, 'wxss 缺图标样式：' + cls)
  })

  // 三个对齐图标必须真的靠不同类名区分，否则会长得一模一样
  const alignIcons = items.filter((i) => i.kind === 'align').map((i) => i.icon)
  assert.deepStrictEqual(alignIcons, ['align-left', 'align-center', 'align-right'],
    '对齐图标必须各自区分，实际：' + alignIcons.join(', '))
  const alignRules = wxss.match(/\.rt-ic-align-(left|center|right)[^{]*\{[^}]*\}/g) || []
  assert.ok(alignRules.length >= 6, '左/中/右的横线对齐与线宽规则不完整（实际 ' + alignRules.length + ' 条）')
})

check('叠加样式不产出裸记号，且逐层可撤销', () => {
  // 回归点：曾经「在加粗行点删除线」会拼出 ~~**文字**~~，渲染时把 ** 当正文显示。
  const MARK_RE = /[*_~{}]/
  const plainText = (text) => (richtext.parseBlocks(text)[0].runs || []).map((r) => r.t).join('')
  const stacks = [
    ['**文字**', 'italic'], ['*文字*', 'bold'],
    ['__文字__', 'bold'], ['~~文字~~', 'bold'],
    ['**文字**', 'underline'], ['**文字**', 'strike'], ['**文字**', 'link']
  ]
  stacks.forEach(([text, kind]) => {
    const out = richtext.wrapLine(text, text.length, kind)
    assert.ok(!MARK_RE.test(plainText(out.text)),
      '在「' + text + '」上点 ' + kind + ' 后仍露出裸记号：' + out.text + ' -> ' + plainText(out.text))
  })

  // 粗体与斜体可叠加，且每次点击只动自己那一层
  const bold = richtext.wrapLine('文字', 2, 'bold')
  assert.strictEqual(bold.text, '**文字**')
  const bi = richtext.wrapLine(bold.text, bold.cursor, 'italic')
  assert.strictEqual(bi.text, '***文字***', '粗体上叠斜体应产出 ***粗斜***')
  assert.strictEqual(richtext.wrapLine(bi.text, bi.cursor, 'italic').text, '**文字**', '再点斜体只摘掉斜体层')
  assert.strictEqual(richtext.wrapLine(bi.text, bi.cursor, 'bold').text, '*文字*', '再点粗体只摘掉粗体层')
  assert.deepStrictEqual(
    richtext.parseBlocks('***文字***')[0].runs.map((r) => r.cls), ['rt-b rt-i'],
    '*** 必须解析成粗体+斜体，而不是露出星号')

  // 字色与行内标记组合：同色再点只摘字色，行内标记保留
  const blue = richtext.colorLine('**文字**', 6, '蓝')
  assert.strictEqual(blue.text, '{蓝|**文字**}')
  assert.ok(richtext.parseBlocks(blue.text)[0].runs.some((r) => r.cls === 'rt-b' && /color:#2e6bff/.test(r.style)),
    '字色+粗体应落在同一个 run 上')
  assert.strictEqual(richtext.colorLine(blue.text, blue.cursor, '蓝').text, '**文字**', '再点同色只摘掉字色层')
  assert.strictEqual(richtext.colorLine('{红|文字}', 6, '蓝').text, '{蓝|文字}', '换色是替换不是套娃')

  // 历史套娃字色（旧逻辑产出）也要干净渲染，不能漏出裸 }
  assert.strictEqual(plainText('{蓝|{红|文字}}'), '文字')
  assert.ok(!MARK_RE.test(plainText('{蓝|{红|文字}}')), '套娃字色不得漏出裸记号')

  // 缩进：dataset 可能把数字退化成字符串，两种形态都必须生效
  assert.strictEqual(richtext.applyIndent('» 文字', 4, -1).text, '文字')
  assert.strictEqual(richtext.applyIndent('» 文字', 4, '-1').text, '文字', '字符串 cmd 也要能减缩进')
  assert.strictEqual(richtext.applyIndent('» » 文字', 6, '1').text, '» » » 文字')
})

check('后台审核详情页对富文本字段也用渲染组件，不漏裸标记', () => {
  // 回归点：这三处的正文曾在审核详情里用纯 <text>{{x}}</text> 直吐原文，
  // 于是编辑框里写 **重要提示**，审核人看到的就是带星号的裸标记 —— 与用户端口径不一致。
  // 其中 activityAuditDetail.detailContent 最典型：它正是后台 richtext-editor 编辑的字段。
  const adminWxml = read('pkg-admin/admin/index.wxml')
  const adminJson = JSON.parse(read('pkg-admin/admin/index.json'))
  assert.strictEqual(adminJson.usingComponents['richtext-content'],
    '/components/richtext-content/richtext-content',
    '后台未注册 richtext-content（漏了会整块静默不渲染，图标/正文消失且无报错）')

  const RICH_AUDIT = [
    ['clubAuditDetail.intro', '社团介绍'],
    ['chatApplyDetail.intro', '群介绍'],
    ['activityAuditDetail.detailContent', '活动介绍']
  ]
  RICH_AUDIT.forEach(([field, label]) => {
    const re = new RegExp('<richtext-content[^>]*content="\\{\\{' + field.replace('.', '\\.') + '\\}\\}"')
    assert.ok(re.test(adminWxml), label + '（' + field + '）未走 richtext-content，审核人将看到裸标记')
    // 同时确认没有残留的纯文本直吐
    assert.ok(adminWxml.indexOf('<text class="audit-detail-line">{{' + field + '}}</text>') < 0,
      label + ' 的纯文本渲染分支还在，改回组件时没删干净')
  })

  // 纯文本字段不得误上组件（它们没有解析器，上了会暴露标记语义）
  ;['clubAuditDetail.reviewNote', 'chatApplyDetail.reviewNote', 'activityAuditDetail.auditNote']
    .forEach((field) => {
      assert.ok(adminWxml.indexOf('content="{{' + field + '}}"') < 0,
        field + ' 是管理员手写的纯文本审核意见，不该走标记解析')
    })
})

check('预览默认打开，且编辑器不把预览态写死', () => {
  // 诉求：管理员写正文时不该费劲猜 ** 会渲染成什么，默认就把渲染效果展开。
  assert.strictEqual(options.data.preview, true, '预览默认值应为 true（默认展开渲染效果）')
  // 必须是可切换的：仍要保留 onCmd 的取反分支，否则默认打开就变成「关不掉」
  const cmdSrc = String(options.methods.onCmd)
  assert.ok(/kind === 'preview'/.test(cmdSrc) && /!this\.data\.preview/.test(cmdSrc),
    '「预览」按钮仍须可切换（点击取反），不能被写死成常开')
})

check('四个自定义页面共用底部跳转按钮组件，且都接了 link/linkText', () => {
  // 关键：「保持一致」不能靠四个页面各抄一份按钮（会走出四种圆角与间距），
  // 也不能只加输入框而用户端不渲染（管理员配了没人看得到）。两头都要钉住。
  const PAGES = [
    ['pages/campus-service/index', 'servicePage'],
    ['pkg-feature/pages/driving-school/guide', 'page'],
    ['pkg-feature/pages/driving-school/landing', 'page'],
    ['pkg-feature/pages/market/index', 'page']
  ]
  PAGES.forEach(([base, obj]) => {
    const wxml = read(base + '.wxml')
    const json = JSON.parse(read(base + '.json'))
    assert.strictEqual(json.usingComponents['page-link-button'],
      '/components/page-link-button/page-link-button',
      base + '.json 未注册 page-link-button（漏了整块静默不渲染，且开发者工具外无报错）')
    const re = new RegExp('<page-link-button[^>]*link="\\{\\{' + obj + '\\.link\\}\\}"[^>]*link-text="\\{\\{' + obj + '\\.linkText\\}\\}"')
    assert.ok(re.test(wxml), base + ' 未把 ' + obj + '.link / linkText 交给按钮组件')
  })

  // 组件本身：链接为空不渲染、复用统一跳转口径（不自己另写一套导航）
  const compJs = read('components/page-link-button/page-link-button.js')
  const compWxml = read('components/page-link-button/page-link-button.wxml')
  assert.ok(compJs.indexOf('richtext.openLink(') >= 0,
    '按钮跳转必须复用 utils/richtext.openLink，否则正文链接与按钮链接会出现两套行为')
  assert.ok(compWxml.indexOf('wx:if="{{show}}"') >= 0, '链接为空时必须整块不渲染，老页面不该多出空按钮')

  // 服务端：字段要真的落库并能读回，否则输入框就是假的
  // 注意：横幅那边也有同名的 `link: String(meta.link || '')`，全局 search 会被那几处蒙混过关，
  // 所以必须把断言限定在 parseServicePage / buildServicePagePayload 各自的函数体内。
  const ctrl = read('server/controllers/configController.js')
  const fnBody = (name, nextName) => {
    const start = ctrl.indexOf('function ' + name + '(')
    assert.ok(start >= 0, '找不到函数 ' + name)
    const end = nextName ? ctrl.indexOf('function ' + nextName + '(', start) : ctrl.length
    return ctrl.slice(start, end > start ? end : ctrl.length)
  }
  const parseBody = fnBody('parseServicePage', 'listServicePages')
  assert.ok(parseBody.indexOf("link: String(meta.link || '')") >= 0, 'parseServicePage 未回传 link')
  assert.ok(parseBody.indexOf("linkText: String(meta.linkText || '')") >= 0, 'parseServicePage 未回传 linkText')

  const buildBody = fnBody('buildServicePagePayload', 'createServicePage')
  assert.ok(/meta\.link = link\b/.test(buildBody), 'buildServicePagePayload 未把 link 写入 meta')
  assert.ok(/meta\.linkText = link \? rawLinkText : ''/.test(buildBody),
    'buildServicePagePayload 未把 linkText 写入 meta（且链接为空时应一并清空文字）')
  // 断言调用表达式本身（不是只出现标识符）。
  // 2026-10-08：校验抽成 server/utils/link.js 的 isNavigableLink，
  // 口径扩到分包 /pkg-feature/pages/...，见 tests/miniprogram-link-routing.test.js
  assert.ok(/isNavigableLink\(link\)/.test(buildBody),
    '链接未做取值校验（javascript: 等会被落库）')

  // 表单：自定义页面与横幅共用同一组输入框（不得再被 !isCard 挡掉）
  const editorWxml = read('pkg-feature/pages/banner-detail/index.wxml')
  // 跳转链接改成 components/link-picker（选页面 / 选帖子 / 手动输入），
  // 不再是裸 input —— 但「表单里必须有这两个字段」这件事不变，断言跟着改成组件形态。
  assert.ok(editorWxml.indexOf('value="{{form.link}}"') >= 0,
    '编辑表单缺跳转链接字段（应接 components/link-picker 的 value）')
  assert.ok(editorWxml.indexOf('data-field="linkText"') >= 0,
    '编辑表单缺链接文字输入框')
  // 自定义页面（校园卡等）也要能看到：不能只给横幅显示
  const cardOnly = /<block wx:if="\{\{!isCard\}\}">[\s\S]{0,600}value="\{\{form\.link\}\}"/.test(editorWxml)
  assert.ok(!cardOnly, '跳转链接仍被 !isCard 挡住，自定义页面（校园卡等）表单里看不到它')

  // 编辑器回填不得把 link 清空（曾硬编码 link:'' 导致保存后链接消失）
  const editorJs = read('pkg-feature/pages/banner-detail/index.js')
  assert.ok(/link: raw\.link \|\| ''/.test(editorJs), 'loadBanner 回填时清空了 link，管理员保存后链接会丢')
  assert.ok(/link, linkText \}/.test(editorJs), '自定义页面的 payload 未带上 link/linkText')
})

console.log('richtext editor tests passed. (' + testCount + ')')