/**
 * 首页浮动按钮「私信未读角标」位置回归测试（静态断言，无需真机）
 *
 * 背景（2026-09-11 修复）：.float-badge 是 position:absolute，但 .float-btn 未设
 * position:relative，角标以 .float-actions 容器（fixed）为定位基准，跑到容器右上角，
 * 视觉上压在第一个按钮「每日热榜」图标右上角。修复：.float-btn 加 position:relative。
 *
 * 本测试锁住两件事：
 *   1) WXML 里 float-badge 只出现在「消息通知」按钮内，不出现在每日热榜按钮内
 *   2) WXSS 里 .float-btn 必须声明 position:relative（角标定位基准）
 *
 * 定位方式：按 bindtap 处理器切片段，而不是按 aria-label 文案。
 * 文案会随需求改（本按钮曾叫「私信」后改「消息通知」），按文案断言会长期假红，
 * 而处理器名是按钮的身份，相对稳定。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

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

const wxml = fs.readFileSync(path.join(ROOT, 'pages', 'index', 'index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(ROOT, 'pages', 'index', 'index.wxss'), 'utf8')

// 按 bindtap 处理器切出该浮动按钮的片段
function floatBtnSegment(handler) {
  const marker = 'bindtap="' + handler + '"'
  const at = wxml.indexOf(marker)
  assert.ok(at > -1, 'WXML 应存在 bindtap="' + handler + '" 的浮动按钮')
  const start = wxml.lastIndexOf('<view', at)
  const end = wxml.indexOf('</view>', at)
  return wxml.slice(start, end > -1 ? end + '</view>'.length : wxml.length)
}

// 1) 角标在「消息通知」按钮内（点击进入消息中心的那颗）
check(() => {
  const segment = floatBtnSegment('goMessages')
  assert.ok(
    segment.indexOf('float-badge') > -1,
    'float-badge 应绑定在「消息通知」浮动按钮（bindtap="goMessages"）内',
  )
}, '角标绑定在消息通知按钮内')

// 2) 每日热榜按钮上没有角标
check(() => {
  assert.strictEqual(
    floatBtnSegment('onTodayHotTap').indexOf('float-badge'),
    -1,
    '「每日热榜」浮动按钮不应包含 float-badge',
  )
}, '热榜按钮无角标')

// 3) .float-btn 声明了 position:relative（否则 absolute 角标会以 .float-actions 容器定位）
check(() => {
  const m = wxss.match(/\.float-btn\s*\{[^}]*\}/)
  assert.ok(m, 'WXSS 应存在 .float-btn 规则')
  assert.ok(
    /position\s*:\s*relative/.test(m[0]),
    '.float-btn 必须声明 position:relative 作为角标定位基准',
  )
}, '.float-btn 为相对定位基准')

// 4) 角标样式保持原设计：绝对定位 + 原偏移与配色
check(() => {
  const m = wxss.match(/\.float-badge\s*\{[^}]*\}/)
  assert.ok(m, 'WXSS 应存在 .float-badge 规则')
  const rule = m[0]
  assert.ok(/position\s*:\s*absolute/.test(rule), '角标仍应为 absolute 定位')
  assert.ok(/top\s*:\s*-6rpx/.test(rule) && /right\s*:\s*-12rpx/.test(rule), '角标偏移应保持原设计（top:-6rpx / right:-12rpx）')
  assert.ok(/#ff5a5f/.test(rule), '角标配色应保持原设计（#ff5a5f）')
}, '角标样式与偏移保持原设计')

console.log(testCount + ' tests passed.')
