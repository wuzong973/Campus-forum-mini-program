/**
 * 消息页「蹲贴」标签页与蹲贴评论通知的页面回归测试（无需真机/无需数据库）
 *
 * 用 vm 加载真实页面文件 pages/my-messages/index.js，注入假 wx / api / request / format，
 * 覆盖：
 *   1) tab 结构：「蹲贴」位于「点赞」右侧，「回复」位于「蹲贴」右侧，「系统」最后，角标数组同步为 6 位；
 *   2) 通知归类：type='follow'（你蹲的帖子有新评论）归入「评论」tab；type='reply'
 *      （用户回复用户）归入独立「回复」tab，并计入其未读角标；
 *   3) 蹲贴列表：切到蹲贴 tab 拉取「我蹲的 / 蹲我的」两组帖子，
 *      卡片带标题、作者、蹲贴人数、发布时间，点击进入帖子详情；
 *   4) 「消息通知」入口索引：user 页跳转的 tab 仍指向「系统」而非新插入的「蹲贴」。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_FILE = path.join(MINI_PROGRAM_ROOT, 'pages', 'my-messages', 'index.js')
const source = fs.readFileSync(PAGE_FILE, 'utf8')

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

// ===== 桩：通知与蹲贴数据 =====
const NOTIFICATIONS = [
  { id: 1, type: 'comment', title: '你的帖子有新评论', actorNick: '小明', relatedId: 101, isRead: false, createdAt: '2026-09-11 20:00:00' },
  // 快照头像是历史脏路径：改名前存在的内置素材名，直出会让 <image> 图裂并刷渲染层错误
  { id: 2, type: 'follow', title: '你蹲的帖子有新评论', actorNick: '小红', actorAvatar: '/assets/avatar1/考拉 (2).jpg', relatedId: 102, isRead: false, createdAt: '2026-09-11 20:05:00' },
  { id: 3, type: 'like', title: '你的帖子收到了点赞', actorNick: '小刚', relatedId: 103, isRead: false, createdAt: '2026-09-11 20:10:00' },
  { id: 4, type: 'reply', title: '你的评论收到了回复', actorNick: '小丽', relatedId: 104, isRead: false, createdAt: '2026-09-11 20:15:00' },
  { id: 5, type: 'system', title: '系统消息', content: '维护通知', isRead: false, createdAt: '2026-09-11 20:20:00' },
]

const MINE_POST = {
  id: 201,
  // 需求变更：卡片不再展示标题，改为展示作者 + 正文。title 仍由接口下发，但不应进入卡片
  title: '求推荐图书馆自习位',
  content: '图书馆四楼靠窗的位置最抢手，早上八点前到基本都有空位，去晚了就只能坐大厅。',
  nickName: '楼主A',
  // 作者头像同样是历史脏路径，卡片渲染前必须归一化（否则图裂 + 渲染层报错）
  avatarUrl: '/assets/avatar1/考拉 (2).jpg',
  followCount: 4,
  isFollowed: true,
  createdAt: '2026-09-11 18:00:00',
  squatUsers: [],
}
const THEIRS_POST = {
  id: 202,
  title: '我的帖子被蹲了',
  content: '求组队参加比赛，还差一个队友。',
  nickName: '我自己',
  avatarUrl: '/assets/avatar2/avatar_02.jpg',
  followCount: 3,
  isFollowed: false,
  createdAt: '2026-09-11 17:00:00',
  squatUsers: [{ userId: 9, nickName: '小红' }, { userId: 8, nickName: '小刚' }],
}

const apiCalls = []
const apiStub = {
  getFollowedPosts: (type) => {
    apiCalls.push(type)
    return Promise.resolve({ list: type === 'mine' ? [MINE_POST] : [THEIRS_POST] })
  },
}
const requestStub = {
  get: (url) => {
    if (String(url).indexOf('/notification') === 0) return Promise.resolve({ list: NOTIFICATIONS })
    return Promise.resolve({ list: [] })
  },
  put: () => Promise.resolve({}),
  post: () => Promise.resolve({}),
  del: () => Promise.resolve({}),
}
const messageStoreStub = {
  onMessage: () => () => undefined,
  loadConversations: () => [],
  getConversations: () => Promise.resolve({ list: [] }),
  saveConversations: () => undefined,
  syncUnreadCount: () => Promise.resolve(0),
  getUnreadTotal: () => 0,
}
const formatStub = { formatRelativeTime: (v) => (v ? '3小时前' : '') }
const authStub = { guardPage: () => true }
const refreshStub = { runPullDownRefresh: (page, tasks) => tasks.forEach((t) => t()) }

// ===== 桩：wx =====
const navCalls = []
const wxStub = new Proxy({
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  showToast: () => undefined,
  navigateTo: (opts) => navCalls.push(opts.url),
  navigateBack: () => undefined,
}, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) })

// ===== 沙箱 =====
let pageDefinition = null
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Date,
  Math,
  require: (name) => {
    const s = String(name)
    if (s.indexOf('utils/api') > -1) return apiStub
    if (s.indexOf('utils/messageStore') > -1) return messageStoreStub
    if (s.indexOf('utils/request') > -1) return requestStub
    if (s.indexOf('utils/format') > -1) return formatStub
    if (s.indexOf('utils/auth') > -1) return authStub
    if (s.indexOf('utils/refresh') > -1) return refreshStub
    if (s.indexOf('utils/avatar') > -1) return require('../../utils/avatar')
    // 液态指示条驱动器打桩：真实模块在 vm 沙箱外加载，拿不到沙箱里的 wx 全局；
    // 本测试只关心蹲贴 tab 逻辑，指示条行为由 liquid-tab-shared.test.js 源码断言覆盖
    if (s.indexOf('utils/liquid-tab') > -1) {
      return { create: () => ({ moveTo() {}, snap() {}, refresh() {}, destroy() {} }) }
    }
    return {}
  },
  getApp: () => ({ globalData: { userInfo: { id: 1 } } }),
  getCurrentPages: () => [],
  getTabBar: () => null,
  wx: wxStub,
}
sandbox.Page = (definition) => { pageDefinition = definition }
vm.createContext(sandbox)

check(() => {
  vm.runInNewContext(source, sandbox, { filename: 'pages/my-messages/index.js' })
  assert.ok(pageDefinition, '应调用 Page() 注册页面')
}, '页面加载')

function createPage() {
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  // setData 需支持数据路径（'conversations[0].peerAvatar'）：页面局部更新用路径语法，
  // 桩只按整键赋值会把路径当成新键，断言就永远看不到效果
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') === -1 && k.indexOf('[') === -1) {
        this.data[k] = patch[k]
        return
      }
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

async function main() {
  const page = createPage()
  page.onLoad({})
  await tick()

  // ===== 1) tab 结构 =====
  check(() => {
    assert.deepStrictEqual(page.data.tabs, ['私信', '评论', '点赞', '蹲贴', '回复', '系统'], '蹲贴在点赞右侧，回复在蹲贴右侧，系统最后')
    assert.strictEqual(page.data.tabUnread.length, 6, '未读角标数组应同步为 6 位')
  }, 'tab 结构')

  // ===== 2) 通知归类与角标 =====
  check(() => {
    assert.strictEqual(page.data.allMessages.length, 5, '应加载全部通知')
    const follow = page.data.allMessages.find((m) => m.type === 'follow')
    assert.ok(follow, '应保留 follow 类型通知')
    assert.strictEqual(follow.title, '小红 评论了你蹲的帖子', 'follow 通知标题应区分「你蹲的帖子」')
    assert.strictEqual(follow.postId, 102, 'follow 通知必须带帖子 id，否则点击无反应（本次修复）')
    assert.strictEqual(follow.actorAvatar, '/assets/avatar1/考拉2.jpg',
      '通知快照里的旧素材名「考拉 (2).jpg」必须先纠正为「考拉2.jpg」再上屏')
  }, 'follow 通知渲染')

  check(() => {
    // 评论 tab 应同时收纳 comment 与 follow
    page.onTab({ currentTarget: { dataset: { tab: 1 } } })
    const ids = page.data.messages.map((m) => m.id)
    assert.deepStrictEqual(ids.sort(), [1, 2], '评论 tab 应包含 comment 与 follow 两类通知')
    // 点赞 tab 不受影响
    page.onTab({ currentTarget: { dataset: { tab: 2 } } })
    assert.deepStrictEqual(page.data.messages.map((m) => m.id), [3], '点赞 tab 仍只显示点赞通知')
    // 回复 tab 收纳 type='reply'
    page.onTab({ currentTarget: { dataset: { tab: 4 } } })
    assert.deepStrictEqual(page.data.messages.map((m) => m.id), [4], '回复 tab 应只显示 reply 通知')
    // 系统 tab 用新索引 5
    page.onTab({ currentTarget: { dataset: { tab: 5 } } })
    assert.deepStrictEqual(page.data.messages.map((m) => m.id), [5], '系统 tab 索引应后移到 5')
  }, 'tab 过滤')

  check(() => {
    // vm 沙箱内的数组来自另一个 realm，deepStrictEqual 会因原型不同而失败，先 JSON 降级
    const unread = JSON.parse(JSON.stringify(page.data.tabUnread))
    assert.deepStrictEqual(unread, [0, 2, 1, 0, 1, 1], '评论角标应含 follow 未读，回复角标单独统计，蹲贴角标不掺通知')
  }, '未读角标')

  // ===== 3) 蹲贴列表 =====
  navCalls.length = 0
  apiCalls.length = 0
  page.onTab({ currentTarget: { dataset: { tab: 3 } } })
  await tick()
  check(() => {
    assert.deepStrictEqual(apiCalls.slice().sort(), ['mine', 'theirs'], '进入蹲贴 tab 应同时拉取两组数据')
    assert.strictEqual(page.data.squatList.length, 1, '默认展示「我蹲的」')
    const card = page.data.squatList[0]
    assert.strictEqual(card.id, MINE_POST.id)
    assert.strictEqual(card.author, '楼主A', '卡片应有作者昵称')
    assert.strictEqual(card.content, MINE_POST.content, '卡片应展示帖子正文')
    assert.strictEqual(card.title, undefined, '卡片不应再下发标题（需求：不显示标题）')
    assert.strictEqual(card.followCount, 4, '卡片应有蹲贴用户数')
    assert.strictEqual(card.timeText, '3小时前', '卡片应有发布时间')
    assert.strictEqual(card.avatarUrl, '/assets/avatar1/考拉2.jpg',
      '蹲贴卡片头像同样要过归一化，旧素材名不得直接进 <image>')
  }, '蹲贴列表（我蹲的）')

  check(() => {
    page.onSquatTab({ currentTarget: { dataset: { index: 1 } } })
    const card = page.data.squatList[0]
    assert.strictEqual(card.id, THEIRS_POST.id, '切到「蹲我的」应展示自己的帖子')
    assert.strictEqual(card.content, THEIRS_POST.content, '「蹲我的」卡片同样展示正文')
    assert.deepStrictEqual(card.squatUsers, ['小红', '小刚'], '应展示蹲贴者昵称')
    page.onSquatTab({ currentTarget: { dataset: { index: 0 } } })
    assert.strictEqual(page.data.squatList[0].id, MINE_POST.id, '切回「我蹲的」应恢复原列表')
  }, '蹲贴子分组')

  // 正文兜底：不显示标题后，正文为空/含换行的帖子必须仍有可读内容，
  // 否则卡片只剩作者一行，看起来像「帖子是空的」
  check(() => {
    const list = page.formatSquatPosts([
      { id: 901, nickName: '甲', content: '', images: ['https://x/a.jpg'], createdAt: '2026-09-11 10:00:00', followCount: 0 },
      { id: 902, nickName: '乙', content: '', images: [], createdAt: '2026-09-11 10:00:00', followCount: 0 },
      { id: 903, nickName: '丙', content: '第一行\n\n第二行', images: [], createdAt: '2026-09-11 10:00:00', followCount: 0 },
    ])
    assert.strictEqual(list[0].content, '[图片]', '纯图帖（正文为空）应显示媒体占位')
    assert.strictEqual(list[1].content, '暂无内容', '空帖应有兜底文案')
    assert.strictEqual(list[2].content, '第一行 第二行', '换行应折成空格，避免两行截断切出大片空白')
    assert.strictEqual(list[2].title, undefined, '兜底路径同样不得下发标题')
  }, '正文兜底')

  check(() => {
    page.onOpenSquatPost({ currentTarget: { dataset: { id: 201 } } })
    assert.deepStrictEqual(navCalls, ['/pages/post-detail/index?id=201'], '点击帖子应进入详情页')
  }, '点击进详情')

  // ===== 4) 「消息通知」入口索引 =====
  check(() => {
    const userSource = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'user', 'index.js'), 'utf8')
    assert.match(userSource, /my-messages\/index\?tab=5/, '「消息通知」入口应指向系统 tab（索引 5）')
    assert.doesNotMatch(userSource, /my-messages\/index\?tab=3/, '不应再有入口指向被「蹲贴」占用的索引 3')
  }, '消息通知入口')

  // ===== 5) 会话头像兜底 =====
  check(() => {
    const avatarMod = require(path.join(MINI_PROGRAM_ROOT, 'utils', 'avatar.js'))
    const p = createPage()
    p.setData({
      conversations: [
        { id: 'a_normal', peerId: 200, peerNick: '匿名者', peerAvatar: '/assets/avatar1/态态 (2).jpg' },
        { id: 'b_normal', peerId: 201, peerNick: '普通人', peerAvatar: 'https://payun01.cn/uploads/missing.jpg' },
      ],
    })
    p.onConvAvatarError({ currentTarget: { dataset: { index: 0 } } })
    assert.notStrictEqual(p.data.conversations[0].peerAvatar, '/assets/avatar1/态态 (2).jpg', '损坏路径应被替换')
    assert.ok(avatarMod.isAnonymousAvatar(p.data.conversations[0].peerAvatar),
      '匿名会话头像应换成素材池内的形象，实际：' + p.data.conversations[0].peerAvatar)
    p.onConvAvatarError({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(p.data.conversations[1].peerAvatar, '/assets/icons/avatar.png', '普通头像失败应换默认头像')
  }, '会话头像兜底')

  // ===== 6) 通知 / 蹲贴卡片头像加载失败兜底 =====
  const avatarMod = require(path.join(MINI_PROGRAM_ROOT, 'utils', 'avatar.js'))
  check(() => {
    const p = createPage()
    p.setData({
      messages: [
        { id: 9, type: 'follow', actorNick: '匿名者', actorAvatar: '/assets/avatar1/态态 (2).jpg' },
        { id: 10, type: 'comment', actorNick: '普通人', actorAvatar: 'https://payun01.cn/uploads/missing.jpg' },
      ],
    })
    p.onMsgAvatarError({ currentTarget: { dataset: { index: 0 } } })
    assert.ok(avatarMod.isAnonymousAvatar(p.data.messages[0].actorAvatar),
      '匿名通知头像加载失败应换成素材池内的形象，实际：' + p.data.messages[0].actorAvatar)
    p.onMsgAvatarError({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(p.data.messages[1].actorAvatar, '/assets/icons/avatar.png', '普通头像失败应换默认头像')
  }, '通知头像兜底')

  check(() => {
    const p = createPage()
    p.setData({
      squatList: [
        { id: 1, author: '匿名者', avatarUrl: '/assets/avatar1/态态 (2).jpg' },
        { id: 2, author: '普通人', avatarUrl: '/assets/icons/avatar.png' },
      ],
    })
    p.onSquatAvatarError({ currentTarget: { dataset: { index: 0 } } })
    assert.ok(avatarMod.isAnonymousAvatar(p.data.squatList[0].avatarUrl),
      '蹲贴卡片匿名头像失败应换成素材池内的形象，实际：' + p.data.squatList[0].avatarUrl)
    // 已经是默认头像时不应反复改写（否则会陷入 改→仍失败→再改 的死循环）
    p.onSquatAvatarError({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(p.data.squatList[1].avatarUrl, '/assets/icons/avatar.png')
  }, '蹲贴头像兜底')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('message squat tab tests failed:', err.message)
  process.exit(1)
})
