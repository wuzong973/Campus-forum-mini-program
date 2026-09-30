/**
 * SQL 占位符数量 / 参数数组长度一致性回归（无需数据库）
 *
 * 背景：给 SELECT 里加一个子查询 `?`（如 isFollowed）却忘记给参数数组补值时，
 * 代码不报错，只是**后面的参数整体错位**（WHERE 的值被拿去当 isFollowed，
 * pageSize 被当成 OFFSET），接口在特定输入下直接 500，
 * 静态读代码几乎发现不了 —— 因为 SQL 文本里列数与值数是「看起来」配平的。
 *
 * 线上实例（2026-09-11）：postController.list / detail 加了 isFollowed 子查询后
 * 参数数组只补了 2 个 userId（SELECT 里有 3 个 `?`），
 * 结果 `GET /api/v1/post/list` 与 `GET /api/v1/post/1` 全部 500。
 * 这里对每个读接口逐一断言：SQL 中 `?` 的个数必须等于参数个数。
 */
const assert = require('assert')

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

const ROW = {
  total: 0, id: 1, user_id: 1, title: '标题', content: '内容', category: '日常话题',
  status: 1, created_at: '2026-09-11 00:00:00', images: null, anonymous_identity: null,
  components: null, contact: null, like_count: 0, comment_count: 0, favorite_count: 0,
  follow_count: 0, share_count: 0, view_count: 0, nick_name: '昵称',
  avatar_url: '/assets/avatar2/avatar_01.jpg', campus: '南海北校区', is_verified: 0,
  cert_label: '', allow_anonymous_pm: 1, post_count: 1, pinned: 0, review_note: '',
  isFollowed: 0, followed_at: '2026-09-11 00:00:00', last_followed_at: '2026-09-11 00:00:00',
}

const QUERIES = []
const fakePool = {
  async query(sql, params) {
    QUERIES.push({ sql: String(sql), params: params === undefined ? [] : params })
    return [[ROW]]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
// 订阅/推送服务与本次校验无关
const NOTIF_PATH = require.resolve('../services/notificationService')
require.cache[NOTIF_PATH] = {
  id: NOTIF_PATH, filename: NOTIF_PATH, loaded: true,
  exports: { createNotification: () => Promise.resolve({}), withMediaPlaceholder: (c) => c },
}

const postController = require('../controllers/postController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

// 每个用例：接口 + 请求对象 + 说明（覆盖「未登录」与「已登录」两种参数形态）
const CASES = [
  ['list(未登录)', () => postController.list({ query: {}, userId: 0 }, makeRes())],
  ['list(已登录)', () => postController.list({ query: { page: '2', pageSize: '10', category: '日常话题' }, userId: 7 }, makeRes())],
  ['detail(未登录)', () => postController.detail({ params: { id: '1' }, query: {}, userId: 0 }, makeRes())],
  ['detail(已登录)', () => postController.detail({ params: { id: '1' }, query: {}, userId: 7 }, makeRes())],
  ['search(未登录)', () => postController.search({ query: { keyword: '自习' }, userId: 0 }, makeRes())],
  ['search(已登录)', () => postController.search({ query: { keyword: '自习', page: '2' }, userId: 7 }, makeRes())],
  ['hot(未登录)', () => postController.hot({ query: {}, userId: 0 }, makeRes())],
  ['hot(已登录)', () => postController.hot({ query: {}, userId: 7 }, makeRes())],
  ['hotRank(未登录)', () => postController.hotRank({ query: { period: 'today', limit: '15' }, userId: 0 }, makeRes())],
  ['followedList(mine)', () => postController.followedList({ query: { type: 'mine', pageSize: '20' }, userId: 7 }, makeRes())],
  ['followedList(theirs)', () => postController.followedList({ query: { type: 'theirs', pageSize: '20' }, userId: 7 }, makeRes())],
]

async function main() {
  for (const [name, invoke] of CASES) {
    QUERIES.length = 0
    try {
      await invoke()
    } catch (e) {
      // 桩数据可能触发下游异常（如 detail 的写库分支），这里只关心参数配平
    }
    check(() => {
      assert.ok(QUERIES.length > 0, name + '：应至少执行一条 SQL')
      const bad = QUERIES.filter((q) => {
        const marks = (q.sql.match(/\?/g) || []).length
        return marks !== q.params.length
      })
      assert.deepStrictEqual(
        bad.map((q) => ((q.sql.match(/\?/g) || []).length) + ' 个 ? / ' + q.params.length + ' 个参数：' + q.sql.replace(/\s+/g, ' ').slice(0, 160)),
        [],
        name + '：占位符个数必须与参数个数一致，否则后续参数整体错位（接口 500 或查错数据）'
      )
    }, name)
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('post query param count tests failed:', err.message)
  process.exit(1)
})
