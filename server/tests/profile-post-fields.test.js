/**
 * 用户主页帖子字段完整性测试（无需数据库）
 *
 * 用户报告：在自己主页看帖子、在别人主页看帖子，浏览量**全都显示 0**。
 *
 * 根因：`userController.mapProfilePost()` 的返回对象里漏了 `viewCount`。
 * SQL 用的是 `SELECT p.*`（`view_count` 一直躺在结果集里），但这一步手工映射没有抄进去，
 * 客户端 `api.js` 的 `mapPost` 拿到 `undefined || undefined || 0` → 恒为 0，
 * 且无论看自己还是看别人都一样（因为根本不区分访问者）。
 *
 * 同一个漏映射还带掉了 `pinned`：帖子头部「置顶」角标读的是 `post.pinned`，
 * 缺失时置顶帖在主页与普通帖长得完全一样。
 *
 * 对照：`postController.mapPost()`（首页/列表用）两者都有，所以只有主页异常。
 *
 * 本测试锁两件事：
 *   1) 主页接口必须下发 viewCount / pinned，且**值来自数据库**而不是硬编码 0；
 *   2) 帖子卡片渲染所依赖的字段必须齐全（子集断言）—— 防止同类漏映射再次发生。
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

// ===== 假 pool：按 SQL 分派 =====
const DB_POST = {
  id: 9,
  user_id: 50,
  title: '广轻，梦想哭了',
  category: '日常话题',
  content: '正文内容',
  images: null,
  like_count: 3,
  comment_count: 9,
  favorite_count: 1,
  share_count: 0,
  view_count: 280,
  status: 1,
  pinned: 1,
  isLiked: 0,
  created_at: '2026-09-12 09:11:00',
  anonymous_identity: null,
  nick_name: '广轻观察',
  avatar_url: '/assets/avatar2/avatar_01.jpg',
  campus: '南海北校区',
  is_verified: 1,
  cert_label: '官方',
}

let sqlLog = []
let currentPost = DB_POST

const fakePool = {
  async query(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    sqlLog.push({ text, params })
    if (/SELECT COUNT\(\*\) total FROM forum_post/.test(text)) return [[{ total: 1 }]]
    if (/FROM forum_post p LEFT JOIN sys_user u/.test(text)) return [[Object.assign({}, currentPost)]]
    return [[]]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const userController = require('../controllers/userController')
const USER_CONTROLLER_SRC = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'userController.js'), 'utf8')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

// 主页帖子卡片真正渲染的字段：从 post-card.wxml 里 `post.xxx` 提取，避免人工维护漏项。
// 排除项说明：
//   reviewNote —— 审核备注，只有被驳回（status !== 1）的帖子才有，主页只列 status = 1
// （isLiked 曾在这份豁免名单里，理由是「主页 showFooter=false 看不到点赞按钮」；
//   但同一接口也被 pages/my-posts 的「我的帖子」列表复用，那里 footer 是显示的，
//   于是豁免掩盖了「点赞态恒为 false」的缺陷。现已修好并纳入断言，不再豁免。）
const CARD_FIELD_EXEMPT = ['reviewNote']

function cardFieldsFromTemplate() {
  const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'post-card', 'post-card.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'post-card', 'post-card.js'), 'utf8')
  const fields = new Set()
  wxml.replace(/post\.([a-zA-Z]+)/g, (match, field) => { fields.add(field); return match })
  // observers 里显式声明的依赖（模板可能没直接出现，但组件靠它计算展示值）
  const observers = js.match(/observers:\s*\{[\s\S]*?\n\s{4}\}/)
  if (observers) observers[0].replace(/post\.([a-zA-Z]+)/g, (match, field) => { fields.add(field); return match })
  CARD_FIELD_EXEMPT.forEach((f) => fields.delete(f))
  return Array.from(fields).sort()
}

async function main() {
  const res = makeRes()
  await userController.getProfilePosts({ params: { id: '50' }, userId: 50, query: {} }, res)

  check(() => {
    assert.strictEqual(res.body.code, 200, '主页帖子接口应返回成功：' + JSON.stringify(res.body))
    assert.strictEqual(res.body.data.list.length, 1, '应返回一条帖子')
  }, '接口可用')

  const post = res.body.data.list[0]

  // ===== 1) 用户直接报告的缺陷 =====
  check(() => {
    assert.strictEqual(post.viewCount, 280,
      '主页帖子必须下发真实浏览量（DB 里是 280）。拿到 0 说明 mapProfilePost 又漏抄了 view_count')
    assert.notStrictEqual(post.viewCount, undefined, 'viewCount 不能是 undefined')
  }, '浏览量下发')

  check(() => {
    assert.strictEqual(post.pinned, true, '置顶标记必须下发（帖子头部「置顶」角标读它）')
  }, '置顶标记下发')

  // ===== 2) 卡片字段齐备（子集断言，不用 Object.keys 全等）=====
  check(() => {
    const fields = cardFieldsFromTemplate()
    assert.ok(fields.length >= 10, '应从 post-card.wxml 提取到足够的字段，实际：' + fields.length)
    const missing = fields.filter((f) => !(f in post))
    assert.deepStrictEqual(missing, [],
      '主页接口缺少帖子卡片渲染所需的字段：' + missing.join(', '))
  }, '卡片字段齐备')

  // ===== 3) 值不能是硬编码 0 / 假值 =====
  check(() => {
    assert.strictEqual(post.likeCount, 3, 'likeCount 应来自 DB')
    assert.strictEqual(post.commentCount, 9, 'commentCount 应来自 DB')
    assert.strictEqual(post.nickName, '广轻观察', '昵称应来自 DB')
    assert.strictEqual(post.certLabel, '官方', '认证标签应来自 DB')
  }, '字段值来自数据库')

  // ===== 4) 点赞态必须来自 SQL，而不是恒 false =====
  // 同一接口被 pages/my-posts 的「我的帖子」列表复用，那里的帖子卡片是渲染 footer 的，
  // 点赞按钮读 post.isLiked —— 不查这一列就永远显示未点赞。
  check(() => {
    const listQuery = sqlLog.filter((s) => /FROM forum_post p LEFT JOIN sys_user u/.test(s.text)).pop()
    assert.ok(listQuery, '应记录到主页帖子列表查询')
    assert.match(listQuery.text, /FROM forum_like l WHERE l\.post_id = p\.id AND l\.user_id = \?/,
      '主页帖子查询必须带 isLiked 子查询；缺了它，「我的帖子」列表的点赞按钮永远不亮')
    assert.deepStrictEqual(listQuery.params, [50, 50, 30, 0],
      '参数顺序应为 [currentUserId, profileId, pageSize, offset] —— 新增子查询后漏补参数会整体错位')
    assert.strictEqual(post.isLiked, false, 'DB 未点赞时应下发 false')
  }, '未点赞态')

  // ===== 5) 已点赞：让「为真」的分支有专属输入 =====
  // （多重防护的代码每个分支都要有只让它生效的输入，否则断言是被另一条分支拦住的）
  {
    const likedRes = makeRes()
    currentPost = Object.assign({}, DB_POST, { isLiked: 1 })
    sqlLog = []
    await userController.getProfilePosts({ params: { id: '50' }, userId: 50, query: {} }, likedRes)
    currentPost = DB_POST
    check(() => {
      assert.strictEqual(likedRes.body.data.list[0].isLiked, true,
        'DB 里点赞过就必须下发 true（0/1 都要能正确转成布尔）')
    }, '已点赞态')
  }

  // ===== 6) 匿名帖仍不得泄露真实资料（主页支持匿名帖，回归保护）=====
  {
    const anonRes = makeRes()
    const anonRow = Object.assign({}, DB_POST, {
      anonymous_identity: JSON.stringify({ nickName: '深幽的洞穴', avatarUrl: '/assets/avatar1/熊猫.jpg' }),
    })
    const originalQuery = fakePool.query
    fakePool.query = async (sql) => {
      const text = String(sql).replace(/\s+/g, ' ').trim()
      if (/SELECT COUNT\(\*\) total FROM forum_post/.test(text)) return [[{ total: 1 }]]
      if (/FROM forum_post p LEFT JOIN sys_user u/.test(text)) return [[anonRow]]
      return [[]]
    }
    await userController.getProfilePosts({ params: { id: '50' }, userId: 50, query: {} }, anonRes)
    fakePool.query = originalQuery
    check(() => {
      const ap = anonRes.body.data.list[0]
      assert.strictEqual(ap.nickName, '深幽的洞穴', '匿名帖应显示分身昵称')
      assert.ok(String(ap.avatarUrl).indexOf('avatar1') > -1, '匿名帖应显示分身头像')
      assert.ok(String(ap.nickName).indexOf('广轻观察') === -1, '不得泄露真实昵称')
      // 匿名帖同样要带上浏览量，别因为走匿名分支又丢一次
      assert.strictEqual(ap.viewCount, 280, '匿名帖也必须下发浏览量')
    }, '匿名帖不泄露且字段齐备')
  }

  // ===== 7) 源码护栏：三个字段必须留在映射里 =====
  check(() => {
    const fn = USER_CONTROLLER_SRC.match(/function mapProfilePost\(item, viewerId\)\s*\{[\s\S]*?\r?\n  return post;\r?\n\}/)
    assert.ok(fn, '应能找到 mapProfilePost 定义')
    assert.match(fn[0], /viewCount:/, 'mapProfilePost 必须映射 viewCount')
    assert.match(fn[0], /pinned:/, 'mapProfilePost 必须映射 pinned')
    assert.match(fn[0], /isLiked:/, 'mapProfilePost 必须映射 isLiked')
    assert.match(fn[0], /components: presentComponents\(/, 'mapProfilePost 必须下发帖内组件（投票等），post-card 渲染依赖它')
  }, '源码护栏')

  // ===== 8) 蹲贴列表（pages/my-posts 的「我蹲的帖子」）同样渲染 footer =====
  // 它的 baseSelect 与 type='theirs' 分支共用，改这里必须同步两个分支的参数个数
  // （参数配平另有 post-query-param-count.test.js 逐接口兜底）。
  check(() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'postController.js'), 'utf8')
    const block = src.match(/const baseSelect = `[\s\S]*?`/)
    assert.ok(block, '应能找到 followedList 的 baseSelect')
    assert.match(block[0], /FROM forum_like l WHERE l\.post_id = p\.id AND l\.user_id = \?/,
      '蹲贴列表的 baseSelect 也必须带 isLiked 子查询，否则「我蹲的帖子」点赞按钮同样不亮')
  }, '蹲贴列表点赞态')

  // ===== 9) 文案口径：统一用「分身」而不是「匿名」=====
  // 同一功能在别处已叫「分身私信」（聊天页、发帖页的说明文案），
  // 术语不统一会让用户以为是两个不同的设置，因此锁住发帖页的标题。
  check(() => {
    const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'post-publish', 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('允许被分身私信') > -1, '发帖页标题应为「允许被分身私信」')
    assert.ok(wxml.indexOf('允许被匿名私信') === -1, '不应再出现旧文案「允许被匿名私信」')
  }, '文案口径统一')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('profile post fields tests failed:', err.message)
  process.exit(1)
})
