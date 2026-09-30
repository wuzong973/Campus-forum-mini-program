/**
 * 管理员删除评论测试（无需数据库）
 *
 * 需求：管理员在小程序帖子详情页点评论右上角「···」时，菜单里要有「删除」，
 * 点击后该评论对所有用户消失。
 *
 * 修复前的两处缺陷：
 *   1) DELETE /comment/:id 的 SQL 是 `WHERE id = ? AND user_id = ?` —— 只认作者，
 *      管理员删别人的评论会命中 0 行并返回 403（前端菜单也就没给管理员这个入口）；
 *   2) 删除不扣 forum_post.comment_count，删得越多帖子上的评论数越虚高；
 *      且只删父评论会留下孤儿回复（被前端提升成根评论）。
 *
 * 覆盖：
 *   A. 服务端：作者删自己的、管理员删他人的、普通用户删他人的（403）、评论不存在（404）、
 *      连带删除多层回复、评论计数同步
 *   B. 页面：管理员菜单含「删除」且置顶、非管理员不含、确认后调接口并本地移除（含子回复）、
 *      取消则不调接口
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

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
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ===== A. 服务端 =====
const NOTIF_PATH = require.resolve('../services/notificationService')
require.cache[NOTIF_PATH] = {
  id: NOTIF_PATH, filename: NOTIF_PATH, loaded: true,
  exports: { createNotification: () => Promise.resolve(null), withMediaPlaceholder: (c) => c },
}

// 评论树：1 → 2 → 3（三层，均属帖子 77，他人发的），4 是帖主自己发的，5 属另一篇帖子 88
// 帖子 77 的作者 = POST_AUTHOR(30)；帖子 88 的作者 = 40
const POST_AUTHOR = 30
const COMMENTS = {
  1: { id: 1, post_id: 77, user_id: 10, parent_id: 0, status: 1, post_author_id: POST_AUTHOR },
  2: { id: 2, post_id: 77, user_id: 11, parent_id: 1, status: 1, post_author_id: POST_AUTHOR },
  3: { id: 3, post_id: 77, user_id: 12, parent_id: 2, status: 1, post_author_id: POST_AUTHOR },
  4: { id: 4, post_id: 77, user_id: POST_AUTHOR, parent_id: 0, status: 1, post_author_id: POST_AUTHOR },
  5: { id: 5, post_id: 88, user_id: 41, parent_id: 0, status: 1, post_author_id: 40 },
}
const SQL_LOG = []
const fakePool = {
  async query(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    SQL_LOG.push({ sql: text, params: params || [] })
    if (/FROM forum_comment c LEFT JOIN forum_post p ON p\.id = c\.post_id/.test(text)) {
      const row = COMMENTS[Number(params[0])]
      // 桩也要按真实 WHERE 语义过滤 status，否则「已删除的评论」会被当成存在
      return [row && row.status === 1 ? [row] : []]
    }
    if (/SELECT id FROM forum_comment WHERE parent_id IN/.test(text)) {
      const parents = params.map(Number)
      return [Object.values(COMMENTS).filter((c) => parents.indexOf(Number(c.parent_id)) > -1 && c.status === 1).map((c) => ({ id: c.id }))]
    }
    if (/UPDATE forum_comment SET status = 0 WHERE id IN/.test(text)) {
      let affected = 0
      params.map(Number).forEach((id) => {
        if (COMMENTS[id] && COMMENTS[id].status === 1) { COMMENTS[id].status = 0; affected += 1 }
      })
      return [{ affectedRows: affected }]
    }
    if (/UPDATE forum_post SET comment_count/.test(text)) return [{ affectedRows: 1 }]
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

function resetComments() {
  Object.keys(COMMENTS).forEach((id) => { COMMENTS[id].status = 1 })
}

async function serverTests() {
  // ===== 与评论无关的第三方 → 403 =====
  {
    resetComments()
    SQL_LOG.length = 0
    const res = makeRes()
    await commentController.remove({ params: { id: '1' }, userId: 20, user: { role: 'user' } }, res)
    check(() => {
      assert.strictEqual(res.statusCode, 403, '既非评论作者、也非帖子作者/管理员的用户应 403')
      assert.strictEqual(COMMENTS[1].status, 1, '评论不应被改动')
    }, '无关用户删评论')
  }

  // ===== 评论作者删自己的评论：连带子回复 + 扣计数 =====
  {
    resetComments()
    SQL_LOG.length = 0
    const res = makeRes()
    await commentController.remove({ params: { id: '1' }, userId: 10, user: { role: 'user' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '评论作者应能删除自己的评论：' + JSON.stringify(res.body))
      assert.strictEqual(res.body.data.removed, 3, '三层结构应连带删除 3 条（自身 + 2 层回复）')
      assert.strictEqual(COMMENTS[1].status, 0)
      assert.strictEqual(COMMENTS[2].status, 0, '子回复应一并删除，否则会变成无上下文的根评论')
      assert.strictEqual(COMMENTS[3].status, 0, '深层回复也要删除（只查一层会留下孤儿）')
      assert.strictEqual(COMMENTS[4].status, 1, '无关评论不应受影响')
      const countSql = SQL_LOG.find((q) => /UPDATE forum_post SET comment_count/.test(q.sql))
      assert.ok(countSql, '应同步帖子评论计数（旧实现漏了这步，删得越多计数越虚高）')
      assert.deepStrictEqual(JSON.parse(JSON.stringify(countSql.params)), [3, 77], '按实际删除条数扣减，post_id 取自被删评论')
    }, '评论作者删自己的评论')
  }

  // ===== 帖子作者删自己评论区里「他人」的评论（本次需求核心）=====
  {
    resetComments()
    SQL_LOG.length = 0
    const res = makeRes()
    await commentController.remove({ params: { id: '1' }, userId: POST_AUTHOR, user: { role: 'user' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200,
        '帖子作者应能删除自己评论区里他人的评论：' + JSON.stringify(res.body))
      assert.strictEqual(res.body.data.removed, 3)
      assert.strictEqual(res.body.data.asPostAuthor, true, '应标识这是以帖子作者身份执行的删除')
      assert.strictEqual(COMMENTS[1].status, 0)
      assert.strictEqual(COMMENTS[2].status, 0)
      assert.strictEqual(COMMENTS[3].status, 0)
    }, '帖子作者删他人评论')

    // 「只能删自己评论区里的」：别人帖子下的评论不能删
    const res2 = makeRes()
    await commentController.remove({ params: { id: '5' }, userId: POST_AUTHOR, user: { role: 'user' } }, res2)
    check(() => {
      assert.strictEqual(res2.statusCode, 403, '帖子作者不能删别人帖子下的评论')
      assert.strictEqual(COMMENTS[5].status, 1, '评论不应被改动')
    }, '帖子作者越界删除被拒')
  }

  // ===== 管理员删任意帖子下的任意评论 =====
  {
    resetComments()
    const res = makeRes()
    await commentController.remove({ params: { id: '1' }, userId: 999, user: { role: 'content_admin' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '管理员应能删除任意评论：' + JSON.stringify(res.body))
      assert.strictEqual(res.body.data.removed, 3)
      assert.strictEqual(res.body.data.asPostAuthor, false, '管理员删除不应被标记为帖子作者身份')
    }, '管理员删他人评论')

    const res2 = makeRes()
    await commentController.remove({ params: { id: '5' }, userId: 999, user: { role: 'content_admin' } }, res2)
    check(() => {
      assert.strictEqual(res2.body.code, 200, '管理员可删任意帖子下的评论')
    }, '管理员跨帖子删除')

    resetComments()
    const res3 = makeRes()
    await commentController.remove({ params: { id: '4' }, userId: 999, user: { role: 'super_admin' } }, res3)
    check(() => {
      assert.strictEqual(res3.body.code, 200, 'super_admin 同样可删')
      assert.strictEqual(res3.body.data.removed, 1, '无回复时只删自身')
    }, 'super_admin 删评论')
  }

  // ===== 无效 id / 已删除评论 =====
  {
    resetComments()
    const res = makeRes()
    await commentController.remove({ params: { id: 'abc' }, userId: 999, user: { role: 'content_admin' } }, res)
    check(() => {
      assert.strictEqual(res.statusCode, 404, '非法 id 应 404')
    }, '非法 id')

    COMMENTS[1].status = 0
    const res2 = makeRes()
    await commentController.remove({ params: { id: '1' }, userId: 999, user: { role: 'content_admin' } }, res2)
    check(() => {
      assert.strictEqual(res2.statusCode, 404, '已删除的评论再删应 404（幂等语义）')
    }, '重复删除')
    resetComments()
  }
}

// ===== B. 页面（post-detail 评论菜单）=====
const ROOT = path.join(__dirname, '..', '..')
const toastCalls = []
const actionSheetCalls = []
let actionSheetPick = 0
let modalConfirm = true
let actionSheetFail = false
const deletedCalls = []

const wxStub = new Proxy({
  showToast: (opts) => toastCalls.push(opts && opts.title),
  showActionSheet: (opts) => {
    actionSheetCalls.push(opts.itemList)
    if (actionSheetFail) return
    opts.success({ tapIndex: actionSheetPick })
  },
  showModal: (opts) => { if (typeof opts.success === 'function') opts.success({ confirm: modalConfirm, cancel: !modalConfirm }) },
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined,
  navigateTo: () => undefined,
  navigateBack: () => undefined,
  switchTab: () => undefined,
  previewImage: () => undefined,
  setClipboardData: () => undefined,
}, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) })

const apiStub = {
  deleteComment: (id) => { deletedCalls.push(Number(id)); return Promise.resolve({ removed: 1 }) },
  getPostDetail: () => Promise.resolve(null),
  reportComment: () => Promise.resolve(),
}
const requestStub = {
  get: () => Promise.resolve({}),
  post: () => Promise.resolve({}),
  put: () => Promise.resolve({}),
  del: () => Promise.resolve({}),
}
const formatStub = { formatRelativeTime: () => '刚刚', stripMediaPlaceholder: (s) => s }
const authStub = { requireLogin: () => true, isLoggedIn: () => true, guardPage: () => true }

let currentRole = 'user'
const pageSandbox = {
  module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, setImmediate,
  Promise, JSON, Date, Math, Number, String, Array, Object, parseInt, parseFloat, isNaN,
  require: (name) => {
    const s = String(name)
    if (s.indexOf('utils/api') > -1) return apiStub
    if (s.indexOf('utils/request') > -1) return requestStub
    if (s.indexOf('utils/format') > -1) return formatStub
    if (s.indexOf('utils/auth') > -1) return authStub
    if (s.indexOf('utils/refresh') > -1) return { runPullDownRefresh: () => undefined }
    if (s.indexOf('utils/avatar') > -1) return require(path.join(ROOT, 'utils', 'avatar.js'))
    if (s.indexOf('utils/anonymousIdentity') > -1) return { generate: () => ({ nickName: 'x', avatarUrl: '/assets/avatar1/熊猫.jpg' }) }
    return {}
  },
  getApp: () => ({ globalData: { userInfo: { id: 5, nickName: '管理员', role: currentRole } }, __postDetailReturn: null }),
  getCurrentPages: () => [],
  getTabBar: () => null,
  wx: wxStub,
}
let pageDefinition = null
pageSandbox.Page = (d) => { pageDefinition = d }
vm.createContext(pageSandbox)
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'pages', 'post-detail', 'index.js'), 'utf8'), pageSandbox, { filename: 'post-detail/index.js' })

function instantiate() {
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') === -1 && k.indexOf('[') === -1) { this.data[k] = patch[k]; return }
      const parts = String(k).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
      let node = this.data
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (node[parts[i]] === undefined || node[parts[i]] === null) node[parts[i]] = {}
        node = node[parts[i]]
      }
      node[parts[parts.length - 1]] = patch[k]
    })
    if (typeof cb === 'function') cb()
  }
  return page
}

// 评论树：1（他人）→ 2（他人回复），3 是自己发的。
// postAuthorId 控制「我是不是本帖作者」——帖主对自己评论区里他人的评论也有删除权。
function seedPage(role, postAuthorId) {
  currentRole = role
  const page = instantiate()
  page.buildCommentThreads = (list) => list
  page.setData({
    currentUserId: 5,
    commentTotal: 3,
    post: { id: 77, userId: postAuthorId === undefined ? 30 : postAuthorId, commentCount: 3 },
    rawComments: [
      { id: 1, userId: 10, nickName: '他人甲', content: '第一条', parentId: 0 },
      { id: 2, userId: 11, nickName: '他人乙', content: '回复', parentId: 1 },
      { id: 3, userId: 5, nickName: '自己', content: '我的评论', parentId: 0 },
    ],
  })
  return page
}

async function main() {
  await serverTests()

  // ===== 管理员菜单含「删除」且置顶 =====
  {
    actionSheetCalls.length = 0
    actionSheetFail = true
    const page = seedPage('content_admin')
    page.onCommentMore({ currentTarget: { dataset: { id: 1, userid: 10, nick: '他人甲' } } })
    check(() => {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(actionSheetCalls[0])), ['删除', '隐藏', '举报', '拉黑'],
        '管理员菜单应含「删除」且放首位（与帖子级菜单一致），实际：' + JSON.stringify(actionSheetCalls[0]))
    }, '管理员菜单')

    const page2 = seedPage('content_admin')
    actionSheetCalls.length = 0
    page2.onCommentMore({ currentTarget: { dataset: { id: 3, userid: 5, nick: '自己' } } })
    check(() => {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(actionSheetCalls[0])), ['隐藏'],
        '自己的评论不在菜单里给「删除」（评论区下方已有编辑/删除入口），管理员同样如此')
    }, '管理员 + 自己的评论')

    actionSheetFail = false
  }

  // ===== 帖子作者：可删自己评论区里他人的评论 =====
  {
    actionSheetCalls.length = 0
    actionSheetFail = true
    // role 为普通用户，但自己是本帖作者（postAuthorId = 5 = currentUserId）
    const page = seedPage('user', 5)
    page.onCommentMore({ currentTarget: { dataset: { id: 1, userid: 10, nick: '他人甲' } } })
    check(() => {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(actionSheetCalls[0])), ['删除', '隐藏', '举报', '拉黑'],
        '帖子作者应能删除自己评论区里他人的评论，实际：' + JSON.stringify(actionSheetCalls[0]))
    }, '帖子作者菜单')

    // 别人的帖子（作者 30）：不能删
    actionSheetCalls.length = 0
    const page2 = seedPage('user', 30)
    page2.onCommentMore({ currentTarget: { dataset: { id: 1, userid: 10, nick: '他人甲' } } })
    check(() => {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(actionSheetCalls[0])), ['隐藏', '举报', '拉黑'],
        '别人的帖子下菜单不应出现「删除」（作者只能删自己评论区里的评论）')
      assert.ok(actionSheetCalls[0].indexOf('删除') === -1)
    }, '非本帖作者菜单')
    actionSheetFail = false
  }

  // ===== 确认后调接口并本地移除（含子回复）=====
  {
    deletedCalls.length = 0
    toastCalls.length = 0
    modalConfirm = true
    const page = seedPage('user', 5)
    page.deleteCommentAsModerator(1)
    await tick()
    await tick()
    check(() => {
      assert.deepStrictEqual(deletedCalls, [1], '帖子作者应能调用删除接口')
      const ids = page.data.rawComments.map((c) => c.id)
      assert.deepStrictEqual(JSON.parse(JSON.stringify(ids)), [3], '被删评论及其子回复应一并从列表移除，实际：' + JSON.stringify(ids))
      assert.strictEqual(page.data.post.commentCount, 1, '帖子评论数应同步扣减（3 - 2）')
      assert.ok(toastCalls.some((t) => t && t.indexOf('已删除') > -1), '应提示删除成功')
    }, '帖子作者删除生效')
  }

  // ===== 取消确认 → 不调接口 =====
  {
    deletedCalls.length = 0
    modalConfirm = false
    const page = seedPage('content_admin')
    page.deleteCommentAsModerator(1)
    await tick()
    check(() => {
      assert.strictEqual(deletedCalls.length, 0, '取消确认不应调用接口')
      assert.strictEqual(page.data.rawComments.length, 3, '列表不应变化')
    }, '取消删除')
    modalConfirm = true
  }

  // ===== 非管理员即便直接调用也应被拦住 =====
  {
    deletedCalls.length = 0
    const page = seedPage('user', 30)
    page.deleteCommentAsModerator(1)
    await tick()
    check(() => {
      assert.strictEqual(deletedCalls.length, 0, '既非管理员也非本帖作者时不应走通删除路径（前端兜底，服务端仍是最终防线）')
    }, '前端权限兜底')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('comment admin delete tests failed:', err.message)
  process.exit(1)
})
