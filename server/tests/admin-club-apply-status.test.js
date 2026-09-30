/**
 * 管理端「社团审核」列表渲染测试（无需真机 / 无需数据库）
 * 用 vm 加载真实页面文件 pkg-admin/admin/index.js，注入假 admin API，
 * 验证 loadClubApplies() 能把服务端 club_apply.status（pending/approved/rejected）
 * 映射成中文 statusText，并把列表写入 data.clubApplies。
 *
 * 背景：此前的缺陷是 index.js 里引用了未定义的常量 CLUB_APPLY_STATUS_TEXT
 * （只定义了群聊的 GC_APPLY_STATUS_TEXT），进入「社团审核」页即抛
 * ReferenceError: CLUB_APPLY_STATUS_TEXT is not defined，列表恒为空。
 * 详见 docs/修复说明_2026-09-10_社团审核状态常量未定义.md
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const ADMIN_PAGE = path.join(MINI_PROGRAM_ROOT, 'pkg-admin', 'admin', 'index.js')
const source = fs.readFileSync(ADMIN_PAGE, 'utf8')

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

// vm 里 new 出来的数组/对象与宿主的原型不同（跨 realm），
// deepStrictEqual 会因「结构相同但非同一引用」报错，统一降级成纯数据再比。
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function deepEqual(actual, expected, message) {
  assert.deepStrictEqual(plain(actual), expected, message)
}

// ===== 桩：小程序运行时 =====
let lastQuery = null
let appliesResponse = { list: [] }

const adminStub = {
  clubApplies: (query) => {
    lastQuery = query
    return Promise.resolve(appliesResponse)
  }
}

const passthrough = new Proxy({}, { get: () => () => undefined })

let pageDefinition = null
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  Math,
  JSON,
  require: (name) => (String(name).indexOf('utils/admin') > -1 ? adminStub : passthrough),
  getApp: () => ({ globalData: { userInfo: {} } }),
  getCurrentPages: () => [],
  wx: new Proxy({}, { get: () => () => undefined }),
  Page: (definition) => { pageDefinition = definition }
}
vm.createContext(sandbox)

check(() => {
  vm.runInNewContext(source, sandbox, { filename: 'pkg-admin/admin/index.js' })
}, 'pkg-admin/admin/index.js 应能在无 CLUB_APPLY_STATUS_TEXT 报错的情况下加载')

check(() => {
  assert.ok(pageDefinition, 'pkg-admin/admin/index.js 应调用 Page() 注册页面')
}, '页面应完成注册')

function createPage() {
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  return page
}

async function main() {
  // 1) 三种状态都能映射成中文文案（回归：常量未定义会直接抛 ReferenceError）
  {
    appliesResponse = {
      list: [
        { id: 1, name: '摄影社', status: 'pending', images: null, createdAt: '2026-09-10 12:00:00' },
        { id: 2, name: '街舞社', status: 'approved', images: [], createdAt: '2026-09-10 12:00:00', reviewedAt: '2026-09-10 13:00:00' },
        { id: 3, name: '棋牌社', status: 'rejected', images: [], createdAt: '2026-09-10 12:00:00', reviewedAt: '2026-09-10 13:00:00', reviewNote: '材料不全' }
      ]
    }
    const page = createPage()
    let thrown = null
    await page.loadClubApplies().catch((err) => { thrown = err })
    check(() => {
      assert.strictEqual(thrown, null, 'loadClubApplies 不应抛错：' + (thrown && thrown.message))
    }, 'loadClubApplies 不应抛错')
    check(() => {
      deepEqual(page.data.clubApplies.map((row) => row.statusText), ['待审核', '已通过', '已驳回'],
        '三种状态应映射为中文文案')
    }, '状态文案映射')
    check(() => {
      deepEqual(page.data.clubApplies.map((row) => row.images), [[], [], []],
        'images 非数组时应兜底为空数组')
    }, 'images 兜底')
    check(() => {
      assert.strictEqual(page.data.clubApplies[0].clubChar, '摄', 'clubChar 应取社团名首字符')
      assert.strictEqual(page.data.clubApplies[2].reviewedAtText.length > 0, true, '有审核时间时应生成 reviewedAtText')
      assert.strictEqual(page.data.clubApplies[0].reviewedAtText, '', '未审核时 reviewedAtText 应为空串')
    }, '列表字段兜底')
    check(() => {
      assert.strictEqual(page.data.clubAuditDetail, null, '每次加载列表应清空详情弹窗')
    }, '清空详情')
  }

  // 2) 未知状态回退为原始值，不应渲染出 undefined
  {
    appliesResponse = { list: [{ id: 9, name: '未知社', status: 'unknown_state', createdAt: 0 }] }
    const page = createPage()
    await page.loadClubApplies()
    check(() => {
      assert.strictEqual(page.data.clubApplies[0].statusText, 'unknown_state', '未知状态应回退为原始值')
    }, '未知状态回退')
  }

  // 3) 空列表也要正常收尾（服务端不返回 list 字段时）
  {
    appliesResponse = {}
    const page = createPage()
    await page.loadClubApplies()
    check(() => {
      deepEqual(page.data.clubApplies, [], '缺少 list 字段时应落到空数组')
    }, '空响应兜底')
  }

  // 4) 筛选条件随当前 tab 传入接口
  {
    appliesResponse = { list: [] }
    const page = createPage()
    page.data.clubApplyStatus = 'approved'
    await page.loadClubApplies()
    check(() => {
      assert.strictEqual(lastQuery.status, 'approved', '应按当前筛选状态请求')
      assert.strictEqual(lastQuery.page, 1)
      assert.strictEqual(lastQuery.pageSize, 50)
    }, '筛选条件透传')
  }

  // 5) 竞态保护：旧请求的响应不应覆盖新请求的结果
  {
    appliesResponse = { list: [] }
    const page = createPage()
    let resolveFirst = null
    adminStub.clubApplies = () => new Promise((resolve) => { resolveFirst = resolve })
    const stale = page.loadClubApplies()
    adminStub.clubApplies = () => Promise.resolve({ list: [{ id: 100, name: '新数据', status: 'pending', createdAt: 0 }] })
    await page.loadClubApplies()
    resolveFirst({ list: [{ id: 200, name: '旧数据', status: 'pending', createdAt: 0 }] })
    await stale
    check(() => {
      assert.strictEqual(page.data.clubApplies.length, 1, '旧请求响应应被丢弃')
      assert.strictEqual(page.data.clubApplies[0].name, '新数据', '应保留最新的请求结果')
    }, '竞态保护')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Admin club apply status tests failed:', err.message)
  process.exit(1)
})
