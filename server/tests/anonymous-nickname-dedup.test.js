/**
 * 分身昵称「撞名」治理回归（2026-11-03）
 *
 * 背景：分身昵称从固定素材池随机取。线上统计（647 帖 / 1307 条分身评论）：
 *   - 216 条匿名帖只用到 103 个不同昵称；
 *   - **1307 条分身评论把 134 个昵称全部用满，平均每个名字被用 9.8 次**；
 *   - 热门帖（170 条评论）只有 72 个不同昵称，同名者 2~3 个。
 * 后果不是「不好看」，而是**误导**：两个「攀爬的苔藓」可能是不同人，
 * 读者却会当成同一个人；反过来同一人跨帖又换了名字，看着像很多人。
 *
 * 两层修复：
 *   A. 同帖内去重（server/controllers/commentController.js）
 *      —— 以楼主为第 1 位，同名分身第 2 个起追加「·2」「·3」；
 *         按**用户**编号（同帖内一个用户只有一个分身），且按全帖 id 排序，
 *         保证翻页/换排序不改变后缀。
 *   B. 素材池扩容（utils/avatar.js）
 *      —— 修饰语 × 景物 组合，昵称空间 134 → 1.8 万。
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

// ======================= B. 素材池 =======================

const avatar = require('../../utils/avatar')

check(() => {
  assert.ok(avatar.DEFAULT_NAMES.length >= 100, '精选池不应被删减')
  assert.ok(avatar.ANONYMOUS_NAME_MODIFIERS.length >= 100, '需要足够的修饰语')
  assert.ok(avatar.ANONYMOUS_NAME_NOUNS.length >= 100, '需要足够的景物词')
  assert.ok(
    avatar.ANONYMOUS_NAME_SPACE >= 10000,
    '昵称空间必须扩到 1 万以上，否则 1300+ 条评论仍会大面积撞名（实际 ' + avatar.ANONYMOUS_NAME_SPACE + '）'
  )
}, 'B1. 昵称空间 ≥ 10000')

check(() => {
  // 组合结果必须仍是「XX的YY」形态，且不能出现自相矛盾的季节堆叠
  const samples = []
  for (let i = 0; i < 400; i++) samples.push(avatar.getRandomAnonymousName())
  assert.ok(samples.every((n) => typeof n === 'string' && n.length >= 3 && n.length <= 16),
    '昵称长度应在 3~16 字之间')
  const seasonal = /^(春日|夏日|秋日|冬日)的(初春|盛夏|深秋|隆冬|早春|秋季|冬至|夏至|梅季)$/
  assert.deepStrictEqual(
    samples.filter((n) => seasonal.test(n)),
    [],
    '不应生成「春日的隆冬」这类季节矛盾组合'
  )
}, 'B2. 组合形态与语义约束')

check(() => {
  // 170 次抽样（≈一个热门帖的评论数）应几乎不重复
  const seen = new Set()
  for (let i = 0; i < 170; i++) seen.add(avatar.getRandomAnonymousName())
  assert.ok(seen.size >= 160, '170 次抽样唯一数应 ≥160（旧池只有 134，必然不达标），实际 ' + seen.size)
}, 'B3. 170 次抽样唯一数 ≥160')

check(() => {
  const source = require('fs').readFileSync(require.resolve('../../utils/anonymousIdentity'), 'utf8')
  assert.ok(
    /getRandomAnonymousName/.test(source),
    'anonymousIdentity.generate 必须改用扩容后的 getRandomAnonymousName，否则线上仍是 134 池'
  )
  assert.ok(
    !/pick\(\s*names\s*\)/.test(source),
    '不得再直接从 DEFAULT_NAMES（134 个）里抽昵称'
  )
}, 'B4. 分身生成已接入扩容池')

// ======================= A. 同帖内去重 =======================

const QUERIES = []
let pageRows = []
let allComments = []

const POST_AUTHOR = { user_id: 100, nick: '火红的晚霞' }

const fakePool = {
  async query(sql, params) {
    const text = String(sql)
    QUERIES.push({ sql: text, params: params === undefined ? [] : params })
    if (/SELECT COUNT\(\*\) as total FROM forum_comment/.test(text)) return [[{ total: allComments.length }]]
    if (/FROM forum_post WHERE id = \?/.test(text)) return [[POST_AUTHOR]]
    if (/FROM forum_comment\s+WHERE post_id = \? AND status = 1 AND anonymous_identity IS NOT NULL/.test(text)) {
      return [allComments.map((c) => ({ id: c.id, user_id: c.user_id, nick: c.nick }))]
    }
    if (/FROM forum_comment c LEFT JOIN sys_user u/.test(text)) return [pageRows]
    return [[]]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const commentController = require('../controllers/commentController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function commentRow(id, userId, nick, parentId, parentNick) {
  return {
    id, user_id: userId, content: '内容 ' + id, images: null,
    anonymous_identity: JSON.stringify({ nickName: nick, avatarUrl: '/assets/avatar1/鹰.jpg' }),
    parent_id: parentId || 0, like_count: 0, status: 1,
    nick_name: '真实昵称', avatar_url: '/assets/avatar2/avatar_01.jpg',
    created_at: '2026-11-03 10:00:00',
    // 真实 SQL 用子查询算出被回复者的展示昵称，测试桩按同样语义直接给值
    parent_nick_name: parentNick || null,
  }
}

// 场景：楼主叫「火红的晚霞」；评论里两个不同的用户都撞了楼主名；
// 另有两个不同用户都叫「攀爬的苔藓」；其中 user 201 连续发了两条（应复用同一后缀）
const FULL = [
  { id: 1, user_id: 201, nick: '火红的晚霞' },
  { id: 2, user_id: 202, nick: '攀爬的苔藓' },
  { id: 3, user_id: 201, nick: '火红的晚霞' }, // 同一人再发，必须与 id 1 同后缀
  { id: 4, user_id: 203, nick: '攀爬的苔藓' },
  { id: 5, user_id: 204, nick: '攀爬的苔藓' },
]

async function listPage(rows) {
  QUERIES.length = 0
  pageRows = rows
  const res = makeRes()
  await commentController.list({ query: { postId: '316', page: '1', pageSize: '20' }, userId: 999 }, res)
  return res.body.data.list
}

async function main() {
  allComments = FULL

  const firstPage = await listPage(FULL.map((c) => commentRow(c.id, c.user_id, c.nick)))
  const nickOf = (id) => {
    const hit = firstPage.find((c) => Number(c.id) === id)
    assert.ok(hit, '应返回评论 ' + id)
    return hit.nick_name
  }

  check(() => {
    assert.strictEqual(nickOf(1), '火红的晚霞·2', '与楼主撞名的评论者应变成「·2」，不能被误认成楼主')
    assert.strictEqual(nickOf(2), '攀爬的苔藓', '同名的第 1 位保持原名')
    assert.strictEqual(nickOf(3), '火红的晚霞·2', '同一用户在同一帖只占一个号，第 2 条评论必须复用同一后缀')
    assert.strictEqual(nickOf(4), '攀爬的苔藓·2', '同名的第 2 位追加「·2」')
    assert.strictEqual(nickOf(5), '攀爬的苔藓·3', '同名的第 3 位追加「·3」')
  }, 'A1. 同帖去重：楼主占第 1 位、同用户复用同一后缀、不同人依次编号')

  // 分页稳定性：只取后两条时，后缀必须与全量时一致（按全帖 id 排序算，而非按当前页）
  const secondPage = await listPage([
    commentRow(4, 203, '攀爬的苔藓'),
    commentRow(5, 204, '攀爬的苔藓'),
  ])
  check(() => {
    const n4 = secondPage.find((c) => Number(c.id) === 4).nick_name
    const n5 = secondPage.find((c) => Number(c.id) === 5).nick_name
    assert.strictEqual(n4, '攀爬的苔藓·2', '翻页后同一条评论的后缀不得改变')
    assert.strictEqual(n5, '攀爬的苔藓·3', '翻页后同一条评论的后缀不得改变')
  }, 'A2. 分页稳定：后缀按全帖 id 顺序计算')

  // 回复关系里的被回复者昵称也要带后缀，否则「回复 @某某」仍指向不明
  allComments = FULL
  const withReply = await listPage([
    commentRow(4, 203, '攀爬的苔藓'),
    commentRow(5, 204, '攀爬的苔藓', 4, '攀爬的苔藓'),
  ])
  check(() => {
    const reply = withReply.find((c) => Number(c.id) === 5)
    assert.strictEqual(
      reply.parent_nick_name,
      '攀爬的苔藓·2',
      '被回复的是同名里的第 2 位，回复提示必须带同一后缀，否则「回复 @某某」仍分不清'
    )
  }, 'A3. 回复目标昵称与被回复者保持一致')

  // 不撞名时不应出现任何后缀（避免给所有匿名评论加编号）
  allComments = [
    { id: 11, user_id: 301, nick: '蜿蜒的小溪' },
    { id: 12, user_id: 302, nick: '皎洁的明月' },
  ]
  const clean = await listPage([
    commentRow(11, 301, '蜿蜒的小溪'),
    commentRow(12, 302, '皎洁的明月'),
  ])
  check(() => {
    assert.strictEqual(clean.find((c) => Number(c.id) === 11).nick_name, '蜿蜒的小溪')
    assert.strictEqual(clean.find((c) => Number(c.id) === 12).nick_name, '皎洁的明月')
  }, 'A4. 无撞名时不加任何后缀')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('anonymous nickname dedup tests failed:', err.message)
  process.exit(1)
})
