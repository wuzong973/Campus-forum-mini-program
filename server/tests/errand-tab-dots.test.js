/**
 * 互助大厅顶部标签「未读小红点」测试（vm 加载真实页面文件，无需真机/数据库）
 *
 * 背景（2026-09-11 新增）：顶部标签 我接的单/我发布的/已完成的 右上角需显示未读小红点，
 * 与状态筛选行的数字角标同源联动（_mineCache + _localStatus + _readFinalIds）：
 * 数字角标因订单被读取而消失时红点同步熄灭，再次出现未读订单时重新亮起。
 *
 * 覆盖：
 *   1) 我接的单/我发布的：任一未读订单 → 红点亮起；全部已读/无订单 → 熄灭
 *   2) 已完成的：任一来源存在未读已完成订单 → 红点亮起；已读后走真实 markFinalRead 链路熄灭
 *   3) 乐观状态（_localStatus）实时反映到红点（接单/支付后立即变化）
 *   4) 缓存未加载时全部熄灭（不误报）
 *   5) 静态断言：WXML 红点绑定 tabDots 且挂在标签文本右上角；WXSS 红点样式与定位基准
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
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

// ===== 桩 =====
const localStorage = {}
const wxStub = new Proxy(
  {
    getStorageSync: (key) => (key in localStorage ? localStorage[key] : ''),
    setStorageSync: (key, value) => {
      localStorage[key] = value
    },
    removeStorageSync: () => undefined,
    showToast: () => undefined,
    showModal: () => undefined,
    navigateTo: () => undefined,
    navigateBack: () => undefined,
    switchTab: () => undefined,
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  },
  { get: (target, prop) => (prop in target ? target[prop] : () => undefined) },
)
const requestStub = { get: () => Promise.resolve({ list: [] }), post: () => Promise.resolve({}), BASE_URL: 'http://localhost' }
const authStub = { requireRunnerReady: () => true, requireLogin: () => true }
const formatStub = { formatRelativeTime: () => '刚刚' }
const refreshStub = { runPullDownRefresh: () => undefined }
const errandStatusStub = { consume: () => ({}), publish: () => undefined }
const apiStub = { getErrandList: () => Promise.resolve({ list: [] }) }

// ===== 沙箱加载真实页面 =====
let pageDefinition = null
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
  Set,
  require: (name) => {
    const s = String(name)
    if (s.indexOf('utils/api') > -1) return apiStub
    if (s.indexOf('utils/request') > -1) return requestStub
    if (s.indexOf('utils/auth') > -1) return authStub
    if (s.indexOf('utils/format') > -1) return formatStub
    if (s.indexOf('utils/refresh') > -1) return refreshStub
    if (s.indexOf('utils/errand-status') > -1) return errandStatusStub
    return {}
  },
  getApp: () => ({ globalData: { userInfo: { id: 1 }, token: '' } }),
  getCurrentPages: () => [],
  getTabBar: () => null,
  wx: wxStub,
}
sandbox.Page = (definition) => {
  pageDefinition = definition
}
const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'errand', 'index.js'), 'utf8')
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'pages/errand/index.js' })
check(() => {
  assert.ok(pageDefinition, '应调用 Page() 注册页面')
  assert.strictEqual(typeof pageDefinition.refreshTabDots, 'function', '页面应实现 refreshTabDots')
}, '页面加载与 refreshTabDots 实现')

function createPage() {
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      this.data[k] = patch[k]
    })
  }
  page._localStatus = {}
  page._readFinalIds = new Set()
  page._readFinalKey = 'errand_read_final_order_ids:1'
  page._mineCache = { published: null, accepted: null }
  return page
}

// ===== 1) 我接的单/我发布的：未读 → 亮，缓存未加载 → 熄 =====
{
  const page = createPage()
  page.refreshTabDots()
  check(() => {
    // vm 沙箱对象来自另一 realm，deepStrictEqual 会假报 reference-equal 问题，降级 JSON 比较
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(page.data.tabDots)),
      { accepted: false, published: false, done: false },
      '缓存未加载时应全部熄灭',
    )
  }, '缓存未加载红点全熄')

  page._mineCache = {
    published: null,
    accepted: [{ id: 1, status: 'pending' }],
  }
  page.refreshTabDots()
  check(() => {
    assert.strictEqual(page.data.tabDots.accepted, true, '我接的单有未读订单应亮起')
    assert.strictEqual(page.data.tabDots.published, false, '我发布的无数据应熄灭')
    assert.strictEqual(page.data.tabDots.done, false, '无未读已完成应熄灭')
  }, '我接的单红点亮起')

  // 订单被接走后乐观状态更新 → 红点保持（仍在未读集合内），状态变化实时反映
  page._localStatus['1'] = 'accepted'
  page.refreshTabDots()
  check(() => {
    assert.strictEqual(page.data.tabDots.accepted, true, '乐观状态更新后红点应实时保持')
  }, '乐观状态实时反映')
}

// ===== 2) 已完成的：未读已完成订单 → 亮；已读 → 走真实 markFinalRead 链路熄灭 =====
{
  const page = createPage()
  page.setData({ activeListTab: 2 })
  page._mineCache = {
    published: [{ id: 10, status: 'finished' }],
    accepted: [{ id: 11, status: 'pending' }],
  }
  page.refreshTabDots()
  check(() => {
    assert.strictEqual(page.data.tabDots.done, true, '存在未读已完成订单时「已完成的」红点亮起')
    assert.strictEqual(page.data.tabDots.published, true, '未读已完成订单同时让我发布的红点亮起')
  }, '已完成红点亮起')

  // 用户点开详情 → 真实 markFinalRead → refreshBadgesNow → refreshTabDots 全链路
  page.markFinalRead({ id: 10, statusClass: 'done', raw: { id: 10 } })
  check(() => {
    assert.strictEqual(page.data.tabDots.done, false, '订单被读取后「已完成的」红点应立即熄灭')
    assert.strictEqual(page.data.tabDots.published, false, '数字角标消失的同时「我发布的」红点同步熄灭')
    const stored = localStorage['errand_read_final_order_ids:1'] || []
    assert.ok(stored.indexOf('10') > -1, '已读 id 应持久化，重启后红点不再出现')
  }, 'markFinalRead 全链路熄灭红点')

  // 再出现未读订单 → 红点重新亮起
  page._mineCache.published.push({ id: 12, status: 'finished' })
  page.refreshTabDots()
  check(() => {
    assert.strictEqual(page.data.tabDots.done, true, '再次出现未读订单时红点重新亮起')
  }, '新未读订单重新亮起')
}

// ===== 3) 已取消未读订单计入红点（与数字角标同口径） =====
{
  const page = createPage()
  page._mineCache = {
    published: [{ id: 20, status: 'cancelled' }],
    accepted: null,
  }
  page.refreshTabDots()
  check(() => {
    assert.strictEqual(page.data.tabDots.published, true, '未读已取消订单应计入我发布的红点')
    assert.strictEqual(page.data.tabDots.done, false, '已取消不计入已完成的红点')
  }, '已取消订单口径一致')
}

// ===== 4) 静态断言：WXML 绑定与 WXSS 样式 =====
{
  const wxml = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'errand', 'index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'errand', 'index.wxss'), 'utf8')
  check(() => {
    assert.ok(wxml.indexOf('tab-dot') > -1, 'WXML 应包含红点节点')
    assert.ok(wxml.indexOf('tabDots.accepted') > -1 && wxml.indexOf('tabDots.published') > -1 && wxml.indexOf('tabDots.done') > -1, '红点应绑定 tabDots 三个字段')
    const tabsStart = wxml.indexOf('class="list-tabs"')
    const tabsEnd = wxml.indexOf('status-chips', tabsStart)
    const tabsSeg = wxml.slice(tabsStart, tabsEnd)
    assert.ok(tabsSeg.indexOf('tab-dot') > -1, '红点应挂在顶部标签容器内')
    assert.ok(tabsSeg.indexOf('list-tab-text-wrap') > -1, '标签文本应有包裹层作为红点定位基准')
  }, 'WXML 红点绑定与位置')

  check(() => {
    const dot = wxss.match(/\.tab-dot\s*\{[^}]*\}/)
    assert.ok(dot, 'WXSS 应存在 .tab-dot 规则')
    assert.ok(/position\s*:\s*absolute/.test(dot[0]), '红点应为绝对定位')
    assert.ok(/#f5484d/.test(dot[0]), '红点配色应与状态筛选数字角标一致（#f5484d）')
    const wrap = wxss.match(/\.list-tab-text-wrap\s*\{[^}]*\}/)
    assert.ok(wrap && /position\s*:\s*relative/.test(wrap[0]), '.list-tab-text-wrap 应为 relative 定位基准')
  }, 'WXSS 红点样式与定位基准')
}

console.log(testCount + ' tests passed.')
