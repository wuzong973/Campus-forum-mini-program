/**
 * 列表分页「总数 total / 加载更多 hasMore」行为回归（无需数据库）
 *
 * 背景：`const [[count], [list]] = await Promise.all([...])` 里的 `count` 是 COUNT 查询的
 * **结果集（行数组）**，不是第一行 —— 正确取值是 `count[0].total`。
 * 曾经有一批接口写成 `count.total`：它恒为 `undefined`，`Number(undefined)` 得到 NaN，
 * 于是 `total` 出参变成 null（JSON 里 NaN → null）、`hasMore` 恒 false，
 * 表现为「后台列表底部永远不出现『加载更多』，数据超过一页就再也翻不动」。
 *
 * 这个缺陷静态读代码完全看不出来 —— `count.total` 看起来天经地义，
 * 只有当 COUNT 查询被拆成「结果集」这一层显式出现时才露馅。所以这里做双层护栏：
 *
 *   1) 行为层：顶掉 pool 后用可预测的桩调用真实接口，
 *      断言 total 是有限数字、且「返回 2 条 / 共 7 条」时 hasMore 必须为 true；
 *      count 取错层时 total 必然是 NaN → 直接失败。
 *   2) 静态层：扫描所有 controller，凡是 `const [[count], ...] = await Promise.all(` 的函数体，
 *      都不允许再出现裸 `count.total`（`count[0].total` 不会命中该正则）。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

// ===== 1. 顶掉连接池与通知服务，换成可预测的桩 =====
const COUNT_TOTAL = 7
const PAGE_ROWS = 2
const SAFE_ROW = {
  id: 1, userId: 1, nickName: '测试用户', avatarUrl: '/assets/avatar2/avatar_01.jpg',
  phone: '13800000000', status: 'sent', detail: '{}', tplType: 'post_comment',
  amountFen: 99, amount: 0.99, createdAt: '2026-09-19 12:00:00', reviewedAt: null, paidAt: null,
  action: 'post.delete', targetType: 'post', targetId: 1, reason: '违规内容', note: '',
  campusName: '南海北校区', studentId: '2023001', realName: '张三', identityNumber: '440000',
  campusCredential: '', identityCredential: '', reviewNote: '',
}

let countQueries = 0
let listQueries = 0
const fakePool = {
  async query(sql) {
    const text = String(sql)
    // 只认「纯 COUNT 查询」，避免把带 GROUP BY 的聚合查询（订阅额度看板）也算进来
    if (/^\s*SELECT COUNT\(\*\) total FROM/i.test(text)) {
      countQueries++
      return [[{ total: COUNT_TOTAL }], []]
    }
    listQueries++
    return [[SAFE_ROW, Object.assign({}, SAFE_ROW, { id: 2 })], []]
  },
}

function stub(rel, exportsValue) {
  const resolved = require.resolve(rel)
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue }
}

stub('../config/pool', fakePool)
stub('../services/notificationService', {
  createNotification: () => Promise.resolve({}),
  withMediaPlaceholder: (content) => content,
})

const adminController = require('../controllers/adminController')
const paymentController = require('../controllers/paymentController')
const walletController = require('../controllers/walletController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

// 这些接口都曾用 `count.total` 取值（2026-09-19 修复），逐一钉住
const CASES = [
  ['GET /admin/reports', adminController, 'listReports', { page: '1', pageSize: '2' }],
  ['GET /admin/posts', adminController, 'listPosts', { page: '1', pageSize: '2' }],
  ['GET /admin/errand-orders', adminController, 'listErrandOrders', { page: '1', pageSize: '2' }],
  ['GET /admin/subscribe-logs', adminController, 'listSubscribeLogs', { page: '1', pageSize: '2' }],
  ['GET /admin/users', adminController, 'listUsers', { page: '1', pageSize: '2' }],
  ['GET /admin/rider-verifications', adminController, 'listRiderVerifications', { page: '1', pageSize: '2' }],
  ['GET /admin/audit-logs', adminController, 'listAuditLogs', { page: '1', pageSize: '2' }],
  ['GET /admin/payments', paymentController, 'listPayments', { page: '1', pageSize: '2' }],
  ['GET /admin/withdrawals', walletController, 'listWithdrawals', { page: '1', pageSize: '2' }],
]

async function main() {
  for (const [label, controller, method, query] of CASES) {
    const res = makeRes()
    await controller[method]({ query, userId: 1, headers: {}, body: {} }, res)
    assert.strictEqual(res.statusCode, 200, `${label} 应返回 200，实际 ${res.statusCode}：${JSON.stringify(res.body)}`)
    const data = res.body.data || {}
    assert.strictEqual(typeof data.total, 'number', `${label} 的 total 必须是数字`)
    // count 取错层时 total 会是 NaN（JSON 化后变成 null），这一条就是核心判据
    assert.ok(Number.isFinite(data.total), `${label} 的 total 不能是 NaN —— 说明 COUNT 结果集被当成了首行`)
    assert.strictEqual(data.total, COUNT_TOTAL, `${label} 的 total 应等于 COUNT 查询值 ${COUNT_TOTAL}`)
    assert.strictEqual(data.list.length, PAGE_ROWS, `${label} 应返回 ${PAGE_ROWS} 条`)
    assert.strictEqual(
      data.hasMore, true,
      `${label} 在「已返回 ${PAGE_ROWS} 条 / 共 ${COUNT_TOTAL} 条」时必须 hasMore=true（恒 false 说明 total 取错了）`
    )
  }
  assert.ok(countQueries >= CASES.length, `COUNT 查询应至少被触发 ${CASES.length} 次，实际 ${countQueries}`)
  assert.ok(listQueries >= CASES.length, `列表查询应至少被触发 ${CASES.length} 次，实际 ${listQueries}`)

  // ===== 2. 静态护栏：多结果解构后不得再用裸 count.total =====
  const dir = path.join(__dirname, '..', 'controllers')
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'))
  // 只看「多结果解构」：const [[count], [list]] = await Promise.all([...])
  // 单查询的 `const [[count]] = await pool.query(...)` 里 count 就是首行，count.total 是对的
  const ROWS_SET_DESTRUCTURE = /const \[\[count\], [^\n]*\] = await Promise\.all\(/g
  let scanned = 0
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    let match
    ROWS_SET_DESTRUCTURE.lastIndex = 0
    while ((match = ROWS_SET_DESTRUCTURE.exec(src)) !== null) {
      scanned++
      // 取该解构所在的整个函数体（到下一个顶层 exports 为止）
      const nextExports = src.indexOf('\nexports.', match.index)
      const body = src.slice(match.index, nextExports === -1 ? src.length : nextExports)
      assert.ok(
        !/count\.total/.test(body),
        `${file}: 多结果解构里的 count 是「结果集」而非首行，必须写 count[0].total`
      )
    }
  }
  assert.ok(scanned >= 15, `应扫描到至少 15 处多结果解构，实际 ${scanned}（正则可能已失配，请同步更新）`)

  console.log(`Pagination count destructure tests passed.（${CASES.length} 个接口 + ${scanned} 处解构）`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
