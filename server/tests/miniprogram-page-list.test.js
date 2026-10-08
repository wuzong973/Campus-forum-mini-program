// 后台「跳转路径」选择器 + 页面清单的护栏。
//
// 背景（2026-10-08）：后台原先让运营手打 `/pkg-feature/pages/activity/index` 这种路径，
// 甲方反馈太麻烦，且实际连续踩了三个坑 —— 填了微信短链 `#小程序://...`、漏了分包前缀、
// 带了 `.html` 后缀。改成「从页面列表选」+「手动输入自动纠错」。
//
// 本文件锁三件事：
//   A. 页面清单必须覆盖 app.json 的每一个页面（要么在清单、要么在带理由的排除表）——
//      漏登记会让某页永远选不到，而且是静默的
//   B. 自动纠错各条规则逐条有效，且不误伤（外链、主包真实页面、query 里的点）
//   C. 后台真的接上了选择器（picker + 三个 handler + 保存前归一化与校验）
const assert = require('assert')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

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

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
}

function methodBody(src, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    '(?:^|[\\s,{;])' + safe + '\\s*(?:=\\s*(?:async\\s*)?)?\\([^)]*\\)\\s*(?:=>\\s*)?\\{',
    'm'
  )
  const m = re.exec(src)
  if (!m) return ''
  const start = src.indexOf('{', m.index + m[0].length - 1)
  if (start < 0) return ''
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return ''
}

const pageList = require(path.join(root, 'utils', 'page-list.js'))
const link = require(path.join(root, 'utils', 'link.js'))
const appJson = JSON.parse(read('app.json'))

// 全站跳转配置点共用的组件（路径相对项目根）
const LINK_PICKER = 'components/link-picker/link-picker'

const APP_PAGES = []
;(appJson.pages || []).forEach((p) => APP_PAGES.push('/' + p))
;(appJson.subPackages || appJson.subpackages || []).forEach((sp) => {
  sp.pages.forEach((p) => APP_PAGES.push('/' + sp.root + '/' + p))
})

// ============ A. 清单与 app.json 必须完全对齐 ============

check('app.json 的每个页面都被登记（清单内或排除表里）', () => {
  const missing = APP_PAGES.filter(
    (p) => !pageList.PAGE_PATH_SET[p] && !pageList.EXCLUDED[p]
  )
  assert.deepStrictEqual(
    missing,
    [],
    '有页面既不在跳转清单、也不在排除表里 → 后台永远选不到它：\n  ' + missing.join('\n  ')
  )
})

check('清单与排除表里没有 app.json 已不存在的页面', () => {
  const listed = Object.keys(pageList.PAGE_PATH_SET).concat(Object.keys(pageList.EXCLUDED))
  const stale = listed.filter((p) => APP_PAGES.indexOf(p) < 0)
  assert.deepStrictEqual(
    stale,
    [],
    '这些页面已从 app.json 移除，但仍留在清单/排除表里：\n  ' + stale.join('\n  ')
  )
})

check('清单与排除表不重叠', () => {
  const both = Object.keys(pageList.PAGE_PATH_SET).filter((p) => pageList.EXCLUDED[p])
  assert.deepStrictEqual(both, [], '同一个页面不能既可选又被排除：' + both.join(', '))
})

check('排除表每一项都写了理由', () => {
  Object.keys(pageList.EXCLUDED).forEach((p) => {
    const why = String(pageList.EXCLUDED[p] || '').trim()
    assert.ok(why.length >= 4, p + ' 的排除理由太短或为空，后人看不出为什么不让选')
  })
})

