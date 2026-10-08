/**
 * 「回到帖子」返回逻辑测试（无需数据库）
 * 用 vm 加载真实页面文件 pages/chat/index.js，构造不同页面栈验证目标解析。
 * 覆盖：帖子详情→聊天(delta 1)、帖子详情→个人主页→聊天(delta 2)、未透传 postId 的同路径、
 * 原帖不在页面栈时跳转原帖、列表/消息列表入口、来源帖子缓存补显、无来源时不展示入口。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const CHAT_PAGE = path.join(MINI_PROGRAM_ROOT, 'pages', 'chat', 'index.js')
const source = fs.readFileSync(CHAT_PAGE, 'utf8')

// ===== 桩：小程序运行时 =====
let currentStack = []
let storage = {}
let lastHistoryArgs = null
let lastSendArgs = null
let historyResponse = null

const messageStoreStub = {
  onMessage: () => () => {},
  getHistory: (...args) => {
    lastHistoryArgs = args
    return Promise.resolve(historyResponse || { list: [], hasMore: false, canSend: true })
  },
  saveCache: () => {},
  loadCache: () => [],
  markRead: () => Promise.resolve(),
  appendCache: () => {},
  sendMessage: (...args) => {
    lastSendArgs = args
    return Promise.resolve({})
  },
  recallMessage: () => Promise.resolve(),
  blockPeer: () => Promise.resolve(),
  unblockPeer: () => Promise.resolve()
}

const wxStub = {
  setStorageSync: (key, value) => { storage[key] = value },
  getStorageSync: (key) => storage[key] || '',
  showToast: () => {},
  showModal: () => {},
  navigateBack: () => {},
  navigateTo: () => {},
  previewImage: () => {}
}

let pageDefinition = null
const sandbox = {
  require: (name) => {
    const s = String(name)
    if (s.indexOf('messageStore') > -1) return messageStoreStub
    // 页面依赖的本地工具模块必须返回真实模块（而不是空对象）：聊天页会用
    // avatar.normalizeLegacyAvatar 归一化头像路径，空桩会让它变成 undefined，
    // 用例直接抛「not a function」——那是桩的问题，不是页面缺陷
    if (s.indexOf('utils/avatar') > -1) return require('../../utils/avatar')
    return {}
  },
  Page: (definition) => { pageDefinition = definition },
  getApp: () => ({ globalData: { userInfo: { id: 1, avatarUrl: 'a' }, statusBarHeight: 20, navBarHeight: 44 } }),
  getCurrentPages: () => currentStack,
  wx: wxStub,
  console: { log: () => {}, error: () => {}, warn: () => {} },
  setTimeout,
  clearTimeout,
  decodeURIComponent,
  encodeURIComponent,
  String,
  Number,
  parseInt
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: CHAT_PAGE })

assert.ok(pageDefinition, '未能从 pages/chat/index.js 取到 Page 定义')
assert.ok(typeof pageDefinition.initChat === 'function', 'initChat 缺失')

// 每次用例都基于页面原始 data 生成一个独立实例，避免用例之间互相污染
const baseData = JSON.parse(JSON.stringify(pageDefinition.data))

function runCase({ stack, options, cachePostId }) {
  storage = {}
  lastHistoryArgs = null
  historyResponse = null
  if (cachePostId) storage['pm_src_post_9'] = cachePostId
  currentStack = stack.map((item) => ({ route: item.route, options: item.options || {} }))
  const instance = Object.assign({}, pageDefinition, { data: JSON.parse(JSON.stringify(baseData)) })
  instance.setData = function (patch) { Object.assign(this.data, patch) }
  instance.initChat(Object.assign({ peerId: '9', nick: 'a', avatar: 'b' }, options))
  return {
    delta: instance._backToPostDelta,
    url: instance._backToPostUrl,
    show: instance.data.showBackToPost,
    cache: Object.assign({}, storage),
    historyPostId: lastHistoryArgs ? lastHistoryArgs[7] : undefined
  }
}

// 复现「我的消息」二次进入：入口不带 personaKey，本地缓存按真实分身键存放，
// 需要等历史接口返回真实 personaKey 后按该键读缓存补显入口
async function runReentryCase({ cacheKey, cacheValue, personaKeyFromServer }) {
  storage = {}
  lastHistoryArgs = null
  historyResponse = { list: [], hasMore: false, canSend: true, personaKey: personaKeyFromServer }
  if (cacheKey) storage[cacheKey] = cacheValue
  currentStack = [{ route: 'pages/my-messages/index', options: {} }, { route: 'pages/chat/index' }]
  const instance = Object.assign({}, pageDefinition, { data: JSON.parse(JSON.stringify(baseData)) })
  instance.setData = function (patch) { Object.assign(this.data, patch) }
  instance.initChat({ peerId: '9', nick: 'a', avatar: 'b' })
  const beforeLoad = instance.data.showBackToPost
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { beforeLoad, show: instance.data.showBackToPost, url: instance._backToPostUrl, delta: instance._backToPostDelta }
}

// 通用异步补显用例：可自定义页面栈与服务端下发的来源帖子，
// 用于验证「入口只命中列表页兜底 + 服务端下发真实来源帖子」时目标被纠正
async function runReentryCaseWithStack({ stack, cacheKey, cacheValue, sourcePostIdFromServer }) {
  storage = {}
  lastHistoryArgs = null
  historyResponse = {
    list: [],
    hasMore: false,
    canSend: true,
    personaKey: '',
    sourcePostId: sourcePostIdFromServer || 0
  }
  if (cacheKey) storage[cacheKey] = cacheValue
  currentStack = stack.map((item) => ({ route: item.route, options: item.options || {} }))
  const instance = Object.assign({}, pageDefinition, { data: JSON.parse(JSON.stringify(baseData)) })
  instance.setData = function (patch) { Object.assign(this.data, patch) }
  instance.initChat({ peerId: '9', nick: 'a', avatar: 'b' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { show: instance.data.showBackToPost, url: instance._backToPostUrl, delta: instance._backToPostDelta }
}

// 发送路径：会话若由「首条消息」创建（历史接口失败、离线补发等），
// 发送请求同样必须带上来源帖子，否则来源会永久丢失
async function runSendCase(options) {
  storage = {}
  lastHistoryArgs = null
  lastSendArgs = null
  historyResponse = null
  currentStack = [
    { route: 'pages/post-detail/index', options: { id: '12' } },
    { route: 'pages/chat/index' }
  ]
  const instance = Object.assign({}, pageDefinition, { data: JSON.parse(JSON.stringify(baseData)) })
  instance.setData = function (patch) { Object.assign(this.data, patch) }
  instance.initChat(Object.assign({ peerId: '9', nick: 'a', avatar: 'b' }, options))
  await instance.sendContent('hello')
  return { sendArgs: lastSendArgs, historyPostId: lastHistoryArgs ? lastHistoryArgs[7] : undefined }
}

// 只比较「回到哪一层 / 跳哪个地址 / 是否展示入口」三个关键结果
const core = (result) => ({ delta: result.delta, url: result.url, show: result.show })
const assertCase = (result, expected, message) => assert.deepStrictEqual(core(result), expected, message)

// 1) 帖子详情 → 聊天：携带 postId，精确命中原实例，返回 1 层
let result = runCase({
  stack: [{ route: 'pages/post-detail/index', options: { id: '12' } }, { route: 'pages/chat/index' }],
  options: { postId: '12' }
})
assertCase(result, { delta: 1, url: '', show: true }, '路径1 帖子详情→聊天 应返回原帖')

// 2) 帖子详情 → 个人主页 → 聊天：postId 由个人主页透传，跨 2 层返回原帖
result = runCase({
  stack: [
    { route: 'pages/post-detail/index', options: { id: '12' } },
    { route: 'pages/profile/index', options: { id: '7', postId: '12' } },
    { route: 'pages/chat/index' }
  ],
  options: { postId: '12' }
})
assertCase(result, { delta: 2, url: '', show: true }, '路径2 帖子详情→个人主页→聊天 应跨 2 层返回原帖')

// 3) 同上但个人主页漏传 postId 时，仍应由页面栈优先命中帖子详情页（不能退回个人主页）
result = runCase({
  stack: [
    { route: 'pages/post-detail/index', options: { id: '12' } },
    { route: 'pages/profile/index', options: { id: '7' } },
    { route: 'pages/chat/index' }
  ],
  options: {}
})
assertCase(result, { delta: 2, url: '', show: true }, '个人主页不应抢占「回到帖子」目标')

// 4) 携带 postId 但原帖详情页已不在页面栈：跳转该帖子，而不是退回中间页
result = runCase({
  stack: [
    { route: 'pages/post-detail/index', options: { id: '99' } },
    { route: 'pages/profile/index', options: { id: '7' } },
    { route: 'pages/chat/index' }
  ],
  options: { postId: '12' }
})
assertCase(result, { delta: 0, url: '/pages/post-detail/index?id=12', show: true }, '原帖不在栈时应跳转原帖')

// 5) 列表卡片入口（无 postId）：退回列表页
result = runCase({
  stack: [{ route: 'pages/index/index', options: {} }, { route: 'pages/chat/index' }],
  options: {}
})
assertCase(result, { delta: 1, url: '', show: true }, '列表入口应退回列表页')

// 6) 消息通知入口 + 本地缓存来源帖子：跳转缓存的帖子
result = runCase({
  stack: [{ route: 'pages/my-messages/index', options: {} }, { route: 'pages/chat/index' }],
  options: {},
  cachePostId: 12
})
assertCase(result, { delta: 0, url: '/pages/post-detail/index?id=12', show: true }, '缓存来源帖子应兜底')

// 7) 无任何帖子上下文：不展示入口
result = runCase({ stack: [{ route: 'pages/chat/index' }], options: {} })
assertCase(result, { delta: 0, url: '', show: false }, '无来源时不应展示入口')

// 8) 无帖子详情页时按「最近」原则命中：个人主页比列表页更近，则回到个人主页
result = runCase({
  stack: [
    { route: 'pages/index/index', options: {} },
    { route: 'pages/profile/index', options: { id: '7' } },
    { route: 'pages/chat/index' }
  ],
  options: {}
})
assertCase(result, { delta: 1, url: '', show: true }, '无帖子详情页时应命中最近的帖子相关页')

// 8.1) 首页私信入口 → 私信列表 → 聊天：入口不带 postId，页面栈中只有首页（tabBar 常驻），
//      但本地缓存已记录来源帖子 → 必须回到原帖子详情页，而不是退回首页
result = runCase({
  stack: [
    { route: 'pages/index/index', options: {} },
    { route: 'pages/my-messages/index', options: { tab: '0' } },
    { route: 'pages/chat/index' }
  ],
  options: {},
  cachePostId: 12
})
assertCase(
  result,
  { delta: 0, url: '/pages/post-detail/index?id=12', show: true },
  '首页私信入口→聊天：有缓存的来源帖子时应回到原帖，而不是首页'
)

// 8.2) 同上但服务端下发更精确来源帖子（本地缓存缺失，如换设备）：异步补显后也应跳原帖
;(async () => {
  const homeEntry = await runReentryCaseWithStack({
    stack: [
      { route: 'pages/index/index', options: {} },
      { route: 'pages/my-messages/index', options: { tab: '0' } },
      { route: 'pages/chat/index' }
    ],
    cacheKey: '',
    cacheValue: 0,
    sourcePostIdFromServer: 12
  })
  assert.strictEqual(homeEntry.show, true, '首页私信入口应从服务端拿到来源帖子并补显入口')
  assert.strictEqual(
    homeEntry.url,
    '/pages/post-detail/index?id=12',
    '服务端来源帖子应覆盖「退回首页」的兜底目标'
  )
})()

// 9) 携带 postId 但页面栈中连帖子详情页都没有（如个人主页进入）：跳转原帖
result = runCase({
  stack: [{ route: 'pages/profile/index', options: { id: '7', postId: '12' } }, { route: 'pages/chat/index' }],
  options: { postId: '12' }
})
assertCase(result, { delta: 0, url: '/pages/post-detail/index?id=12', show: true }, '栈内无原帖时应跳转原帖')

// 10) 匿名会话（入口带 personaKey + anonymous）：与普通私信一致，返回原帖
result = runCase({
  stack: [{ route: 'pages/post-detail/index', options: { id: '12' } }, { route: 'pages/chat/index' }],
  options: { postId: '12', anonymous: '1', personaKey: '/assets/avatar1/2.png' }
})
assertCase(result, { delta: 1, url: '', show: true }, '匿名会话也应返回原帖')

// 11) 从帖子详情进入时必须写入本地缓存并上报服务端：
//     之后从「我的消息」（入口无帖子页、且可能不带 personaKey）进入时才能补显入口
result = runCase({
  stack: [{ route: 'pages/post-detail/index', options: { id: '12' } }, { route: 'pages/chat/index' }],
  options: { postId: '12', anonymous: '1', personaKey: '/assets/avatar1/2.png' }
})
assert.strictEqual(result.cache['pm_src_post_9_p__assets_avatar1_2_png'], 12, '应按 personaKey 写入来源帖子缓存')
assert.strictEqual(result.historyPostId, 12, '拉历史时应上报来源帖子，供服务端记录会话来源')

// 12) 入口漏传 postId、但页面栈中有帖子详情页：同样要缓存并上报（兜住旧入口）
result = runCase({
  stack: [{ route: 'pages/post-detail/index', options: { id: '12' } }, { route: 'pages/chat/index' }],
  options: {}
})
assert.strictEqual(result.cache['pm_src_post_9'], 12, '栈内解析出的来源帖子也应写入缓存')
assert.strictEqual(result.historyPostId, 12, '栈内解析出的来源帖子也应上报服务端')

// ===== 静态断言：入口两侧的参数透传 =====
const postDetailSource = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'post-detail', 'index.js'), 'utf8')
const profileSource = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'profile', 'index.js'), 'utf8')
const messageStoreSource = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'messageStore.js'), 'utf8')
// 头像卡片已抽成共享组件 components/avatar-sheet（评价详情页与帖子详情页共用同一份实现），
// 「帖子详情 → 个人主页 → 私信 → 回到帖子」的 postId 透传链路随之移入组件。
// 因此这里改为：断言组件内部透传 + 断言帖子详情页把 postId 交给组件。
const avatarSheetSource = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'components', 'avatar-sheet', 'index.js'), 'utf8')
assert.match(
  avatarSheetSource,
  /profileUrl\(userId, fromPostId\) \{\s*return '\/pages\/profile\/index\?id=' \+ userId \+ \(fromPostId \? '&postId=' \+ fromPostId : ''\)/,
  '头像卡片的主页跳转必须透传来源帖子'
)
assert.match(
  avatarSheetSource,
  /const postSuffix = '&postId=' \+ \(sheet\.fromPostId \|\| ''\)/,
  '头像卡片的私信跳转必须透传来源帖子'
)
assert.doesNotMatch(postDetailSource, /navigateTo\(\{ url: "\/pages\/profile\/index/, '帖子详情页仍存在未透传 postId 的主页跳转')
assert.strictEqual(
  (postDetailSource.match(/fromPostId: \(this\.data\.post \|\| \{\}\)\.id \|\| 0/g) || []).length,
  1,
  '评论头像应把来源帖子 id 交给头像卡片'
)
assert.strictEqual(
  (postDetailSource.match(/fromPostId: post\.id \|\| 0/g) || []).length,
  1,
  '帖主头像应把来源帖子 id 交给头像卡片'
)
assert.match(profileSource, /this\.sourcePostId = parseInt\(options\.postId, 10\) \|\| 0/)
assert.match(profileSource, /this\.sourcePostId \? '&postId=' \+ this\.sourcePostId : ''/)
// 聊天页顶部入口：只在解析出目标时渲染
assert.match(source, /showBackToPost: backToPost\.delta > 0 \|\| !!backToPost\.url/)
// 历史接口要能上报来源帖子（否则服务端 source_post_id 永远是空，消息列表入口无法补显）
assert.match(messageStoreSource, /if \(Number\(sourcePostId\) > 0\) query\.postId = Math\.floor\(Number\(sourcePostId\)\)/)
// 发送接口同样要能上报来源帖子：会话由「首条消息」创建时（历史接口失败/离线补发）来源才不会丢
assert.match(messageStoreSource, /if \(Number\(sourcePostId\) > 0\) body\.postId = Math\.floor\(Number\(sourcePostId\)\)/)
assert.match(
  source,
  /messageStore\.sendMessage\(this\.data\.peerId, content, msgType, this\.data\.anonymousMode, persona, this\.personaKey, this\._sourcePostId \|\| 0\)/,
  '聊天页发送消息时应携带来源帖子'
)
// 服务端：发送路径把 postId 一路透传到 getOrCreateConversation（只在会话来源为空时写入）
const messageControllerSource = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'server', 'controllers', 'messageController.js'), 'utf8')
assert.match(messageControllerSource, /parseInt\(req\.body\.postId, 10\) \|\| 0/, '发送接口应解析 body.postId')
assert.match(
  messageControllerSource,
  /getOrCreateConversation\(senderId, receiverId, anonymousRequested, identity, 'self', persona, sourcePostId\)/,
  '发送路径应把来源帖子透传给会话创建'
)

// 13) 「我的消息」二次进入（异步）：入口不带 personaKey，历史接口返回真实分身键后按该键读缓存补显入口
;(async () => {
  const reentry = await runReentryCase({
    cacheKey: 'pm_src_post_9_p__assets_avatar1_2_png',
    cacheValue: 12,
    personaKeyFromServer: '/assets/avatar1/2.png'
  })
  assert.strictEqual(reentry.beforeLoad, false, '入口缺省 personaKey 时首屏应尚未拿到来源帖子')
  assert.strictEqual(reentry.show, true, '拿到服务端 personaKey 后应补显「回到帖子」入口')
  assert.strictEqual(reentry.url, '/pages/post-detail/index?id=12', '补显后应跳转来源帖子')

  // 14) 真实分身键下缓存也没有来源帖子：仍不展示入口（无来源就是无来源）
  const noSource = await runReentryCase({ cacheKey: '', cacheValue: 0, personaKeyFromServer: '/assets/avatar1/2.png' })
  assert.strictEqual(noSource.show, false, '无来源帖子时不应展示入口')

  // 15) 发送消息同样要带上来源帖子：会话若由首条消息创建（历史接口失败/离线补发），来源才不会丢
  const sent = await runSendCase({ postId: '12' })
  assert.strictEqual(sent.sendArgs[6], 12, '发送消息时应携带来源帖子')
  assert.strictEqual(sent.historyPostId, 12, '发送前拉历史同样应上报来源帖子')

  console.log('Chat back-to-post tests passed.')
})().catch((err) => {
  console.error('Chat back-to-post tests failed:', err.message)
  process.exit(1)
})
