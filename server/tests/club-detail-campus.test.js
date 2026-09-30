/**
 * 社团分类详情页测试（无需真机 / 无需数据库）
 * 用 vm 加载真实页面文件 pages/club/detail.js，注入假 wx / getApp。
 *
 * 覆盖：能正常 onLoad（回归：此前引用了 campus.js 里并不存在的 CAMPUS_OPTIONS，
 * 一进详情页就抛 TypeError: Cannot read properties of undefined (reading 'indexOf')）、
 * 主校区/分校区/'' 全部校区的解析、未带入与非法取值的回退、社团列表渲染，
 * 以及「点击社团整行跳转到社团详情页」的跳转地址与本地兜底数据（无 id）的处理。
 *
 * 关键设计：require 返回的是**真实的 utils/campus.js 模块**（不是桩），
 * 这样如果以后 campus.js 的导出名再被改动，测试会立刻失败，而不是等到线上崩溃。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const DETAIL_PAGE = path.join(MINI_PROGRAM_ROOT, 'pages', 'club', 'detail.js')
const source = fs.readFileSync(DETAIL_PAGE, 'utf8')

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

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// ===== 桩：小程序运行时 =====
const realCampus = require('../../utils/campus')

let lastFetchCampus = null
let fetchResult = []
const clubDataStub = {
  getCategoryById: () => ({ id: 'art', name: '艺术类', theme: {}, clubs: [] }),
  fetchCategories: (campus) => {
    lastFetchCampus = campus
    return Promise.resolve(fetchResult)
  }
}

const localStorage = {}
let navTitle = ''
let navigatedTo = null
let toastText = ''
const wxStub = new Proxy({
  getStorageSync: (key) => localStorage[key] || '',
  setNavigationBarTitle: (opt) => { navTitle = opt.title },
  navigateTo: (opt) => { navigatedTo = opt.url },
  showToast: (opt) => { toastText = opt.title },
  vibrateShort: () => undefined
}, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) })

const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Date,
  Math,
  // 真实 campus 模块：故意不 mock，用来锁住导出名
  require: (name) => (String(name).indexOf('campus') > -1 ? realCampus : clubDataStub),
  getApp: () => ({ globalData: { userInfo: {} } }),
  getCurrentPages: () => [],
  wx: wxStub
}
let pageDefinition = null
sandbox.Page = (definition) => { pageDefinition = definition }
vm.createContext(sandbox)

check(() => {
  vm.runInNewContext(source, sandbox, { filename: 'pages/club/detail.js' })
  assert.ok(pageDefinition, '应调用 Page() 注册页面')
}, '页面加载')

function createPage() {
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((key) => {
      // 支持 'clubs[0].avatarState' 等 setData 路径写法（与真机行为一致）
      const matched = key.match(/^([^\[\].]+)\[(\d+)\]\.([^\[\].]+)$/)
      if (matched) {
        const arr = this.data[matched[1]]
        if (Array.isArray(arr) && arr[matched[2]]) arr[matched[2]][matched[3]] = patch[key]
      } else {
        this.data[key] = patch[key]
      }
    })
    if (typeof cb === 'function') cb()
  }
  return page
}

// onLoad 不应抛错；抛错时把错误原样抛出来便于定位
function loadPage(options) {
  const page = createPage()
  page.onLoad(options)
  return page
}

async function main() {
  const DEFAULT_CAMPUS = realCampus.getDefaultCampus()

  // 1) 列表页带入主校区：应原样采用（回归：此前这里直接抛 TypeError）
  {
    const page = loadPage({ id: 'art', campus: encodeURIComponent('佛山校区') })
    check(() => {
      assert.strictEqual(page.campus, '佛山校区', '应使用带入的主校区')
      assert.strictEqual(page.categoryId, 'art', '应记住分类 id')
    }, '主校区透传')
    await new Promise((r) => setImmediate(r))
    check(() => {
      assert.strictEqual(lastFetchCampus, '佛山校区', '应按带入校区分拉取分类')
      // 自定义导航后标题渲染在页面内（page-title），不再走 setNavigationBarTitle
      assert.strictEqual(page.data.category.name, '艺术类', '应在页面内展示分类标题')
    }, '按带入校区分拉取')
  }

  // 2) 分校区取值也应被接受（isValidCampus 覆盖两级校区）
  {
    const page = loadPage({ id: 'art', campus: encodeURIComponent('南海南校区') })
    check(() => {
      assert.strictEqual(page.campus, '南海南校区', '分校区应原样采用而非回退')
    }, '分校区透传')
  }

  // 3) '' = 全部校区：必须放行，不能回退成默认校区
  //    （isValidCampus('') 为 false，所以这是最容易写错的一格）
  {
    const page = loadPage({ id: 'art', campus: encodeURIComponent('') })
    check(() => {
      assert.strictEqual(page.campus, '', '列表页选「全部校区」时详情页也应看全部')
    }, '全部校区放行')
  }

  // 4) 未带入 campus（非列表页入口）：回退到用户设置中的校区
  {
    const page = loadPage({ id: 'art' })
    check(() => {
      assert.strictEqual(page.campus, DEFAULT_CAMPUS, '未带入校时应回退默认校区')
    }, '未带入回退')
  }

  // 5) 非法校区取值：回退默认校区，不应把野值透传给接口
  {
    const page = loadPage({ id: 'art', campus: encodeURIComponent('火星校区') })
    check(() => {
      assert.strictEqual(page.campus, DEFAULT_CAMPUS, '非法校应回退默认校区')
    }, '非法取值回退')

    const page2 = loadPage({ id: 'art', campus: 'campus=%E7%81%AB' })
    check(() => {
      assert.strictEqual(page2.campus, DEFAULT_CAMPUS, '乱码取值也不应透传')
    }, '乱码取值回退')
  }

  // 6) 服务端返回分类后：社团列表（含首字符徽标）应落到 data 上
  {
    fetchResult = [{
      id: 'art',
      name: '艺术类',
      theme: { deep: '#8B5CF6' },
      clubs: [{ name: '武术社', tags: '武术' }, { name: '你好', tags: '' }]
    }]
    const page = loadPage({ id: 'art', campus: encodeURIComponent('佛山校区') })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    check(() => {
      assert.strictEqual(page.data.category.name, '艺术类', '应展示服务端返回的分类')
      assert.deepStrictEqual(plain(page.data.clubs.map((c) => c.name)), ['武术社', '你好'],
        '详情页应展示该分类下的社团（截图里点进去为空就是这条链路断了）')
      assert.strictEqual(page.data.clubs[0].firstChar, '武', '应预计算首字符徽标')
      assert.strictEqual(page.data.clubs[0].avatarState, 'none', '无头像社团应回退文字徽标（avatarState = none）')
    }, '社团列表渲染')
  }

  // 7) 点击社团 → 整行跳转社团详情页，带上唯一标识 id
  {
    fetchResult = [{
      id: 'art',
      name: '艺术类',
      theme: { deep: '#8B5CF6' },
      clubs: [{ id: 7, name: '武术社', tags: '武术', avatarUrl: 'https://cdn.example.com/a.png' }, { id: 9, name: '你好', tags: '' }]
    }]
    const page = loadPage({ id: 'art', campus: encodeURIComponent('佛山校区') })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    check(() => {
      assert.strictEqual(page.data.clubs[0].id, 7, '服务端社团有 id，应可跳转（箭头展示条件）')
      assert.strictEqual(page.data.clubs[0].avatarUrl, 'https://cdn.example.com/a.png', '申请人上传的社团头像应透传到列表')
      assert.strictEqual(page.data.clubs[0].avatarState, 'loading', '带头像社团初始为加载态，加载完成由 bindload 置为 loaded')
      assert.strictEqual(page.data.clubs[1].avatarState, 'none', '无头像社团不走头像加载流程')
    }, '可跳转标记与头像透传')

    navigatedTo = null
    page.onClubTap({ currentTarget: { dataset: { id: 7, name: '武术社' } } })
    check(() => {
      assert.ok(navigatedTo, '点击社团应触发跳转')
      assert.strictEqual(navigatedTo, '/pages/club/club-detail?id=7&name=' + encodeURIComponent('武术社'),
        '应带上社团唯一标识 id 与名称跳转（名称用于先占住导航栏标题）')
    }, '跳转社团详情页')
  }

  // 7.5) 头像同步三态：加载完成淡入 / 失败回退并提示 / 手动重试
  {
    fetchResult = [{
      id: 'art',
      name: '艺术类',
      theme: { deep: '#8B5CF6' },
      clubs: [{ id: 7, name: '武术社', tags: '武术', avatarUrl: 'https://cdn.example.com/a.png' }]
    }]
    const page = loadPage({ id: 'art' })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    // 加载完成 → 淡入显示
    page.onAvatarLoad({ currentTarget: { dataset: { index: 0 } } })
    check(() => {
      assert.strictEqual(page.data.clubs[0].avatarState, 'loaded', 'bindload 后应置为 loaded 并淡入显示')
    }, '头像加载完成')
    // 加载失败 → 回退文字徽标并给出明确提示
    toastText = ''
    page.onAvatarError({ currentTarget: { dataset: { index: 0 } } })
    check(() => {
      assert.strictEqual(page.data.clubs[0].avatarState, 'failed', 'binderror 后应回退 failed（文字徽标兜底）')
      assert.strictEqual(toastText, '头像同步失败，点击头像可重试', '同步失败应给出明确提示')
    }, '头像同步失败提示')
    // 手动更新：附加时间戳绕过失败缓存重新加载
    page.onAvatarRetry({ currentTarget: { dataset: { index: 0 } } })
    check(() => {
      assert.strictEqual(page.data.clubs[0].avatarState, 'loading', '重试后应回到加载态')
      assert.ok(
        page.data.clubs[0].avatarSrc.indexOf('https://cdn.example.com/a.png') === 0 && /r=\d+/.test(page.data.clubs[0].avatarSrc),
        '重试应附加时间戳参数绕过失败缓存'
      )
    }, '手动重试')
  }

  // 8) 本地内置兜底数据没有 id：不能跳到空白详情页，应给出提示
  {
    navigatedTo = null
    toastText = ''
    const page = loadPage({ id: 'unknown' })
    page.onClubTap({ currentTarget: { dataset: { id: undefined, name: '武术社' } } })
    check(() => {
      assert.strictEqual(navigatedTo, null, '没有唯一标识时不应跳转')
      assert.strictEqual(toastText, '社团详情暂不可用', '应提示详情暂不可用')
    }, '无 id 不跳转')
  }

  // 9) wxml/wxss 不应再保留就地展开区（已改为整行跳转）
  {
    const wxml = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'club', 'detail.wxml'), 'utf8')
    const wxss = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'club', 'detail.wxss'), 'utf8')
    check(() => {
      assert.doesNotMatch(wxml, /onToggleClub|club-detail-inner/,
        '分类页不应再有就地展开逻辑（已改为跳转社团详情页）')
      assert.doesNotMatch(wxss, /\.club-detail\.show/,
        '分类页不应再保留折叠展开区的 max-height 样式')
      assert.match(wxml, /bindtap="onClubTap"/, '社团行应绑定跳转事件')
    }, '展开区已移除')
  }

  // 10) 社团详情页必须为简介留出完整高度：不得用 max-height + overflow 折叠长简介
  //     （分类页旧实现曾写死 560rpx 把长简介裁掉，新页面不能重蹈覆辙）
  {
    const rawDetailWxss = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'club', 'club-detail.wxss'), 'utf8')
    // 先去掉 css 注释：注释里会出现「不设 max-height」之类的说明文字，不剥离会误判
    const detailWxss = rawDetailWxss.replace(/\/\*[\s\S]*?\*\//g, '')
    const controllerSrc = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'clubController.js'), 'utf8')
    const introLimit = Number((controllerSrc.match(/optionalText\(body\.intro,\s*(\d+)\)/) || [])[1])
    const sectionText = detailWxss.match(/\.section-text\s*\{[^}]*\}/)
    check(() => {
      assert.strictEqual(introLimit, 1000, '应从 clubController 解析出简介上限')
      assert.ok(sectionText, '应存在 .section-text 样式块')
      assert.doesNotMatch(sectionText[0], /max-height/,
        '.section-text 不得设 max-height，简介上限 ' + introLimit + ' 字，截断后用户无从查看')
      assert.doesNotMatch(sectionText[0], /overflow\s*:\s*hidden/,
        '.section-text 不得设 overflow:hidden，否则长简介会被静默裁掉')
    }, '简介不截断')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Club detail campus tests failed:', err.message)
  process.exit(1)
})
