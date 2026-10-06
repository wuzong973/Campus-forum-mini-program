/**
 * 「点消息 → 定位到那条评论并高亮」回归测试（无需真机/无需数据库）
 *
 * 用户诉求（截图 + 视频）：
 *   在消息页「评论」/「回复」tab 点一条互动通知，应**直接进原帖**并
 *   ① 滚动到那条评论所在的框；② 给它加醒目的颜色高亮。
 *   即"点击那个收到的消息，先定位到点击的那条消息框，然后加颜色显示"。
 *
 * 本文件守住三条容易退化的通路：
 *   1) 前端跳转：my-messages.onOpenNotification 必须直接跳 post-detail 且带上 commentId，
 *      不得再回退到「先跳 message-detail 中间页」的旧两跳路径；
 *   2) 锚点 high-light 分离：post-detail 里 scroll-into-view 用的 commentAnchor 必须常驻，
 *      视觉高亮必须是**独立字段** commentHighlight 且会定时淡出
 *      —— 两者混用会退化成「高亮永不消失」或「滚上去又跳回顶部」；
 *   3) 后端字段：comment / follow / reply / like（点赞评论）四类通知都必须带 source_comment_id，
 *      漏了的话前端拿不到锚点，点进去只能手动翻评论区（＝"定不了位"）。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// =====================================================================
// A. 前端跳转：my-messages.onOpenNotification 直接进详情 + 带 commentId
// =====================================================================
const MM_FILE = path.join(ROOT, 'pages', 'my-messages', 'index.js')
const mmSource = fs.readFileSync(MM_FILE, 'utf8')

const NOTIFICATIONS = [
  {
    id: 11, type: 'comment', title: '你的帖子有新评论', actorNick: '小明', content: '好帖',
    relatedId: 501, sourceCommentId: 9001, isRead: false, createdAt: '2026-10-01 10:00:00'
  },
  {
    id: 12, type: 'reply', title: '有人回复了你的评论', actorNick: '小红', content: '同问',
    relatedId: 501, sourceCommentId: 9002, isRead: false, createdAt: '2026-10-01 11:00:00'
  },
  {
    id: 13, type: 'like', title: '你的评论收到了点赞', actorNick: '小蓝', content: '哈哈',
    relatedId: 501, sourceCommentId: 9003, isRead: true, createdAt: '2026-10-01 12:00:00'
  }
]

const navCalls = []
const toastCalls = []
const wxStub = new Proxy({
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  showToast: (o) => toastCalls.push(o && o.title),
  navigateTo: (o) => { navCalls.push(o.url); if (o.success) o.success() },
  navigateBack: () => undefined,
}, { get: (t, p) => (p in t ? t[p] : () => undefined) })

const apiStub = {
  getFollowedPosts: () => Promise.resolve({ list: [] }),
}
const messageStoreStub = {
  onMessage: () => () => {},
  loadConversations: () => [],
  getConversations: () => Promise.resolve({ list: [] }),
  saveConversations: () => undefined,
  syncUnreadCount: () => Promise.resolve(0),
}
const requestStub = {
  get: () => Promise.resolve({ list: NOTIFICATIONS, hasMore: false, total: NOTIFICATIONS.length }),
  put: () => Promise.resolve({}),
}
const formatStub = { formatRelativeTime: (v) => (v ? '3小时前' : '') }

const appStub = { globalData: { userInfo: { id: 1 } } }
const sandbox = {
  module: { exports: {} },
  exports: {},
  console, setTimeout, clearTimeout, Promise, JSON, Date, Math,
  require: (name) => {
    const s = String(name)
    if (s.indexOf('utils/api') > -1) return apiStub
    if (s.indexOf('utils/messageStore') > -1) return messageStoreStub
    if (s.indexOf('utils/request') > -1) return requestStub
    if (s.indexOf('utils/format') > -1) return formatStub
    if (s.indexOf('utils/auth') > -1) return { guardPage: () => true }
    if (s.indexOf('utils/refresh') > -1) return { runPullDownRefresh: (p, t) => t.forEach((x) => x()) }
    if (s.indexOf('utils/avatar') > -1) return require(path.join(ROOT, 'utils/avatar'))
    if (s.indexOf('utils/liquid-tab') > -1) return { create: () => ({ moveTo() {}, snap() {}, refresh() {}, destroy() {} }) }
    if (s.indexOf('utils/subscribe') > -1) return { entryVisibleAsync: () => Promise.resolve(false), entryVisible: () => false, requestEntryByTap: () => Promise.resolve(), requestTriggerByTap: () => undefined }
    return {}
  },
  getApp: () => appStub,
  getCurrentPages: () => [],
  getTabBar: () => null,
  wx: wxStub,
}
let mmDef = null
sandbox.Page = (d) => { mmDef = d }
vm.createContext(sandbox)

check(() => {
  vm.runInNewContext(mmSource, sandbox, { filename: 'pages/my-messages/index.js' })
  assert.ok(mmDef, '应调用 Page() 注册消息页')
}, '消息页加载')

function makeMMPage() {
  const page = Object.assign({}, mmDef)
  page.data = JSON.parse(JSON.stringify(mmDef.data))
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k] })
    if (typeof cb === 'function') cb()
  }
  return page
}

async function main() {
  const page = makeMMPage()
  page.onLoad({})
  await tick()
  // 手动灌入通知（loadInteractMessages 已被 request 桩满足，但保险起见再 set 一次）
  page.setInteractionMessages(page.data.allMessages.length ? page.data.allMessages : [])

  navCalls.length = 0

  // ---- A1. 评论通知：直接跳 post-detail 且带 commentId ----
  check(() => {
    page.setInteractionMessages([
      {
        id: 11, type: 'comment', postId: 501, sourceCommentId: 9001,
        actorNick: '小明', content: '好帖', time: '3小时前', read: false
      }
    ])
    navCalls.length = 0
    page.onOpenNotification({ currentTarget: { dataset: { id: 11 } } })
    assert.strictEqual(navCalls.length, 1, '点通知应发起一次跳转')
    assert.ok(/^\/pages\/post-detail\/index\?id=501/.test(navCalls[0]),
      '互动通知应直接进原帖详情，实际：' + navCalls[0])
    assert.ok(navCalls[0].indexOf('commentId=9001') > -1,
      '必须带上 commentId 才能定位到那条评论，实际：' + navCalls[0])
    assert.ok(navCalls[0].indexOf('/pages/message-detail/') === -1,
      '不应再经过 message-detail 中间页（多一跳用户还得再点「查看原帖」）')
  }, '评论通知直接定位')

  // ---- A2. 回复通知：同样带 commentId ----
  check(() => {
    page.setInteractionMessages([
      {
        id: 12, type: 'reply', postId: 501, sourceCommentId: 9002,
        actorNick: '小红', content: '同问', time: '3小时前', read: false
      }
    ])
    navCalls.length = 0
    page.onOpenNotification({ currentTarget: { dataset: { id: 12 } } })
    assert.strictEqual(navCalls[0], '/pages/post-detail/index?id=501&commentId=9002',
      '回复通知应直接带 commentId 进详情，实际：' + navCalls[0])
  }, '回复通知直接定位')

  // ---- A3. 缺 sourceCommentId 时退化为只跳帖子（不崩、不编造 id） ----
  check(() => {
    page.setInteractionMessages([
      {
        id: 14, type: 'comment', postId: 502, sourceCommentId: 0,
        actorNick: '小绿', content: 'x', time: '刚刚', read: false
      }
    ])
    navCalls.length = 0
    page.onOpenNotification({ currentTarget: { dataset: { id: 14 } } })
    assert.strictEqual(navCalls[0], '/pages/post-detail/index?id=502',
      '没有来源评论时只跳帖子、不得拼出 commentId=0，实际：' + navCalls[0])
  }, '无来源评论时优雅退化')

  // ---- A4. 无关联帖子的通知（系统类）仍可打开详情快照 ----
  check(() => {
    page.setInteractionMessages([
      {
        id: 15, type: 'system', postId: '', sourceCommentId: 0,
        actorNick: '', content: '系统通知', time: '刚刚', read: false,
        title: '系统通知'
      }
    ])
    navCalls.length = 0
    appStub.__messageDetail = null
    page.onOpenNotification({ currentTarget: { dataset: { id: 15 } } })
    assert.strictEqual(navCalls.length, 1, '系统通知应仍能打开消息详情')
    assert.ok(navCalls[0].indexOf('/pages/message-detail/') === 0,
      '无关联帖子的通知走消息详情，实际：' + navCalls[0])
    assert.ok(appStub.__messageDetail && appStub.__messageDetail.content === '系统通知',
      '经 globalData 交接的通知快照应带上正文')
  }, '系统通知保留详情页')

  // ---- A5. 读状态的写入不受影响（仍发 read 请求） ----
  check(() => {
    page.setInteractionMessages([
      {
        id: 16, type: 'comment', postId: 503, sourceCommentId: 9009,
        actorNick: '小紫', content: 'y', time: '刚刚', read: false
      }
    ])
    page.onOpenNotification({ currentTarget: { dataset: { id: 16 } } })
    const marked = page.data.allMessages.find((m) => Number(m.id) === 16)
    assert.ok(marked && marked.read === true, '点开后该条应即时置为已读')
  }, '点击同时标记已读')

  // =====================================================================
  // B. post-detail：锚点与高亮分离 + 定时淡出
  // =====================================================================
  const PD_FILE = path.join(ROOT, 'pages', 'post-detail', 'index.js')
  const pdSource = fs.readFileSync(PD_FILE, 'utf8')
  const pdWxml = read('pages/post-detail/index.wxml')
  const pdWxss = read('pages/post-detail/index.wxss')

  check(() => {
    // 两个字段都要在 data 里声明，且高亮字段是独立的
    assert.ok(/commentAnchor\s*:/.test(pdSource), 'data 应声明 commentAnchor')
    assert.ok(/commentHighlight\s*:/.test(pdSource), 'data 应声明独立的 commentHighlight（视觉高亮）')
  }, '锚点与高亮字段分离')

  check(() => {
    // scroll-into-view 绑锚点；高亮类名绑 commentHighlight
    assert.ok(/scroll-into-view="\{\{commentAnchor\}\}"/.test(pdWxml),
      'scroll-view 的 scroll-into-view 必须绑 commentAnchor')
    assert.ok(pdWxml.indexOf("commentHighlight === 'comment-' + item.id") > -1,
      '评论卡高亮类名应由 commentHighlight 驱动')
    assert.ok(pdWxml.indexOf("commentHighlight === 'reply-' + reply.id") > -1,
      '回复卡高亮类名应由 commentHighlight 驱动')
    assert.ok(pdWxml.indexOf('commentAnchor ===') === -1,
      '不得再用 commentAnchor 驱动高亮类名（那样高亮会常驻不消失）')
  }, 'WXML 锚点/高亮各司其职')

  check(() => {
    // 高亮必须有定时清除，且能在页面卸载时被清理
    assert.ok(/pulseCommentHighlight\s*\(/.test(pdSource), '应定义 pulseCommentHighlight 开启高亮')
    assert.ok(/_highlightTimer\s*=\s*setTimeout/.test(pdSource), '高亮应用定时器自动淡出')
    assert.ok(/clearTimeout\(this\._highlightTimer\)/.test(pdSource),
      'onUnload/重复触发时应清理高亮定时器')
  }, '高亮自动淡出并可清理')

  check(() => {
    // 定位到目标后必须先滚动、再高亮（顺序与视频一致）
    const fn = pdSource.slice(pdSource.indexOf('applyPendingCommentAnchor'), pdSource.indexOf('pulseCommentHighlight(anchor) {') > -1 ? pdSource.indexOf('pulseCommentHighlight(anchor) {') : pdSource.length)
    assert.ok(fn.indexOf("this.setData({ commentAnchor: anchor })") > -1,
      '定位成功应先设 scroll-into-view 锚点')
    assert.ok(/setTimeout\(\(\)\s*=>\s*this\.pulseCommentHighlight\(anchor\)/.test(fn),
      '应在下一帧再开启高亮（先滚动、后亮色）')
  }, '先滚动后高亮')

  check(() => {
    // 高亮样式必须是显眼的实心底 + 描边（视频里的琥珀色卡片）
    const anchored = pdWxss.slice(pdWxss.indexOf('.comment-item.anchored'), pdWxss.indexOf('.comment-meta'))
    assert.ok(/background:\s*#fef0c7/i.test(anchored), '高亮评论卡应有琥珀实心底 #fef0c7')
    assert.ok(/box-shadow:\s*0 0 0 4rpx/.test(anchored), '高亮评论卡应有 4rpx 描边')
    const replyAnchored = pdWxss.slice(pdWxss.indexOf('.reply-item.anchored'), pdWxss.indexOf('.reply-avatar'))
    assert.ok(/background:\s*#fef0c7/i.test(replyAnchored), '高亮回复卡应有琥珀实心底')
  }, '高亮为琥珀实心底 + 描边')

  // =====================================================================
  // C. 后端：四类互动通知都必须带 source_comment_id
  // =====================================================================
  const commentCtl = read('server/controllers/commentController.js')
  const notificationService = read('server/services/notificationService.js')

  check(() => {
    assert.ok(/sourceCommentId\s*=\s*null/.test(notificationService),
      'createNotification 应支持 sourceCommentId 参数')
    assert.ok(/source_comment_id/.test(notificationService), 'createNotification 应把它写进 system_notification')
  }, '通知服务支持来源评论')

  check(() => {
    // comment / follow / reply 三条在同一个 createComment 里，按行号精确切块
    // （『type: like』出现在前面，不能只靠 indexOf('type: comment') 划界）
    const lines = commentCtl.split('\n')
    const findLine = (needle) => lines.findIndex((l) => l.indexOf(needle) > -1)
    assert.ok(findLine("type: 'comment'") > -1, '应有 type: comment 通知')
    assert.ok(findLine("type: 'follow'") > -1, '应有 type: follow 通知')
    assert.ok(findLine("type: 'reply'") > -1, '应有 type: reply 通知')
    // 三类通知各自块内都必须出现 sourceCommentId（块 = 本行到下一个 type: 行）
    const typeLines = [findLine("type: 'comment'"), findLine("type: 'follow'"), findLine("type: 'reply'")]
      .sort((a, b) => a - b)
    const boundaries = typeLines.concat([lines.length])
    for (let i = 0; i < typeLines.length; i += 1) {
      const block = lines.slice(typeLines[i], boundaries[i + 1]).join('\n')
      assert.ok(/sourceCommentId:\s*result\.insertId/.test(block),
        '第 ' + (typeLines[i] + 1) + ' 行起始的通知分支缺 sourceCommentId（点进去无法定位那条评论）')
    }
  }, '评论三类通知带锚点')

  check(() => {
    // 点赞「评论」的通知也必须带锚点 —— 否则点进去无法定位被点赞的那条评论
    const likeBlock = commentCtl.slice(commentCtl.indexOf("type: 'like'"), commentCtl.indexOf("postTitle: posts.length"))
    assert.ok(/sourceCommentId:\s*commentId/.test(likeBlock),
      '「你的评论收到了点赞」通知必须带 sourceCommentId（缺失＝评论 tab 定不了位）')
  }, '点赞评论通知带锚点')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Notification anchor locate tests failed:', err && err.message)
  process.exit(1)
})
