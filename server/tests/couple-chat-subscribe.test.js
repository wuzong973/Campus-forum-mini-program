/**
 * 一周CP聊天页订阅授权行为测试（无需数据库 / 无需微信运行时）
 *
 * 用 vm 加载真实 pkg-feature/pages/couple/chat.js，桩掉小程序模块：
 *   - 文字发送、打开图片/视频工具、进入语音模式都必须触发 message 授权；
 *   - 用户拒绝时沿用现有「去设置」引导；
 *   - onLoad 必须接收推送落地页带来的 matchId。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..', '..')
const CHAT_JS = path.join(ROOT, 'pkg-feature/pages/couple/chat.js')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

function loadChat(subscribeStub) {
  const holder = {}
  const sandbox = {
    Page: (definition) => { holder.definition = definition },
    wx: {
      hideKeyboard() {},
      showToast() {},
      showLoading() {},
      hideLoading() {},
      nextTick(fn) { fn() }
    },
    getApp: () => ({ globalData: { userInfo: {} } }),
    require: (request) => {
      const norm = String(request).split('\\').join('/')
      if (/utils\/api$/.test(norm)) return { getCoupleCurrent: async () => ({}), getCoupleMatch: async () => ({}) }
      if (/utils\/auth$/.test(norm)) return { requireFeatureAccess: async () => true }
      if (/utils\/messageStore$/.test(norm)) return {
        connect() {}, onMessage() {}, markRead: async () => {},
        getHistory: async () => ({ list: [] }), sendMessage: async () => ({}), recallMessage: async () => ({})
      }
      if (/utils\/wechat$/.test(norm)) return {
        ensurePrivacyAuthorize: async () => true,
        uploadImages: async () => [], uploadVideo: async () => '', uploadAudio: async () => ''
      }
      if (/utils\/image$/.test(norm)) return { splitOverlongVideos: () => ({ valid: [] }) }
      if (/utils\/subscribe$/.test(norm)) return subscribeStub
      if (/utils\/couple$/.test(norm)) return { formatClock: () => '' }
      throw new Error('测试桩未覆盖：' + request)
    },
    console, Promise, Date, setTimeout, clearTimeout
  }
  vm.runInNewContext(fs.readFileSync(CHAT_JS, 'utf8'), sandbox, { filename: 'pkg-feature/pages/couple/chat.js' })
  assert.ok(holder.definition, '未能从 chat.js 取到 Page 定义')
  return holder.definition
}

function makeContext(definition, overrides = {}) {
  const context = {
    data: Object.assign({}, definition.data, {
      activePanel: '',
      voiceMode: false,
      recording: false,
      sending: false,
      imageSending: false,
      videoSending: false,
      inputValue: 'hi',
      readonly: false
    }),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callback()
    },
    sendContent: async () => {},
    requestMessageSubscribe() { this.subscribeCalls = (this.subscribeCalls || 0) + 1 },
    ...overrides
  }
  return context
}

async function run() {
  const calls = []
  const subscribe = {
    requestTriggerByTap(trigger) {
      calls.push(trigger)
      return Promise.resolve({ accepted: ['message'], rejected: [], failed: false })
    },
    guideReopen() { throw new Error('授权成功时不应触发去设置引导') }
  }
  const definition = loadChat(subscribe)

  await definition.requestMessageSubscribe.call({})
  check(() => {
    assert.deepStrictEqual(calls, ['message'], '必须申请 message 模板，不能申请其他模板')
  }, 'S1. 授权入口申请 message 模板')

  subscribe.requestTriggerByTap = () => Promise.resolve({ rejected: ['message'], failed: false })
  let guided = null
  subscribe.guideReopen = (types, label, options) => {
    guided = { types, label, options }
    return Promise.resolve(true)
  }
  await definition.requestMessageSubscribe.call({})
  check(() => {
    assert.strictEqual(guided.types.length, 1, '被拒后应只针对 message 引导')
    assert.strictEqual(guided.types[0], 'message', '被拒后应只针对 message 引导')
    assert.strictEqual(guided.label, '私信通知', '引导文案渠道应复用私信通知')
    assert.strictEqual(guided.options.throttleKey, 'subscribe_reopen_guide_chat', '引导节流键应复用聊天页')
  }, 'S2. 拒绝后引导去设置')

  check(() => {
    const context = makeContext(definition)
    definition.onToggleTools.call(context)
    assert.strictEqual(context.subscribeCalls, 1, '打开图片/视频工具必须申请授权')
    assert.strictEqual(context.data.activePanel, 'tools')
  }, 'S3. 打开媒体面板触发授权')

  check(() => {
    const context = makeContext(definition)
    definition.onToggleVoice.call(context)
    assert.strictEqual(context.subscribeCalls, 1, '进入语音模式必须申请授权')
    assert.strictEqual(context.data.voiceMode, true)
  }, 'S4. 进入语音模式触发授权')

  const sendContext = makeContext(definition)
  await definition.send.call(sendContext)
  check(() => {
    assert.strictEqual(sendContext.subscribeCalls, 1, '发送文字必须申请授权')
    assert.strictEqual(sendContext.data.sending, false, '发送完成后应恢复按钮状态')
  }, 'S5. 发送文字触发授权')

  check(() => {
    let seen = 0
    const context = makeContext(definition, {
      setData(patch) { Object.assign(this.data, patch) },
      load: async () => { seen++ }
    })
    definition.onLoad.call(context, { matchId: '321' })
    assert.strictEqual(context.data.matchId, 321, '推送落地页的 matchId 必须写入页面')
    assert.strictEqual(seen, 1, 'onLoad 必须继续加载配对')
  }, 'S6. 推送落地页 matchId 进入聊天页')

  check(() => {
    const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
    const pages = []
    ;(appJson.subPackages || appJson.subpackages || []).forEach((pack) => {
      (pack.pages || []).forEach((page) => pages.push(pack.root + '/' + page))
    })
    assert.ok(pages.includes('pkg-feature/pages/couple/chat'), '推送落地页必须在 app.json 分包中注册')
  }, 'S7. 推送落地页已注册')

  console.log(testCount + ' tests passed.')
}

run().catch((err) => {
  console.error(err && err.stack)
  process.exit(1)
})