check('清单每项都有中文名与合法路径', () => {
  assert.ok(pageList.PAGES.length > 0, '清单为空')
  pageList.PAGES.forEach((p) => {
    assert.ok(p.name && p.name.trim(), p.path + ' 缺中文名（后台会显示成空白项）')
    assert.ok(/^\//.test(p.path), p.path + ' 不是以 / 开头的站内路径')
    assert.ok(
      !link.linkRejectReason(p.path),
      p.path + ' 本身就被链接校验拒绝，选它等于给运营挖坑：' + link.linkRejectReason(p.path)
    )
  })
})

check('清单路径无重复', () => {
  const seen = {}
  const dup = []
  pageList.PAGES.forEach((p) => {
    if (seen[p.path]) dup.push(p.path)
    seen[p.path] = true
  })
  assert.deepStrictEqual(dup, [], '清单里有重复路径：' + dup.join(', '))
})

check('picker 选项与清单一一对应，label 形如「分组 / 名称」', () => {
  assert.strictEqual(pageList.PICKER_OPTIONS.length, pageList.PAGES.length, 'picker 选项数与清单不一致')
  pageList.PICKER_OPTIONS.forEach((o, i) => {
    assert.strictEqual(o.path, pageList.PAGES[i].path, '第 ' + i + ' 项路径错位')
    assert.strictEqual(o.label, pageList.PAGES[i].group + ' / ' + pageList.PAGES[i].name, 'label 拼装与分组不一致')
    assert.strictEqual(pageList.pageIndexOf(o.path), i, 'pageIndexOf 没能反查到第 ' + i + ' 项')
    assert.strictEqual(pageList.nameOf(o.path), pageList.PAGES[i].name, 'nameOf 与清单不一致')
  })
})

// 行为判据（不是按文件名猜）：页面 onLoad 里若写了「缺参数就退出」的守卫，
// 就说明它不能无参打开，不该出现在可选清单里。
// ⚠ 一开始按名字匹配 /(detail|target|profile)$/，把 /pkg-feature/pages/club/detail 误报了 ——
//   它其实用 `options.id || ''` 兜底、无参也能打开。名字不可靠，行为才可靠。
const PARAM_GUARD_RE = /if\s*\(\s*!\s*(?:\w+\.)?(id|postId|url|profileId|targetId|groupId|clubId|activityId)\b[^)]*\)\s*\{?[^}]{0,80}(return|failBack|notFound)/

