/**
 * 跑腿「接单冻结必须可解除」护栏（无需数据库）
 *
 * 背景（2026-10-06 用户反馈「被冻结了能解除吗」）：
 *   接单完成率低于 50%（且完成+自身取消满 3 单）会冻结接单功能。原实现里
 *   `isRunnerFrozen` 只是**当场用 errand_stat 现算**，没有任何到期/解冻机制：
 *
 *     · 冻结后 accept 直接 403 → finished_count 永远不再增长 →
 *       完成率永远低于阈值 → **数学上永久封禁**，用户没有任何自救路径；
 *     · 没有管理员解冻入口，客服收到申诉也无能为力；
 *     · 403 文案只有「已被冻结，请联系客服处理」，用户不知道会不会、什么时候恢复。
 *
 *   实测坐实：账号 67（完成 1 / 自身取消 2 = 33%）被永久锁死，
 *   而它是另一个测试号唯一能互相接单的账号 → 整条业务流程走不下去。
 *
 * 本护栏守住的点：
 *   ① 冻结必须是「冷却期」：errand_stat 有 frozen_at / frozen_until 列；
 *   ② 判定口径两条路径必须一致（在线接单 与 管理后台列表），否则管理员看到的
 *      冻结名单与实际能不能接单不一致；
 *   ③ 必须有手动解冻接口 + 权限，且解冻不能粉饰统计（只动 frozen_until）；
 *   ④ 403 文案必须告知恢复时间或申诉途径；
 *   ⑤ 后台要有对应的查询/解冻接线，否则接口是「悬空能力」（写了没人调）。
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
const ADMIN_CTRL = read('server/controllers/adminController.js')
const ADMIN_ROUTES = read('server/routes/adminRoutes.js')
const ADMIN_UTILS = read('pkg-admin/utils/admin.js')
const ADMIN_JS = read('pkg-admin/admin/index.js')
const ADMIN_WXML = read('pkg-admin/admin/index.wxml')
const MIGRATIONS = read('server/utils/migrations.js')

// ===== A. 冻结带冷却期（不是永久封禁）=====
console.log('\n[A] 冻结冷却期')

check(() => {
  assert.ok(/FREEZE_COOLDOWN_DAYS\s*=\s*\d+/.test(CTRL), '缺少 FREEZE_COOLDOWN_DAYS 常量')
}, 'A1 必须定义冻结冷却天数')

check(() => {
  assert.ok(
    /ensureColumn\('errand_stat',\s*'frozen_at'/.test(MIGRATIONS),
    'errand_stat 缺少 frozen_at 列（无法记录何时被冻结）'
  )
  assert.ok(
    /ensureColumn\('errand_stat',\s*'frozen_until'/.test(MIGRATIONS),
    'errand_stat 缺少 frozen_until 列 —— 没有到期时间就等于永久封禁'
  )
}, 'A2 errand_stat 必须有 frozen_at / frozen_until 列')

check(() => {
  assert.ok(
    /ensureColumn\('errand_stat',\s*'unfrozen_at'/.test(MIGRATIONS) &&
      /ensureColumn\('errand_stat',\s*'unfreeze_note'/.test(MIGRATIONS),
    '缺少解冻审计列（谁解的、什么原因）'
  )
}, 'A3 解冻必须留痕（unfrozen_at / unfreeze_note）')

check(() => {
  assert.ok(/function freezeStats\s*\(/.test(CTRL), '缺少 freezeStats 统一判定函数')
  const body = CTRL.slice(CTRL.indexOf('function freezeStats'), CTRL.indexOf('async function isRunnerFrozen'))
  assert.ok(/frozen_until/.test(body), 'freezeStats 必须读 frozen_until')
  assert.ok(/until\s*>\s*Date\.now\(\)/.test(body), 'frozen 判定必须比较 frozen_until 与当前时间（到期即恢复）')
}, 'A4 冻结判定必须结合到期时间')

check(() => {
  // 首次判定为「应冻结」时要补写冷却期，否则永远没有到期时间
  const body = CTRL.slice(CTRL.indexOf('async function isRunnerFrozen'))
  assert.ok(/overThreshold/.test(body), 'isRunnerFrozen 应基于 freezeStats 的 overThreshold')
  assert.ok(
    /UPDATE errand_stat SET frozen_at = \?, frozen_until = \?/.test(body),
    'isRunnerFrozen 必须为首次超阈值的用户补写冻结起止时间（否则永远没有到期时间）'
  )
}, 'A5 首次冻结必须写入冷却起止时间')

// ===== B. 403 文案必须给出出路 =====
console.log('\n[B] 403 提示文案')

check(() => {
  const acceptBody = CTRL.slice(CTRL.indexOf('exports.accept'), CTRL.indexOf('exports.finish'))
  assert.ok(/freezeStats\(statRows\[0\]\)\.frozen/.test(acceptBody), 'accept 必须用 freezeStats 判定冻结')
  assert.ok(/暂时冻结/.test(acceptBody), '403 文案应说明是「暂时」冻结而非永久')
}, 'B1 accept 用统一判定且文案体现「暂时」')

check(() => {
  const acceptBody = CTRL.slice(CTRL.indexOf('exports.accept'), CTRL.indexOf('exports.finish'))
  assert.ok(/frozenUntil/.test(acceptBody), '403 文案必须带上解冻到期时间')
  assert.ok(/联系客服/.test(acceptBody), '403 文案必须给出申诉途径（联系客服提前解除）')
}, 'B2 403 文案必须含恢复时间与申诉途径')

// ===== C. 手动解冻接口 =====
console.log('\n[C] 手动解冻')

check(() => {
  assert.ok(/exports\.unfreezeErrandRunner\s*=/.test(ADMIN_CTRL), '缺少 unfreezeErrandRunner 接口')
  const body = ADMIN_CTRL.slice(ADMIN_CTRL.indexOf('exports.unfreezeErrandRunner'))
  const end = body.indexOf('\nexports.', 1)
  const fn = end > -1 ? body.slice(0, end) : body
  // 解冻只能动 frozen_until，不能改统计（否则完成率被粉饰，失去追责依据）
  assert.ok(/frozen_until = NOW\(\)/.test(fn), '解冻必须把 frozen_until 置为当前时间')
  assert.ok(
    !/SET\s+finished_count/i.test(fn) && !/self_cancel_count\s*=/i.test(fn),
    '解冻不得修改完成率统计（finished_count / self_cancel_count 必须如实保留）'
  )
  assert.ok(/unfrozen_at = NOW\(\)/.test(fn), '解冻必须写 unfrozen_at 审计时间')
}, 'C1 解冻只清冷却期、不改统计')

check(() => {
  assert.ok(
    /router\.post\('\/errand-runners\/:userId\/unfreeze'/.test(ADMIN_ROUTES),
    '缺少 POST /admin/errand-runners/:userId/unfreeze 路由'
  )
  assert.ok(
    /router\.get\('\/errand-runners'/.test(ADMIN_ROUTES),
    '缺少 GET /admin/errand-runners 路由'
  )
}, 'C2 后台路由必须齐备')

check(() => {
  // 权限点沿用 admin.manage（与其它跑腿管理一致）
  const block = ADMIN_ROUTES.slice(ADMIN_ROUTES.indexOf('/errand-runners'))
  assert.ok(/requireAdmin\('admin\.manage'\)/.test(block), '接单冻结管理必须挂 requireAdmin 权限')
}, 'C3 接口必须挂权限校验')

// ===== D. 两处冻结判定口径一致 =====
console.log('\n[D] 判定口径一致性')

check(() => {
  const body = ADMIN_CTRL.slice(ADMIN_CTRL.indexOf('exports.listErrandRunners'))
  const end = body.indexOf('\nexports.', 1)
  const fn = end > -1 ? body.slice(0, end) : body
  assert.ok(/FREEZE_MIN_RECORDS = 3/.test(fn), '后台列表的「满 3 单」阈值必须与在线接单一致')
  assert.ok(/FREEZE_RATE = 0\.5/.test(fn), '后台列表的 50% 阈值必须与在线接单一致')
  assert.ok(/frozen_until > NOW\(\)/.test(fn), '后台「仅被冻结」筛选必须同样考虑到期时间')
}, 'D1 后台列表阈值与在线接单一致')

check(() => {
  // 在线侧常量也要是同一组值，防止一边改一边不改
  assert.ok(/FREEZE_MIN_RECORDS = 3/.test(CTRL), '在线侧 FREEZE_MIN_RECORDS 应为 3')
  assert.ok(/FREEZE_RATE = 0\.5/.test(CTRL), '在线侧 FREEZE_RATE 应为 0.5')
}, 'D2 在线侧阈值常量为 3 / 0.5')

// ===== E. 后台接线（避免悬空能力）=====
console.log('\n[E] 后台接线')

check(() => {
  assert.ok(/errandRunners:\s*\(data\)\s*=>\s*get\('\/errand-runners'/.test(ADMIN_UTILS), 'admin.js 缺少 errandRunners 封装')
  assert.ok(/unfreezeErrandRunner:/.test(ADMIN_UTILS), 'admin.js 缺少 unfreezeErrandRunner 封装')
}, 'E1 admin.js 必须有对应封装')

check(() => {
  assert.ok(/errandRunners: \[\]/.test(ADMIN_JS), 'admin js data 缺少 errandRunners 列表')
  // runnerOnly 是「仅被冻结」筛选项的状态字段，缺了筛选就点不动
  assert.ok(/runnerOnly:/.test(ADMIN_JS), 'admin js data 缺少 runnerOnly 筛选状态')
  assert.ok(/loadErrandRunners/.test(ADMIN_JS), 'admin js 缺少 loadErrandRunners')
  assert.ok(/loadMoreRunners/.test(ADMIN_JS), 'admin js 缺少 loadMoreRunners（分页）')
  assert.ok(/unfreezeRunner\s*\(/.test(ADMIN_JS), 'admin js 缺少 unfreezeRunner 处理')
  const scope = ADMIN_JS.slice(ADMIN_JS.indexOf('chooseLogScope'))
  assert.ok(/runner/.test(scope.slice(0, 700)), 'chooseLogScope 必须把 runner 分段接上加载')
}, 'E2 admin js 必须接上加载与解冻')

check(() => {
  assert.ok(/data-scope="runner"/.test(ADMIN_WXML), 'wxml 缺少「接单完成率」分段入口')
  assert.ok(/runnerOnly === 'frozen'/.test(ADMIN_WXML), 'wxml 缺少「仅被冻结」筛选')
  assert.ok(/bindtap="unfreezeRunner"/.test(ADMIN_WXML), 'wxml 缺少解冻按钮')
  assert.ok(/frozenUntilText/.test(ADMIN_WXML), '列表必须显示冻结到期时间')
}, 'E3 wxml 必须提供入口 / 筛选 / 解冻按钮 / 到期时间')

check(() => {
  // 解冻按钮必须带 hover-class（共享弹性层约定）。取整个 <button ...> 标签，
  // 而不是从 bindtap 往后截 —— hover-class/hover-stay-time 写在 bindtap 之前，往后截会漏掉。
  const m = ADMIN_WXML.match(/<button[^>]*unfreezeRunner[^>]*>/)
  assert.ok(m, '找不到解冻按钮')
  assert.ok(/hover-class="press-spring"/.test(m[0]), '解冻按钮必须带 press-spring 悬停/按压反馈')
  assert.ok(/hover-stay-time="\d+"/.test(m[0]), '解冻按钮必须带 hover-stay-time')
  assert.ok(/spring-btn/.test(m[0]), '解冻按钮必须带 spring-btn 类（共享弹性层）')
}, 'E4 解冻按钮必须符合共享弹性层约定')

// ===== F. 反例：冻结判定不得退回「只看比例、不看期限」=====
console.log('\n[F] 反例')

check(() => {
  // 旧实现形态：没有 frozen_until 的裸判定
  const hasBare = /return total >= FREEZE_MIN_RECORDS && Number\(stat\.finished_count\) \/ total < FREEZE_RATE/.test(CTRL)
  assert.ok(!hasBare, '出现了「只看完成率、不看到期时间」的裸判定 —— 会退回永久封禁')
}, 'F1 不得存在无视到期时间的裸冻结判定')

check(() => {
  // 解冻必须真的能被 isRunnerFrozen 认出来（frozen_until 过期 → 不冻结）
  const body = CTRL.slice(CTRL.indexOf('function freezeStats'), CTRL.indexOf('async function isRunnerFrozen'))
  assert.ok(
    /const inCooldown = overThreshold && until > Date\.now\(\)/.test(body),
    'frozen 必须要求 frozen_until 仍在未来（解冻写过去时间后应立即失效）'
  )
  assert.ok(/frozen: inCooldown/.test(body), 'freezeStats 的 frozen 字段必须来自 inCooldown')
}, 'F2 手动解冻后必须立即生效')

// ===== G. 端上 UI：按钮要有可见边框 + 确认弹窗不得截断正文 =====
console.log('\n[G] 端上 UI 细节')

const ADMIN_WXSS = read('pkg-admin/admin/index.wxss')

check(() => {
  // 用户反馈：「恢复接单」只有文字、没有框，看不出是按钮
  const start = ADMIN_WXSS.indexOf('.runner-actions .runner-btn {')
  assert.ok(start > -1, '找不到 .runner-actions .runner-btn 样式')
  const block = ADMIN_WXSS.slice(start, ADMIN_WXSS.indexOf('}', start))
  assert.ok(
    /border:\s*1rpx solid/.test(block),
    '「恢复接单/解除冻结」按钮必须有可见边框（否则浮在卡片上看不出是按钮）—— 当前：' + block.slice(0, 120)
  )
  assert.ok(/border-radius/.test(block), '按钮需要圆角')
  assert.ok(/padding:/.test(block), '按钮需要内边距（否则文字贴着边框）')
}, 'G1 解冻按钮必须有可见边框而非裸文字')

check(() => {
  // 两种状态要有区分：已冻结（危险操作）与待解冻（常规恢复）
  assert.ok(
    /\.runner-btn--danger\s*\{[^}]*border-color:\s*var\(--error\)/.test(ADMIN_WXSS),
    '「解除冻结」（危险操作）应有独立配色（--error 描边）'
  )
  assert.ok(/runner-btn--danger/.test(ADMIN_WXML), 'WXML 必须按 frozen 状态套用 runner-btn--danger')
}, 'G2 冻结/恢复两态视觉必须可区分')

check(() => {
  // 用户反馈：wx.showModal 的 content 多行 + editable 同开时被截断，「文字显示不全」
  assert.ok(
    !/wx\.showModal\(\{[\s\S]{0,400}?editable:\s*true/.test(ADMIN_JS),
    'wx.showModal 多行 content + editable:true 会截断正文 —— 应改用自定义弹窗'
  )
}, 'G3 不得再用 wx.showModal 承载多行正文 + 输入')

check(() => {
  // 自定义弹窗必须齐备：状态字段 + 打开/关闭/输入/提交
  assert.ok(/runnerConfirm:\s*\{\s*show:\s*false/.test(ADMIN_JS), '缺少 runnerConfirm 初始状态')
  for (const m of ['unfreezeRunner\\(', 'closeRunnerConfirm\\(', 'onRunnerNoteInput\\(', 'submitRunnerConfirm\\(']) {
    assert.ok(new RegExp(m).test(ADMIN_JS), `缺少方法 ${m}`)
  }
  assert.ok(/confirm-mask/.test(ADMIN_WXML) && /confirm-card/.test(ADMIN_WXML), 'WXML 缺少自定义确认弹窗结构')
}, 'G4 自定义确认弹窗必须齐备')

check(() => {
  // 正文必须能完整换行显示（不被省略号/单行裁掉）
  assert.ok(
    /\.confirm-text\s*\{[^}]*white-space:\s*pre-wrap/.test(ADMIN_WXSS),
    'confirm-text 必须 white-space: pre-wrap（保证多行正文完整展示）'
  )
  assert.ok(/word-break:\s*break-word/.test(ADMIN_WXSS), '长用户名等需要 word-break 防溢出')
  assert.ok(/\.confirm-card\s*\{[^}]*overflow-y:\s*auto/.test(ADMIN_WXSS), '弹窗内容需可滚动，避免超高被裁')
}, 'G5 弹窗正文必须完整可读，不得截断')

check(() => {
  // 切换分段时要关掉残留弹窗（与 errandDetail/repairDetail 同口径）
  const body = ADMIN_JS.slice(ADMIN_JS.indexOf('chooseLogScope(e)'), ADMIN_JS.indexOf('chooseLogScope(e)') + 600)
  assert.ok(/'runnerConfirm\.show':\s*false/.test(body), '切换日志分段时必须关闭接单解冻弹窗')
}, 'G6 切分段必须清理残留弹窗')

check(() => {
  // 用户反馈：点了「恢复接单」显示「已解除冻结」，但列表状态仍显示「待解冻」。
  // 根因：端上只用 overThreshold 判「待解冻」，而解冻后完成率并不会变好 → overThreshold 恒为真。
  // 必须由服务端显式下发 unfrozen 标志，端上按 已冻结/已解冻/正常 三态渲染。
  assert.ok(
    /const unfrozen = overThreshold && !frozen && !!r\.frozenUntil/.test(ADMIN_CTRL),
    'listErrandRunners 必须下发 unfrozen 标志（统计仍超标但已提前解冻）'
  )
  // 必须真的挂进 return 的对象里下发（否则端上拿到 undefined，三态渲染失效）
  const retStart = ADMIN_CTRL.indexOf('return Object.assign({}, r, {')
  assert.ok(retStart > -1, '找不到 listErrandRunners 的返回值构造')
  const retBlock = ADMIN_CTRL.slice(retStart, ADMIN_CTRL.indexOf('})', retStart))
  assert.ok(/^\s*unfrozen,?\s*$/m.test(retBlock), '返回值里必须带上 unfrozen 字段')
}, 'G7 服务端必须显式下发「已解冻」状态')

check(() => {
  // 端上不得再用 overThreshold 单独判「待解冻」
  assert.ok(
    !/item\.overThreshold \? '待解冻'/.test(ADMIN_WXML),
    "不得再用 overThreshold 判「待解冻」—— 解冻后它恒为真，会一直显示待解冻"
  )
  assert.ok(
    /item\.frozen \? '已冻结' : \(item\.unfrozen \? '已解冻' : '正常'\)/.test(ADMIN_WXML),
    '状态文案必须三态：已冻结 / 已解冻 / 正常'
  )
}, 'G8 端上必须按三态渲染状态')

check(() => {
  // 已解冻时不得再给「恢复接单 / 解除冻结」按钮（没意义）
  const start = ADMIN_WXML.indexOf('class="runner-actions"')
  assert.ok(start > -1, '找不到 runner-actions 容器')
  // 取完整的 <view ...> 开标签（不能只切固定长度，否则会截断 wx:if）
  const tagStart = ADMIN_WXML.lastIndexOf('<view', start)
  const tagEnd = ADMIN_WXML.indexOf('>', start)
  const open = ADMIN_WXML.slice(tagStart, tagEnd + 1)
  assert.ok(
    /wx:if="\{\{item\.frozen\}\}"/.test(open),
    '操作按钮必须只在「当前确实冻结中」出现（item.frozen），不能是 overThreshold'
  )
  const block = ADMIN_WXML.slice(start, ADMIN_WXML.indexOf('</view>', start))
  assert.ok(!/恢复接单/.test(block), '「恢复接单」文案应移除（已解冻无此按钮）')
}, 'G9 已解冻不得再显示操作按钮')

check(() => {
  // 已解冻要有独立配色，不能和正常/冻结混淆
  assert.ok(
    /\.st-frozen-lifted\s*\{[^}]*background:/.test(ADMIN_WXSS),
    '缺少 .st-frozen-lifted 样式（已解冻状态配色）'
  )
  assert.ok(/st-frozen-lifted/.test(ADMIN_WXSS), 'WXSS 必须定义 st-frozen-lifted')
  // 类名是由三元拼出来的（st- 前缀在模板外），所以校验拼装片段而不是整串
  assert.ok(
    /st-\{\{item\.frozen[^}]*'frozen-lifted'/.test(ADMIN_WXML),
    'WXML 必须把已解冻状态拼成 st-frozen-lifted'
  )
}, 'G10 已解冻状态必须有独立配色')

console.log(`\nerrand-runner-unfreeze.test.js OK — ${testCount} 项断言全部通过\n`)
