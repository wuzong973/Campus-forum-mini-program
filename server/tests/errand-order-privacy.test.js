/**
 * 跑腿订单「交接阶段」隐私与权限回归（2026-09-21 用户反馈）
 *
 * 现象：
 *   1. 接单大厅「全部订单」里，第三方用户能看到别人**待确认**的订单（图一）；
 *   2. 第三方点进详情，能看到「接单人已提交完成，已等待 00:13:18」并点「查看」，
 *      弹出提交完成弹窗、点「确认已完成」甚至能弹出确认框（图二）。
 *
 * 根因（两层，缺一不可）：
 *   - 后端 `/errand/list?status=active` 把 finishing/disputed 一并放进公开大厅。
 *     P05 的本意是「别让当事人订单从列表里消失」，但当事人看的是
 *     `/errand/mine/*`（listMine 全量返回、不按状态过滤），根本不受本接口影响。
 *   - 前端详情页的 wait-banner / 提交完成弹窗 / openSubmitSheet / onConfirmComplete
 *     全部**没有角色判断**，浏览者（viewer）也能走到发单人的确认入口。
 *
 * 服务端 `exports.confirm` 本身是有校验的（仅发单人，否则 403），
 * 所以不会产生资损 —— 但私密进度被公开、界面又给出可点的假入口，
 * 且 `onConfirmComplete` 的 `.catch(() => {})` 把 403 静默吞掉，用户只会觉得「点了没反应」。
 *
 * 判据：
 *   A. 行为：detail 对 viewer 必须剔除交接阶段的私密字段（description 等；
 *      remark 已转为「公开描述」——发布表单标注◎所有人可见、大厅对所有人展示，
 *      故对 viewer 保留，保证详情与大厅显示一致）；
 *   B. 行为：list 的 active 分支必须带上「当事人」过滤；
 *   C. 静态：前端详情页的角色守卫不得被删。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

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

const ROOT = path.resolve(__dirname, '..', '..')

/** 按大括号平衡取出某个方法（形如 `name() {`）的完整函数体，比按字符数切片可靠 */
function functionBody(src, name) {
  const start = src.indexOf(name + '()')
  if (start < 0) return ''
  const open = src.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  let inStr = null
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open)
}

// ======================= 桩 pool =======================

const QUERIES = []
let detailRow = null
let mineRow = null

