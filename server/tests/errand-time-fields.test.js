/**
 * 跑腿订单「期望时间 / 截止时间」字段测试（无需真机/无需数据库）
 *
 * 背景（2026-09-11 修复）：订单卡片此前把发单人在公开描述里用快捷标签插入的
 * 「期望完成时间：」当正文展示，加上卡片本身的期望时间行，出现两个重复标签。
 * 修复后：
 *   - 卡片固定展示「期望时间：」（appointment_time，未填写 → 越快越好）与
 *     「截止时间：」（accept_deadline，未设置不显示）两个独立字段；
 *   - 期望完成时间在发布页改为选填，服务端为空存 NULL；
 *   - 公开描述开头的历史「期望完成时间：」前缀在展示层清理。
 *
 * 覆盖：
 *   A) 接单大厅 pages/errand/index.js normalizeOrder
 *   B) 订单管理页 pages/errand-order/index.js normalizeOrder
 *   C) 服务端 errandController：接单大厅列表 SELECT 必须下发 accept_deadline；
 *      create 允许期望完成时间为空（存 NULL），非空时正常入库
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

// ===== 通用桩 =====
const formatStub = { formatRelativeTime: () => '刚刚' }
const refreshStub = { runPullDownRefresh: () => undefined }
const authStub = { requireRunnerReady: () => true, requireLogin: () => true, isLoggedIn: () => true }
const requestStub = { get: () => Promise.resolve({ list: [] }), post: () => Promise.resolve({}), BASE_URL: 'http://localhost' }
const errandStatusStub = { consume: () => ({}), publish: () => undefined }
const apiStub = { getErrandList: () => Promise.resolve({ list: [] }) }

function makeSandbox() {
  const localStorage = {}
  const wxStub = new Proxy(
    {
      getStorageSync: (key) => (key in localStorage ? localStorage[key] : ''),
      setStorageSync: () => undefined,
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
    RegExp,
    Proxy,
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
    sandbox.__pageDefinition = definition
  }
  return sandbox
}

function loadPage(relPath) {
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, relPath), 'utf8')
  const sandbox = makeSandbox()
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: relPath })
  assert.ok(sandbox.__pageDefinition, relPath + ' 应调用 Page() 注册页面')
  return sandbox.__pageDefinition
}

function makePageInstance(definition, dataOverrides) {
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  Object.assign(page.data, dataOverrides || {})
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      this.data[k] = patch[k]
    })
  }
  page._localStatus = {}
  return page
}

// 与实现一致的本地时区期望值（时区无关断言：把字符串解析回原时刻再取本地字段）
function expectedDeadlineText(value) {
  const d = new Date(String(value).replace(' ', 'T'))
  const p = (n) => String(n).padStart(2, '0')
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// ===== A) 接单大厅 =====
function testHallPage() {
  const definition = loadPage(path.join('pages', 'errand', 'index.js'))

  // A1: 有 appointment_time → 期望时间原样展示；无 → 越快越好
  const page = makePageInstance(definition, { activeListTab: 0 })
  const withTime = page.normalizeOrder({ id: 1, status: 'pending', appointment_time: '今天下午3点前', remark: '帮我拿一下' })
  check(() => {
    assert.strictEqual(withTime.expectText, '今天下午3点前', '有期望时间应原样展示')
  }, '大厅：有期望时间')

  const withoutTime = page.normalizeOrder({ id: 2, status: 'pending' })
  check(() => {
    assert.strictEqual(withoutTime.expectText, '越快越好', '未填期望时间应显示越快越好')
    assert.strictEqual(withoutTime.deadlineText, '', '未设置截止时间不应显示')
  }, '大厅：未填期望时间 → 越快越好')

  // A2: accept_deadline（服务端 DATETIME 序列化的 UTC ISO 串）→ 按本地时区格式化
  const withDeadline = page.normalizeOrder({ id: 3, status: 'pending', accept_deadline: '2026-09-12T07:00:00.000Z' })
  check(() => {
    assert.strictEqual(withDeadline.deadlineText, expectedDeadlineText('2026-09-12T07:00:00.000Z'), '截止时间应按本地时区格式化')
  }, '大厅：截止时间格式化')

  // A3: 公开描述里的历史「期望完成时间：」前缀应清理，避免与期望时间字段重复
  const legacyEmpty = page.normalizeOrder({ id: 4, status: 'pending', remark: '期望完成时间：', title: '快递代拿' })
  check(() => {
    assert.strictEqual(legacyEmpty.descText, '快递代拿', '描述只有空「期望完成时间：」时应回退标题')
  }, '大厅：空期望前缀回退标题')

  const legacyWithContent = page.normalizeOrder({ id: 5, status: 'pending', remark: '期望完成时间：\n送达地点：东门', title: '快递代拿' })
  check(() => {
    assert.strictEqual(legacyWithContent.descText, '送达地点：东门', '描述开头的期望前缀应被清理')
  }, '大厅：期望前缀清理')

  const normalRemark = page.normalizeOrder({ id: 6, status: 'pending', remark: '帮我取一下快递，谢谢', title: '快递代拿' })
  check(() => {
    assert.strictEqual(normalRemark.descText, '帮我取一下快递，谢谢', '正常描述不应被改动')
  }, '大厅：正常描述不清理')
}

// ===== B) 订单管理页 =====
function testOrderPage() {
  const definition = loadPage(path.join('pages', 'errand-order', 'index.js'))
  const page = makePageInstance(definition, { activeTab: 0 })

  const withTime = page.normalizeOrder({ id: 11, status: 'pending', publisher_id: 1, appointmentTime: '明天上午' })
  check(() => {
    assert.strictEqual(withTime.expectText, '明天上午', '订单管理页：有期望时间应原样展示')
  }, '管理页：有期望时间')

  const withoutTime = page.normalizeOrder({ id: 12, status: 'pending', publisher_id: 1 })
  check(() => {
    assert.strictEqual(withoutTime.expectText, '越快越好', '订单管理页：未填期望时间应显示越快越好')
    assert.strictEqual(withoutTime.deadlineText, '', '订单管理页：未设置截止时间不应显示')
  }, '管理页：未填期望时间 → 越快越好')

  const withDeadline = page.normalizeOrder({ id: 13, status: 'pending', publisher_id: 1, acceptDeadline: '2026-09-12 15:00:00' })
  check(() => {
    assert.strictEqual(withDeadline.deadlineText, expectedDeadlineText('2026-09-12 15:00:00'), '订单管理页：截止时间应格式化')
  }, '管理页：截止时间格式化')

  const legacyEmpty = page.normalizeOrder({ id: 14, status: 'pending', publisher_id: 1, remark: '期望完成时间：', title: '外卖代拿' })
  check(() => {
    assert.strictEqual(legacyEmpty.descText, '外卖代拿', '订单管理页：空期望前缀应回退标题')
  }, '管理页：空期望前缀回退标题')
}

// ===== C) 服务端 =====
async function testServerController() {
  const POOL_PATH = require.resolve('../config/pool')
  const captured = []
  const fakePool = {
    async query(sql, params) {
      captured.push({ sql: String(sql), params: params || [] })
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 0 }]]
      if (/INSERT INTO errand_order/.test(sql)) return [[{ insertId: 9 }]]
      return [[]]
    },
  }
  require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
  const errandController = require('../controllers/errandController')

  function makeRes() {
    return {
      locals: {}, statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this },
      json(body) { this.body = body; return this },
    }
  }

  // C1: 接单大厅列表 SELECT 必须包含 e.accept_deadline（否则卡片无法展示截止时间）
  {
    captured.length = 0
    const res = makeRes()
    await errandController.list({ userId: 0, query: {} }, res)
    const listSql = captured.map((c) => c.sql).find((s) => s.indexOf('publisher_avatar') > -1) || ''
    check(() => {
      assert.ok(listSql.indexOf('e.accept_deadline') > -1, '大厅列表 SQL 应下发 accept_deadline，实际：' + listSql.slice(0, 200))
    }, '服务端：大厅列表下发 accept_deadline')
  }

  // C2: create 期望完成时间为空 → 存 NULL，不再报「请填写期望完成时间」
  {
    captured.length = 0
    const res = makeRes()
    await errandController.create(
      { userId: 1, body: { type: '其他', campus: '佛山校区', genderRequirement: '不限性别', receiverName: '张三', receiverPhone: '13800000000', pickupTimeType: '预约', appointmentTime: '   ', reward: 5, remark: '谢谢' } },
      res,
    )
    const insert = captured.find((c) => c.sql.indexOf('INSERT INTO errand_order') > -1)
    check(() => {
      assert.ok(insert, '应执行创建订单 INSERT')
      assert.strictEqual(insert.params[10], null, '期望完成时间为空应存 NULL（第 11 个参数为 appointment_time）')
    }, '服务端：create 允许空期望时间')
  }

  // C3: create 期望完成时间非空 → 原样入库
  {
    captured.length = 0
    const res = makeRes()
    await errandController.create(
      { userId: 1, body: { type: '其他', campus: '佛山校区', genderRequirement: '不限性别', receiverName: '张三', receiverPhone: '13800000000', pickupTimeType: '预约', appointmentTime: '今天下午3点前', reward: 5, remark: '谢谢' } },
      res,
    )
    const insert = captured.find((c) => c.sql.indexOf('INSERT INTO errand_order') > -1)
    check(() => {
      assert.strictEqual(insert.params[10], '今天下午3点前', '非空期望时间应原样入库')
    }, '服务端：create 保留非空期望时间')
  }
}

async function main() {
  testHallPage()
  testOrderPage()
  await testServerController()
  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Errand time fields tests failed:', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
