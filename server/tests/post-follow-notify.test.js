/**
 * 蹲贴（关注帖子）与「蹲过的帖子被评论」通知测试（无需数据库）
 *
 * 覆盖的缺陷（用户反馈「消息通知里，其他用户评论了我蹲过的帖子，消息不显示」）：
 *   此前 commentController.create 只通知帖子作者，蹲过该帖的用户收不到任何通知，
 *   消息列表里永远看不到这类消息。修复后：
 *     1) 帖子作者 → type='comment'「你的帖子有新评论」
 *     2) 蹲贴者   → type='follow' 「你蹲的帖子有新评论」（排除评论者本人与帖子作者，避免重复打扰作者）
 *   并新增 forum_post_follow 明细表承载蹲贴关系（此前蹲贴只写本地 storage，服务端无数据，
 *   既无法展示「我蹲过的帖子 / 别人蹲我的帖子」，也无从知道要通知谁）。
 *
 * 另覆盖新增的两个接口：
 *   POST /post/:id/follow   切换蹲贴（明细表 + follow_count 计数器同事务双写）
 *   GET  /post/follow/list  蹲贴列表（type=mine 我蹲的 / type=theirs 别人蹲我的）
 */
const assert = require('assert')
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

const AUTHOR_ID = 10
const COMMENTER_ID = 20
const SQUATTER_ID = 30
const POST_ID = 5

// ===== 桩：通知服务（必须在 require controller 之前注入）=====
const NOTIF_PATH = require.resolve('../services/notificationService')
const notifications = []
require.cache[NOTIF_PATH] = {
  id: NOTIF_PATH,
  filename: NOTIF_PATH,
  loaded: true,
  exports: {
    createNotification: (payload) => {
      notifications.push(payload)
      return Promise.resolve(payload)
    },
    withMediaPlaceholder: (content) => content,
  },
}

// ===== 桩：数据库 =====
// 蹲贴明细按「谁蹲了这篇帖子」建模，查询语义与真实 SQL 对齐
const SQUAT_ROWS = [{ user_id: AUTHOR_ID }, { user_id: SQUATTER_ID }, { user_id: COMMENTER_ID }]
const POST_ROW = {
  id: POST_ID,
  user_id: AUTHOR_ID,
  title: '求助：图书馆座位怎么预约',
  category: '打听求助',
  content: '如题',
  images: null,
  like_count: 1,
  comment_count: 2,
  favorite_count: 0,
  follow_count: 3,
  share_count: 0,
  view_count: 9,
  created_at: '2026-09-11 20:00:00',
  nick_name: '楼主',
  avatar_url: '/assets/avatar2/avatar_01.jpg',
  campus: '南海北校区',
  is_verified: 0,
  cert_label: '',
  allow_anonymous_pm: 1,
  post_count: 2,
  anonymous_identity: null,
  components: null,
  contact: null,
  pinned: 0,
  review_note: '',
}

