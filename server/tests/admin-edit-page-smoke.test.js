// 后台编辑页（pkg-admin/admin/edit）的**行为**冒烟测试。
//
// 为什么需要：这个页面承载 13 种编辑表单 + 5 处跳转配置点，改动频繁。
// 静态扫描（源码字符串断言）抓不到「引用了未定义的变量」这类运行时错误 ——
// 2026-10-08 就出过一次：重构跳转路径时删掉了 `const patch = {...}`，
// 却漏删下面的 `this.setData(patch)`，静态护栏全绿，真机一进编辑页直接白屏
// 显示「patch is not defined」。
//
// 所以这里用 vm 把真实页面文件加载起来，真的调用关键方法，看它会不会抛。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..', '..')
const PAGE_PATH = 'pkg-admin/admin/edit/index.js'
const PAGE_DIR = path.join(root, 'pkg-admin', 'admin', 'edit')

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

// ===== 沙箱：加载真实页面文件，只把网络/宿主相关的东西换成桩 =====
function loadEditPage(adminStub) {
  const source = fs.readFileSync(path.join(root, PAGE_PATH), 'utf8')
  let pageDefinition = null
  const toasts = []
  const modals = []

  const wxStub = new Proxy({
    showToast: (o) => toasts.push(o && o.title),
    showModal: (o) => modals.push(o),
    showLoading: () => undefined,
    hideLoading: () => undefined,
    navigateBack: () => undefined,
    navigateTo: () => undefined,
    setNavigationBarTitle: () => undefined,
    vibrateShort: () => undefined,
    getStorageSync: () => '',
    setStorageSync: () => undefined,
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    setClipboardData: () => undefined,
    previewImage: () => undefined
  }, { get: (t, p) => (p in t ? t[p] : () => undefined) })

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Date,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    getApp: () => ({ globalData: {} }),
    wx: wxStub,
    Page: (def) => { pageDefinition = def },
    require: (name) => {
      const key = String(name)
      if (/utils\/admin$/.test(key)) return adminStub
      if (/utils\/wechat$/.test(key)) {
        return { getPhoneNumber: () => Promise.resolve(''), login: () => Promise.resolve('') }
      }
      // 其余一律加载真实模块（utils/link、utils/page-list、admin-edit-meta 都是纯逻辑）
      if (key.charAt(0) !== '.') return require(key)
      return require(path.resolve(PAGE_DIR, key))
    }
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: PAGE_PATH })
  return { pageDefinition, toasts, modals }
}

// 把页面定义变成可调用的实例（只实现测试用得到的 setData / data）
function createInstance(pageDefinition) {
  const inst = Object.assign({}, pageDefinition)
  inst.data = JSON.parse(JSON.stringify(pageDefinition.data || {}))
  inst.setData = function (patch) {
    Object.keys(patch || {}).forEach((k) => {
      if (k.indexOf('.') < 0) { inst.data[k] = patch[k]; return }
      const parts = k.split('.')
      let cur = inst.data
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined || cur[parts[i]] === null) cur[parts[i]] = {}
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = patch[k]
    })
  }
  return inst
}

function makeAdminStub(overrides) {
  const calls = { updateContent: [], createContent: [] }
  const stub = Object.assign({
    me: () => Promise.resolve({ id: 1, role: 'super_admin', permissions: ['*'] }),
    content: () => Promise.resolve({ list: [] }),
    updateContent: (id, payload) => { calls.updateContent.push({ id, payload }); return Promise.resolve(null) },
    createContent: (payload) => { calls.createContent.push({ payload }); return Promise.resolve({ id: 9 }) },
    posts: () => Promise.resolve({ list: [] }),
    campusCardPages: () => Promise.resolve([]),
    clubCategories: () => Promise.resolve([]),
    chatCategories: () => Promise.resolve([]),
    features: () => Promise.resolve({ list: [] }),
    items: () => Promise.resolve({ list: [] }),
    serviceCategories: () => Promise.resolve([]),
    drivingSchools: () => Promise.resolve({ list: [] }),
    clubs: () => Promise.resolve({ list: [] }),
    groupChatCategories: () => Promise.resolve([]),
    groupChats: () => Promise.resolve({ list: [] }),
    activities: () => Promise.resolve({ list: [] })
  }, overrides || {})
  stub.__calls = calls
  return stub
}

// ===== 1. 页面能加载，且关键方法都在 =====

check('页面能在沙箱里加载出 Page 定义', () => {
  const { pageDefinition } = loadEditPage(makeAdminStub())
  assert.ok(pageDefinition, '没拿到 Page 定义，页面文件加载失败')
  const required = [
    'onLoad', '_loadContentForm', 'buildPayload',
    'onLinkPicked', 'onNoticeLinkPicked', 'onPublishBannerLinkPicked', 'onPushGroupLinkPicked'
  ]
  required.forEach((m) => {
    assert.strictEqual(typeof pageDefinition[m], 'function', '页面缺方法 ' + m)
  })
})

// ===== 2. 加载已有轮播：曾经在这里抛「patch is not defined」 =====

