/**
 * 跑腿「取消订单需对方同意」护栏（无需数据库）
 *
 * 背景（2026-10-06 用户反馈）：发单人发布订单后，另一个号接单；30 分钟后发单人
 * 仍可直接取消订单，**完全没有征求接单人同意**，接单人可能已经在路上。
 * 接单方取消早就有「30 分钟内自身原因可直接取消、其余需发单人同意」的审批流，
 * 发单方这一侧却是直接 UPDATE ... status='cancelled'，两边完全不对称。
 *
 * 本次把发单方也改成对称流程：
 *   · 订单未被接单（pending）：无人受影响，仍可直接取消（保持原行为，别过度设计）；
 *   · 订单已被接单（accepted）：发单人只能**提交取消申请**，必须接单方同意才终止订单。
 *
 * 这层护栏要守住的点（每一条都对应一个真会犯的错）：
 *   ① 发单人取消 accepted 订单时不得直接置 cancelled —— 必须落 errand_cancel_request；
 *   ② 审批人必须是「申请的对方」。判据用 requester_id 与订单双方比对，若图省事写成
 *      「publisher_id === req.userId」，发单人就能自己批自己的申请，等于绕回单方面取消；
 *   ③ 双向审批都要走 reviewCancelRequest，且 reason_side='publisher' 的申请不得
 *      把发单人的取消算到接单方完成率上（bumpStat 只对「接单方自身原因」生效）；
 *   ④ 端上「谁能看到同意/拒绝按钮」必须与后端权限同源（canHandleRequest 按 requester 判方向），
 *      否则要么按钮出在申请人自己的页面上（假入口 + 后端 403），要么审批人看不到入口；
 *   ⑤ detail 接口要下发驼峰键 requesterId/reasonSide/images，否则端上 reasonSide 恒 undefined
 *      （原因方标签永远显示"自身原因"）、images 恒 undefined（凭证图不渲染）。
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const CTRL = read('server/controllers/errandController.js')
const ROUTES = read('server/routes/errandRoutes.js')
const DETAIL_JS = read('pages/errand-detail/index.js')
const DETAIL_WXML = read('pages/errand-detail/index.wxml')
const CANCEL_JS = read('pages/errand-cancel/index.js')
const CANCEL_WXML = read('pages/errand-cancel/index.wxml')

// 从源码里截出 exports.cancel 的函数体（到下一个顶层 exports. 为止）
function fnBody(src, name) {
  const start = src.indexOf(`exports.${name} = `)
  assert.ok(start > -1, `找不到 exports.${name}`)
  const rest = src.slice(start)
  const next = rest.indexOf('\nexports.', 1)
  return next > -1 ? rest.slice(0, next) : rest
}

const CANCEL_BODY = fnBody(CTRL, 'cancel')
const REVIEW_BODY = fnBody(CTRL, 'reviewCancelRequest')
const RELEASE_BODY = fnBody(CTRL, 'release')

// ===== A. 发单人取消：pending 直接取消 / accepted 必须申请 =====
console.log('\n[A] 发单人取消的分支')

check(() => {
  // 必须存在「已接单 → 落申请」的分支
  assert.ok(
    /order\.status\s*===\s*'accepted'/.test(CANCEL_BODY),
    'exports.cancel 未区分「订单已被接单」的情况'
  )
}, 'A1 cancel 必须判断订单是否已被接单')

check(() => {
  const acceptedBranch = CANCEL_BODY.slice(CANCEL_BODY.indexOf("order.status === 'accepted'"))
  const insertIdx = acceptedBranch.indexOf('errand_cancel_request')
  assert.ok(insertIdx > -1, '已接单分支未写入 errand_cancel_request，等于还是直接取消')
  // 在写申请之前不得出现置 cancelled 的 UPDATE
  const beforeInsert = acceptedBranch.slice(0, insertIdx)
  assert.ok(
    !/SET status = 'cancelled'/.test(beforeInsert),
    '已接单分支在写取消申请之前就置了 cancelled —— 必须先申请、等对方同意'
  )
  assert.ok(/INSERT INTO errand_cancel_request/.test(acceptedBranch), '已接单分支缺少 INSERT errand_cancel_request')
}, 'A2 已接单时发单人只能提交申请，不得直接置 cancelled')

check(() => {
  // reason_side 固定为 publisher，用于端上区分「谁申请的」
  assert.ok(
    /INSERT INTO errand_cancel_request[\s\S]{0,220}'publisher'/.test(CANCEL_BODY),
    '发单人的取消申请 reason_side 必须写成 publisher'
  )
}, 'A3 发单人的取消申请 reason_side 必须为 publisher')

check(() => {
  const acceptedBranch = CANCEL_BODY.slice(CANCEL_BODY.indexOf("order.status === 'accepted'"))
  assert.ok(/mode:\s*'requested'/.test(acceptedBranch), '已接单分支必须返回 mode=requested 供端上区分')
  assert.ok(/notify\(/.test(acceptedBranch), '提交申请后必须通知接单方')
}, 'A4 已接单分支必须返回 mode=requested 并通知接单方')

check(() => {
  // 未被接单时仍直接取消（UPDATE 条件必须限定 pending）
  assert.ok(
    /SET status = 'cancelled' WHERE id = \? AND status = 'pending'/.test(CANCEL_BODY),
    "直接取消的 UPDATE 必须限定 status='pending'（不能接受 accepted，否则又变回单方面取消）"
  )
}, 'A5 pending 订单仍可直接取消，且 UPDATE 只允许 pending')

check(() => {
  // 直接取消分支也要退款
  const tail = CANCEL_BODY.slice(CANCEL_BODY.indexOf("ORDER BY id DESC LIMIT 1"))
  assert.ok(/refundOrderTolerant/.test(CANCEL_BODY), '直接取消分支必须发起退款')
}, 'A6 直接取消分支必须发起退款')

check(() => {
  // 申请分支不得退款（订单还没终止）
  const startIdx = CANCEL_BODY.indexOf("order.status === 'accepted'")
  const endIdx = CANCEL_BODY.indexOf("mode: 'requested'")
  assert.ok(startIdx > -1 && endIdx > startIdx, '取消申请分支结构异常')
  const acceptedBranch = CANCEL_BODY.slice(startIdx, endIdx)
  assert.ok(
    !/refundOrderTolerant/.test(acceptedBranch),
    '提交申请时不得退款 —— 订单尚未终止，赏金还在托管中'
  )
}, 'A7 提交申请阶段不得发起退款')

// ===== B. 审批人必须是「申请的对方」 =====
console.log('\n[B] 审批人方向')

check(() => {
  assert.ok(
    /requester_id\)\s*===\s*Number\(request\.publisher_id\)/.test(REVIEW_BODY),
    'reviewCancelRequest 未按 requester_id 与订单双方比对来判定方向'
  )
}, 'B1 审批方向必须由 requester_id 与订单双方比对得出')

check(() => {
  // 审批人 = 申请的对方
  assert.ok(
    /reviewerId\s*=\s*isPublisherRequester\s*\?\s*request\.acceptor_id\s*:\s*request\.publisher_id/.test(REVIEW_BODY),
    'reviewerId 必须是「申请的对方」（发单人申请→接单方批，反之→发单人批）'
  )
  assert.ok(
    /Number\(reviewerId\)\s*!==\s*Number\(req\.userId\)/.test(REVIEW_BODY),
    '必须以 reviewerId 做权限校验'
  )
}, 'B2 只有申请的对方可以审批')

check(() => {
  // 关键回归点：绝不能退化成「仅发单人可以处理」
  assert.ok(
    !/Number\(request\.publisher_id\)\s*!==\s*Number\(req\.userId\)/.test(REVIEW_BODY),
    'reviewCancelRequest 退回了「仅发单人可以处理」—— 发单人撤回自己的申请就等于单方面取消'
  )
}, 'B3 不得退回「仅发单人可以处理」')

check(() => {
  // 发单人原因取消不得算接单方完成率
  assert.ok(
    /if\s*\(!isPublisherRequester\s*&&\s*request\.reason_side\s*===\s*'self'\)\s*await bumpStat/.test(REVIEW_BODY),
    'bumpStat 必须限定「接单方自身原因」，发单人申请取消不得影响接单方完成率'
  )
}, 'B4 发单人申请取消不得计入接单方完成率')

check(() => {
  // 同意后要退款
  assert.ok(/refundOrderTolerant/.test(REVIEW_BODY), '同意取消后必须发起退款')
}, 'B5 同意取消后必须发起退款')

// ===== C. 反例：接单方原有流程不得被改坏 =====
console.log('\n[C] 接单方原有流程不回归')

check(() => {
  assert.ok(/FREE_CANCEL_MINUTES/.test(RELEASE_BODY), 'release 的 30 分钟免费窗口不得被删')
  assert.ok(/withinFreeWindow\s*&&\s*reasonSide\s*===\s*'self'/.test(RELEASE_BODY), 'release 的「30 分钟内自身原因可直接取消」判据不得改')
  assert.ok(/mode:\s*'requested'/.test(RELEASE_BODY), 'release 超窗仍应走申请')
  assert.ok(/mode:\s*'released'/.test(RELEASE_BODY), 'release 直取消仍应返回 mode=released')
}, 'C1 接单方 release 的窗口与两种模式保持不变')

check(() => {
  // 接单方申请仍写 reason_side = 传入值（self/publisher），不是被写死成 publisher
  assert.ok(
    /INSERT INTO errand_cancel_request \(order_id, requester_id, reason_side, reason, images\) VALUES \(\?, \?, \?, \?, \?\)/.test(RELEASE_BODY),
    'release 的 INSERT 必须仍然使用传入的 reasonSide'
  )
}, 'C2 接单方 release 的 reason_side 仍取传入值')

// ===== D. 路由与端上接线 =====
console.log('\n[D] 路由与端上接线')

check(() => {
  assert.ok(/post\('\/:id\/cancel'/.test(ROUTES), '缺少 POST /:id/cancel 路由')
  assert.ok(/post\('\/cancel-requests\/:id\/review'/.test(ROUTES), '缺少取消申请审批路由')
}, 'D1 取消与审批路由齐备')

check(() => {
  // ⚠ 最关键的一条：路由必须真的指向 errandController.cancel。
  //
  // 背景（2026-10-06 二次踩坑）：上一轮把同意审批流写进了 errandController.cancel，
  // 但 POST /:id/cancel 实际绑的是 paymentController.cancelErrand —— 那条路
  // 直接 UPDATE status='cancelled' + 退款，不校验接单方意愿、不写流水。
  // 结果「改完代码线上照旧能单方面取消」，测试还全绿（因为测试只读函数体，
  // 不看路由绑的是谁）。线上 order 46/47 静默取消即由此产生。
  const routeLine = ROUTES.split('\n').find((l) => /post\('\/:id\/cancel'/.test(l)) || ''
  assert.ok(
    /errandController\.cancel\b/.test(routeLine),
    "POST /:id/cancel 必须绑定 errandController.cancel；绑到 paymentController.cancelErrand 会绕过同意审批流：" + routeLine.trim()
  )
  assert.ok(
    !/paymentController\.cancelErrand\b/.test(routeLine),
    'POST /:id/cancel 不得绑定 paymentController.cancelErrand（无同意校验 / 无流水）'
  )
}, 'D1b 取消路由必须绑定带同意审批流的控制器')

check(() => {
  // 反向自证：带同意审批流的 exports.cancel 必须真的被路由引用，
  // 否则它只是死代码（上一轮的错误形态）。
  assert.ok(
    /errandController\.cancel\b/.test(ROUTES),
    'exports.cancel 未被任何路由引用 —— 它成了死代码，线上走的是别处'
  )
}, 'D1c exports.cancel 必须被真实挂载（防死代码）')

check(() => {
  // 端上必须按 requester 判方向，而不是「role === publisher」
  assert.ok(
    /requestByPublisher\s*=/.test(DETAIL_JS) && /requesterId\s*\|\|\s*cancelRequest\.requester_id/.test(DETAIL_JS),
    'applyOrder 必须按 requesterId 判定申请方向（并兼容蛇形键）'
  )
  assert.ok(
    /canHandleRequest\s*=\s*requestPending\s*&&/.test(DETAIL_JS),
    'canHandleRequest 必须由 requestByPublisher + role 共同决定'
  )
}, 'D2 端上审批人判定必须与后端同源')

check(() => {
  // 发单人自己的申请页面上不得出现「同意取消」按钮
  assert.ok(
    /requestByPublisher\s*&&\s*role\s*===\s*'acceptor'/.test(DETAIL_JS) &&
      /!requestByPublisher\s*&&\s*role\s*===\s*'publisher'/.test(DETAIL_JS),
    'canHandleRequest 必须写全两个方向的条件'
  )
}, 'D3 canHandleRequest 必须覆盖双向且互斥')

check(() => {
  // 接单方要有独立的审批底部栏
  assert.ok(
    /bottomMode === 'acceptorReview'/.test(DETAIL_WXML),
    '缺少接单方审批时的底部栏（否则接单方看不到"申请取消接单"入口/等待态）'
  )
  assert.ok(
    /bottomMode === 'publisher' && requestPending/.test(DETAIL_WXML),
    '缺少发单人「申请已提交、等接单方同意」的等待态'
  )
}, 'D4 双向的底部栏状态必须齐备')

check(() => {
  // 发单人入口文案要如实说明是「申请」而不是立即取消
  assert.ok(
    /申请取消订单/.test(DETAIL_WXML),
    '已被接单时发单人的按钮应写「申请取消订单」，不能写「取消订单」（会误导为立即生效）'
  )
}, 'D5 发单人按钮文案必须体现「需对方同意」')

check(() => {
  // 未被接单时仍是「取消订单」
  const ownerPending = DETAIL_WXML.slice(DETAIL_WXML.indexOf("bottomMode === 'ownerPending'"))
  const bar = ownerPending.slice(0, ownerPending.indexOf('</view>'))
  assert.ok(/取消订单/.test(bar), 'order 未被接单时仍应显示「取消订单」（直接生效）')
}, 'D6 待接单状态保持「取消订单」直取消')

check(() => {
  // detail 接口要下发驼峰键
  assert.ok(
    /requesterId:\s*row\.requester_id/.test(CTRL),
    'detail 必须下发 requesterId（端上按它判方向）'
  )
  assert.ok(/reasonSide:\s*row\.reason_side/.test(CTRL), 'detail 必须下发 reasonSide（否则原因方标签恒为"自身原因"）')
  assert.ok(
    /images:\s*Array\.isArray\(row\.images\)\s*\?\s*row\.images\s*:\s*\[\]/.test(CTRL),
    'detail 必须把 images 归一化为数组（否则模板 .length 取不到、凭证图不渲染）'
  )
}, 'D7 detail 必须下发 requesterId / reasonSide / images 驼峰键')

check(() => {
  // 取消页要按角色显示提前告知
  assert.ok(/orderAccepted/.test(CANCEL_JS), 'errand-cancel 未拉取「是否已被接单」')
  assert.ok(
    /role === 'publisher' && orderAccepted/.test(CANCEL_WXML),
    'errand-cancel 缺少发单方「已被接单需对方同意」的提示'
  )
  assert.ok(
    /data\.mode === 'requested'/.test(CANCEL_JS),
    'errand-cancel 未处理 mode=requested（会误报「订单已取消」）'
  )
}, 'D8 取消页必须按角色提示且正确识别 requested 模式')

check(() => {
  // 申请提交后不得广播 cancelled（订单状态其实没变）。
  // 注意：'doCancelOrder(reason)' 在 submit() 的回调里先出现一次，必须锚定方法定义那一行
  // （行首两个空格 + 名字 + (reason) {），否则 slice 起点会跑到方法外面去。
  const start = CANCEL_JS.search(/^ {2}doCancelOrder\(reason\)\s*\{/m)
  const end = CANCEL_JS.search(/^ {2}doRelease\(side, reason\)\s*\{/m)
  assert.ok(start > -1 && end > start, '找不到 doCancelOrder 方法主体')
  const body = CANCEL_JS.slice(start, end)
  const reqBranch = body.indexOf("mode === 'requested'")
  const publish = body.indexOf('errandStatus.publish')
  assert.ok(reqBranch > -1 && publish > -1, 'doCancelOrder 缺少 requested 分支或状态广播')
  assert.ok(reqBranch < publish, 'requested 分支必须在 errandStatus.publish 之前 return（否则误广播已取消）')
}, 'D9 提交申请后不得广播订单已取消')

// ===== F. 退款路径不得静默取消订单 =====
console.log('\n[F] 退款驱动的取消必须留下流水')

const PAY = read('server/controllers/paymentController.js')

check(() => {
  // reserveErrandRefund 把 status 改成 cancelled 时必须补写 errand_order_log
  assert.ok(
    /hasCancelLog/.test(PAY) && /logCancellation/.test(PAY),
    'reserveErrandRefund 必须通过 hasCancelLog/logCancellation 补写取消流水'
  )
}, 'F1 退款路径必须补写取消流水')

check(() => {
  // 补写必须发生在置 cancelled 的同一事务里（不能是事后 fire-and-forget）
  const start = PAY.indexOf('async function reserveErrandRefund')
  const end = PAY.indexOf('async function submitErrandRefund')
  assert.ok(start > -1 && end > start, '找不到 reserveErrandRefund 主体')
  const body = PAY.slice(start, end)
  const cancelIdx = body.indexOf("SET status = 'cancelled'")
  const logIdx = body.indexOf('logCancellation(')
  assert.ok(cancelIdx > -1 && logIdx > cancelIdx, '置 cancelled 之后必须在同一事务内补写流水')
  // 不得出现「置 cancelled 但没有任何 logCancellation 调用」的裸路径
  assert.ok(
    /hasCancelLog\(conn, order\.id\)/.test(body),
    '补写前必须用 hasCancelLog 做幂等判断，避免重复流水'
  )
}, 'F2 补写流水必须与状态变更同事务且幂等')

check(() => {
  // 遗留 pending 取消申请要随订单关闭（孤儿申请 id=2/3 的根因）
  assert.ok(
    /UPDATE errand_cancel_request SET status = 'rejected', handled_at = NOW\(\) WHERE order_id = \? AND status = 'pending'/.test(PAY),
    '取消路径必须关闭遗留的 pending 取消申请（否则留下孤儿申请）'
  )
}, 'F3 取消时必须关闭遗留 pending 申请')

console.log(`\nerrand-cancel-consent.test.js OK — ${testCount} 项断言全部通过\n`)
