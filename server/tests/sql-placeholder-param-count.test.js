/**
 * SQL 占位符 / 参数个数一致性回归（全仓静态扫描 + 骑手教务认证行为）
 *
 * 背景（2026-09-21 线上事故）：
 *   `POST /api/v1/user/rider-verification/jw` 的 INSERT 分支
 *   —— 4 个 `?`（user_id / student_id / campus_credential / phone）只喂了 3 个参数
 *   `[req.userId, studentId, phone]`。
 *
 *   mysql2 的 `format()` **不会报错**，它按顺序填充并把剩下的 `?` 原样留在 SQL 里：
 *     VALUES (90, '2026...335', '13800000000', ?, 'approved', ...)
 *   后果有两层，都很隐蔽：
 *     1. `phone` 的值被错位塞进了 `campus_credential`；
 *     2. 残留的 `?` 让 MySQL 抛 ER_PARSE_ERROR，
 *        而 `safeMessage()` 对 `ER_*` 一律只回「数据库操作失败」
 *        → 用户看到一句无法定位的提示，日志里也什么都没有。
 *
 *   触发条件是「该用户在 rider_verification 里没有记录」（即所有首次认证的用户），
 *   而已有记录的用户走 UPDATE 分支（参数恰好配平）——所以问题只在全新用户身上复现，
 *   人工审核进来那 9 条数据全部正常，极易误判为「教务系统的问题」。
 *
 * 两条判据：
 *   A. 静态：扫描 server/**\/*.js，凡「字符串字面量 SQL + 数组字面量参数」的
 *      query/execute 调用，`?` 个数必须等于数组顶层元素个数。
 *   B. 动态：把 SQL 与参数真的喂给 mysql2.format()，渲染结果里不得残留 `?`。
 *      （比数个数更贴近真实运行，能抓到 `??` 标识符转义之类的边界。）
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2')

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

// ======================= A. 全仓静态扫描 =======================

const SERVER_ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', 'tests', 'logs', 'uploads', '.git', 'tmp'])

function walk(dir, out) {
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch (e) {
    return out
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try {
      st = fs.statSync(full)
    } catch (e) {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name) || name === 'deploy-backup' || name.startsWith('deploy-backup-')) continue
      walk(full, out)
    } else if (name.endsWith('.js')) {
      out.push(full)
    }
  }
  return out
}

/** 去掉 SQL 里的字符串字面量，避免把 'LIKE "%?%"' 里的 ? 也算进去 */
function stripSqlLiterals(sql) {
  return sql.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/** 数占位符：`??`（标识符转义）算一个 */
function countMarks(sql) {
  const s = stripSqlLiterals(sql)
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '?') {
      n++
      if (s[i + 1] === '?') i++
    }
  }
  return n
}

/** 从 open 位置读取一对匹配括号，跳过字符串内部 */
function readBalanced(src, start, open, close) {
  let depth = 0
  let inStr = null
  let i = start
  for (; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) break
    }
  }
  return { text: src.slice(start, i + 1), end: i + 1 }
}

/**
 * 数数组字面量的顶层元素个数。
 * 按「元素段」计数而不是数逗号 +1：多行参数数组普遍带尾随逗号
 * （`[\n  openid,\n]`），数逗号会凭空多出一个元素，把正常代码误判成 bug。
 */
function countArrayElements(arrText) {
  const inner = arrText.slice(1, -1)
  let depth = 0
  let inStr = null
  let count = 0
  let pending = true // 当前元素段是否还没碰到任何内容
  const touch = () => {
    if (pending) {
      count++
      pending = false
    }
  }
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
      touch()
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      touch()
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      touch()
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      continue
    }
    if (ch === ',' && depth === 0) {
      pending = true
      continue
    }
    if (!/\s/.test(ch)) touch()
  }
  return count
}

function lineOf(src, index) {
  return src.slice(0, index).split(/\r?\n/).length
}