function onLoadBody(pagePath) {
  const file = path.join(root, pagePath.replace(/^\//, '') + '.js')
  if (!fs.existsSync(file)) return ''
  const src = fs.readFileSync(file, 'utf8')
  const m = src.match(/onLoad\s*\(([^)]*)\)\s*\{/)
  if (!m) return ''
  const start = src.indexOf('{', m.index + m[0].length - 1)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return ''
}

check('可选清单里的页面都不能有「缺参数就退出」的守卫', () => {
  const bad = pageList.PAGES.filter((p) => PARAM_GUARD_RE.test(onLoadBody(p.path)))
  assert.deepStrictEqual(
    bad.map((p) => p.path),
    [],
    '这些页面缺参数打不开，却进了可选清单，运营选中后点了会报错：\n  ' + bad.map((p) => p.path).join('\n  ')
  )
})

check('需要参数的详情页确实都在排除表里', () => {
  const MUST_EXCLUDE = [
    '/pages/post-detail/index',
    '/pages/profile/index',
    '/pages/errand-detail/index',
    '/pages/webview/index',
    '/pages/campus-service/index',
    '/pkg-feature/pages/activity/detail',
    '/pkg-feature/pages/review/target',
    '/pkg-feature/pages/club/club-detail',
    '/pkg-feature/pages/group-chat/detail',
    '/pkg-feature/pages/driving-school/detail'
  ]
  MUST_EXCLUDE.forEach((p) => {
    assert.ok(pageList.EXCLUDED[p], p + ' 必须带参数，却没写进排除表（后人看不出为什么不让选）')
    assert.ok(!pageList.PAGE_PATH_SET[p], p + ' 出现在可选清单里了，选中后缺参数打不开')
  })
})

// ============ B. 自动纠错 ============

const NORMALIZE_CASES = [
  // [输入, 期望输出, 说明]
  ['/pkg-feature/pages/activity/index.html', '/pkg-feature/pages/activity/index', '去掉 .html'],
  ['pkg-feature/pages/activity/index', '/pkg-feature/pages/activity/index', '补前导斜杠'],
  ['https://payun01.cn/pkg-feature/pages/activity/index', '/pkg-feature/pages/activity/index', '去掉站点域名'],
  ['https://payun01.cn/pkg-feature/pages/activity/index.html', '/pkg-feature/pages/activity/index', '域名+后缀一起修'],
  // ⚠ 本站**外链**不能被去域名：https://payun01.cn/xxx.html 本意是走 webview 打开网页，
  //   改成 /xxx.html 会变成不存在的站内路径，再被校验拦下 → 「合法外链却保存不了」。
  //   （2026-10-08 冒烟测试实测抓到）
  ['https://payun01.cn/page.html', 'https://payun01.cn/page.html', '本站外链（非页面路径）不得被去域名'],
  ['https://payun01.cn/wechat-qr.html', 'https://payun01.cn/wechat-qr.html', '本站 H5 页不得被改写'],
  ['https://payun01.cn/uploads/a.jpg', 'https://payun01.cn/uploads/a.jpg', '本站图片地址不得被改写'],
  ['/pages/activity/index', '/pkg-feature/pages/activity/index', '补分包前缀（pkg-feature）'],
  ['pages/activity/index', '/pkg-feature/pages/activity/index', '补斜杠+补分包前缀'],
  ['/pages/schedule-home/index', '/pkg-schedule/schedule-home/index', '补分包前缀（pkg-schedule，内层不带 pages/）'],
  ['/schedule-home/index', '/pkg-schedule/schedule-home/index', '补分包前缀（无 pages/）'],
  ['/pages/account-settings/index', '/pkg-user/pages/account-settings/index', '补分包前缀（pkg-user）'],
  // —— 反向保护：这些必须原样不动，改坏就是新 bug ——
  ['/pages/index/index', '/pages/index/index', '主包真实页面不得被加前缀'],
  ['/pages/schedule/index', '/pages/schedule/index', 'tabBar 主包页面不得被改'],
  ['/pkg-feature/pages/activity/index', '/pkg-feature/pages/activity/index', '已正确的不动'],
  ['/pages/post-detail/index?id=3', '/pages/post-detail/index?id=3', '详情页带 query 不动'],
  ['https://other.com/x.html', 'https://other.com/x.html', '外链不动（.html 是正常的）'],
  ['#小程序://帕云校园/abc', '#小程序://帕云校园/abc', '微信短链不动（交给校验去拒绝）'],
  ['', '', '空串不动']
]

check('自动纠错：每条规则与每条反向保护都成立', () => {
  NORMALIZE_CASES.forEach(([input, want, why]) => {
    const got = link.normalizePagePath(input).value
    assert.strictEqual(got, want, why + '：' + JSON.stringify(input) + ' → ' + JSON.stringify(got))
  })
})

check('自动纠错：changed 与 notes 如实反映，便于后台提示管理员', () => {
  const noop = link.normalizePagePath('/pkg-feature/pages/activity/index')
  assert.strictEqual(noop.changed, false, '没改动时 changed 必须为 false')
  assert.deepStrictEqual(noop.notes, [], '没改动时不该有 notes')

  const fixed = link.normalizePagePath('https://payun01.cn/pkg-feature/pages/activity/index.html')
  assert.strictEqual(fixed.changed, true, '有改动时 changed 必须为 true')
  assert.ok(fixed.notes.length >= 2, '改了多处就该有多条说明，实际 ' + JSON.stringify(fixed.notes))
  fixed.notes.forEach((n) => assert.ok(String(n).trim().length >= 2, 'notes 里有空说明'))
})

check('自动纠错后的值一定能通过校验（纠错与校验不能互相打架）', () => {
  NORMALIZE_CASES.forEach(([input]) => {
    const fixed = link.normalizePagePath(input).value
    if (!fixed) return
    // 外链与短链不归 normalizePagePath 修，校验拒绝它们是对的
    if (link.isWebUrl(fixed) || fixed.indexOf('#') === 0) return
    assert.ok(
      !link.linkRejectReason(fixed),
      '纠错后的值仍被拒绝：' + JSON.stringify(input) + ' → ' + JSON.stringify(fixed)
      + '（' + link.linkRejectReason(fixed) + '）'
    )
  })
})

check('页面存在性检查：清单外且无参数的路径要拦，带参数的详情页要放行', () => {
  assert.strictEqual(pageList.pageExistenceReason(''), '', '空串不归它管')
  assert.strictEqual(pageList.pageExistenceReason('https://a.com'), '', '外链不归它管')
  assert.strictEqual(pageList.pageExistenceReason('/pkg-feature/pages/activity/index'), '', '清单内的页面应放行')
  assert.strictEqual(pageList.pageExistenceReason('/pages/post-detail/index?id=3'), '', '带参数的详情页应放行')
  assert.strictEqual(pageList.pageExistenceReason('/pages/campus-service/index?id=3'), '', '被排除但带参数的页面应放行')
  assert.ok(pageList.pageExistenceReason('/pages/typo/index'), '清单外且无参数的路径必须拦下（大概率拼错）')
  assert.ok(
    pageList.pageExistenceReason('/pkg-feature/pages/activiti/index'),
    '拼错的分包路径必须拦下'
  )
})

// ============ C. 后台接线 ============

check('页面搜索：中文名 / 分组 / 路径都能命中，空关键词返回全部', () => {
  const all = pageList.searchPages('')
  assert.strictEqual(all.length, pageList.PICKER_OPTIONS.length, '空关键词必须返回全部（后台初始就展示全量）')

  const byName = pageList.searchPages('校园活动')
  assert.ok(byName.length >= 1, '按中文名搜不到「校园活动」')
  assert.ok(
    byName.some((o) => o.path === '/pkg-feature/pages/activity/index'),
    '按中文名搜「校园活动」没命中活动页：' + byName.map((o) => o.label).join(' / ')
  )

  const byGroup = pageList.searchPages('教务')
  assert.ok(byGroup.length >= 5, '按分组搜「教务」命中太少：' + byGroup.length)

  const byPath = pageList.searchPages('schedule')
  assert.ok(byPath.length >= 5, '按路径片段搜「schedule」命中太少：' + byPath.length)

  // 大小写不敏感
  assert.strictEqual(
    pageList.searchPages('SCHEDULE').length,
    pageList.searchPages('schedule').length,
    '搜索应大小写不敏感'
  )

  assert.deepStrictEqual(pageList.searchPages('这个词肯定搜不到xyz'), [], '搜不到时应返回空数组')
})

check('搜索按命中位置排序：中文名命中要排在「仅分组命中」之前', () => {
  // 搜「活动」时分组名「社团与活动」整体命中，若不排序会把
  // 「校园活动」「发布活动」压到后面 —— 运营得往下翻才找得到，等于没搜。
  const r = pageList.searchPages('活动')
  const nameHitIdx = r.findIndex((o) => o.path === '/pkg-feature/pages/activity/index')
  assert.ok(nameHitIdx > -1, '搜「活动」没命中校园活动')
  assert.strictEqual(
    nameHitIdx,
    0,
    '中文名精确命中的「校园活动」应排第一，实际第 ' + (nameHitIdx + 1) + ' 项是 ' + r[0].label
  )
  // 名称命中的都要排在仅分组命中的前面
  const nameHits = r.filter((o) => pageList.nameOf(o.path).indexOf('活动') > -1)
  const rest = r.filter((o) => pageList.nameOf(o.path).indexOf('活动') < 0)
  const lastNameHit = nameHits.length ? r.indexOf(nameHits[nameHits.length - 1]) : -1
  const firstRest = rest.length ? r.indexOf(rest[0]) : r.length
  assert.ok(
    lastNameHit < firstRest,
    '中文名命中的结果必须整体排在仅分组命中的结果之前'
  )
})

check('搜索结果里的每一项都真实存在于清单（按下标回查会错位，必须按 path）', () => {
  ;['', '活动', '课', 'schedule'].forEach((kw) => {
    pageList.searchPages(kw).forEach((o) => {
      assert.ok(
        pageList.PAGE_PATH_SET[o.path],
        '搜索结果里有清单外的路径：' + o.path
      )
      assert.strictEqual(pageList.nameOf(o.path) !== '', true, o.path + ' 在清单里但查不到中文名')
    })
  })
})

check('帖子详情页路径拼装：只有正整数 id 才产出路径', () => {
  assert.strictEqual(pageList.postDetailPath(123), '/pages/post-detail/index?id=123', '正常 id 拼装错误')
  assert.strictEqual(pageList.postDetailPath('456'), '/pages/post-detail/index?id=456', '字符串数字应可用')
  ;[0, -1, '', null, undefined, 'abc', 1.5, NaN].forEach((v) => {
    assert.strictEqual(
      pageList.postDetailPath(v),
      '',
      '非法 id 必须返回空串（否则会拼出 ?id=NaN 这种打不开的路径）：' + JSON.stringify(v)
    )
  })
  // 拼出来的路径必须能过校验（详情页带 query 属于放行范围）
  assert.strictEqual(link.linkRejectReason(pageList.postDetailPath(1)), '', '帖子详情路径被格式校验拒绝了')
  assert.strictEqual(
    pageList.pageExistenceReason(pageList.postDetailPath(1)),
    '',
    '帖子详情路径被存在性校验拒绝了（带 query 的详情页应放行）'
  )
})

check('帖子显示标题：title 为空时退回正文摘要（否则满屏「无标题」）', () => {
  const format = require(path.join(root, 'utils', 'format.js'))
  // 实测 forum_post 353 行里 352 行 title 为空 —— 所以「title 空」是主路径，不是边角
  assert.strictEqual(
    format.postTitle({ title: '', content: '学校哪里招兼职嘛' }),
    '学校哪里招兼职嘛',
    'title 为空时必须退回正文'
  )
  assert.strictEqual(
    format.postTitle({ title: '失物招领', content: '在图书馆丢了一把伞' }),
    '失物招领',
    'title 有值时应优先用 title'
  )
  assert.strictEqual(
    format.postTitle({ title: '', content: '出个二手自行车[图片]' }),
    '出个二手自行车',
    '正文末尾的媒体占位要剥掉'
  )
  assert.strictEqual(
    format.postTitle({ title: '', content: '第一行\n\n第二行   第三行' }),
    '第一行 第二行 第三行',
    '换行与连续空白要压成单个空格，否则列表行高会被撑开'
  )
  assert.ok(
    format.postTitle({ title: '', content: '一二三四五六七八九十'.repeat(6) }).length <= 43,
    '长正文要截断，不能整段塞进列表'
  )
  // 含 null / undefined：调用方传进来的 row 可能整个是空（接口返回缺项），
  // 只测 {} 是测不到「忘了兜底 row 本身」的
  ;[null, undefined, { title: '', content: '' }, { title: null, content: null }, {}, { title: '  ', content: '  ' }]
    .forEach((row) => {
      assert.strictEqual(
        format.postTitle(row),
        '',
        '全空应返回空串（由调用方兜底），实际：' + JSON.stringify(format.postTitle(row))
      )
    })
})

check('选帖子的结果项必须走 format.postTitle，不能只读 row.title', () => {
  const js = read(LINK_PICKER + '.js')
  const postSearch = stripComments(methodBody(js, 'searchPosts'))
  assert.ok(postSearch.length > 0, '没切出 searchPosts 的函数体')
  statementLine(postSearch, /title:\s*format\.postTitle\(row\)/, '用 format.postTitle 生成标题')
  assert.ok(
    !/title:\s*String\(row\.title/.test(postSearch),
    '又写回了只读 row.title —— 论坛帖 title 基本为空，会满屏「（无标题）」'
  )
  statementLine(postSearch, /subText:\s*\[/, '副行在 js 里拼好（作者 · 分类 · 时间）')
})

// ============ C2. 全站跳转配置点必须共用 components/link-picker ============
// 曾经只有首页轮播做了选择器，别处还是「手打路径 + 只认 /pages/」，
// 运营换个入口又踩同样的坑。现在统一抽成组件，这里锁「哪些位置必须用组件」。

check('link-picker 组件四件套齐全且三模式都在', () => {
  ;['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    const p = LINK_PICKER + '.' + ext
    assert.ok(fs.existsSync(path.join(root, p)), '缺少组件文件 ' + p)
  })
  const wxml = stripComments(read(LINK_PICKER + '.wxml'))
  ;['pick', 'post', 'manual'].forEach((m) => {
    assert.ok(
      new RegExp('data-mode="' + m + '"').test(wxml),
      '组件缺少 data-mode="' + m + '" 的模式入口'
    )
  })
  // 选页面：搜索框 + 结果列表 + 点选（原生 picker 不能搜索，57 项翻不动）
  assert.ok(/bindinput="onPageSearch"/.test(wxml), '选页面模式没有搜索框')
  assert.ok(/bindtap="onPagePickItem"/.test(wxml), '搜索结果没有点选事件')
  assert.ok(/data-path="\{\{item\.path\}\}"/.test(wxml), '搜索结果必须用 data-path 传路径（下标会错位）')
  // 选帖子
  assert.ok(/bindinput="onPostSearchInput"/.test(wxml), '选帖子模式没有搜索框')
  assert.ok(/bindtap="onPostPickItem"/.test(wxml), '帖子结果没有点选事件')
  assert.ok(/data-id="\{\{item\.id\}\}"/.test(wxml), '帖子结果必须用 data-id 传帖子 id')
  // 手动输入
  assert.ok(/bindblur="onManualBlur"/.test(wxml), '手动输入没接失焦纠错')
  // 对外只走 change 事件
  assert.ok(/triggerEvent\(\s*'change'/.test(read(LINK_PICKER + '.js')), '组件没有通过 change 事件回传路径')
})

check('主包组件不得引用分包文件（主包解析不到分包，会直接崩）', () => {
  // components/link-picker 在主包，pkg-admin 与 pkg-feature 都要用它。
  // 它一旦 require 了 pkg-admin/utils/admin.js 这类分包文件，真机上会报
  // module not found —— 所以帖子搜索必须自己走 utils/request。
  function requiresOf(f) {
    const js = read(f)
    const out = []
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g
    let m
    while ((m = re.exec(js))) out.push(m[1])
    return out
  }

  // 这两个文件本来就该有 require，用来证明扫描正则没失效
  // （utils/page-list.js 是纯数据模块，0 个 require 是正常的，不能拿它自证）
  ;[LINK_PICKER + '.js', 'utils/link.js'].forEach((f) => {
    assert.ok(requiresOf(f).length > 0, f + ' 没扫到 require，扫描正则可能失效了')
  })

  const ALL = [LINK_PICKER + '.js', 'utils/link.js', 'utils/page-list.js', 'utils/format.js']
  ALL.forEach((f) => {
    const bad = requiresOf(f).filter((r) => /(^|\/)pkg-[A-Za-z0-9_-]+\//.test(r))
    assert.deepStrictEqual(
      bad,
      [],
      f + ' 引用了分包文件（主包解析不到，真机会崩）：' + bad.join(', ')
    )
  })
})

check('组件注册在两个使用方的 json 里', () => {
  ;['pkg-admin/admin/edit/index.json', 'pkg-feature/pages/banner-detail/index.json'].forEach((f) => {
    const cfg = JSON.parse(read(f))
    const uc = cfg.usingComponents || {}
    assert.strictEqual(
      uc['link-picker'],
      '/components/link-picker/link-picker',
      f + ' 没注册 link-picker（漏了会整块静默不渲染）'
    )
  })
})

// 全站「跳转路径」配置点：每个都必须用组件，且绑到正确的字段上
const LINK_PICKER_SITES = [
  ['pkg-admin/admin/edit/index.wxml', 'form.meta.link', 'onLinkPicked', '首页轮播'],
  ['pkg-admin/admin/edit/index.wxml', 'form.meta.linkUrl', 'onNoticeLinkPicked', '公告右侧链接'],
  ['pkg-admin/admin/edit/index.wxml', 'form.meta.link', 'onPublishBannerLinkPicked', '发布横幅'],
  ['pkg-admin/admin/edit/index.wxml', 'form.link', 'onPushGroupLinkPicked', '推送群卡片'],
  ['pkg-feature/pages/banner-detail/index.wxml', 'form.link', 'onLinkPicked', '自定义页面底部按钮']
]

check('每个跳转配置点都换成了 link-picker，且绑到正确字段', () => {
  LINK_PICKER_SITES.forEach(([file, field, handler, what]) => {
    const wxml = stripComments(read(file))
    const re = new RegExp(
      '<link-picker[^>]*value="\\{\\{' + field.replace('.', '\\.') + '\\}\\}"[^>]*bind:change="' + handler + '"'
    )
    assert.ok(
      re.test(wxml),
      what + '（' + file + '）没有换成 <link-picker value="{{' + field + '}}" bind:change="' + handler + '">'
    )
  })
})

check('跳转配置点不再遗留裸 input（会绕过选择器与纠错）', () => {
  const wxml = stripComments(read('pkg-admin/admin/edit/index.wxml'))
  // meta.link / meta.linkUrl / form.link 这三类字段都不该再出现裸 input
  const bare = []
  const re = /<input[^>]*data-key="(meta\.link|meta\.linkUrl|link)"[^>]*>/g
  let m
  while ((m = re.exec(wxml))) bare.push(m[1])
  // 服务项的 H5 链接是唯一例外（只支持外部网址，见下一条）
  assert.deepStrictEqual(
    bare,
    ['link'],
    '还有跳转路径字段留着裸 input（运营会绕过选择器直接手打）：' + bare.join(', ')
  )
})

check('服务项的 H5 链接不加选择器（那里只支持外部网址）', () => {
  const wxml = stripComments(read('pkg-admin/admin/edit/index.wxml'))
  // 用户端 pages/index/index.js 的 onServiceTap 对非 http(s) 链接直接提示
  // 「该服务链接暂不可用」—— 页面路径在那里走不通，给选择器等于挖坑。
  const label = wxml.match(/<view class="form-label">H5 链接[^<]*<\/view>/)
  assert.ok(label, '找不到服务项的 H5 链接字段')
  assert.ok(
    label[0].indexOf('http(s)') > -1 && label[0].indexOf('页面路径') > -1,
    '服务项字段要写明「只支持 http(s)、页面路径不可用」，否则运营会填页面路径然后点了没反应：' + label[0]
  )
  const serviceBlock = wxml.slice(wxml.indexOf('H5 链接'), wxml.indexOf('H5 链接') + 600)
  assert.ok(
    serviceBlock.indexOf('<link-picker') < 0,
    '服务项不该用 link-picker（页面路径在那里无效）'
  )
})

// ⚠ 统一用「语句级」断言：把函数体按行切开，找出真正执行该动作的那一行。
// 只查子串会被「标识符出现在注释里 / 挂在 if (false) 分支 / 出现在另一处不相干的
// 判断条件里」骗过去 —— 这三类反向验证都实测漏网过。
function statementLine(body, re, what) {
  const line = body.split('\n').find((l) => re.test(l))
  assert.ok(line, '没找到「' + what + '」的语句：' + re)
  return line.trim()
}

check('组件的 handler 都真实存在且行为正确', () => {
  const js = read(LINK_PICKER + '.js')
  const search = stripComments(methodBody(js, 'onPageSearch'))
  const pick = stripComments(methodBody(js, 'onPagePickItem'))
  const postInput = stripComments(methodBody(js, 'onPostSearchInput'))
  const postSearch = stripComments(methodBody(js, 'searchPosts'))
  const postPick = stripComments(methodBody(js, 'onPostPickItem'))
  const mode = stripComments(methodBody(js, 'onModeChange'))
  const blur = stripComments(methodBody(js, 'onManualBlur'))
  ;[['onPageSearch', search], ['onPagePickItem', pick], ['onPostSearchInput', postInput],
    ['searchPosts', postSearch], ['onPostPickItem', postPick], ['onModeChange', mode],
    ['onManualBlur', blur]].forEach(([name, body]) => {
    assert.ok(body.length > 0, name + ' 没切出函数体')
  })

  // 搜索：结果必须来自 searchPages，不能是未过滤的全量
  statementLine(search, /pageResults:\s*pageList\.searchPages\(/, '搜索过滤并写入 pageResults')

  // 点选页面 / 帖子：都必须 emit 出去（只 setData 本地值的话宿主收不到）
  statementLine(pick, /this\.emit\(path\)/, '选中页面后 emit 给宿主')
  statementLine(postPick, /this\.emit\(path\)/, '选中帖子后 emit 给宿主')

  // 帖子搜索：必须防抖（否则逐字打接口）
  statementLine(postInput, /clearTimeout\(/, '清掉上一次的定时器')
  statementLine(postInput, /setTimeout\(\s*\(\)\s*=>\s*this\.searchPosts\(\)/, '延迟触发 searchPosts')

  // 帖子搜索请求：关键词与条数都要传
  statementLine(postSearch, /request\.get\(\s*POST_SEARCH_PATH/, '调帖子搜索接口')
  statementLine(postSearch, /keyword/, '把关键词传给接口')
  statementLine(postSearch, /pageSize:\s*\d+/, '限制返回条数')

  // 选帖子：必须用 postDetailPath 拼，不能手拼字符串
  statementLine(postPick, /const path\s*=\s*pageList\.postDetailPath\(/, '用 postDetailPath 拼路径')

  // 模式解析这一行必须同时认三种模式 ——
  // 只查函数体里有没有 'post' 会被下面 `else if (mode === 'post')` 那句骗过去。
  const modeLine = statementLine(mode, /const mode\s*=/, '解析模式')
  ;["'pick'", "'post'", "'manual'"].forEach((m) => {
    assert.ok(
      modeLine.indexOf(m) > -1,
      '模式解析没有认 ' + m + '（该模式会点不动）：' + modeLine
    )
  })

  // 手动输入失焦：归一化后必须 emit 修正值（只改本地值的话宿主保存的还是旧的）
  const blurEmit = blur.split('\n').find((l) => /this\.emit\(fixed\.value\)/.test(l))
  assert.ok(blurEmit, 'onManualBlur 没有把修正后的值 emit 给宿主')
  const guardLine = blur.split('\n').find((l) => /if\s*\(\s*fixed\.changed\s*\)/.test(l))
  assert.ok(guardLine, '归一化写回必须由 fixed.changed 把关，不能无条件覆盖')
})

check('宿主页面的 onXxxLinkPicked 都写回各自字段', () => {
  const adminJs = read('pkg-admin/admin/edit/index.js')
  const cases = [
    ['onLinkPicked', "'form.meta.link'", '首页轮播'],
    ['onNoticeLinkPicked', "'form.meta.linkUrl'", '公告右侧链接'],
    ['onPublishBannerLinkPicked', "'form.meta.link'", '发布横幅'],
    ['onPushGroupLinkPicked', "'form.link'", '推送群卡片']
  ]
  cases.forEach(([name, field, what]) => {
    const body = stripComments(methodBody(adminJs, name))
    assert.ok(body.length > 0, '后台缺 ' + name + '（' + what + '）')
    const line = body.split('\n').find((l) => l.indexOf(field) > -1)
    assert.ok(line, name + ' 没把路径写进 ' + field + '（' + what + '）')
    assert.ok(/e\.detail/.test(line), name + ' 必须从事件载荷取值，不能读别的来源')
  })

  const detailJs = read('pkg-feature/pages/banner-detail/index.js')
  const body = stripComments(methodBody(detailJs, 'onLinkPicked'))
  assert.ok(body.length > 0, 'banner-detail 缺 onLinkPicked')
  const line = body.split('\n').find((l) => l.indexOf("'form.link'") > -1)
  assert.ok(line, 'banner-detail 的 onLinkPicked 没把路径写进 form.link')
  assert.ok(/e\.detail/.test(line), 'banner-detail 的 onLinkPicked 必须从事件载荷取值')
})

check('保存前先归一化再校验，且校验排在提交之前', () => {
  const js = read('pkg-admin/admin/edit/index.js')
  const body = stripComments(methodBody(js, 'buildPayload'))
  assert.ok(body.length > 0, '没切出 buildPayload 的函数体')

  const normAt = body.indexOf('normalizePagePath(')
  const checkAt = body.indexOf('linkRejectReason(')
  const existAt = body.indexOf('pageExistenceReason(')
  const bodyAt = body.indexOf('payload.body = JSON.stringify')
  const submitAt = Math.min(
    ...[body.indexOf('admin.updateContent('), body.indexOf('admin.createContent(')].filter((i) => i > -1)
  )

  assert.ok(normAt > -1, 'buildPayload 没有归一化跳转路径')
  assert.ok(checkAt > -1, 'buildPayload 没有做链接格式校验')
  assert.ok(existAt > -1, 'buildPayload 没有做页面存在性校验')
  assert.ok(bodyAt > -1 && submitAt > -1, '没找到 body 赋值或提交调用，切取逻辑失效了')
  assert.ok(normAt < bodyAt, '归一化必须排在 body 序列化之前，否则落库的还是旧值')
  assert.ok(checkAt < submitAt && existAt < submitAt, '校验必须排在提交之前')
})

check('判据非空自证：护栏确实读到了内容', () => {
  assert.ok(read('utils/page-list.js').length > 2000, 'utils/page-list.js 内容异常短')
  assert.ok(read('pkg-admin/admin/edit/index.js').length > 5000, '后台编辑页内容异常短')
  assert.ok(read('pkg-admin/admin/edit/index.wxml').length > 2000, '后台编辑页模板异常短')
  assert.ok(APP_PAGES.length >= 70, 'app.json 页面数异常少，扫描逻辑可能失效：' + APP_PAGES.length)
  assert.ok(pageList.PAGES.length >= 40, '跳转清单异常短：' + pageList.PAGES.length)
})

console.log('miniprogram page list tests passed. (' + testCount + ')')