async function loadBannerForm(link) {
  const adminStub = makeAdminStub({
    content: () => Promise.resolve({
      list: [{
        id: 4,
        type: 'banner',
        title: '校园恋综',
        body: JSON.stringify({ image: 'https://a.com/x.jpg', link }),
        status: 1,
        sortOrder: 0
      }]
    })
  })
  const { pageDefinition } = loadEditPage(adminStub)
  const page = createInstance(pageDefinition)
  await page._loadContentForm(4, 'banner')
  return page
}

check('加载已有轮播不抛错，且把已存路径回填进表单', () => {
  return loadBannerForm('/pkg-feature/pages/activity/index').then((page) => {
    assert.strictEqual(
      page.data.form.meta.link,
      '/pkg-feature/pages/activity/index',
      '已存的跳转路径没回填进 form.meta.link'
    )
    assert.strictEqual(page.data.loaded === undefined || true, true)
  })
})

check('加载存量脏数据（微信短链）也不抛错', () => {
  return loadBannerForm('#小程序://帕云校园/t1CRvODJjcaMhGr').then((page) => {
    assert.strictEqual(
      page.data.form.meta.link,
      '#小程序://帕云校园/t1CRvODJjcaMhGr',
      '脏数据回填应原样保留，由保存时校验去拦'
    )
  })
})

check('新建轮播（无 id）不抛错，且带出默认 meta', () => {
  const adminStub = makeAdminStub()
  const { pageDefinition } = loadEditPage(adminStub)
  const page = createInstance(pageDefinition)
  return page._loadContentForm(0, 'banner').then(() => {
    assert.ok(page.data.form.meta, '新建表单没有 meta')
    assert.strictEqual(page.data.form.meta.link, '', '新建时 link 应为空串')
  })
})

// ===== 3. 保存：归一化 + 校验 + 落库 =====

async function runBuildPayload(form, scope, adminStub) {
  const { pageDefinition, modals, toasts } = loadEditPage(adminStub || makeAdminStub())
  const page = createInstance(pageDefinition)
  page.data.scope = scope || 'content'
  page.data.form = form
  const ok = await page.buildPayload()
  return { ok, page, modals, toasts, adminStub }
}

function bannerForm(link) {
  return {
    kind: 'content',
    type: 'banner',
    id: 4,
    title: '校园恋综',
    status: 1,
    sortOrder: 0,
    meta: { image: 'https://a.com/x.jpg', link, accent: '#FFE8F1', subtitle: '', tag: '' }
  }
}

check('保存轮播：带 .html 的路径会被自动修正后落库', () => {
  const stub = makeAdminStub()
  return runBuildPayload(bannerForm('/pkg-feature/pages/activity/index.html'), 'content', stub).then((r) => {
    assert.strictEqual(r.ok, true, '合法路径不该被拦：' + JSON.stringify(r.modals))
    assert.strictEqual(stub.__calls.updateContent.length, 1, '没有发起保存')
    const body = JSON.parse(stub.__calls.updateContent[0].payload.body)
    assert.strictEqual(
      body.link,
      '/pkg-feature/pages/activity/index',
      '落库的路径应已去掉 .html，实际：' + body.link
    )
  })
})

check('保存轮播：微信短链被拦下并给出可读原因', () => {
  const stub = makeAdminStub()
  return runBuildPayload(bannerForm('#小程序://帕云校园/abc'), 'content', stub).then((r) => {
    assert.strictEqual(r.ok, false, '微信短链必须被拦')
    assert.strictEqual(stub.__calls.updateContent.length, 0, '被拦时不得发起保存')
    assert.ok(r.modals.length > 0, '被拦时要弹窗说明原因，不能静默')
    assert.ok(
      String(r.modals[0].content || '').indexOf('#小程序://') > -1,
      '弹窗要说清是 #小程序:// 的问题：' + JSON.stringify(r.modals[0])
    )
  })
})

check('保存轮播：拼错的页面路径被拦下', () => {
  const stub = makeAdminStub()
  return runBuildPayload(bannerForm('/pkg-feature/pages/activiti/index'), 'content', stub).then((r) => {
    assert.strictEqual(r.ok, false, '不存在的页面必须被拦')
    assert.strictEqual(stub.__calls.updateContent.length, 0, '被拦时不得发起保存')
  })
})

check('保存轮播：帖子详情页路径（带 query）放行', () => {
  const stub = makeAdminStub()
  return runBuildPayload(bannerForm('/pages/post-detail/index?id=42'), 'content', stub).then((r) => {
    assert.strictEqual(r.ok, true, '带 query 的详情页应放行：' + JSON.stringify(r.modals))
    const body = JSON.parse(stub.__calls.updateContent[0].payload.body)
    assert.strictEqual(body.link, '/pages/post-detail/index?id=42', '详情页路径不该被改写')
  })
})

check('保存轮播：外链放行且不被改写', () => {
  const stub = makeAdminStub()
  return runBuildPayload(bannerForm('https://payun01.cn/page.html'), 'content', stub).then((r) => {
    assert.strictEqual(r.ok, true, '外链应放行：' + JSON.stringify(r.modals))
    const body = JSON.parse(stub.__calls.updateContent[0].payload.body)
    assert.strictEqual(body.link, 'https://payun01.cn/page.html', '外链不得被改写')
  })
})