const fakePool = {
  async query(sql, params) {
    const text = String(sql)
    QUERIES.push({ sql: text, params: params === undefined ? [] : params })
    if (/SELECT COUNT\(\*\)/i.test(text)) return [[{ total: 0 }]]
    if (/SELECT role, campus FROM sys_user/.test(text)) return [[{ role: 'user', campus: '南海北区' }]]
    if (/FROM errand_order e/.test(text) && /LIMIT 1/.test(text)) return [[detailRow].filter(Boolean)]
    if (/FROM errand_order e/.test(text)) return [mineRow ? [mineRow] : []]
    return [[]]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const errandController = require('../controllers/errandController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

/** 一条处于「待确认」的完整订单（含全部私密字段） */
function makeFinishingOrder() {
  return {
    id: 77, order_no: 'E20260921001', publisher_id: 1001, acceptor_id: 2002,
    type: '快递', title: '帮取快递', description: '一号门菜鸟驿站，取件码 6688',
    remark: '放门口就行，门禁密码 1234#', reward: '10.00',
    pickup_addr: '一号门', delivery_addr: '31 栋', campus: '南海北区',
    private_info: '取件码 T3-26-5729', private_images: ['https://x/code.jpg'],
    images: ['https://x/public.jpg'],
    receiver_name: '张三', receiver_phone: '13800138000',
    delivery_building: '31 栋', delivery_room: '201',
    payment_status: 'SUCCESS', transaction_id: '4200001234202609210001', paid_at: '2026-09-21 12:00:00',
    status: 'finishing',
    finish_description: '已送达，放在门口', finish_images: ['https://x/a.jpg'],
    finish_submitted_at: '2026-09-21 12:47:00',
    dispute_reason: '', dispute_note: '', dispute_result: '',
    disputed_at: null, dispute_handled_at: null,
    created_at: '2026-09-21 12:00:00', updated_at: '2026-09-21 12:47:00',
    publisher_name: '枯黄的落叶', publisher_avatar: '', acceptor_name: '朦胧的月晕', acceptor_avatar: '',
  }
}

const PRIVATE_FIELDS = [
  'description',
  'private_info', 'private_images',
  'receiver_name', 'receiver_phone', 'delivery_building', 'delivery_room',
  'finish_description', 'finish_images', 'finish_submitted_at',
  'dispute_reason', 'dispute_note', 'dispute_result', 'disputed_at', 'dispute_handled_at',
  'transaction_id',
]

async function getDetail(userId) {
  detailRow = makeFinishingOrder()
  const res = makeRes()
  await errandController.detail({ params: { id: '77' }, userId }, res)
  return { res, order: res.body && res.body.data && res.body.data.order }
}

async function main() {
  // ---------- A. detail：viewer 必须看不到交接阶段私密字段 ----------
  const viewer = await getDetail(9999)
  check(() => {
    assert.strictEqual(viewer.res.statusCode, 200, '浏览者应当能打开详情（订单本身可见）')
    assert.ok(viewer.order, '应当返回 order')
    assert.strictEqual(viewer.order.role, 'viewer', '非当事人必须被判定为 viewer')
  }, 'viewer 打开待确认订单：可访问且角色为 viewer')

  check(() => {
    const leaked = PRIVATE_FIELDS.filter((f) => viewer.order[f] !== undefined)
    assert.deepStrictEqual(
      leaked,
      [],
      'viewer 不得拿到交接阶段私密字段（description 等必须剔除）'
    )
    // remark 即发布页的「公开描述」（表单标注◎所有人可见，大厅列表对所有人展示）：
    // 必须对 viewer 保留，否则详情 desc-box 退回 title，与大厅卡片显示不一致
    assert.strictEqual(viewer.order.remark, '放门口就行，门禁密码 1234#',
      '公开描述（remark）对 viewer 可见，与大厅口径一致')
    assert.strictEqual(viewer.res.body.data.canViewRemark, false, 'viewer 不应获得备注查看权')
  }, 'viewer 详情：私密字段全部剔除')

  check(() => {
    // 公开信息仍应保留，否则大厅列表点进来就是白页
    assert.strictEqual(viewer.order.title, '帮取快递', '标题是公开信息')
    assert.strictEqual(viewer.order.status, 'finishing', '状态本身用于前端角色判断')
    assert.strictEqual(viewer.order.acceptor_name, '朦胧的月晕', '接单人昵称在列表里本就公开')
  }, 'viewer 详情：公开信息保留')

  // ---------- 发单人 / 接单人应当看到完整字段 ----------
  const publisher = await getDetail(1001)
  check(() => {
    assert.strictEqual(publisher.order.role, 'publisher', '发单人必须被判定为 publisher')
    assert.strictEqual(publisher.order.remark, '放门口就行，门禁密码 1234#', '发单人能看到自己填的备注')
    assert.strictEqual(publisher.order.finish_submitted_at, '2026-09-21 12:47:00', '发单人需要提交时间核对')
    assert.strictEqual(publisher.res.body.data.canViewRemark, true, '当事人应获得备注查看权')
  }, 'publisher 详情：私密字段完整保留')

  const acceptor = await getDetail(2002)
  check(() => {
    assert.strictEqual(acceptor.order.role, 'acceptor', '接单人必须被判定为 acceptor')
    assert.strictEqual(acceptor.order.finish_description, '已送达，放在门口', '接单人能看到自己提交的说明')
  }, 'acceptor 详情：私密字段完整保留')

  // ---------- 隐私图片：与公开图分开，绝不进大厅 ----------
  check(() => {
    // 发布页「隐私信息」区上传的图（private_images）必须只对当事人可见：
    // viewer 拿到的是被 delete 掉 private_images 的对象 → undefined
    assert.strictEqual(viewer.order.private_images, undefined,
      'viewer 不得拿到 private_images（隐私图必须明确剔除）')
    // 公开图（images）是发布页「公开描述」区的图，detail 走 SELECT e.*，对所有人可见 —— 不属隐私
    assert.deepStrictEqual(viewer.order.images, ['https://x/public.jpg'],
      '公开图 images 对 viewer 保留（发布页公开描述区，本就公开）')
    assert.deepStrictEqual(acceptor.order.private_images, ['https://x/code.jpg'],
      '接单人必须能看到隐私图（取件码截图等）')
  }, 'detail：private_images 仅当事人可见、images 公开')

  check(() => {
    // 服务端创建接口必须落库 private_images 列（否则端上传了也是白传）
    const controller = fs.readFileSync(path.join(ROOT, 'server', 'controllers', 'errandController.js'), 'utf8')
    assert.ok(/private_info, private_images, images/.test(controller),
      'create 的 INSERT 列清单必须含 private_images')
    assert.ok(/JSON\.stringify\(privateImages\)/.test(controller),
      'create 必须把 privateImages 序列化落库')
    assert.ok(/const privateImages = Array\.isArray\(body\.privateImages\)/.test(controller),
      'create 必须从 body.privateImages 取值（字段名对齐端上 payload）')
  }, 'create：private_images 落库链路在位')

  // ---------- B. list：active 必须带当事人过滤 ----------
  QUERIES.length = 0
  mineRow = null
  const listRes = makeRes()
  await errandController.list({ query: { status: 'active' }, userId: 9999 }, listRes)

  const listQuery = QUERIES.find((q) => /FROM errand_order e/.test(q.sql) && /ORDER BY/.test(q.sql))
  check(() => {
    assert.ok(listQuery, '必须执行列表查询')
    assert.ok(
      /OR \(e\.status IN \(\?, \?\) AND \(e\.publisher_id = \? OR e\.acceptor_id = \?\)\)/.test(listQuery.sql),
      '交接阶段必须是「状态 + 当事人」的组合条件，否则第三方会在大厅看到别人的待确认订单：' + listQuery.sql
    )
    // 回归点（2026-09-21 第一次修完又踩）：不能写成「公开状态 OR 当事人」——
    // 那样当事人自己全部已取消/已完成的历史订单也会倒进大厅，实测某账号一次刷出 22 条 cancelled
    assert.ok(
      !/OR e\.publisher_id = \?/.test(listQuery.sql),
      '不得出现不限状态的当事人 OR（会把已取消/已完成一并放出来）：' + listQuery.sql
    )
  }, 'list(active)：公开状态 + 仅当事人的交接阶段')

  check(() => {
    // 参数必须配平，且 userId 出现在当事人过滤的位置
    const marks = (listQuery.sql.match(/\?/g) || []).length
    assert.strictEqual(marks, listQuery.params.length, '占位符个数必须与参数个数一致')
    const userIds = listQuery.params.filter((p) => p === 9999)
    // CASE WHEN 两处 + WHERE 当事人两处 = 4
    assert.strictEqual(userIds.length, 4, 'userId 应出现 4 次（SELECT 的 CASE WHEN 两处 + WHERE 两处），实际 ' + userIds.length)

    // 字符串参数里前 4 个是状态（其后还有 campus 等）
    const stringParams = listQuery.params.filter((p) => typeof p === 'string')
    assert.deepStrictEqual(
      stringParams.slice(0, 4),
      ['pending', 'accepted', 'finishing', 'disputed'],
      '大厅可见状态恰好是这四种（公开两种 + 交接阶段两种），实际参数序列 ' + JSON.stringify(stringParams)
    )
    // 历史订单绝不进大厅：当事人看历史走「我发布的/我接的单」tab（/errand/mine/* 全量）
    assert.ok(!stringParams.includes('cancelled'), 'cancelled 不得出现在大厅可见状态里')
    assert.ok(!stringParams.includes('finished'), 'finished 不得出现在大厅可见状态里')
  }, 'list(active)：参数配平且不含已取消/已完成')

  check(() => {
    // 大厅列表用的是显式列清单，绝不能出现 private_images / private_info（隐私图会漏给全体用户）
    assert.ok(!/private_images/.test(listQuery.sql), '大厅列表不得下发 private_images')
    assert.ok(!/private_info/.test(listQuery.sql), '大厅列表不得下发 private_info')
  }, 'list：大厅列清单不含任何隐私字段')

  // ---------- C. 静态：前端角色守卫 ----------
  const wxml = fs.readFileSync(path.join(ROOT, 'pages', 'errand-detail', 'index.wxml'), 'utf8')
  // 必须先剥掉整行注释再断言：注释里写出的代码片段（如「此前是空 catch」的举例）
  // 会被字符串匹配当成真代码，产生「改了反而失败」的假红
  const js = fs
    .readFileSync(path.join(ROOT, 'pages', 'errand-detail', 'index.js'), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  check(() => {
    assert.ok(
      /class="wait-banner"[^>]*order\.role !== 'viewer'/.test(wxml),
      'wait-banner 必须对 viewer 隐藏（否则第三方能看到「接单人已提交完成，已等待 xx」）'
    )
    assert.ok(
      /class="dispute-banner"[^>]*order\.role !== 'viewer'/.test(wxml),
      'dispute-banner 必须对 viewer 隐藏'
    )
  }, 'wxml：交接阶段横幅对 viewer 隐藏')

  check(() => {
    assert.ok(
      /showSubmitSheet && order\.role === 'publisher'/.test(wxml),
      '提交完成弹窗必须限定发单人（弹窗内含「确认已完成」按钮）'
    )
  }, 'wxml：提交完成弹窗限定发单人')

  check(() => {
    const open = functionBody(js, 'openSubmitSheet')
    assert.ok(open, '应能取到 openSubmitSheet 函数体（方法被改名时这里会失败）')
    assert.ok(/order\.role !== 'publisher'/.test(open), 'openSubmitSheet 必须有发单人守卫')

    const confirm = functionBody(js, 'onConfirmComplete')
    assert.ok(confirm, '应能取到 onConfirmComplete 函数体')
    assert.ok(/order\.role !== 'publisher'/.test(confirm), 'onConfirmComplete 必须有发单人守卫（图二的直接原因）')
  }, 'js：openSubmitSheet / onConfirmComplete 守卫在位')

  check(() => {
    assert.ok(
      /status === 'finished'\) bottomMode = role === 'viewer' \? '' : 'finished'/.test(js),
      '已完成状态也要判角色：viewer 不该看到「到手佣金 / 去评价」'
    )
    assert.ok(
      /\(status === 'accepted' \|\| status === 'finishing' \|\| status === 'disputed'\)[\s\S]{0,80}role === 'viewer'/.test(js),
      'viewer 点开待确认/有异议的订单也应走「已被接走」引导'
    )
  }, 'js：bottomMode 与「已被接走」引导覆盖交接阶段')

  check(() => {
    const confirmBody = functionBody(js, 'onConfirmComplete')
    assert.ok(
      /error\.requiresLogin/.test(confirmBody),
      '确认失败必须有可见反馈（401 由 utils/request 统一处理、其余给 toast）'
    )
    assert.ok(
      !/\.catch\(\(\) => \{\}\)/.test(confirmBody),
      '确认接口的 catch 不得为空 —— 后端 403「仅发单人可确认完成」会被静默吞掉，用户只觉得点了没反应'
    )
  }, 'js：确认失败有可见反馈')

  // ---------- D. 静态：仅当事人可见的两个入口（2026-10-01 订单记录 403） ----------
  check(() => {
    assert.ok(
      /class="row" bindtap="openLogs" wx:if="\{\{canViewLogs\}\}"/.test(wxml),
      '「订单记录 / 查看记录」行必须挂 canViewLogs：后端 /errand/:id/logs 仅参与双方可见，第三方点进来必然 403'
    )
    assert.ok(
      /class="contact spring-btn" bindtap="onContact"[^>]*wx:if="\{\{canContact\}\}"/.test(wxml),
      '联系按钮必须挂 canContact：第三方看别人的历史单会看到一个点了拿不到号码的假入口'
    )
  }, 'wxml：订单记录与联系入口按角色隐藏')

  check(() => {
    assert.ok(/canViewLogs: role !== 'viewer'/.test(js), 'canViewLogs 必须由角色推导，不得写死')
    assert.ok(
      /canContact: role === 'publisher' \|\| role === 'acceptor' \|\| status === 'pending'/.test(js),
      'canContact 要保留「待接单 + 浏览者」这条引导路径（onContact 会提示先接单），但不得放行其他状态的浏览者'
    )
    const logs = functionBody(js, 'openLogs')
    assert.ok(logs, '应能取到 openLogs 函数体（方法被改名时这里会失败）')
    assert.ok(/if \(!this\.data\.canViewLogs\) return/.test(logs), 'openLogs 必须有角色守卫，与后端 403 同口径')
    assert.ok(
      !/订单记录加载失败/.test(logs),
      'openLogs 不得再弹笼统文案：utils/request 已按服务端 message 弹过一次，' +
        '第二次 toast 会把「无权查看该订单记录」覆盖成「订单记录加载失败」，看起来像网络坏了'
    )
  }, 'js：openLogs 守卫与提示口径')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('errand order privacy tests failed:', err.message)
  process.exit(1)
})