/** 从 query/execute 调用里抽出 (SQL 字面量, 参数数组字面量) 对 */
function extractCalls(src) {
  const found = []
  const re = /\.(?:query|execute)\s*\(/g
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length
    while (i < src.length && /\s/.test(src[i])) i++
    const quote = src[i]
    if (quote !== '"' && quote !== "'") continue
    let j = i + 1
    while (j < src.length && src[j] !== quote) {
      if (src[j] === '\\') j++
      j++
    }
    if (j >= src.length) continue
    const sql = src.slice(i + 1, j)

    let k = j + 1
    while (k < src.length && /\s/.test(src[k])) k++
    // 跳过 SQL 与参数之间的逗号（query(sql, params) 形态）
    if (src[k] === ',') {
      k++
      while (k < src.length && /\s/.test(src[k])) k++
    }

    if (src[k] === ')') {
      // 单参数形式 query(sql)
      const marks = countMarks(sql)
      if (marks > 0) found.push({ sql, marks, params: 0, paramsText: '(无)', line: lineOf(src, i) })
      continue
    }
    if (src[k] !== '[') continue // 参数是变量，静态判断不了
    const { text } = readBalanced(src, k, '[', ']')
    found.push({
      sql,
      marks: countMarks(sql),
      params: countArrayElements(text),
      paramsText: text,
      line: lineOf(src, i),
    })
    re.lastIndex = k + text.length
  }
  return found
}

const files = walk(SERVER_ROOT, [])
assert.ok(files.length > 20, '应扫描到 server 下的源文件（实际 ' + files.length + ' 个）')

const mismatches = []
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  for (const call of extractCalls(src)) {
    if (call.marks !== call.params) {
      mismatches.push({
        file: path.relative(SERVER_ROOT, file).replace(/\\/g, '/'),
        line: call.line,
        marks: call.marks,
        params: call.params,
        sql: call.sql.replace(/\s+/g, ' ').slice(0, 130),
      })
    }
  }
}

check(() => {
  assert.deepStrictEqual(
    mismatches.map((x) => x.file + ':' + x.line + ' → ' + x.marks + ' 个 ? / ' + x.params + ' 个参数｜' + x.sql),
    [],
    'SQL 占位符个数必须与参数个数一致，否则 mysql2 静默错位 + ER_PARSE_ERROR（被 safeMessage 说成「数据库操作失败」）'
  )
}, '全仓静态扫描：query/execute 的 ? 个数 == 参数数组长度')

// ======================= B. 动态渲染校验 =======================

/** 统计 SQL 字符串字面量内部的 `?`（这些是数据，不是占位符，渲染后会合理保留） */
function literalMarks(sql) {
  let n = 0
  const re = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g
  let m
  while ((m = re.exec(sql))) n += (m[0].match(/\?/g) || []).length
  return n
}

/** 渲染后残留的 `?` 是否超过「字面量内本来就有的」数量 —— 超过即说明参数喂少了 */
function hasLeftoverMarks(sql, params) {
  const rendered = mysql.format(sql, params)
  return ((rendered.match(/\?/g) || []).length) > literalMarks(sql)
}

const RENDER_SAMPLES = [
  ['4 占位符 / 3 参数（事故原样）', "INSERT INTO t (a, b, c, d) VALUES (?, ?, ?, ?, 'x')", [1, 's', 'p']],
  ['4 占位符 / 4 参数', "INSERT INTO t (a, b, c, d) VALUES (?, ?, ?, ?, 'x')", [1, 's', '', 'p']],
  ['含字符串字面量里的问号', "SELECT * FROM t WHERE a = ? AND b LIKE '%?%'", [1]],
]

check(() => {
  const leftover = RENDER_SAMPLES.filter(([, sql, params]) => hasLeftoverMarks(sql, params))
  assert.deepStrictEqual(
    leftover.map((x) => x[0]),
    ['4 占位符 / 3 参数（事故原样）'],
    '参数少于占位符时，mysql2 不报错、静默把 ? 留在 SQL 里并让参数整体错位 —— 这正是本次事故的机制'
  )
  // 反向确认：少一个参数时，phone 会顶进 campus_credential 的位置
  const rendered = mysql.format(RENDER_SAMPLES[0][1], RENDER_SAMPLES[0][2])
  assert.ok(
    rendered.includes("'p', ?") || /,\s*\?\s*,\s*'x'/.test(rendered),
    '错位表现应为「值依次前移、末尾多出一个 ?」，实际：' + rendered
  )
}, '动态渲染：参数不足时 mysql2 会把 ? 留在 SQL 里（这正是本次事故的机制）')

// ======================= C. 行为回归：骑手教务认证三个分支 =======================

const QUERIES = []
let existRows = []

