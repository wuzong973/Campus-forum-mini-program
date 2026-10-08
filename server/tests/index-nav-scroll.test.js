/**
 * 首页顶部导航栏「随滚动显隐」测试（无需真机/无需数据库）
 * 用 vm 加载真实页面文件 pages/index/index.js，构造滚动序列验证导航栏状态机。
 * 覆盖：向下滚动收起、向上滚动展开、回到顶部展开、bindscrolltoupper /
 * 浮动按钮回顶 / 切分类回顶 / onShow / 下拉刷新 / 搜索栏刷新 一律恢复展开，
 * 以及 80ms 节流与方向阈值不会让细碎抖动反复触发显隐。
 *
 * 背景：此前的缺陷是「向下滚动隐藏后再也不恢复」，根因见
 * docs/02_前端与UI交互.md（§八 导航栏滚动显隐）
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const INDEX_PAGE = path.join(MINI_PROGRAM_ROOT, 'pages', 'index', 'index.js')
const source = fs.readFileSync(INDEX_PAGE, 'utf8')

// ===== 桩：小程序运行时 =====
let fakeNow = 1000000
// 任何 require 出来的模块，任意方法都返回可链式调用的 thenable
const thenable = { then: () => thenable, catch: () => thenable, finally: () => thenable }
const stubModule = new Proxy({}, { get: () => () => thenable })

// 校园服务数据源例外：首页在模块顶层就读它的 SERVICES 生成「名字 → id」映射，
// 通用 Proxy 桩给不出数组，会让页面加载直接抛错。这里按真实结构返回。
const campusServicesStub = {
  SERVICES: [
    { id: 'school-bus', name: '校车时刻' },
    { id: 'campus-guide', name: '轻友指南' },
    { id: 'campus-card', name: '校园卡' },
    { id: 'print', name: '速印' },
    { id: 'home-bus', name: '返乡大巴' },
    { id: 'express', name: '特惠寄件' }
  ]
}

let pageConfig = null
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  Promise,
  Date: { now: () => fakeNow },
  require: (name) => (String(name).indexOf('campus-services') >= 0 ? campusServicesStub : stubModule),
  getApp: () => ({ globalData: {} }),
  getCurrentPages: () => [],
  wx: new Proxy({}, { get: () => () => undefined }),
  Page: (config) => { pageConfig = config }
}
vm.createContext(sandbox)
vm.runInNewContext(source, sandbox, { filename: 'pages/index/index.js' })
assert.ok(pageConfig, 'pages/index/index.js 应调用 Page() 注册页面')
assert.strictEqual(pageConfig.data.navVisible, true, '导航栏初始应为展开态')

// ===== 桩：页面实例 =====
function createPage() {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  return page
}

// 推进 100ms 再派发滚动事件（绕开 80ms 节流）
function scroll(page, scrollTop) {
  fakeNow += 100
  page.onContentScroll({ detail: { scrollTop } })
}

// 1) 向下滚动收起，向上滚动展开
{
  const page = createPage()
  scroll(page, 20)
  assert.strictEqual(page.data.navVisible, true, '离开顶部 20px（未过收起最小位移）应保持展开')
  scroll(page, 80)
  assert.strictEqual(page.data.navVisible, false, '向下滚动 80px 应收起导航栏')
  scroll(page, 160)
  assert.strictEqual(page.data.navVisible, false, '继续向下滚动应保持收起')
  scroll(page, 150)
  assert.strictEqual(page.data.navVisible, true, '向上滚动 10px 应恢复展开')
  scroll(page, 200)
  assert.strictEqual(page.data.navVisible, false, '再次向下滚动应收起')
  scroll(page, 40)
  assert.strictEqual(page.data.navVisible, true, '向上滚回 40px 应恢复展开')
  scroll(page, 4)
  assert.strictEqual(page.data.navVisible, true, '回到顶部附近应保持展开')
}

// 2) 收起态下滚到顶（bindscrolltoupper）必定展开
{
  const page = createPage()
  scroll(page, 300)
  assert.strictEqual(page.data.navVisible, false, '向下滚动 300px 应收起')
  page.onContentScrollToUpper()
  assert.strictEqual(page.data.navVisible, true, 'bindscrolltoupper 应展开导航栏')
}

// 3) 收起态下「回到顶部」（浮动按钮 / 切分类共用同一入口）必定展开
{
  const page = createPage()
  scroll(page, 300)
  assert.strictEqual(page.data.navVisible, false, '向下滚动 300px 应收起')
  page.scrollContentToTop({ isAtTop: true, showFloatBtns: false, showTopBtn: false })
  assert.strictEqual(page.data.navVisible, true, 'scrollContentToTop 应展开导航栏')
}

// 4) 收起态下 onShow / 下拉刷新 / 搜索栏刷新 必定展开
{
  const page = createPage()
  scroll(page, 300)
  page.onShow()
  assert.strictEqual(page.data.navVisible, true, 'onShow 应展开导航栏')

  const pull = createPage()
  scroll(pull, 300)
  pull.onContentRefresh()
  assert.strictEqual(pull.data.navVisible, true, '下拉刷新应展开导航栏')

  const action = createPage()
  scroll(action, 300)
  action.onRefreshAction()
  assert.strictEqual(action.data.navVisible, true, '搜索栏刷新按钮应展开导航栏')
}

// 5) 节流窗口内的碎事件与低于阈值的位移不应反复触发显隐
{
  const page = createPage()
  scroll(page, 200)
  assert.strictEqual(page.data.navVisible, false, '向下滚动 200px 应收起')
  for (let i = 0; i < 5; i++) {
    fakeNow += 10
    page.onContentScroll({ detail: { scrollTop: 200 - i } })
  }
  assert.strictEqual(page.data.navVisible, false, '节流窗口内的事件应被忽略')
  fakeNow += 100
  page.onContentScroll({ detail: { scrollTop: 196 } })
  assert.strictEqual(page.data.navVisible, false, '向上 4px（低于方向阈值）不应展开')
  fakeNow += 100
  page.onContentScroll({ detail: { scrollTop: 190 } })
  assert.strictEqual(page.data.navVisible, true, '向上 6px（达到方向阈值）应展开')
}

console.log('Index nav scroll tests passed.')
