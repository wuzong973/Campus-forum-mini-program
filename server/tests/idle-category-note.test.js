/**
 * 「二手闲置帖子不显示在「最新」页面」提醒文案测试（无需真机/无需数据库）
 *
 * 需求（2026-09-15）：在「二手闲置」下面加一句提醒，让用户知道该分类的帖子不会进「最新」列表。
 * 落点两处（用户确认「两处都加」）：
 *   1. 发布页「主题分类」弹层 —— 分类宫格下方、确认按钮之前（作者选分类时就能看到）；
 *   2. 首页分类栏下方 —— 仅当切到「二手闲置」分类时显示（浏览时解释「为什么最新里没有」）。
 *
 * 覆盖：
 *   A. 发布页：提醒行在位且顺序正确（宫格之后、确认按钮之前）
 *   B. 首页：提醒行在位，且带「仅二手闲置分类显示」的条件
 *   C. 两处文案逐字一致（同一件事不能有两种说法）
 *   D. 两个 WXSS 都定义了 .category-note
 *   E. 服务端行为与文案对齐：「最新」列表确实排除二手闲置（否则这句提醒就是假的）
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const NOTE_TEXT = '二手闲置帖子不显示在「最新」页面'

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

const publishWxml = read('pages/post-publish/index.wxml')
const indexWxml = read('pages/index/index.wxml')

// ===== A. 发布页 =====
check(() => {
  assert.ok(publishWxml.indexOf(NOTE_TEXT) > -1, '发布页「主题分类」弹层必须含提醒文案')
  const gridAt = publishWxml.indexOf('class="category-grid"')
  const noteAt = publishWxml.indexOf(NOTE_TEXT)
  // 按钮弹性按压接入后 class 会带 spring-btn，匹配放宽到类名本身（意图不变）
  const confirmAt = publishWxml.indexOf('sheet-confirm', gridAt)
  assert.ok(gridAt > -1 && confirmAt > -1, '分类宫格与确认按钮必须存在')
  assert.ok(gridAt < noteAt, '提醒必须位于分类宫格**之后**')
  assert.ok(noteAt < confirmAt, '提醒必须位于确认按钮**之前**（否则会掉到按钮下方）')
}, 'A1. 发布页：提醒行在分类宫格之后、确认按钮之前')

check(() => {
  assert.ok(
    /<view class="category-note"><text class="notice-mark">!<\/text>二手闲置帖子不显示在「最新」页面<\/view>/.test(publishWxml),
    '发布页提醒行必须复用页内既有的 notice-mark 提示样式（与「禁止发布重复信息…」同一套视觉）'
  )
}, 'A2. 发布页：提醒行复用既有 notice-mark 提示样式')

// ===== B. 首页 =====
check(() => {
  const scrollEnd = indexWxml.indexOf('</scroll-view>', indexWxml.indexOf('class="category-scroll"'))
  const noteAt = indexWxml.indexOf('class="category-note"')
  assert.ok(scrollEnd > -1, '首页分类栏 scroll-view 必须存在')
  assert.ok(noteAt > scrollEnd, '首页提醒必须在分类栏**下方**')
}, 'B1. 首页：提醒行位于分类栏下方')

check(() => {
  assert.ok(
    /<view class="category-note" wx:if="\{\{categories\[activeCategory\] === '二手闲置'\}\}">二手闲置帖子不显示在「最新」页面<\/view>/.test(indexWxml),
    '首页提醒必须带「仅切到二手闲置分类时显示」的条件，否则会在所有分类下常驻'
  )
  const indexJs = read('pages/index/index.js')
  assert.ok(/categories:\s*\[[^\]]*'二手闲置'/.test(indexJs), '首页 categories 必须含「二手闲置」，否则条件永远不成立')
}, 'B2. 首页：提醒仅在「二手闲置」分类下显示，且该分类确实存在')

// ===== C. 文案一致性 =====
check(() => {
  const count = (s) => s.split(NOTE_TEXT).length - 1
  assert.strictEqual(count(publishWxml), 1, '发布页文案应恰好出现 1 次')
  assert.strictEqual(count(indexWxml), 1, '首页文案应恰好出现 1 次')
}, 'C. 两处文案逐字一致，且各出现一次')

// ===== D. 样式 =====
check(() => {
  const publishWxss = read('pages/post-publish/index.wxss')
  const indexWxss = read('pages/index/index.wxss')
  assert.ok(/\.category-note\s*\{/.test(publishWxss), '发布页 WXSS 必须定义 .category-note')
  assert.ok(/\.category-note\s*\{/.test(indexWxss), '首页 WXSS 必须定义 .category-note')
}, 'D. 两个 WXSS 都定义了 .category-note 样式')

// ===== E. 服务端行为与文案对齐 =====
check(() => {
  const ctrl = read('server/controllers/postController.js')
  assert.ok(
    /const LATEST_EXCLUDED_CATEGORY = '二手闲置'/.test(ctrl),
    '「最新」排除的分类必须是二手闲置 —— 否则这句提醒与实际行为不符'
  )
  assert.ok(
    /无分类（「最新」）时排除二手闲置/.test(ctrl) && /p\.category NOT IN/.test(ctrl),
    '「最新」查询必须真的排除二手闲置分类'
  )
  // 反向校验：具体分类查询不得把二手闲置也排除掉（否则该分类页会是空的）
  assert.ok(
    /categoryFilter/.test(ctrl) && /p\.category IN \(/.test(ctrl),
    '指定分类查询必须走 IN，保证二手闲置分类页能正常出帖'
  )
}, 'E. 服务端行为对齐：「最新」排除二手闲置，但二手闲置分类页正常出帖')

console.log(testCount + ' tests passed.')
process.exit(0)