const fakePool = {
  async query(sql, params) {
    const text = String(sql)
    QUERIES.push({ sql: text, params: params === undefined ? [] : params })
    if (/FROM rider_verification WHERE user_id/.test(text)) return [existRows]
    return [{ affectedRows: 1 }]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

// 教务登录环节与本次校验无关：直接让它成功，好把「登录成功之后」的写库链路测到
const JW_PATH = require.resolve('../services/jwScheduleSyncService')
require.cache[JW_PATH] = {
  id: JW_PATH, filename: JW_PATH, loaded: true,
  exports: { verifyJwAccount: async () => true },
}

const userController = require('../controllers/userController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function makeReq(userId) {
  return {
    userId,
    body: { studentId: '2026232801335', password: 'pw', phone: '13800138000' },
  }
}

async function runCase(name, rows, invoke) {
  QUERIES.length = 0
  existRows = rows
  const res = makeRes()
  try {
    await invoke(res)
  } catch (e) {
    // 下游可能与本次校验无关，只关心 SQL 参数配平
  }
  check(() => {
    assert.ok(QUERIES.length > 0, name + '：应至少执行一条 SQL')
    const bad = QUERIES.filter((q) => countMarks(q.sql) !== q.params.length)
    assert.deepStrictEqual(
      bad.map((q) => countMarks(q.sql) + ' 个 ? / ' + q.params.length + ' 个参数：' + q.sql.replace(/\s+/g, ' ').slice(0, 130)),
      [],
      name + '：占位符个数必须与参数个数一致'
    )
    // 更贴近真实：渲染后不得残留多余的 ?
    const leftovers = QUERIES.filter((q) => hasLeftoverMarks(q.sql, q.params))
    assert.deepStrictEqual(
      leftovers.map((q) => q.sql.replace(/\s+/g, ' ').slice(0, 130)),
      [],
      name + '：mysql2 渲染后残留 ? —— 参数喂少了'
    )
  }, name)
  return res
}

async function main() {
  // 首次认证（rider_verification 无记录）→ 走 INSERT 分支，正是本次事故分支
  const res1 = await runCase('首次认证(INSERT 分支)', [], (res) =>
    userController.verifyRiderByJw(makeReq(60001), res))
  check(() => {
    assert.strictEqual(res1.statusCode, 200, '首次认证应成功返回 200，实际 ' + res1.statusCode)
  }, '首次认证应真正通过（回归本次「数据库操作失败」）')
  check(() => {
    const insert = QUERIES.find((q) => /INSERT INTO rider_verification/.test(q.sql))
    assert.ok(insert, '首次认证必须走 INSERT 分支')
    assert.strictEqual(insert.params.length, 4, 'INSERT 必须喂 4 个参数（含 campus_credential 占位）')
    assert.strictEqual(insert.params[2], '', 'campus_credential 必须是空串，不能把 phone 顶进来')
    assert.strictEqual(insert.params[3], '13800138000', 'phone 必须落在第 4 个位置')
  }, 'INSERT 参数位次：campus_credential 为空串且 phone 不得错位')

  // 已有记录但被拒过 → 走 UPDATE 分支
  const res2 = await runCase('再次认证(UPDATE 分支)', [{ id: 9, status: 'rejected' }], (res) =>
    userController.verifyRiderByJw(makeReq(60002), res))
  check(() => {
    const upd = QUERIES.find((q) => /UPDATE rider_verification/.test(q.sql))
    assert.ok(upd, '已有记录必须走 UPDATE 分支')
    assert.strictEqual(upd.params.length, countMarks(upd.sql), 'UPDATE 参数必须配平')
    assert.strictEqual(res2.statusCode, 200, '再次认证应成功返回 200')
  }, 'UPDATE 分支参数配平')

  // 已通过 → 409，不该再打教务（这里 verifyJwAccount 被桩成成功，故只断言提前返回）
  const res3 = await runCase('已通过(409 提前返回)', [{ id: 9, status: 'approved' }], (res) =>
    userController.verifyRiderByJw(makeReq(60003), res))
  check(() => {
    assert.strictEqual(res3.statusCode, 409, '已通过骑手认证应返回 409，实际 ' + res3.statusCode)
    assert.strictEqual(QUERIES.length, 1, '已通过时应只查一次 rider_verification')
  }, '已通过骑手认证 → 409 提前返回')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('sql placeholder param count tests failed:', err.message)
  process.exit(1)
})