const SQL_LOG = []
const fakePool = {
  async query(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    SQL_LOG.push({ sql: text, params: params || [] })
    if (/SELECT id, user_id, title FROM forum_post WHERE id = \?/.test(text)) return [[POST_ROW]]
    // 评论插入返回真实 insertId：通知的来源评论锚点就是它
    if (/^INSERT INTO forum_comment/.test(text)) return [{ insertId: 777 }]
    if (/SELECT id, nick_name, avatar_url FROM sys_user WHERE id = \?/.test(text)) {
      return [[{ id: COMMENTER_ID, nick_name: '小明', avatar_url: '/assets/avatar2/avatar_02.jpg' }]]
    }
    if (/SELECT user_id FROM forum_post_follow WHERE post_id = \?/.test(text)) return [SQUAT_ROWS]
    // 蹲贴列表
    if (/SELECT COUNT\(\*\) AS total FROM forum_post_follow f/.test(text)) return [[{ total: 1 }]]
    if (/SELECT COUNT\(\*\) AS total FROM forum_post p/.test(text)) return [[{ total: 2 }]]
    if (/FROM forum_post_follow f JOIN forum_post p/.test(text)) {
      return [[Object.assign({}, POST_ROW, { isFollowed: 1, followed_at: '2026-09-11 21:00:00' })]]
    }
    if (/FROM forum_post p LEFT JOIN sys_user u ON p\.user_id = u\.id WHERE p\.user_id = \? AND p\.status = 1/.test(text)) {
      return [[Object.assign({}, POST_ROW, { isFollowed: 1, last_followed_at: '2026-09-11 21:30:00' })]]
    }
    if (/SELECT f\.post_id, f\.user_id, u\.nick_name, u\.avatar_url/.test(text)) {
      return [[{ post_id: POST_ID, user_id: SQUATTER_ID, nick_name: '小红', avatar_url: '/assets/avatar2/avatar_03.jpg' }]]
    }
    return [[]]
  },
  // 计数器双写走事务连接；用开关模拟「首次未蹲 / 再次已蹲」两种状态
  async getConnection() {
    return {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async query(sql, params) {
        const text = String(sql).replace(/\s+/g, ' ').trim()
        SQL_LOG.push({ sql: text, params: params || [] })
        if (/SELECT id FROM forum_post WHERE id = \? AND status = 1/.test(text)) return [[{ id: POST_ID }]]
        if (/FROM forum_post_follow WHERE post_id = \? AND user_id = \?/.test(text)) {
          return [connState.followed ? [{ id: 1 }] : []]
        }
        if (/SELECT follow_count FROM forum_post WHERE id = \?/.test(text)) {
          return [[{ follow_count: connState.followed ? 3 : 4 }]]
        }
        return [[]]
      },
    }
  },
}
const connState = { followed: false }
const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const commentController = require('../controllers/commentController')
const postController = require('../controllers/postController')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function main() {
  // ===== 1) 发表评论：作者收到评论通知，蹲贴者收到蹲贴通知 =====
  {
    notifications.length = 0
    const res = makeRes()
    await commentController.create(
      { body: { postId: POST_ID, content: '我也想知道' }, userId: COMMENTER_ID },
      res,
    )
    check(() => {
      assert.strictEqual(res.body.code, 200, '评论应创建成功：' + JSON.stringify(res.body))
    }, '评论创建')

    check(() => {
      assert.strictEqual(notifications.length, 2, '应产生 2 条通知（作者 + 1 个蹲贴者），实际 ' + notifications.length)
      const authorNotif = notifications.find((n) => n.userId === AUTHOR_ID)
      assert.ok(authorNotif, '帖子作者应收到通知')
      assert.strictEqual(authorNotif.type, 'comment', '作者收到的是 comment 类型')
      assert.strictEqual(authorNotif.relatedId, POST_ID, '通知应关联原帖')
      assert.strictEqual(authorNotif.postTitle, POST_ROW.title, '通知应带帖子标题快照')
      assert.strictEqual(authorNotif.sourceCommentId, 777,
        'comment 通知必须带来源评论 id，否则点消息进原帖定不了位（前端锚点/高亮/配色全靠它）')
    }, '作者收到评论通知')

    check(() => {
      const squatNotif = notifications.find((n) => n.userId === SQUATTER_ID)
      assert.ok(squatNotif, '蹲贴者应收到「你蹲的帖子有新评论」通知（本次修复的核心）')
      assert.strictEqual(squatNotif.type, 'follow', '蹲贴通知应为独立类型 follow')
      assert.strictEqual(squatNotif.title, '你蹲的帖子有新评论')
      assert.strictEqual(squatNotif.relatedId, POST_ID)
      assert.strictEqual(squatNotif.actorNick, '小明', '通知应带评论者昵称')
      // 与作者那条指向同一条评论（都是 777）：唯一键必须含 user_id，否则 fan-out 的
      // 第二个收件人会被 ER_DUP_ENTRY 静默吞掉（迁移侧护栏见 1b）
      assert.strictEqual(squatNotif.sourceCommentId, 777, '蹲贴通知应指向同一条评论')
    }, '蹲贴者收到蹲贴通知')

    check(() => {
      assert.ok(!notifications.some((n) => n.userId === COMMENTER_ID), '评论者本人不应收到自己的评论通知')
      assert.ok(!notifications.some((n) => n.userId === AUTHOR_ID && n.type === 'follow'),
        '作者不应同时收到 comment 与 follow 两条重复通知')
      assert.strictEqual(notifications.filter((n) => n.userId === AUTHOR_ID).length, 1, '作者只应收到 1 条')
    }, '去重与自我排除')
  }

  // ===== 1b) 唯一键范围护栏（读 migrations.js 原文）=====
  {
    const fs = require('fs')
    const migrations = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
    check(() => {
      assert.ok(
        !/ensureUniqueIndex\('system_notification', 'uk_notification_source_comment', '\(source_comment_id\)'\)/.test(migrations),
        'uk_notification_source_comment 不得再按单列 (source_comment_id) 建：会吞掉同一条评论的多个收件人通知'
      )
      assert.ok(
        /ensureUniqueIndexColumns\(\s*'system_notification',\s*'uk_notification_source_comment',\s*\[\s*'user_id',\s*'type',\s*'source_comment_id'\s*\]/.test(migrations),
        '唯一键应扩成 (user_id, type, source_comment_id)，并按列集合重建（ensureUniqueIndex 只认索引名、改了定义不会重建）'
      )
    }, '来源评论唯一键范围')
  }

  // ===== 2) 切换蹲贴：明细表 + 计数器双写 =====
  {
    connState.followed = false
    SQL_LOG.length = 0
    const res = makeRes()
    await postController.follow({ params: { id: String(POST_ID) }, userId: SQUATTER_ID }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '蹲贴应成功：' + JSON.stringify(res.body))
      assert.strictEqual(res.body.data.followed, true, '首次调用应变为已蹲')
      assert.strictEqual(res.body.data.followCount, 4, '应返回落库后的真实计数（3 + 1）')
      // P22：改为 INSERT IGNORE（唯一键挡并发重复蹲贴），明细表仍必须写入
    assert.ok(SQL_LOG.some((q) => /INSERT( IGNORE)? INTO forum_post_follow/.test(q.sql)), '应写入明细表')
      assert.ok(SQL_LOG.some((q) => /follow_count = follow_count \+ 1/.test(q.sql)), '计数器应 +1')
    }, '蹲贴')
  }

  {
    connState.followed = true
    SQL_LOG.length = 0
    const res = makeRes()
    await postController.follow({ params: { id: String(POST_ID) }, userId: SQUATTER_ID }, res)
    check(() => {
      assert.strictEqual(res.body.data.followed, false, '再次调用应取消蹲贴')
      assert.ok(SQL_LOG.some((q) => /DELETE FROM forum_post_follow/.test(q.sql)), '应删除明细')
      assert.ok(SQL_LOG.some((q) => /GREATEST\(follow_count - 1, 0\)/.test(q.sql)), '计数器应 -1 且不为负')
    }, '取消蹲贴')
  }

  // ===== 3) 蹲贴列表：我蹲的 / 别人蹲我的 =====
  {
    SQL_LOG.length = 0
    const res = makeRes()
    await postController.followedList({ query: { type: 'mine', pageSize: '20' }, userId: SQUATTER_ID }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '列表应返回成功：' + JSON.stringify(res.body))
      const item = res.body.data.list[0]
      assert.ok(item, '应返回帖子')
      assert.strictEqual(item.id, POST_ID)
      assert.strictEqual(item.isFollowed, true, '「我蹲的」列表里的帖子必须是已蹲状态')
      assert.strictEqual(item.followCount, 3, '应下发蹲贴人数')
      assert.strictEqual(item.createdAt, POST_ROW.created_at, '应下发帖子发布时间')
      assert.strictEqual(item.title, POST_ROW.title, '应下发帖子标题')
      assert.strictEqual(item.nickName, '楼主', '应下发作者昵称')
      // 只取主查询（列表 SQL 以 SELECT p.* 开头），跳过同样 JOIN 了 forum_post 的 COUNT 查询
      const query = SQL_LOG.find((q) => /SELECT p\.\*,/.test(q.sql) && /FROM forum_post_follow f/.test(q.sql))
      assert.ok(query, '应查询蹲贴明细表')
      // 完整断言参数顺序与个数：占位符少配一个参数时 mysql2 会静默错位（如把 pageSize 当 userId）
      // 首位是 baseSelect 里 isLiked 子查询用的用户 id（2026-09-16 新增，
      // 否则「我蹲的帖子」列表卡片 footer 的点赞按钮永远不亮）
      assert.deepStrictEqual(query.params, [SQUATTER_ID, SQUATTER_ID, 20, 0], '参数应为 isLiked 用户 id / 蹲贴过滤用户 id / 页大小 / 偏移')
    }, '我蹲的帖子')
  }

  {
    SQL_LOG.length = 0
    const res = makeRes()
    await postController.followedList({ query: { type: 'theirs', pageSize: '20' }, userId: AUTHOR_ID }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '列表应返回成功：' + JSON.stringify(res.body))
      const item = res.body.data.list[0]
      assert.ok(item, '应返回帖子')
      assert.deepStrictEqual(item.squatUsers, [{ userId: SQUATTER_ID, nickName: '小红', avatarUrl: '/assets/avatar2/avatar_03.jpg' }],
        '应下发蹲贴者昵称预览')
      assert.strictEqual(item.followedAt, '2026-09-11 21:30:00', '应按最近被蹲时间排序')
      const main = SQL_LOG.find((q) => /SELECT p\.\*,/.test(q.sql) && /FROM forum_post p LEFT JOIN sys_user u ON p\.user_id = u\.id WHERE p\.user_id = \? AND p\.status = 1/.test(q.sql))
      assert.ok(main, '应查询自己的帖子')
      assert.ok(/f\.user_id <> \?/.test(main.sql), '必须排除「我自己蹲自己」，只统计其他用户')
      assert.deepStrictEqual(main.params,
        [AUTHOR_ID, AUTHOR_ID, AUTHOR_ID, AUTHOR_ID, AUTHOR_ID, 20, 0],
        '五个占位符依次为 baseSelect 的 isLiked、isFollowed 判定、最近被蹲时间、作者过滤、EXISTS 排除自己，再接分页')
    }, '别人蹲我的帖子')
  }

  // ===== 4) 未登录 =====
  {
    const res = makeRes()
    await postController.followedList({ query: {}, userId: 0 }, res)
    check(() => {
      assert.strictEqual(res.statusCode, 401, '未登录应返回 401')
    }, '未登录拒绝')
  }

  // ===== 5) 结构护栏：库迁移与路由注册 =====
  {
    const fs = require('fs')
    const migrations = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
    check(() => {
      assert.match(migrations, /CREATE TABLE IF NOT EXISTS forum_post_follow/, '迁移应自愈建蹲贴明细表')
      assert.match(migrations, /ensureColumn\('forum_post', 'follow_count'/, '应为 forum_post 补 follow_count 列')
      assert.match(migrations, /MODIFY COLUMN type ENUM\([^)]*'follow'[^)]*\)/,
        "通知类型枚举必须包含 'follow'，否则插入通知会报 ER_DATA_TRUNCATED 并被静默吞掉")
    }, '迁移脚本')

    const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'postRoutes.js'), 'utf8')
    check(() => {
      assert.match(routes, /router\.post\('\/:id\/follow', auth, postController\.follow\)/, '应注册切换蹲贴路由')
      assert.match(routes, /router\.get\('\/follow\/list', auth, postController\.followedList\)/, '应注册蹲贴列表路由')
      // 用注册语句本身比较，避免注释里出现的 '/:id' 干扰
      assert.ok(routes.indexOf("router.get('/follow/list'") < routes.indexOf("router.get('/:id'"),
        "'/follow/list' 必须注册在 '/:id' 之前，否则会被当作帖子 id 命中详情路由")
    }, '路由注册')

    const notif = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'notificationController.js'), 'utf8')
    check(() => {
      assert.match(notif, /n\.type IN \('comment','like','follow'\)/, '通知列表应把 follow 也关联到原帖标题')
    }, '通知列表关联')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('post follow notify tests failed:', err.message)
  process.exit(1)
})
