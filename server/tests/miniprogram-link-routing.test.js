// 站内跳转口径护栏（utils/link.js + 各消费端）
//
// 为什么需要：本项目 35 个页面在 pkg-feature 分包里（另有 pkg-user / pkg-schedule /
// pkg-admin），真实路径是 `/pkg-feature/pages/xxx`。历史上多处代码写的是
// 「以 /pages/ 开头就 navigateTo」，分包路径会被漏判 —— 表现为「点了完全没反应」
// 或「链接被复制到剪贴板」，且**不报错**，只能靠人肉发现。
//
// 本文件锁四件事：
//   A. utils/link.js 的 tabBar 白名单必须与 app.json 完全一致（加 tab 忘了同步会跳不动）
//   B. 站内路径判定覆盖主包与分包，且拒绝 javascript: / data: 之类
//   C. 各消费端不得再自己抄「只认 /pages/」的分支
//   D. 服务端链接校验正则必须与端上同口径（否则管理员填分包路径会被挡在保存前）
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

// 剥掉注释：断言「不得出现 X」时，注释里往往正解释「为什么不用 X」，
// 不剥掉就会把说明文字当成违规代码（这条踩过）。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
}

// 按大括号配平取出方法体。比 indexOf 稳：不会命中同名前缀的另一个方法，
// 也不会把后面的代码一起圈进来。
// 要同时吃下三种写法：`onXxx(e) {`、`function onXxx(a) {`、
// `exports.onXxx = async (req, res) => {`（名字带点、且 = / async / => 都在括号外）。
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

const link = require(path.join(root, 'utils', 'link.js'))
const appJson = JSON.parse(read('app.json'))

// ============ A. tabBar 白名单与 app.json 一致 ============

check('tabBar 白名单与 app.json 完全一致', () => {
  const fromApp = (appJson.tabBar.list || []).map((i) => '/' + i.pagePath).sort()
  const fromLink = link.TAB_BAR_PAGES.slice().sort()
  assert.deepStrictEqual(
    fromLink,
    fromApp,
    'utils/link.js 的 TAB_BAR_PAGES 与 app.json 的 tabBar.list 不一致：'
      + '加/删 tab 后必须同步，否则 switchTab 会跳到不存在的页面'
  )
})

check('每个 tabBar 页都被 isTabBarPage 认出（含带 query 的写法）', () => {
  ;(appJson.tabBar.list || []).forEach((i) => {
    const p = '/' + i.pagePath
    assert.ok(link.isTabBarPage(p), p + ' 没被识别为 tabBar 页，会被 navigateTo 拒绝')
    assert.ok(link.isTabBarPage(p + '?from=1'), p + ' 带 query 时也应识别为 tabBar 页')
  })
})

// ============ B. 站内路径判定 ============

check('站内路径覆盖主包与全部分包前缀', () => {
  const roots = (appJson.subPackages || appJson.subpackages || []).map((s) => s.root)
  assert.ok(roots.length > 0, 'app.json 应当有分包配置，否则本护栏失去意义')

  roots.forEach((r) => {
    const sample = '/' + r + '/pages/index/index'
    assert.ok(link.isInnerPath(sample), '分包 ' + r + ' 的路径未被识别为站内：' + sample)
  })
  assert.ok(link.isInnerPath('/pages/index/index'), '主包路径未被识别为站内')
})

check('分包页不得被误判为 tabBar 页', () => {
  ;(appJson.subPackages || appJson.subpackages || []).forEach((s) => {
    s.pages.slice(0, 5).forEach((p) => {
      const full = '/' + s.root + '/' + p
      assert.ok(!link.isTabBarPage(full), full + ' 不是 tabBar 页，不该走 switchTab')
    })
  })
})

