/**
 * 订阅消息「授权弹窗触发点」接线护栏（无需数据库 / 无需网络）
 *
 * 背景：授权弹窗的机制早就有了（utils/subscribe.js 的 TRIGGER_GROUPS / requestTriggerByTap），
 * 但只有少数几个业务点接了线。本次按需求把触发点**复制式新增**到更多入口，
 * 且**原有的触发方式一个都不能动**。
 *
 * 本测试用源码断言把「哪个入口 → 哪个触发组」的对应关系锁死，
 * 因为这类改动最容易在后续重构里被静默删掉，而症状是「用户收不到通知」——
 * 没有任何报错，只有后台的 skipped/failed 记录。
 *
 * 覆盖（按需求逐条）：
 *   A. 评论通知 postPublish —— 提交评论 / 点帖子 / 点评论区
 *   B. 代拿跑腿 errandPublish —— 发布需求 / 右下角发布·消息 / 我接的单·我发布的·已完成的
 *   C. 提现结果 withdraw —— 钱包 / 订单
 *   D. 私信通知 message —— 消息通知 / 消息页六个 tab / 首页消息图标
 *   E. 审核结果 riderVerify —— 骑手认证 / 每一处联系客服
 *   F. 活动审核 activityPublish —— 发起活动
 *   G. 活动结果 activitySignup —— 我的参与 / 活动卡片 / 全部活动
 *   H. 原有触发方式未被破坏（发帖成功、发布跑腿成功、提现提交、聊天发送、骑手提交、
 *      发布活动成功、活动报名成功、活动页「报名中」）
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

// 统一成单引号，让断言与文件里用双引号还是单引号无关
function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/"/g, "'")
}

// 取某个方法声明之后的一段窗口，用于断言「该方法里调用了某某」。
// 刻意不用花括号配平（模板字符串里的 {} 会打断扫描），只取方法开头的一段，
// 因为所有新增调用都写在方法体最前面。
function methodWindow(src, name, size) {
  // 允许 `async ` 前缀（onSendComment / onSheetSendComment 都是 async 方法）
  const m = new RegExp('(^|\\n)\\s*(?:async\\s+)?' + name + '\\s*\\(', 'm').exec(src)
  if (!m) return ''
  return src.slice(m.index, m.index + (size || 700))
}

function assertCalls(src, methodName, expected, fileLabel) {
  const body = methodWindow(src, methodName)
  assert.ok(body, fileLabel + '：找不到方法 ' + methodName)
  assert.ok(
    body.indexOf(expected) > -1,
    fileLabel + '：' + methodName + ' 里必须调用 ' + expected
  )
}

function assertRequiresSubscribe(src, fileLabel) {
  assert.ok(
    /require\('\.\.\/\.\.\/utils\/subscribe'\)/.test(src) || /require\('\.\.\/\.\.\/\.\.\/utils\/subscribe'\)/.test(src),
    fileLabel + '：必须 require utils/subscribe'
  )
}

function run() {
  // ===== A. 评论通知（postPublish）=====
  const postCard = read('components/post-card/post-card.js')
  check(() => {
    assertRequiresSubscribe(postCard, 'components/post-card')
    assertCalls(postCard, 'onTap', "requestTriggerByTap('postPublish')", 'post-card')
    assertCalls(postCard, 'onComment', "requestTriggerByTap('postPublish')", 'post-card')
  }, 'A1. 点帖子卡片 / 点评论区 → postPublish（评论通知）')

  const postDetail = read('pages/post-detail/index.js')
  check(() => {
    assertRequiresSubscribe(postDetail, 'pages/post-detail')
    assertCalls(postDetail, 'onSendComment', "requestTriggerByTap('postPublish')", 'post-detail')
  }, 'A2. 帖子详情页提交评论 → postPublish（评论通知）')

  const homeIndex = read('pages/index/index.js')
  check(() => {
    assertRequiresSubscribe(homeIndex, 'pages/index')
    assertCalls(homeIndex, 'onSheetSendComment', "requestTriggerByTap('postPublish')", 'pages/index')
  }, 'A3. 首页评论面板提交评论 → postPublish（评论通知）')

  // ===== B. 代拿/跑腿（errandPublish）=====
  const errand = read('pages/errand/index.js')
  check(() => {
    assertRequiresSubscribe(errand, 'pages/errand')
    assertCalls(errand, 'goPublish', "requestTriggerByTap('errandPublish')", 'pages/errand')
    assertCalls(errand, 'goMessages', "requestTriggerByTap('errandPublish')", 'pages/errand')
    assertCalls(errand, 'onListTab', "requestTriggerByTap('errandPublish')", 'pages/errand')
    // 「全部订单」(0) 是浏览大厅，不应触发
    assert.ok(
      /if \(index > 0 &&/.test(methodWindow(errand, 'onListTab')),
      'pages/errand：onListTab 只应对 index > 0（我接的单/我发布的/已完成的）触发，全部订单不触发'
    )
  }, 'B. 发布需求 / 右下角发布·消息 / 我接的单·我发布的·已完成的 → errandPublish（代拿/跑腿通知）')

  // ===== C. 提现结果（withdraw）=====
  const user = read('pages/user/index.js')
  const userWxml = read('pages/user/index.wxml')
  check(() => {
    assertRequiresSubscribe(user, 'pages/user')
    const walletLine = user.split('\n').find((l) => /name: '钱包'/.test(l)) || ''
    const orderLine = user.split('\n').find((l) => /name: '订单'/.test(l)) || ''
    assert.ok(/subscribe: 'withdraw'/.test(walletLine), 'pages/user：钱包入口必须标注 subscribe: withdraw')
    assert.ok(/subscribe: 'withdraw'/.test(orderLine), 'pages/user：订单入口必须标注 subscribe: withdraw')
    assert.ok(
      /this\.requestEntrySubscribe\(e\)/.test(methodWindow(user, 'onShortcutTap')),
      'pages/user：onShortcutTap 必须调用 requestEntrySubscribe'
    )
    assert.ok(
      /requestTriggerByTap\(trigger\)/.test(user),
      'pages/user：requestEntrySubscribe 必须把 subscribe 字段转成 requestTriggerByTap'
    )
    assert.ok(
      userWxml.indexOf("data-subscribe='{{item.subscribe}}'") > -1,
      'pages/user.wxml：入口必须把 subscribe 字段透传到 dataset'
    )
  }, 'C. 钱包 / 订单 → withdraw（提现结果通知）')

  // ===== D. 私信通知（message）=====
  check(() => {
    const noticeLine = user.split('\n').find((l) => /name: '消息通知'/.test(l)) || ''
    assert.ok(/subscribe: 'message'/.test(noticeLine), 'pages/user：消息通知入口必须标注 subscribe: message')
    assert.ok(
      /this\.requestEntrySubscribe\(e\)/.test(methodWindow(user, 'onFeatureTap')),
      'pages/user：onFeatureTap 必须调用 requestEntrySubscribe'
    )
  }, 'D1. 我的页「消息通知」→ message（私信通知）')

  const myMessages = read('pages/my-messages/index.js')
  check(() => {
    assertCalls(myMessages, 'onTab', "requestTriggerByTap('message')", 'pages/my-messages')
    // 六个 tab（私信/评论/点赞/蹲贴/回复/系统）共用 onTab，确认 tabs 定义没被改动
    assert.ok(
      /tabs: \['私信', '评论', '点赞', '蹲贴', '回复', '系统'\]/.test(myMessages),
      'pages/my-messages：六个 tab 必须仍然齐全'
    )
  }, 'D2. 消息页六个 tab（私信/评论/点赞/蹲贴/回复/系统）→ message（私信通知）')

  check(() => {
    assertCalls(homeIndex, 'goMessages', "requestTriggerByTap('message')", 'pages/index')
  }, 'D3. 首页消息图标 → message（私信通知）')

  // ===== E. 审核结果（riderVerify）=====
  check(() => {
    const riderLine = user.split('\n').find((l) => /name: '骑手认证'/.test(l)) || ''
    assert.ok(/subscribe: 'riderVerify'/.test(riderLine), 'pages/user：骑手认证入口必须标注 subscribe: riderVerify')
  }, 'E1. 我的页「骑手认证」→ riderVerify（审核结果通知）')

  const contactAdmin = read('components/contact-admin/contact-admin.js')
  check(() => {
    assertRequiresSubscribe(contactAdmin, 'components/contact-admin')
    assertCalls(contactAdmin, 'openMenu', "requestTriggerByTap('riderVerify')", 'contact-admin')
  }, 'E2. 每一处「联系客服」→ riderVerify（审核结果通知）')

  // ===== F. 活动审核（activityPublish）=====
  const activity = read('pages/activity/index.js')
  check(() => {
    assertCalls(activity, 'onCreate', "requestTriggerByTap('activityPublish')", 'pages/activity')
  }, 'F. 「发起活动」→ activityPublish（活动审核通知）')

  // ===== G. 活动结果（activitySignup）+ 活动订阅（activityIndex）=====
  check(() => {
    const chooseTab = methodWindow(activity, 'chooseTab', 1400)
    assert.ok(/requestTriggerByTap\('activitySignup'\)/.test(chooseTab), 'pages/activity：chooseTab 必须触发 activitySignup')
    assert.ok(/key === 'all' \|\| key === 'mine'/.test(chooseTab), 'pages/activity：只有「全部活动」与「我的参与」触发活动结果组')
    assert.ok(/key === 'signing'/.test(chooseTab), 'pages/activity：「报名中」必须保留原有 activityIndex 触发方式')
    // 活动卡片按需求归到「活动订阅」组（activityIndex），与「报名中」同组
    assertCalls(activity, 'onActivityTap', "requestTriggerByTap('activityIndex')", 'pages/activity')
  }, 'G. 全部活动 / 我的参与 → activitySignup；活动卡片 / 报名中 → activityIndex')

  // ===== H. 原有触发方式必须原样保留 =====
  check(() => {
    const cases = [
      ['pages/post-publish/index.js', 'onSubmit', "requestTriggerByTap('postPublish')", '发帖成功'],
      ['pages/errand-publish/index.js', null, "requestTriggerByTap('errandPublish')", '发布跑腿成功'],
      ['pages/wallet/index.js', null, "requestTriggerByTap('withdraw')", '提现提交成功'],
      ['pages/chat/index.js', null, "requestTriggerByTap('message')", '聊天页发送'],
      ['pages/rider-verify/index.js', null, "requestTriggerByTap('riderVerify')", '骑手提交认证'],
      ['pages/activity/publish.js', null, "requestTriggerByTap('activityPublish')", '发布活动成功'],
      ['pages/activity/detail.js', null, "requestTriggerByTap('activitySignup')", '活动报名成功'],
      ['pages/activity/index.js', null, "requestTriggerByTap('activityIndex')", '活动页「报名中」'],
    ]
    cases.forEach(([file, method, expected, label]) => {
      const src = read(file)
      const scope = method ? methodWindow(src, method, 3000) : src
      assert.ok(
        scope.indexOf(expected) > -1,
        '原有触发方式被破坏：' + label + '（' + file + ' 应保留 ' + expected + '）'
      )
    })
  }, 'H. 原有 8 处触发方式全部保留（只做新增，不改动既有）')

  // ===== I. 触发组与文案的对应关系（7 个场景逐一核对）=====
  check(() => {
    const sub = read('utils/subscribe.js')
    // 只在 TRIGGER_CHANNEL 块里找，避免匹配到上面 TRIGGER_GROUPS 的同名键
    const start = sub.indexOf('const TRIGGER_CHANNEL')
    const end = sub.indexOf('// 授权键统一推导规则')
    assert.ok(start > -1 && end > start, 'utils/subscribe.js：找不到 TRIGGER_CHANNEL 块')
    const channelBlock = sub.slice(start, end)
    const expected = [
      ['postPublish', '评论通知'],
      ['errandPublish', '代拿/跑腿通知'],
      ['withdraw', '提现结果通知'],
      ['message', '私信通知'],
      ['riderVerify', '审核结果通知'],
      ['activityPublish', '活动审核通知'],
      ['activitySignup', '活动结果通知'],
    ]
    expected.forEach(([trigger, label]) => {
      const line = channelBlock.split('\n').find((l) => new RegExp('^\\s*' + trigger + ': \\{').test(l)) || ''
      assert.ok(line, 'utils/subscribe.js：TRIGGER_CHANNEL 缺少 ' + trigger)
      assert.ok(
        new RegExp("label: '" + label.replace('/', '\\/') + "'").test(line),
        trigger + ' 的渠道文案必须是「' + label + '」，实际：' + line.trim()
      )
    })
  }, 'I. 7 个场景的弹窗文案与触发组一一对应')
}

try {
  run()
  console.log(testCount + ' tests passed.')
  process.exit(0)
} catch (err) {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
}
