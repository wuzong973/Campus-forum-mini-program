/**
 * 「点击对方头像进入其个人主页」回归测试（无需真机/无需数据库）
 *
 * 用 vm 加载真实页面文件 pages/chat/index.js 与 pages/message-detail/index.js。
 *
 * 需求：私信聊天页里对方非匿名时，点其头像进入对方个人主页。
 * 现实缺口：聊天页头像此前根本没有点击事件（wxml 里 <image class="avatar"> 无 bindtap），
 * 消息详情页原帖 404 时「查看原帖」仍可点（点进去再白屏一次）。
 *
 * 2026-10-06 变更：消息详情页「点用户进个人主页」入口按用户要求移除（详情页只留「查看原帖」），
 * 由 B5 的源码护栏守住，防止后续改动又把它接回来。聊天页的头像进主页入口不受影响。
 *
 * 覆盖：
 *   A. 聊天页
 *     1) 非匿名 → canOpenPeerProfile 为真，点对方头像跳 profile?id=<peerId>（并透传来源帖子）
 *     2) 点自己的头像不跳
 *     3) 匿名会话不跳，并明确提示原因（不是静默无反应）
 *     4) 会话未标记匿名、但对方头像是匿名素材（历史脏数据）→ 同样不跳
 *     5) 连点只跳一次（防重复压栈导致整页白屏）
 *     6) navigateTo 失败 → 有 toast 反馈
 *     7) 服务端下发的对方身份优先：入口参数说非匿名、服务端说匿名 → 以服务端为准
 *     8) 头像加载失败 → 换成可用头像（匿名形象换池内稳定形象，其余换默认头像），不会循环抖动
 *   B. 消息详情页
 *     1) 原帖 404 → 标记为不可用并给出「已删除」文案
 *     2) 原帖不可用时点「查看原帖」不再跳转（否则又是一次 404 白屏）
 *     3) 头像加载失败 → 兜底
 *     4) 不存在「进用户主页」的入口，唯一跳转是「查看原帖」
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..', '..')
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

const toastCalls = []
const navCalls = []
let navShouldFail = false
const wxStub = new Proxy({
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined,
  showToast: (opts) => toastCalls.push(opts && opts.title),
  navigateTo: (opts) => {
    navCalls.push(opts.url)
    if (navShouldFail && typeof opts.fail === 'function') opts.fail({ errMsg: 'navigateTo:fail webview count limit exceed' })
  },
  navigateBack: () => undefined,
  switchTab: () => undefined,
  setClipboardData: () => undefined,
  previewImage: () => undefined,
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => undefined }) }) }),
}, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) })

// ===== 聊天页沙箱 =====
function loadPage(file, sandbox) {
  let definition = null
  sandbox.Page = (d) => { definition = d }
  vm.createContext(sandbox)
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file })
  return definition
}

function instantiate(definition) {
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  // setData 必须支持数据路径（'messages[0].avatar'）：页面用路径做局部更新是常规写法，
  // 桩若只按整键赋值，会把路径当成新键写入 —— 页面逻辑看似通过、实际断言永远看不到效果
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') === -1 && k.indexOf('[') === -1) {
        this.data[k] = patch[k]
        return
      }
      assignPath(this.data, k, patch[k])
    })
    if (typeof cb === 'function') cb()
  }
  return page
}

function assignPath(root, pathStr, value) {
  const parts = String(pathStr).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let node = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]
    if (node[key] === undefined || node[key] === null) {
      node[key] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    }
    node = node[key]
  }
  node[parts[parts.length - 1]] = value
}

const historyCalls = []
let historyResult = null
const chatSandboxBase = {
  module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, setImmediate,
  Promise, JSON, Date, Math, Number, String, Array, Object, parseInt, parseFloat, isNaN,
  require: (name) => {
    const s = String(name)
    if (s.indexOf('utils/messageStore') > -1) return {
      onMessage: () => () => undefined,
      getHistory: (peerId, page) => { historyCalls.push({ peerId, page }); return Promise.resolve(historyResult || {}) },
      saveCache: () => undefined,
      loadCache: () => [],
      markRead: () => Promise.resolve(),
      appendCache: () => undefined,
    }
    if (s.indexOf('utils/wechat') > -1) return {}
    if (s.indexOf('utils/request') > -1) return { get: () => Promise.resolve({}), post: () => Promise.resolve({}), put: () => Promise.resolve({}), del: () => Promise.resolve({}) }
    if (s.indexOf('utils/image') > -1) return {}
    if (s.indexOf('utils/qr') > -1) return { recognize: () => undefined }
    if (s.indexOf('utils/auth') > -1) return { guardPage: () => true, isLoggedIn: () => true, requireLogin: () => true }
    if (s.indexOf('utils/refresh') > -1) return { runPullDownRefresh: () => undefined }
    if (s.indexOf('utils/avatar') > -1) return require(path.join(ROOT, 'utils', 'avatar.js'))
    return {}
  },
  getApp: () => ({ globalData: { userInfo: { id: 1, nickName: '我', avatarUrl: '/assets/avatar2/avatar_01.jpg' } } }),
  getCurrentPages: () => [],
  getTabBar: () => null,
  wx: wxStub,
}

const chatDefinition = loadPage(path.join(ROOT, 'pages', 'chat', 'index.js'), Object.assign({}, chatSandboxBase))

async function newChatPage(options) {
  const page = instantiate(chatDefinition)
  // 滚动到底依赖节点查询，测试里无关紧要
  page.scrollToBottom = () => undefined
  page.initChat(options)
  await tick()
  return page
}

const MESSAGE = {
  id: 11, senderId: 7, msgType: 'text', content: '你好',
  senderNick: '对方', senderAvatar: '/assets/avatar2/avatar_03.jpg', createdAt: '2026-09-11 20:00:00',
}

async function main() {
  // ===== A1 非匿名：可点且跳转正确 =====
  {
    historyResult = { list: [MESSAGE], peerNormal: { nickName: '对方', avatarUrl: '/assets/avatar2/avatar_03.jpg' }, hasMore: false }
    navCalls.length = 0
    toastCalls.length = 0
    const page = await newChatPage({ peerId: '7', nick: encodeURIComponent('对方'), avatar: encodeURIComponent('/assets/avatar2/avatar_03.jpg'), anonymous: '0', postId: '34' })
    check(() => {
      assert.strictEqual(page.data.canOpenPeerProfile, true, '非匿名会话应允许点对方头像进主页')
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.strictEqual(navCalls.length, 1, '点击对方头像应发起一次跳转，实际：' + JSON.stringify(navCalls))
      assert.strictEqual(navCalls[0], '/pages/profile/index?id=7&postId=34',
        '应跳转到目标用户个人主页并透传来源帖子（保证主页再进私信后「回到帖子」仍可用）')
    }, '非匿名可点')
  }

  // ===== A2 点自己的头像不跳 =====
  {
    navCalls.length = 0
    const page = await newChatPage({ peerId: '7', anonymous: '0' })
    check(() => {
      page.onTapAvatar({ currentTarget: { dataset: { self: true, index: 0 } } })
      assert.strictEqual(navCalls.length, 0, '点自己的头像不应跳转')
    }, '自己的头像')
  }

  // ===== A3 匿名会话不跳且有提示 =====
  {
    navCalls.length = 0
    toastCalls.length = 0
    historyResult = { list: [MESSAGE], peerAnonymous: { nickName: '匿名用户', avatarUrl: '/assets/avatar1/熊猫.jpg' }, hasMore: false }
    const page = await newChatPage({ peerId: '7', nick: encodeURIComponent('匿名用户'), avatar: encodeURIComponent('/assets/avatar1/熊猫.jpg'), anonymous: '1' })
    check(() => {
      assert.strictEqual(page.data.canOpenPeerProfile, false, '匿名会话不应给出主页入口')
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.strictEqual(navCalls.length, 0, '匿名会话点对方头像不应跳转 —— 那会把匿名者直接指认出来')
      assert.ok(toastCalls.some((t) => t && t.indexOf('分身') > -1), '应明确提示原因，实际: ' + JSON.stringify(toastCalls))
    }, '匿名会话')
  }

  // ===== A3b 匿名会话但对方头像是普通头像（只有 anonymousMode 这条分支能拦住）=====
  {
    navCalls.length = 0
    toastCalls.length = 0
    historyResult = { list: [MESSAGE], hasMore: false }
    const page = await newChatPage({
      peerId: '7', nick: encodeURIComponent('对方'),
      avatar: encodeURIComponent('https://payun01.cn/uploads/real.jpg'), anonymous: '1',
    })
    check(() => {
      assert.strictEqual(page.data.canOpenPeerProfile, false,
        '匿名会话即使对方用的是普通头像也不能给主页入口 —— 否则匿名者被直接指认出来')
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.strictEqual(navCalls.length, 0, '不应跳转')
      assert.ok(toastCalls.some((t) => t && t.indexOf('分身') > -1), '应提示原因')
    }, '匿名会话（普通头像）')
  }

  // ===== A4 未标记匿名但头像是匿名素材（脏数据边界）=====
  {
    navCalls.length = 0
    historyResult = { list: [MESSAGE], hasMore: false }
    const page = await newChatPage({
      peerId: '7', nick: encodeURIComponent('可疑匿名'),
      avatar: encodeURIComponent('/assets/avatar1/考拉 (2).jpg'), anonymous: '0',
    })
    check(() => {
      assert.strictEqual(page.data.canOpenPeerProfile, false,
        '对方头像是匿名素材时必须拦截：只看 anonymous 标记会漏掉这类脏数据组合')
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.strictEqual(navCalls.length, 0, '不应跳转')
    }, '匿名素材边界')
  }

  // ===== A5 连点只跳一次 =====
  {
    navCalls.length = 0
    historyResult = { list: [MESSAGE], peerNormal: { nickName: '对方', avatarUrl: '/assets/avatar2/avatar_03.jpg' }, hasMore: false }
    const page = await newChatPage({ peerId: '7', anonymous: '0' })
    check(() => {
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.strictEqual(navCalls.length, 1, '连点应只跳一次，否则会重复压栈直到整页白屏')
    }, '防连点')
  }

  // ===== A6 跳转失败有反馈 =====
  {
    navCalls.length = 0
    toastCalls.length = 0
    navShouldFail = true
    const page = await newChatPage({ peerId: '7', anonymous: '0' })
    check(() => {
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.ok(toastCalls.some((t) => t && t.indexOf('失败') > -1), '跳转失败应有 toast，实际: ' + JSON.stringify(toastCalls))
      // 失败后锁应释放，用户可以重试
      page.onTapAvatar({ currentTarget: { dataset: { self: false, index: 0 } } })
      assert.strictEqual(navCalls.length, 2, '失败后应允许重试（锁必须释放）')
    }, '跳转失败反馈')
    navShouldFail = false
  }

  // ===== A7 服务端身份优先 =====
  {
    historyResult = {
      list: [], hasMore: false,
      peerAnonymous: { nickName: '匿名用户', avatarUrl: '/assets/avatar1/熊猫.jpg' },
    }
    const page = await newChatPage({
      peerId: '7', nick: encodeURIComponent('对方'),
      avatar: encodeURIComponent('/assets/avatar2/avatar_03.jpg'), anonymous: '0',
    })
    check(() => {
      assert.strictEqual(page.data.canOpenPeerProfile, false,
        '入口参数说非匿名、服务端下发匿名身份时应以服务端为准')
    }, '服务端身份优先')
  }

  // ===== A8 头像加载失败兜底 =====
  {
    const page = await newChatPage({ peerId: '7', anonymous: '0' })
    page.setData({
      messages: [
        { id: 1, isSelf: false, nickname: '匿名者', avatar: '/assets/avatar1/态态 (2).jpg' },
        { id: 2, isSelf: false, nickname: '普通人', avatar: 'https://payun01.cn/uploads/missing.jpg' },
      ],
    })
    check(() => {
      page.onAvatarError({ currentTarget: { dataset: { index: 0 } } })
      const fixed = page.data.messages[0].avatar
      const avatar = require(path.join(ROOT, 'utils', 'avatar.js'))
      assert.notStrictEqual(fixed, '/assets/avatar1/态态 (2).jpg', '损坏的匿名头像路径应被替换')
      assert.ok(avatar.isAnonymousAvatar(fixed), '匿名形象应换成素材池内的形象（保留匿名语义），实际：' + fixed)

      page.onAvatarError({ currentTarget: { dataset: { index: 1 } } })
      assert.strictEqual(page.data.messages[1].avatar, '/assets/icons/avatar.png', '非匿名头像失败应换默认头像')

      // 已修好的头像再次触发错误不应继续抖动
      const before = page.data.messages[0].avatar
      page.onAvatarError({ currentTarget: { dataset: { index: 0 } } })
      assert.strictEqual(page.data.messages[0].avatar, before, '兜底后不应再变化')
    }, '头像兜底')
  }

  // ===== B 消息详情页 =====
  let detailPostFails = false
  let detailStatus = 404
  // onLoad 通过 getApp() 取消息列表交接的数据，这里用可变变量喂给沙箱
  let currentDetailPayload = null
  const detailSandbox = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, Promise, JSON, Date, Math,
    require: (name) => {
      const s = String(name)
      if (s.indexOf('utils/api') > -1) return {
        getPostDetail: () => {
          if (detailPostFails) {
            const err = new Error('帖子不存在')
            err.statusCode = detailStatus
            return Promise.reject(err)
          }
          return Promise.resolve({ id: 34, title: '原帖', content: '内容', createdAt: '2026-09-11 20:00:00', commentCount: 1, likeCount: 2 })
        },
      }
      if (s.indexOf('utils/request') > -1) return { get: () => Promise.resolve({}) }
      if (s.indexOf('utils/format') > -1) return { formatRelativeTime: () => '3小时前' }
      if (s.indexOf('utils/qr') > -1) return { recognize: () => undefined }
      if (s.indexOf('utils/avatar') > -1) return require(path.join(ROOT, 'utils', 'avatar.js'))
      return {}
    },
    getApp: () => ({ __messageDetail: currentDetailPayload, globalData: {} }),
    getCurrentPages: () => [],
    wx: wxStub,
  }
  const detailDefinition = loadPage(path.join(ROOT, 'pages', 'message-detail', 'index.js'), detailSandbox)

  // ===== B1 原帖 404 → 明确不可用 + 不再跳转 =====
  {
    detailPostFails = true
    detailStatus = 404
    navCalls.length = 0
    toastCalls.length = 0
    const page = instantiate(detailDefinition)
    page.onLoad({ id: '34' })
    await tick()
    check(() => {
      assert.strictEqual(page.data.postMissing, true, '原帖 404 后应标记为不可用')
      assert.ok(String(page.data.postMissingText).indexOf('删除') > -1,
        '应明确告知「已被删除或下架」，而不是含糊的加载失败，实际：' + page.data.postMissingText)
      page.viewOriginalPost()
      assert.strictEqual(navCalls.length, 0, '已知原帖不存在时不应再跳转（否则又是一次 404 白屏）')
      assert.ok(toastCalls.some((t) => t && t.indexOf('删除') > -1), '应说明原因，实际: ' + JSON.stringify(toastCalls))
    }, '原帖404兜底')
  }

  // ===== B2 网络失败（非 404）→ 可重试文案 =====
  {
    detailPostFails = true
    detailStatus = 0
    const page = instantiate(detailDefinition)
    page.onLoad({ id: '34' })
    await tick()
    check(() => {
      assert.strictEqual(page.data.postMissing, true)
      assert.ok(String(page.data.postMissingText).indexOf('稍后重试') > -1,
        '非 404 的失败应提示稍后重试，实际：' + page.data.postMissingText)
    }, '网络失败兜底')
  }

  // ===== B3 原帖正常时可跳转 =====
  {
    detailPostFails = false
    navCalls.length = 0
    const page = instantiate(detailDefinition)
    page.onLoad({ id: '34' })
    await tick()
    check(() => {
      assert.strictEqual(page.data.postMissing, false, '加载成功时不应标记为不可用')
      page.viewOriginalPost()
      assert.strictEqual(navCalls.length, 1, '正常情况应能进入原帖')
      assert.strictEqual(navCalls[0], '/pages/post-detail/index?id=34')
    }, '正常跳转')
  }

  // ===== B4 头像兜底 =====
  {
    currentDetailPayload = {
      nick: '匿名者', avatar: '/assets/avatar1/态态 (2).jpg',
      content: '内容', title: '匿名者 评论了你的帖子',
    }
    const page = instantiate(detailDefinition)
    page.onLoad({ id: '34' })
    await tick()
    check(() => {
      const avatarMod = require(path.join(ROOT, 'utils', 'avatar.js'))
      page.onAvatarError()
      assert.ok(avatarMod.isAnonymousAvatar(page.data.actorAvatar),
        '损坏的匿名头像应换成素材池形象，实际：' + page.data.actorAvatar)
    }, '详情页头像兜底')
  }

  // ===== B5 详情页不得再有「进用户主页」入口（2026-10-06 用户要求只留「查看原帖」）=====
  {
    const detailJs = fs.readFileSync(path.join(ROOT, 'pages', 'message-detail', 'index.js'), 'utf8')
    const detailWxml = fs.readFileSync(path.join(ROOT, 'pages', 'message-detail', 'index.wxml'), 'utf8')
    check(() => {
      assert.ok(detailJs.indexOf('/pages/profile/') === -1, '详情页 js 不得再跳用户主页')
      assert.ok(typeof detailDefinition.onActorProfile === 'undefined', 'onActorProfile 处理器应已删除')
      assert.ok(detailWxml.indexOf('onActorProfile') === -1 && detailWxml.indexOf('/pages/profile/') === -1,
        '详情页 wxml 不得残留主页入口（bindtap/箭头/可点样式）')
      assert.ok(detailWxml.indexOf('viewOriginalPost') > -1, '「查看原帖」入口必须保留')
    }, '主页入口已移除')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('chat avatar profile tests failed:', err.message)
  process.exit(1)
})
