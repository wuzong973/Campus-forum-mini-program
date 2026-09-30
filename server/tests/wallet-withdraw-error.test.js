// 提现打款失败的可读性护栏。
// 背景：商户【运营账户】余额不足时，微信返回 HTTP 403 + NOT_ENOUGH，
// 旧实现把原始英文串直接透给后台（toast 一闪而过）并返回 502，
// 管理员看到"账户里有钱"却提不出来，完全不知道该做什么。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const pay = require('../services/wechatPayV3Service')

// ===== 1. 错误翻译：截图里的真实报错必须落到「运营账户余额不足」这一条 =====
const notEnough = new Error('WeChat Pay /v3/fund-app/mch-transfer/transfer-bills failed (HTTP 403) NOT_ENOUGH 商户运营账户资金不足，充值后可以原单号发起重试，请勿更换商户单号')
notEnough.wxCode = 'NOT_ENOUGH'
notEnough.wxMessage = '商户运营账户资金不足，充值后可以原单号发起重试，请勿更换商户单号'
notEnough.wxStatus = 403

const d1 = pay.describeTransferError(notEnough)
assert.strictEqual(d1.code, 'WITHDRAW_CHANNEL_NOT_ENOUGH')
assert.ok(d1.message.includes('运营账户'), '结论要点名运营账户')
// 指引必须给出可操作路径：充值/转入 页面 + 入款账户选运营账户 + 保持原单号
assert.ok(d1.hint.includes('充值/转入'), '指引必须包含商户平台充值/转入路径')
assert.ok(d1.hint.includes('入款账户'), '指引必须说明充值时要选「运营账户」')
assert.ok(d1.hint.includes('银行卡'), '指引必须说明运营账户只能用银行卡充值')
assert.ok(d1.hint.includes('原商户单号') || d1.hint.includes('原单号'), '指引必须提醒保持原单号重试')
// 反例护栏：不能再教管理员「把基本账户的钱划到运营账户」——
// 微信自 2022 年底已取消基本账户向运营账户的划转，运营账户只能银行卡充值（专款专用）
assert.ok(d1.hint.includes('不能互转'), '指引必须明确指出两个账户资金不能互转')
assert.ok(!d1.hint.includes('把基本账户资金划转'), '不允许再给出「基本账户划转运营账户」的错误指引')

// 只带中文 message（微信有时不给 code）也要能识别
const d1b = pay.describeTransferError(Object.assign(new Error('transfer failed'), { wxMessage: '商户运营账户资金不足' }))
assert.strictEqual(d1b.code, 'WITHDRAW_CHANNEL_NOT_ENOUGH')

// ===== 2. 其余分支：不能全部落到兜底 =====
const cases = [
  [{ wxCode: 'NO_AUTH', wxStatus: 403 }, 'WITHDRAW_CHANNEL_NO_AUTH'],
  [{ wxStatus: 403, wxCode: 'FORBIDDEN' }, 'WITHDRAW_CHANNEL_FORBIDDEN'],
  [{ wxCode: 'PARAM_ERROR', wxMessage: '转账场景未开通' }, 'WITHDRAW_CHANNEL_SCENE'],
  [{ wxCode: 'PARAM_ERROR', wxMessage: 'openid 与 appid 不匹配' }, 'WITHDRAW_USER_OPENID_INVALID'],
  [{ wxCode: 'FREQUENCY_LIMITED', wxMessage: '请求过于频繁' }, 'WITHDRAW_CHANNEL_RATE_LIMIT'],
  [{ wxCode: 'SYSTEM_ERROR', wxStatus: 500 }, 'WITHDRAW_CHANNEL_SYSTEM_ERROR'],
  [{ wxCode: 'NOT_FOUND', wxStatus: 404 }, 'WITHDRAW_CHANNEL_NOT_FOUND'],
]
for (const [raw, expected] of cases) {
  const described = pay.describeTransferError(Object.assign(new Error('x'), raw))
  assert.strictEqual(described.code, expected, `${JSON.stringify(raw)} 应映射为 ${expected}，实际 ${described.code}`)
}

