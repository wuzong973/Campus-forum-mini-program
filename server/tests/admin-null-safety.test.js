/**
 * 管理后台「空值崩溃」回归（2026-11-03）
 *
 * 现象：管理后台用户列表页控制台报
 *   TypeError: Cannot read properties of null (reading '0')
 *     at async Promise.all (index 0)
 *   [渲染层错误] Cannot destructure property 'Symbol(Symbol.iterator)' of 't' as it is undefined
 *
 * 根因有两类，都会让整个页面白屏（而不是只坏一小块）：
 *
 * 1. **WXML 里裸用昵称首字当头图兜底**：`{{item.nickName[0]}}`。
 *    接口偶尔返回 `nickName: null`（账号注销、历史脏数据、后端字段缺失）时，
 *    `null[0]` 直接在渲染层抛错。同文件里其它地方写的是
 *    `{{item.nickName ? item.nickName[0] : '用'}}`，说明这是漏改。
 *
 * 2. **接口返回 null 时直接解包**：`const data = await admin.users(); data.list`。
 *    后端某个路由未部署 / 鉴权失败返回空体时，`data` 为 null，
 *    `data.list` 抛 `reading 'list'`；若再 `.map` 后 setData 到 `wx:for` 的数组上，
 *    渲染层还会连带报 `Cannot destructure ... Symbol.iterator`。
 *
 * 判据：管理端所有「取下标」与「解包接口数据」的写法都必须带空值兜底。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

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

const ROOT = path.resolve(__dirname, '..', '..')
const ADMIN_JS = path.join(ROOT, 'pkg-admin', 'admin', 'index.js')
const ADMIN_WXML = path.join(ROOT, 'pkg-admin', 'admin', 'index.wxml')

const js = fs.readFileSync(ADMIN_JS, 'utf8')
const wxml = fs.readFileSync(ADMIN_WXML, 'utf8')

check(() => {
  // 匹配「整个表达式只有一次取下标」的裸用法：{{item.nickName[0]}}
  // 带三元保护的 {{item.nickName ? item.nickName[0] : '用'}} 不会命中
  const naked = wxml.match(/\{\{[A-Za-z_$][\w.$]*\[0\]\}\}/g) || []
  assert.deepStrictEqual(
    naked,
    [],
    'WXML 里不得裸用 [0]（接口返回 null 时渲染层直接抛 reading \'0\'），请写成 {{x ? x[0] : \'兜底\'}}'
  )
}, 'W1. WXML 无裸 [0] 下标')

check(() => {
  // 接口数据解包：必须是 (data && data.list) 或 data.list 出现在 data 已判空的上下文
  const naked = (js.match(/(?<!&&\s*)data\.list/g) || [])
  assert.strictEqual(
    naked.length,
    0,
    '接口返回 null 时 data.list 会抛 reading \'list\'（实测 21 处），必须写成 (data && data.list) || []'
  )
}, 'W2. JS 无裸 data.list 解包')

check(() => {
  // 分页字段同理
  assert.ok(!/Number\(data\.total \|\| 0\)/.test(js), 'data.total 需带 data 判空')
  assert.ok(!/!!data\.hasMore/.test(js), 'data.hasMore 需带 data 判空')
  assert.ok(!/data\.categories \|\| \[\]/.test(js), 'data.categories 需带 data 判空')
}, 'W3. 分页/分类字段同样带判空')

check(() => {
  // 关键列表加载函数必须保留兜底（防止后续有人改回去）
  const loaders = [
    'loadUsers', 'loadServices', 'loadRiderVerifications',
    'loadWithdrawals', 'loadAdmins', 'loadGroupChatApplies',
  ]
  const missing = loaders.filter((name) => {
    const start = js.indexOf('async ' + name + '(')
    if (start < 0) return true
    const block = js.slice(start, start + 900)
    return !/\(data && data\.list\)/.test(block)
  })
  assert.deepStrictEqual(missing, [], '这些列表加载函数必须保留 data 判空：' + missing.join(', '))
}, 'W4. 列表加载函数保留空值兜底')

check(() => {
  // 昵称首字兜底在帖子卡片等处已有正确写法，确保没有被批量改坏
  assert.ok(
    /item\.nickName \? item\.nickName\[0\] : '同'/.test(wxml),
    '帖子卡片的首字兜底必须保留'
  )
}, 'W5. 既有正确写法未被破坏')

check(() => {
  // 直接对 await 结果解包 .list 的写法没有判空机会（如 (await admin.items()).list）
  const chained = js.match(/\(await admin\.[A-Za-z0-9_]+\([^)]*\)\)\.list/g) || []
  assert.deepStrictEqual(
    chained,
    [],
    '不得直接对 await 结果解包 .list，必须先用变量接收并判空'
  )
}, 'W6. 无链式 .list 解包')

check(() => {
  const start = js.indexOf('async loadUsers(')
  const block = js.slice(start, start + 500)
  assert.ok(/const list = data && data\.list/.test(block), 'loadUsers 必须保留 data 判空')
  assert.ok(/Array\.isArray\(list\)/.test(block), 'users 必须归一化为数组，避免 wx:for 收到 null/对象')
}, 'W7. 用户列表数组归一化')

check(() => {
  const start = js.indexOf('async refreshStats(')
  const block = js.slice(start, start + 1500)
  assert.ok(/Array\.isArray\(raw\.recentActions\)/.test(block), 'recentActions 必须归一化为数组，避免渲染层 Symbol.iterator')
  assert.ok(/users: raw\.users/.test(block), 'stats.users 必须补齐，避免 stats.users.total 读空')
  assert.ok(/posts: raw\.posts/.test(block), 'stats.posts 必须补齐')
  assert.ok(/errands: raw\.errands/.test(block), 'stats.errands 必须补齐')
}, 'W8. 概览统计形状归一化')

check(() => {
  const missing = ['toggleUser', 'changeRole', 'saveCertLabel'].filter((name) => {
    const start = js.indexOf(name)
    if (start < 0) return true
    const block = js.slice(start, start + 700)
    return !/await this\.loadUsers\(\)/.test(block)
  })
  assert.deepStrictEqual(missing, [], '用户操作后的列表刷新必须 await，避免未处理的 Promise rejection：' + missing.join(', '))
  assert.ok(/searchUsers\(\)\s*\{\s*this\.loadUsers\(\)\.catch/.test(js), '搜索刷新同样必须捕获失败')
}, 'W9. 用户操作刷新 Promise 已处理')

console.log(testCount + ' tests passed.')