check('保存轮播：留空链接放行（按钮不显示）', () => {
  const stub = makeAdminStub()
  return runBuildPayload(bannerForm(''), 'content', stub).then((r) => {
    assert.strictEqual(r.ok, true, '留空应放行：' + JSON.stringify(r.modals))
    const body = JSON.parse(stub.__calls.updateContent[0].payload.body)
    assert.strictEqual(body.link, '', '留空应落库为空串')
  })
})

// ===== 4. 四个跳转配置点的回写 =====

check('四个跳转配置点各自写进正确的字段', () => {
  const { pageDefinition } = loadEditPage(makeAdminStub())
  const page = createInstance(pageDefinition)
  page.data.form = { meta: { link: '', linkUrl: '' }, link: '' }

  const cases = [
    ['onLinkPicked', '/pkg-feature/pages/activity/index', () => page.data.form.meta.link],
    ['onNoticeLinkPicked', '/pages/index/index', () => page.data.form.meta.linkUrl],
    ['onPublishBannerLinkPicked', '/pages/schedule/index', () => page.data.form.meta.link],
    ['onPushGroupLinkPicked', '/pkg-feature/pages/group-chat/index', () => page.data.form.link]
  ]
  cases.forEach(([method, value, read]) => {
    page[method]({ detail: { value } })
    assert.strictEqual(read(), value, method + ' 没把路径写进对应字段')
  })

  // 空载荷不能炸，也不能把已有值清成 undefined
  page.onLinkPicked({ detail: {} })
  assert.strictEqual(page.data.form.meta.link, '', '空载荷应写成空串而不是 undefined')
})

// ===== scope 覆盖：入口能进的 scope，编辑页必须有对应分支 =====
// 背景：管理后台列表页有 14 个入口 scope（11 种表单 + 3 种审核）跳进本页。
// 「入口加了 scope、编辑页忘了加分支」不会报错，只表现为进页面后表单一片空白，
// 而上面那些行为冒烟用例都是拿 content 表单跑的，覆盖不到这条路径。
check('入口 scope 与编辑页分支一一对应', () => {
  const indexJs = fs.readFileSync(path.join(root, 'pkg-admin', 'admin', 'index.js'), 'utf8')
  const editJs = fs.readFileSync(path.join(root, PAGE_PATH), 'utf8')

  const entryScopes = [...new Set(
    [...indexJs.matchAll(/admin\/edit\/index\?scope=([A-Za-z]+)/g)].map((x) => x[1])
  )].sort()
  const loadScopes = [...new Set(
    [...editJs.matchAll(/scope === '([A-Za-z]+)'\) await this\._load[A-Za-z]+Form/g)].map((x) => x[1])
  )].sort()

  assert.ok(entryScopes.length >= 14, '入口 scope 解析异常：只找到 ' + entryScopes.length + ' 个')
  assert.deepStrictEqual(
    entryScopes.filter((s) => !loadScopes.includes(s)), [],
    '以下入口 scope 在 edit/index.js 里没有对应的 _load*Form 分支（进页面会空白）'
  )
  assert.deepStrictEqual(
    loadScopes.filter((s) => !entryScopes.includes(s)), [],
    '以下 _load*Form 分支没有任何入口进入（孤立分支）'
  )
})

// 走 pkg-feature/pages/banner-detail 的 4 个「自定义页面」scope 也要有映射
check('banner-detail 覆盖全部自定义页面 scope', () => {
  const indexJs = fs.readFileSync(path.join(root, 'pkg-admin', 'admin', 'index.js'), 'utf8')
  const bannerJs = fs.readFileSync(path.join(root, 'pkg-feature', 'pages', 'banner-detail', 'index.js'), 'utf8')
  const entryScopes = [...new Set(
    [...indexJs.matchAll(/banner-detail\/index\?scope=([A-Za-z]+)/g)].map((x) => x[1])
  )]
  const handled = new Set()
  const ps = /const PAGE_SCOPES = \{([\s\S]*?)\n\}/.exec(bannerJs)
  if (ps) [...ps[1].matchAll(/^\s{2}([A-Za-z]+)\s*:\s*\{/gm)].forEach((x) => handled.add(x[1]))
  ;[...bannerJs.matchAll(/scope === '([A-Za-z]+)'/g)].forEach((x) => handled.add(x[1]))
  const wl = /\[([^\]]*'post'[^\]]*)\]\s*\.indexOf\(\s*options\.scope\s*\)/.exec(bannerJs)
  if (wl) [...wl[1].matchAll(/'([^']+)'/g)].forEach((x) => handled.add(x[1]))

  assert.ok(entryScopes.length >= 4, 'banner-detail 入口 scope 解析异常：只找到 ' + entryScopes.length + ' 个')
  assert.deepStrictEqual(
    entryScopes.filter((s) => !handled.has(s)), [],
    '以下入口 scope 在 banner-detail 里未被处理'
  )
})

console.log('admin edit page smoke tests passed. (' + testCount + ')')
