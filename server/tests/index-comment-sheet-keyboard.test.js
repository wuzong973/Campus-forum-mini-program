/**
 * 首页评论面板「点评论图标却自动弹出键盘」回归测试（无需真机/无需数据库）
 *
 * 现象（2026-09-15 用户报告）：
 *   在首页帖子列表点帖子右下角的评论图标查看评论时，评论面板一打开键盘就自动弹出，
 *   挡住评论列表 —— 用户只想「看评论」，并不想「写评论」。
 *
 * 根因：
 *   `pages/index/index.js` 的 `onPostComment()` 打开面板时设置 `commentSheetFocus: true`，
 *   而 `pages/index/index.wxml` 的评论输入框绑定了 `focus="{{commentSheetFocus}}"`；
 *   输入框随面板渲染即获得焦点 → 微信立刻拉起键盘。
 *
 * 顺带修复的隐患：
 *   面板是 `position: fixed; bottom: 0`，输入框又是 `adjust-position="{{false}}"`（页面不自动上推），
 *   而首页此前**没有任何键盘高度处理** —— 即使不自动聚焦，用户手点输入框时键盘也会盖住输入区。
 *   因此同时补上 `bindkeyboardheightchange` → 面板按键盘高度上移。
 *
 * 覆盖：
 *   A. 打开面板不得抢焦点（行为断言）
 *   B. 键盘高度跟踪与关闭时归零（行为断言）
 *   C. WXML 接线：focus 绑定 + 键盘高度绑定 + 面板 bottom 偏移
 *   D. 源码护栏：onPostComment 内不得再出现 commentSheetFocus: true
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const PAGE_DIR = path.join(MINI_PROGRAM_ROOT, 'pages', 'index')

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

setTimeout(() => {
  fs.writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function read(rel) { return fs.readFileSync(path.join(MINI_PROGRAM_ROOT, rel), 'utf8') }

// ===== 桩：小程序运行时（与 tests/index-nav-scroll.test.js 同一套）=====
const thenable = { then: () => thenable, catch: () => thenable, finally: () => thenable }
const stubModule = new Proxy({}, { get: () => () => thenable })
const campusServicesStub = {
  SERVICES: [
    { id: 'school-bus', name: '校车时刻' },
    { id: 'campus-guide', name: '轻友指南' },
    { id: 'campus-card', name: '校园卡' },
    { id: 'print', name: '速印' },
    { id: 'home-bus', name: '返乡大巴' },
    { id: 'express', name: '特惠寄件' }
  ]
}

let pageConfig = null
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  require: (name) => (String(name).indexOf('campus-services') >= 0 ? campusServicesStub : stubModule),
  getApp: () => ({ globalData: {} }),
  getCurrentPages: () => [],
  wx: new Proxy({}, { get: () => () => undefined }),
  Page: (config) => { pageConfig = config }
}
vm.createContext(sandbox)
vm.runInNewContext(read('pages/index/index.js'), sandbox, { filename: 'pages/index/index.js' })
assert.ok(pageConfig, 'pages/index/index.js 应调用 Page() 注册页面')

function createPage() {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((key) => { this.data[key] = patch[key] })
    if (typeof cb === 'function') cb()
  }
  return page
}

const POST = { id: 42, commentCount: 9, content: '帖子内容' }

// ===== A. 打开面板不得抢焦点 =====
check(() => {
  const page = createPage()
  page.onPostComment({ detail: { post: POST } })
  assert.strictEqual(page.data.commentSheetVisible, true, '面板应打开')
  assert.strictEqual(page.data.commentSheetFocus, false, '打开面板不得抢焦点（否则键盘会自动弹出挡住评论）')
  assert.strictEqual(page.data.commentSheetKeyboardHeight, 0, '刚打开时不应有键盘偏移')
}, 'A1. 点评论图标打开面板：不聚焦、无键盘偏移')

check(() => {
  const page = createPage()
  page.onPostComment({ detail: { post: POST } })
  assert.strictEqual(page.data.commentSheetPost.id, 42, '面板应带上目标帖子')
  // 注意：setData 里的 [] 是在 vm 沙箱 realm 里创建的，跨 realm 用 deepStrictEqual 会因原型不同失败
  assert.strictEqual(page.data.commentSheetComments.length, 0, '每次打开应清空旧评论')
  assert.strictEqual(page.data.commentSheetText, '', '每次打开应清空输入')
}, 'A2. 打开面板仍保留原有初始化行为（清空评论与输入）')

check(() => {
  const page = createPage()
  page.onPostComment({ detail: { post: null } })
  assert.strictEqual(page.data.commentSheetVisible, false, '无 post 时不应打开面板')
}, 'A3. 无 post 时不打开面板')

// ===== B. 键盘高度跟踪 =====
check(() => {
  const page = createPage()
  page.onPostComment({ detail: { post: POST } })
  page.onSheetKeyboardChange({ detail: { height: 320 } })
  assert.strictEqual(page.data.commentSheetKeyboardHeight, 320, '键盘弹出时面板应按键盘高度上移')
  page.onSheetKeyboardChange({ detail: { height: 0 } })
  assert.strictEqual(page.data.commentSheetKeyboardHeight, 0, '键盘收起时偏移归零')
}, 'B1. 键盘高度跟踪：弹出写入、收起归零')

check(() => {
  const page = createPage()
  page.onSheetKeyboardChange({})
  assert.strictEqual(page.data.commentSheetKeyboardHeight, 0, '缺少 detail 时应容错为 0，不得抛错')
  page.onSheetKeyboardChange(undefined)
  assert.strictEqual(page.data.commentSheetKeyboardHeight, 0, '事件对象缺失时同样容错')
}, 'B2. 键盘高度事件容错（detail 缺失不抛错）')

check(() => {
  const page = createPage()
  page.onPostComment({ detail: { post: POST } })
  page.onSheetKeyboardChange({ detail: { height: 320 } })
  page.closeCommentSheet()
  assert.strictEqual(page.data.commentSheetVisible, false, '面板应关闭')
  assert.strictEqual(page.data.commentSheetFocus, false, '关闭时应复位焦点标记')
  assert.strictEqual(page.data.commentSheetKeyboardHeight, 0, '关闭时应复位键盘偏移，避免下次打开带着旧偏移')
}, 'B3. 关闭面板复位焦点与键盘偏移')

// ===== C. WXML 接线 =====
check(() => {
  const wxml = read('pages/index/index.wxml')
  assert.ok(
    /<input[\s\S]{0,400}?focus="\{\{commentSheetFocus\}\}"/.test(wxml),
    '评论输入框必须绑定 focus="{{commentSheetFocus}}"（页面据此控制是否抢焦点）'
  )
  assert.ok(
    /<input[\s\S]{0,500}?bindkeyboardheightchange="onSheetKeyboardChange"/.test(wxml),
    '评论输入框必须绑定 bindkeyboardheightchange，否则键盘会盖住输入区'
  )
  assert.ok(
    /class="comment-sheet"[\s\S]{0,200}?style="bottom: \{\{commentSheetKeyboardHeight\}\}px;"/.test(wxml),
    '评论面板必须按键盘高度上移（面板是 fixed + bottom:0）'
  )
}, 'C. WXML 接线：focus 绑定 + 键盘高度绑定 + 面板 bottom 偏移')

// ===== D. 源码护栏 =====
check(() => {
  const js = read('pages/index/index.js')
  const openAt = js.indexOf('onPostComment(')
  assert.ok(openAt > -1, 'onPostComment 必须存在')
  const openBody = js.slice(openAt, openAt + 700)
  assert.ok(
    !/commentSheetFocus:\s*true/.test(openBody),
    'onPostComment 内不得再把 commentSheetFocus 设为 true —— 那会导致打开面板即弹键盘（本次回归的根因）'
  )
  assert.ok(/commentSheetFocus:\s*false/.test(openBody), 'onPostComment 必须显式把焦点标记置为 false')
  assert.ok(js.indexOf('onSheetKeyboardChange') > -1, '必须提供键盘高度处理函数')
}, 'D. 源码护栏：onPostComment 不再抢焦点，且键盘处理函数在位')

console.log(testCount + ' tests passed.')
process.exit(0)