// 兜底：未知错误也要带原始信息，便于转微信客服
const unknown = pay.describeTransferError(Object.assign(new Error('boom'), { wxCode: 'WEIRD', wxMessage: 'something odd' }))
assert.strictEqual(unknown.code, 'WITHDRAW_CHANNEL_ERROR')
assert.ok(unknown.hint.includes('something odd'), '兜底提示必须保留微信原始 message')

// 空错误不能抛异常
const empty = pay.describeTransferError(new Error(''))
assert.ok(empty.code && empty.message && empty.hint)

// 每条映射都必须是三字段齐全的非空字符串，前端 showModal 直接拼装
for (const described of [d1, d1b, unknown, empty, ...cases.map(([raw]) => pay.describeTransferError(Object.assign(new Error('x'), raw)))]) {
  for (const key of ['code', 'message', 'hint']) {
    assert.strictEqual(typeof described[key], 'string', `${described.code}.${key} 必须是字符串`)
    assert.ok(described[key].length > 0, `${described.code}.${key} 不能为空`)
  }
}

// ===== 3. 源码护栏：控制器与后台必须把原因讲清楚 =====
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
const controller = read('server/controllers/walletController.js')
const adminJs = read('pkg-admin/admin/index.js')
const adminWxml = read('pkg-admin/admin/index.wxml')
const adminApi = read('pkg-admin/utils/admin.js')
const authMw = read('server/middleware/auth.js')

// 3.1 审核失败：翻译原因 + 写 last_error + 422 + 结构化 data（不再是裸 502）
assert.ok(/wechat\.describeTransferError\(error\)/.test(controller), 'reviewWithdrawal 必须用 describeTransferError 翻译错误')
assert.ok(/last_error = \?/.test(controller), '失败原因必须落库到 last_error')
assert.ok(/fail\(res, described\.message, 422, \{ code: described\.code, hint: described\.hint \}\)/.test(controller), '必须返回 422 + { code, hint }')
assert.ok(!/fail\(res, safeMessage\(error\), 502\)/.test(controller), '不允许再把打款失败当成 502 网关错误返回')

// 3.2 失败后单据回到 PENDING，管理员才能重试（且沿用原 out_batch_no，符合微信要求）
assert.ok(/status = 'PENDING', last_error = \?/.test(controller), '失败后必须回到 PENDING 以便原单号重试')

// 3.3 列表要回传 lastError 供后台展示
assert.ok(/w\.last_error lastError/.test(controller), 'listWithdrawals 必须回传 lastError')

// 3.4 fail() 支持结构化 data，且默认值保持旧契约
assert.ok(/function fail\(res, message, code = 400, data = null\)/.test(authMw), 'fail 必须支持可选 data 且默认 null')

// 3.5 后台：失败弹窗展示原因 + 指引，且不再静默吞异常
assert.ok(/showModal\(\{ title: '打款失败'/.test(adminJs), '后台必须用 showModal 展示失败详情')
assert.ok(/detail\.hint/.test(adminJs), '后台弹窗必须展示处置指引')
assert.ok(!/reviewWithdrawal\(id, action\); wx\.showToast[\s\S]{0,120}\} catch \(e\) \{\}/.test(adminJs), '审核异常不允许被静默吞掉')
assert.ok(/silent: true/.test(adminJs), '审核请求应静默，避免 toast 与弹窗重复')

// 3.6 后台：列表展示失败原因并给「重试打款」入口
assert.ok(/lastErrorBrief/.test(adminJs), 'loadWithdrawals 需派生 lastErrorBrief 供列表展示')
assert.ok(/row-warn">上次打款失败/.test(adminWxml), '提现列表需展示上次失败原因')
assert.ok(/data-retry="1"/.test(adminWxml), '提现列表需提供重试打款入口')

// 3.7 api 层需支持把 opts（silent）透传给请求封装
assert.ok(/const post = \(path, data, opts\) => request\.post/.test(adminApi), 'admin api 的 post 需支持 opts')
assert.ok(/reviewWithdrawal: \(id, action, note, opts\)/.test(adminApi), 'reviewWithdrawal 需支持 opts')

console.log('Wallet withdrawal error tests passed.')