check('外链与危险 scheme 都不算站内路径', () => {
  assert.ok(!link.isInnerPath('https://payun01.cn/x'), 'https 不是站内路径')
  assert.ok(!link.isInnerPath('http://a.com'), 'http 不是站内路径')
  assert.ok(!link.isInnerPath('javascript:alert(1)'), 'javascript: 绝不能当站内路径')
  assert.ok(!link.isInnerPath('data:text/html,x'), 'data: 绝不能当站内路径')
  assert.ok(!link.isInnerPath('pkg-feature/pages/a/index'), '缺前导斜杠不算站内')
  assert.ok(!link.isInnerPath('/pagesx/foo'), '/pagesx 不是 /pages 的前缀，不得放行')
  assert.ok(!link.isInnerPath(''), '空串不算站内')
})

check('openPath 对非站内路径返回 false，交给调用方兜底', () => {
  const calls = []
  global.wx = {
    navigateTo: (o) => calls.push(['navigateTo', o.url]),
    switchTab: (o) => calls.push(['switchTab', o.url])
  }
  assert.strictEqual(link.openPath('https://a.com'), false, '外链必须返回 false')
  assert.strictEqual(link.openPath('javascript:alert(1)'), false, '危险 scheme 必须返回 false')
  assert.strictEqual(link.openPath(''), false, '空串必须返回 false')
  assert.deepStrictEqual(calls, [], '返回 false 时不得触发任何跳转')
})

check('openPath：tabBar 走 switchTab，分包走 navigateTo', () => {
  const calls = []
  global.wx = {
    navigateTo: (o) => calls.push(['navigateTo', o.url]),
    switchTab: (o) => calls.push(['switchTab', o.url])
  }
  assert.strictEqual(link.openPath('/pages/schedule/index'), true)
  assert.strictEqual(link.openPath('/pkg-feature/pages/activity/index'), true)
  assert.strictEqual(link.openPath('/pages/post-detail/index?id=3'), true)
  assert.deepStrictEqual(
    calls,
    [
      ['switchTab', '/pages/schedule/index'],
      ['navigateTo', '/pkg-feature/pages/activity/index'],
      ['navigateTo', '/pages/post-detail/index?id=3']
    ],
    'tabBar 页必须 switchTab（navigateTo 会直接失败），其余站内路径 navigateTo'
  )
})

check('openPath：tabBar 页带 query 时剥掉参数再 switchTab', () => {
  const calls = []
  global.wx = { switchTab: (o) => calls.push(o.url) }
  link.openPath('/pages/index/index?from=banner')
  assert.deepStrictEqual(calls, ['/pages/index/index'], 'switchTab 不接受参数，必须剥掉 query')
})

// ============ C. 各消费端不得再自己抄「只认 /pages/」的分支 ============

const CONSUMERS = [
  ['pages/index/index.js', 'onBannerTap'],
  ['pkg-feature/pages/banner-detail/index.js', 'onOpenLink'],
  ['pages/push-groups/index.js', 'onOpenQrPage']
]

CONSUMERS.forEach(([file, fn]) => {
  check(file + ' 的 ' + fn + ' 不再自己判定 /pages/ 前缀', () => {
    const body = stripComments(methodBody(read(file), fn))
    assert.ok(body.length > 0, '没能从 ' + file + ' 里切出 ' + fn + ' 的函数体（切取逻辑失效了？）')
    assert.ok(
      body.indexOf("indexOf('/pages/')") < 0,
      fn + ' 又写回了只认 /pages/ 的分支 —— 分包路径 /pkg-feature/... 会被漏判'
    )
    assert.ok(
      body.indexOf("startsWith('/pages/')") < 0,
      fn + ' 又写回了只认 /pages/ 的分支（startsWith）'
    )
  })
})

