/**
 * 订阅消息模板槽位全量对齐测试（无需数据库 / 无需网络）
 *
 * 需求：把表格中的 20 个模板按场景落入代码；前后端模板注册必须一一对应、
 * 服务端业务发送点全部挂到新模板、.env 全部填入真实 ID。
 *
 * 覆盖：
 *   A. 服务端 TPL_TYPES/TPL_CONFIG/MERGE_WINDOW_MS 结构（20 类型、envKey 与 .env 对应、合并窗口）
 *   B. .env 已填入全部非占位符模板 ID（与 TPL_CONFIG envKey 一一对应）
 *   C. 前端 utils/subscribe.js 与服务端 TPL_TYPES 完全对齐（触发组 keys 全部可申请授权）
 *   D. 业务发送点接线护栏（旧 pushActivity/pushErrand/pushInteract 零残留，新函数就位）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..', '..')
// F 段用 vm 加载小程序侧 utils/subscribe.js 时按这个名字取根目录；
// 此前它从未定义，整段在 ReferenceError 下没跑过（被未 await 的 run() 吞成 exit 0）
const MINI_PROGRAM_ROOT = ROOT
const SERVER = path.join(ROOT, 'server')

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
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

// vm 加载真实 subscribeService.js（axios 捕获发往微信的请求体；pool 按业务分支给额度/openid）
function loadSubscribeService(envMap, captured) {
  const poolStub = {
    query: async (sql) => {
      const text = String(sql)
      if (text.includes('user_subscribe_quota')) return [[{ tpl_type: 'x', remain: 5, total_granted: 5, total_sent: 0 }]]
      if (text.includes('sys_user')) return [[{ openid: 'openid-1', nick_name: '测试用户' }]]
      return [[], []]
    }
  }
  const sandbox = {
    axios: {
      post: async (url, body) => {
        captured.push(body)
        return { data: { errcode: 0 } }
      }
    },
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/config\/pool$/.test(norm)) return poolStub
      if (/wechatToken$/.test(norm)) return { getAccessToken: async () => 'test-token' }
      if (norm === 'axios') return sandbox.axios
      throw new Error('测试桩未覆盖的模块：' + modulePath)
    },
    process: { env: Object.assign({}, envMap) },
    console,
    Promise,
    setTimeout: (f) => f(),
    Date,
    module: { exports: {} },
    exports: {}
  }
  const source = require('fs').readFileSync(path.join(SERVER, 'services', 'subscribeService.js'), 'utf8')
  vm.runInNewContext(source, sandbox, { filename: 'services/subscribeService.js' })
  return sandbox.module.exports
}

function read(p) {
  return require('fs').readFileSync(path.join(ROOT, p), 'utf8')
}

async function run() {
  const EXPECTED_TYPES = [
    'commentNew', 'commentReply',
    'withdrawSuccess', 'withdrawResult',
    'activityNew', 'activityJoined', 'activitySignupNotice',
    'activityAudit', 'activitySignupResult', 'activityStart', 'activitySignup',
    'errandAccepted', 'errandFinished', 'errandCancelled',
    'auditCert', 'audit', 'auditPass',
    'message', 'userPmNotice', 'reportResult'
  ]

  // A. 服务端槽位结构（加载真实模块）
  const svc = loadSubscribeService({})
  check(() => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(svc.TPL_TYPES)).sort(), EXPECTED_TYPES.slice().sort(), 'TPL_TYPES 必须是 20 个具名模板类型（旧 activity/errand/interact 已废弃）')
  }, 'A1. 服务端 TPL_TYPES 为 20 个具名模板类型')

  // A2. TPL_CONFIG：envKey 与 .env 键对应、page/label 齐备
  check(() => {
    const src = read('server/services/subscribeService.js')
    // 落地页必须是 app.json 里真实注册的页面。2026-10-07 页面下沉到 pkg-feature 之后，
    // 「以 pages/ 开头」这条前缀判断把正常配置判成错；
    // 它真正该防的是「页面搬进分包后忘了同步订阅消息落地页」—— 用户点推送会跳到不存在的路径。
    const appJson = JSON.parse(read('app.json'))
    const registeredPages = new Set(appJson.pages || [])
    ;(appJson.subpackages || appJson.subPackages || []).forEach((sp) => {
      (sp.pages || []).forEach((pg) => registeredPages.add(sp.root + '/' + pg))
    })
    EXPECTED_TYPES.forEach((type) => {
      const re = new RegExp(type + ': \\{ envKey: \'(WX_TPL_[A-Z_]+)\', page: \'([^\']+)\', label: \'([^\']+)\' \\}')
      const m = src.match(re)
      assert.ok(m, 'TPL_CONFIG 缺少 ' + type + ' 配置')
      assert.ok(registeredPages.has(m[2]),
        type + ' 的落地页 ' + m[2] + ' 不在 app.json 注册页面里（页面下沉分包后必须同步改）')
    })
    assert.ok(!/WX_TPL_ACTIVITY'|WX_TPL_ERRAND'|WX_TPL_INTERACT'/.test(src), '旧三槽位 envKey 不得残留')
  }, 'A2. 每个类型都有 envKey/落地页/label，旧三槽位 envKey 零残留')

  // A3. 合并窗口：默认全部不合并（每条消息独立推送），仅三个高频模板可由环境变量恢复合并
  check(() => {
    const src = read('server/services/subscribeService.js')
    assert.ok(
      /const MERGE_WINDOW_TYPES = \['commentNew', 'commentReply', 'message'\]/.test(src),
      '仅 commentNew / commentReply / message 三个高频模板可参与合并'
    )
    assert.ok(src.indexOf('process.env.SUBSCRIBE_MERGE_WINDOW_MS') > -1, '合并窗口必须由环境变量 SUBSCRIBE_MERGE_WINDOW_MS 驱动')
    assert.ok(src.indexOf('if (!Number.isFinite(ms) || ms <= 0) return {}') > -1, '0 / 不设 / 非法值必须一律回退为「不合并」')
    assert.ok(!/commentNew: 5 \* 60 \* 1000/.test(src), '不得再硬编码 5 分钟合并窗口（已改为默认不合并）')
    assert.ok(!/errandAccepted: 5 \* 60/.test(src), '跑腿订单类不得合并')
    assert.ok(!/withdrawSuccess: 5 \* 60/.test(src), '资金类不得合并')
  }, 'A3. 合并窗口默认关闭（全模板不合并），仅三个高频模板可经环境变量恢复')

  // B. .env 全部填入真实模板 ID（与 TPL_CONFIG envKey 一一对应）
  check(() => {
    const envSrc = read('server/.env')
    const envKeys = {}
    envSrc.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^(WX_TPL_[A-Z_]+)=(.+)$/)
      if (m) envKeys[m[1]] = m[2].trim()
    })
    EXPECTED_TYPES.forEach((type) => {
      const cfgMatch = read('server/services/subscribeService.js').match(new RegExp(type + ': \\{ envKey: \'(WX_TPL_[A-Z_]+)\''))
      const envKey = cfgMatch[1]
      const value = envKeys[envKey]
      assert.ok(value, '.env 缺少 ' + envKey)
      assert.ok(!/请填入|^$/.test(value), envKey + ' 不得为空或占位符')
      assert.ok(value.length >= 40, envKey + ' 的值形似模板 ID（43 位随机串）')
    })
    assert.strictEqual(Object.keys(envKeys).length, EXPECTED_TYPES.length, '.env 的 WX_TPL_* 键数量与模板类型数一致')
  }, 'B. .env 已填入全部 18 个真实模板 ID 且与代码 envKey 一一对应')

  // C. 前端 subscribe.js 与服务端对齐：无占位符、触发组 keys 全部可申请授权
  check(() => {
    const feSrc = read('utils/subscribe.js')
    const beSrc = read('server/services/subscribeService.js')
    const beTypes = EXPECTED_TYPES
    // 触发组逐行提取
    const groupSubs = {}
    feSrc.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^  (postPublish|withdraw|activityIndex|activityPublish|activitySignup|riderVerify|errandPublish|message): \{ prefsKey: '([^']+)', keys: \[(.+?)\], grantedKeys: \[(.+?)\] \},?$/)
      if (m) groupSubs[m[1]] = m[3].split(',').map((s) => s.trim().replace(/'/g, ''))
    })
    assert.strictEqual(Object.keys(groupSubs).length, 8, '八组触发组定义齐备（含骑手认证与私信聊天）')
    const ids = []
    const idBlock = feSrc.match(/const TEMPLATE_IDS = \{([\s\S]*?)\n\}/)
    assert.ok(idBlock, 'TEMPLATE_IDS 块必须存在')
    ;[...idBlock[1].matchAll(/^  ([A-Za-z]+): '([^']+)'/gm)].forEach((m) => ids.push({ key: m[1], id: m[2] }))
    const idMap = {}
    ids.forEach(({ key, id }) => { idMap[key] = id })
    Object.keys(groupSubs).forEach((trigger) => {
      groupSubs[trigger].forEach((key) => {
        const id = idMap[key]
        assert.ok(id, '触发组 ' + trigger + ' 的 ' + key + ' 缺少 TEMPLATE_IDS')
        assert.ok(!/请填入/.test(id), key + ' 模板 ID 不得为占位符')
        assert.ok(new RegExp("VALID_TYPES = \\[[^\\]]*'" + key + "'").test(feSrc), key + ' 必须在 VALID_TYPES')
        assert.ok(beTypes.includes(key), key + ' 必须在服务端 TPL_TYPES（前后端对齐）')
      })
    })
  }, 'C. 前后端模板注册完全对齐（八组触发 keys 全部可申请授权且有服务端槽位）')

  // D. 业务发送点接线护栏
  check(() => {
    const notification = read('server/services/notificationService.js')
    assert.ok(notification.indexOf('pushComment') > -1, '评论/蹲贴必须走 pushComment')
    assert.ok(notification.indexOf('pushInteract') === -1, '旧 pushInteract 必须移除')
    const errand = read('server/controllers/errandController.js')
    assert.ok(errand.indexOf('pushErrandAccepted') > -1 && errand.indexOf('pushErrandFinished') > -1 && errand.indexOf('pushErrandCancelled') > -1, '跑腿按状态路由三个模板')
    assert.ok(errand.indexOf('pushErrand(') === -1, '旧 pushErrand 必须移除')
    const activity = read('server/controllers/activityController.js')
    assert.ok(activity.indexOf('pushActivitySignup') > -1, '报名成功通知走 activitySignup')
    assert.ok(/^\s*subscribeService\.pushActivityAudit\(/m.test(activity), '管理端活动审核必须以有效语句调用 activityAudit（不得被注释掉）')
    assert.ok(activity.indexOf('pushActivity(') === -1, '旧 pushActivity 必须移除')
    const message = read('server/controllers/messageController.js')
    assert.ok(message.indexOf('pushMessage') > -1, '私信走 pushMessage')
    assert.ok(message.indexOf('pushInteract') === -1, '旧 pushInteract 必须移除')
    const reminder = read('server/services/activityReminderService.js')
    assert.ok(reminder.indexOf('pushActivityStart') > -1, '活动开始提醒走 pushActivityStart（date 字段由便捷函数格式化）')
    const wallet = read('server/controllers/walletController.js')
    assert.ok(wallet.indexOf('pushWithdrawSuccess') > -1 && wallet.indexOf('pushWithdrawResult') > -1, '提现结果接入两模板')
    const admin = read('server/controllers/adminController.js')
    assert.ok(admin.indexOf('pushAuditPass') > -1 && admin.indexOf('pushAuditCert') > -1, '骑手认证审核结果必须下发订阅提醒（通过→pushAuditPass，驳回→pushAuditCert）')
  }, 'D. 七个业务发送点全部挂到新模板，旧函数零残留')

  // E. 字段映射实测（真实调用 push，抓取发往微信的 data，与表格「数据字段」列逐一比对）
  const captured = []
  const svcReal = loadSubscribeService({ WX_TPL_COMMENT_NEW: 'id-comment-new', WX_TPL_ERRAND_CANCELLED: 'id-errand-cancel', WX_TPL_WITHDRAW_SUCCESS: 'id-withdraw-ok' }, captured)
  const checkAsync = async (fn, message) => {
    await fn()
    testCount++
    console.log('PASS:', message)
  }
  await checkAsync(async () => {
    await svcReal.pushComment(1, { channelText: '校园论坛', postDigest: '帖子内容摘要', commentDigest: '评论内容', postId: 9 })
    await svcReal.pushErrandCancelled(1, { orderNo: 'NO123', orderName: '代拿快递', amountFen: 250, reason: '发单人取消', note: '备注', orderId: 9, summary: '订单已取消' })
    await svcReal.pushWithdrawSuccess(1, { orderNo: 'W9', amountFen: 250, note: '已到账' })
    assert.strictEqual(captured.length, 3, '三次发送均触达微信接口')
    const [comment, errand, withdraw] = captured
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(Object.keys(comment.data))).sort(),
      ['number8', 'thing17', 'thing2', 'thing6', 'time3'],
      'commentNew 字段须与表格一致'
    )
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(Object.keys(errand.data))).sort(),
      ['amount2', 'character_string1', 'thing14', 'thing4', 'thing9'],
      'errandCancelled 字段须与表格一致'
    )
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(Object.keys(withdraw.data))).sort(),
      ['amount2', 'thing1', 'thing5', 'time3', 'time4'],
      'withdrawSuccess 字段须与表格一致'
    )
    // 类型约束：number/amount 纯数字（amount 不得带「元」）
    assert.ok(/^\d+(\.\d{1,2})?$/.test(comment.data.number8.value), 'number8 必须纯数字')
    assert.ok(/^\d+(\.\d{1,2})?$/.test(errand.data.amount2.value), 'amount2 必须纯数字（分转元）')
    assert.strictEqual(errand.data.amount2.value, '2.50', '250 分 = 2.50 元')
    assert.strictEqual(withdraw.data.amount2.value, '2.50')
    assert.strictEqual(comment.data.thing2.value.indexOf('评论内容'), 0, 'thing2 承载评论内容摘要')
  }, 'E. 字段映射实测：data 字段编号与表格「数据字段」列一致、number/amount 纯数字')

  // F. shouldShowDialog 授权维度（真实模块）：偏好开启但未授权 → 仍弹窗（用户有完成授权的入口）
  await checkAsync(async () => {
    const seenStorage = {}
    const wxStub2 = {
      getStorageSync: (k) => seenStorage[k],
      setStorageSync: (k, v) => { seenStorage[k] = v },
      requestSubscribeMessage: (opt) => {
        const res = {}
        opt.tmplIds.forEach((id) => { res[id] = 'accept' })
        if (opt.success) opt.success(res)
      }
    }
    const sandbox2 = {
      wx: wxStub2,
      getApp: () => ({ globalData: {} }),
      require: (p2) => {
        const norm = String(p2).split('\\').join('/')
        if (/(^|\/)request$/.test(norm)) return { get: () => Promise.resolve(null), post: () => Promise.resolve(null), put: () => Promise.resolve(null) }
        throw new Error('unexpected require: ' + p2)
      },
      console, Promise, setTimeout: (f) => f(),
      module: { exports: {} }, exports: {}
    }
    const src2 = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    vm.runInNewContext(src2, sandbox2, { filename: 'utils/subscribe.js' })
    const sub2 = sandbox2.module.exports

    // 场景 1：偏好全开但从未授权（无 granted 键）→ 仍应弹窗（否则用户永远收不到推送）
    seenStorage['notify_channel_prefs'] = { withdrawSuccess: true, withdrawResult: true }
    const needDialog = sub2.shouldShowDialog('withdraw')
    assert.strictEqual(needDialog, true, '偏好全开但未授权 → 仍弹窗引导完成授权')

    // 场景 2：经 requestSubscribe 授权成功（granted 写入）→ 静默
    await sub2.requestSubscribe(['withdrawSuccess', 'withdrawResult']).then(() => {})
    // 授权成功后由业务页写偏好+granted（模拟）
    seenStorage['notify_channel_prefs'] = { withdrawSuccess: true, withdrawResult: true, grantedWithdrawSuccess: true, grantedWithdrawResult: true }
    assert.strictEqual(sub2.shouldShowDialog('withdraw'), false, '偏好全开且已授权 → 静默')

    // 场景 3：授权被拒（granted false）→ 仍弹窗给再次授权机会
    seenStorage['notify_channel_prefs'] = { withdrawSuccess: true, withdrawResult: true, grantedWithdrawSuccess: true, grantedWithdrawResult: false }
    assert.strictEqual(sub2.shouldShowDialog('withdraw'), true, '授权被拒 → 仍弹窗给再次授权机会')
  }, 'F. shouldShowDialog 双维度（偏好+授权）：全开且已授权才静默，否则弹窗给授权入口')
}

// run() 是 async：不 await 的话，断言失败只会变成 unhandled rejection，
// 而进程照样 exit(0) —— 这条护栏红了很久都没被 npm test 发现。
run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
