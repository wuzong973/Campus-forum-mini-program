/**
 * 管理后台·帖子列表展示发帖人手机号（2026-11-03）
 *
 * 需求：管理员需要在帖子列表直接看到发帖人手机号（帖子违规/需要沟通时好联系），
 * 且**不脱敏**（超管联系用户是必要能力）。
 *
 * 三层接线缺一不可，漏任何一层都会「后端有数据、页面看不到」：
 *   1. SQL 必须 SELECT `u.phone publisherPhone`；
 *   2. 接口返回的每一条必须带 `publisherPhone`；
 *   3. WXML 帖子卡片必须渲染 `item.publisherPhone`。
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

const QUERIES = []
const ROW = {
  id: 1, userId: 67, title: '测试帖子', category: '日常话题', content: '正文', status: 1,
  pinned: 0, reviewNote: '', createdAt: '2026-11-03 10:00:00', updatedAt: '2026-11-03 10:00:00',
  likeCount: 0, commentCount: 0,
  nickName: '火红的晚霞', avatarUrl: '/assets/avatar2/avatar_01.jpg',
  publisherPhone: '13404481721',
}

const fakePool = {
  async query(sql) {
    const text = String(sql)
    QUERIES.push(text)
    if (/^\s*SELECT COUNT\(\*\) total FROM/i.test(text)) return [[{ total: 1 }], []]
    return [[ROW], []]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const adminController = require('../controllers/adminController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function main() {
  const res = makeRes()
  await adminController.listPosts({ query: { page: '1', pageSize: '10' } }, res)

  const listSql = QUERIES.find((q) => /FROM forum_post p/.test(q) && /ORDER BY p\.pinned/.test(q))

  check(() => {
    assert.ok(listSql, '应执行帖子列表查询')
    assert.ok(
      /u\.phone publisherPhone/.test(listSql),
      'listPosts 的 SELECT 必须带 u.phone publisherPhone，否则前端拿不到号码：' + listSql
    )
  }, 'P1. SQL 返回发帖人手机号')

  check(() => {
    const list = (res.body && res.body.data && res.body.data.list) || []
    assert.strictEqual(list.length, 1, '应返回 1 条')
    assert.strictEqual(list[0].publisherPhone, '13404481721', '每条帖子必须带 publisherPhone')
  }, 'P2. 接口返回 publisherPhone')

  check(() => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.wxml'),
      'utf8'
    )
    assert.ok(
      /item\.publisherPhone/.test(wxml),
      '帖子卡片必须渲染 item.publisherPhone，否则后端加了字段页面上也看不到'
    )
  }, 'P3. 帖子卡片渲染手机号')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('admin post phone tests failed:', err.message)
  process.exit(1)
})