check('首页轮播不再用 indexOf 子串猜目标页', () => {
  const body = stripComments(methodBody(read('pages/index/index.js'), 'onBannerTap'))
  assert.ok(body.length > 0, '没切出 onBannerTap 的函数体')
  // 曾经写成 indexOf('index') > -1 就 switchTab 首页，
  // 结果 /pkg-feature/pages/activity/index 这种正确路径被误跳回首页。
  assert.ok(
    !/indexOf\(\s*['"]index['"]\s*\)/.test(body),
    '不得再用 indexOf(\'index\') 子串判断目标页：分包路径里含 "index" 会被误跳首页'
  )
  assert.ok(
    !/indexOf\(\s*['"]errand['"]\s*\)/.test(body) && !/indexOf\(\s*['"]schedule['"]\s*\)/.test(body),
    '不得再用硬编码子串白名单判断跳转目标'
  )
  assert.ok(
    /link\.openPath\(/.test(body),
    'onBannerTap 必须走 utils/link 的 openPath 统一分发'
  )
})

check('utils/richtext.js 的 openLink 走统一入口', () => {
  const body = stripComments(methodBody(read('utils/richtext.js'), 'openLink'))
  assert.ok(body.length > 0, '没切出 openLink 的函数体')
  assert.ok(body.indexOf("indexOf('/pages/')") < 0, 'openLink 不得再只认 /pages/ 前缀')
  assert.ok(/link\.openPath\(/.test(body), 'openLink 必须委托 utils/link.openPath')
  assert.ok(/link\.isWebUrl\(/.test(body), '外链判定也要走 utils/link，别各处各写一套正则')
})

check('banner-detail 预览跳转委托给 richtext，不再自带副本', () => {
  const body = stripComments(methodBody(read('pkg-feature/pages/banner-detail/index.js'), 'onOpenLink'))
  assert.ok(body.length > 0, '没切出 onOpenLink 的函数体')
  assert.ok(
    /richtext\.openLink\(/.test(body),
    '预览跳转必须复用 utils/richtext.openLink，否则两处口径会分叉'
  )
})

// ============ D. 服务端校验与端上同口径 ============

// 规则在两端各有一份实现（小程序端 utils/link.js、服务端 server/utils/link.js，
// 两个运行时没法共用同一个文件），所以必须用同一张用例表证明它们没分叉。
const LINK_CASES = [
  ['', true, '空串 = 不配置跳转，必须放行'],
  ['/pages/index/index', true, '主包路径'],
  ['/pages/review/target?id=9', true, '主包路径带 query'],
  ['/pkg-feature/pages/activity/index', true, '分包路径（35 个页面在这里）'],
  ['/pkg-admin/admin/index', true, 'pkg-admin 分包'],
  ['/pkg-schedule/pages/schedule/index', true, 'pkg-schedule 分包'],
  ['https://payun01.cn/x', true, 'https 外链'],
  ['http://a.com', true, 'http 外链'],
  ['#小程序://帕云校园/t1CRvODJjcaMhGr', false, '微信小程序短链：只能粘进聊天，跳不了'],
  ['/pkg-feature/pages/activity/index.html', false, '页面路径不能带 .html（实测踩过）'],
  ['/pages/review/target.html', false, '主包路径同样不能带后缀'],
  ['/pages/index/index.js', false, '不能带 .js 后缀'],
  ['/pkg-feature/pages/activity/index.wxml', false, '不能带 .wxml 后缀'],
  ['/pages/a/index?x=1.html', true, 'query 里的点不算文件后缀'],
  ['https://a.com/page.html', true, '外链以 .html 结尾是正常的，不该拦'],
  ['javascript:alert(1)', false, 'javascript: 必须拒绝'],
  ['data:text/html,x', false, 'data: 必须拒绝'],
  ['pkg-feature/pages/a/index', false, '缺前导斜杠'],
  ['/pagesx/foo', false, '/pagesx 不是 /pages 的前缀'],
  ['活动页', false, '自然语言'],
  ['   ', true, '纯空白 trim 后等同未配置']
]

check('端上与服务端对「可跳转链接」的判定完全一致', () => {
  const client = require(path.join(root, 'utils', 'link.js'))
  const server = require(path.join(root, 'server', 'utils', 'link.js'))
  LINK_CASES.forEach(([value, want, why]) => {
    assert.strictEqual(client.isNavigableLink(value), want, '[端上] ' + why + '：' + JSON.stringify(value))
    assert.strictEqual(server.isNavigableLink(value), want, '[服务端] ' + why + '：' + JSON.stringify(value))
    assert.strictEqual(
      !!client.linkRejectReason(value), !want,
      '[端上] 拒绝原因与判定不一致：' + JSON.stringify(value)
    )
    assert.strictEqual(
      !!server.linkRejectReason(value), !want,
      '[服务端] 拒绝原因与判定不一致：' + JSON.stringify(value)
    )
  })
})

check('#小程序:// 短链有专门提示，不能只回一句「格式不对」', () => {
  const client = require(path.join(root, 'utils', 'link.js'))
  const server = require(path.join(root, 'server', 'utils', 'link.js'))
  const bad = '#小程序://帕云校园/t1CRvODJjcaMhGr'
  ;[client, server].forEach((m, i) => {
    const who = i === 0 ? '端上' : '服务端'
    const reason = m.linkRejectReason(bad)
    assert.ok(reason, who + ' 必须拒绝 #小程序:// 短链')
    assert.ok(
      reason.indexOf('#小程序://') > -1,
      who + ' 的提示要点明是「#小程序://」这种链接的问题，否则管理员看不懂为什么被拦'
    )
    assert.ok(
      reason.indexOf('/pkg-feature/pages/') > -1,
      who + ' 的提示要给出正确填法示例（分包路径），否则管理员不知道改成什么'
    )
  })
})

check('页面路径带文件后缀时有专门提示，并给出正确写法', () => {
  const client = require(path.join(root, 'utils', 'link.js'))
  const server = require(path.join(root, 'server', 'utils', 'link.js'))
  const bad = '/pkg-feature/pages/activity/index.html'
  ;[client, server].forEach((m, i) => {
    const who = i === 0 ? '端上' : '服务端'
    const reason = m.linkRejectReason(bad)
    assert.ok(reason, who + ' 必须拒绝带 .html 的页面路径')
    assert.ok(
      reason.indexOf('.html') > -1,
      who + ' 的提示要点明是「.html 后缀」的问题，否则管理员看不出差在哪'
    )
    assert.ok(
      reason.indexOf('/pkg-feature/pages/activity/index') > -1,
      who + ' 的提示要给出正确写法示例（去掉后缀），否则管理员不知道怎么改'
    )
  })
})

check('服务端所有链接校验共用 server/utils/link.js，不留本地副本', () => {
  const ctrl = read('server/controllers/configController.js')
  assert.ok(
    ctrl.indexOf('SERVICE_PAGE_LINK_RE') < 0 && ctrl.indexOf('PUSH_GROUP_LINK_RE') < 0,
    '旧的两套正则应已并入 utils/link，残留会导致口径不一致'
  )
  assert.ok(
    /require\('\.\.\/utils\/link'\)/.test(ctrl),
    'configController 必须引用共享的 server/utils/link.js'
  )
  assert.ok(
    ctrl.indexOf('const PAGE_LINK_RE') < 0,
    '正则不该再在 controller 里重复定义，应只在 server/utils/link.js 一处'
  )
  const uses = ctrl.match(/!isNavigableLink\(/g) || []
  assert.ok(uses.length >= 2, '至少两处校验（自定义页底部按钮、推送群卡片）都要用共享校验，实际 ' + uses.length)
})

// ============ E. 首页轮播的跳转链接必须保存时就校验 ============
// 背景（2026-10-08 实测）：管理员把微信「小程序短链」#小程序://帕云校园/xxx
// 填进首页轮播的跳转路径，保存一路绿灯，用户点了只弹「链接已复制」。
// 根因是首页轮播的 link 存在 body JSON 里，而 createContent/updateContent 从不校验它。

check('服务端保存首页轮播时校验跳转链接', () => {
  const admin = read('server/controllers/adminController.js')
  assert.ok(
    /require\('\.\.\/utils\/link'\)/.test(admin),
    'adminController 必须引用共享的链接校验'
  )
  assert.ok(
    /function bannerLinkRejectReason\(/.test(admin),
    '缺少首页轮播链接校验函数'
  )
  // 断言调用表达式本身，而不是「标识符出现过」——挂到永不进入的分支里子串依然在
  const createBody = methodBody(admin, 'exports.createContent')
  const updateBody = methodBody(admin, 'exports.updateContent')
  assert.ok(createBody.length > 0, '没切出 createContent 的函数体')
  assert.ok(updateBody.length > 0, '没切出 updateContent 的函数体')
  assert.ok(
    /bannerLinkRejectReason\(type, text\)/.test(createBody),
    'createContent 未校验首页轮播的跳转链接'
  )
  assert.ok(
    /bannerLinkRejectReason\(body\.type, text\)/.test(updateBody),
    'updateContent 未校验首页轮播的跳转链接'
  )
  // 校验必须在写库之前（否则「先写后拦」等于没拦）
  const createCall = createBody.indexOf('bannerLinkRejectReason(')
  const createInsert = createBody.indexOf('INSERT INTO system_content')
  assert.ok(createInsert > -1 && createCall < createInsert, '校验必须排在 INSERT 之前')
  const updateCall = updateBody.indexOf('bannerLinkRejectReason(')
  const updateSet = updateBody.indexOf('UPDATE system_content')
  assert.ok(updateSet > -1 && updateCall < updateSet, '校验必须排在 UPDATE 之前')
})

check('后台表单保存前校验首页轮播链接，并给出可读原因', () => {
  const js = read('pkg-admin/admin/edit/index.js')
  const body = methodBody(js, 'buildPayload')
  assert.ok(body.length > 0, '没切出 buildPayload 的函数体')
  assert.ok(
    /link\.linkRejectReason\(/.test(body),
    '后台表单未校验跳转链接，脏数据会一路存进去'
  )
  assert.ok(
    body.indexOf("form.type === 'banner'") > -1,
    '校验只对首页轮播生效（其他 kind 的 link 语义不同）'
  )
  // 原因较长，用 showModal；showToast 会截断到两行
  assert.ok(/wx\.showModal\(/.test(body), '原因较长时应用 showModal，toast 显示不全')
  // 校验必须排在真正提交之前
  const checkAt = body.indexOf('linkRejectReason(')
  const submitAt = Math.min(
    ...[body.indexOf('admin.updateContent('), body.indexOf('admin.createContent(')]
      .filter((i) => i > -1)
  )
  assert.ok(submitAt > -1 && checkAt < submitAt, '校验必须排在提交之前')
})

check('判据非空自证：护栏确实读到了内容', () => {
  // 防止「路径写错 → 读到空串 → 所有 indexOf 断言天然通过」这类假绿灯
  assert.ok(read('utils/link.js').length > 500, 'utils/link.js 内容异常短')
  assert.ok(read('server/utils/link.js').length > 500, 'server/utils/link.js 内容异常短')
  assert.ok(read('pages/index/index.js').length > 1000, 'pages/index/index.js 内容异常短')
  assert.ok(read('server/controllers/configController.js').length > 5000, 'configController.js 内容异常短')
  assert.ok(read('server/controllers/adminController.js').length > 20000, 'adminController.js 内容异常短')
  assert.ok(read('pkg-admin/admin/edit/index.js').length > 5000, 'admin edit 页内容异常短')
  assert.ok((appJson.subPackages || appJson.subpackages || []).length > 0, 'app.json 分包配置为空')
})

console.log('miniprogram link routing tests passed. (' + testCount + ')')
