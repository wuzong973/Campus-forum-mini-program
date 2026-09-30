/**
 * 订阅授权弹窗「触发节流层」回归测试（无需数据库 / 无需网络）
 *
 * 需求：8 个触发组，同一组在**用户未勾选「总是允许」**时，一天最多弹 3 次原生授权弹窗，
 * 用满后当天不再弹。
 *
 * 覆盖：
 *   A. 未勾选总是允许 → 一天最多 3 次；第 4 次不调用微信并返回 throttled
 *   A2. 存储结构（键名 / day 字段 / 按组计数）——设计要点 1
 *   B. 跨天惰性重置（改掉存储里的 day 即视为新的一天）——设计要点 2
 *   C. 勾选「总是允许」→ 跳过节流，仍照常调用（每次静默 +1 额度）——设计要点 3
 *   C2.「总是拒绝」不算「总是允许」→ 仍受节流
 *   D. 组间计数互不影响
 *   E. 顶部入口 requestEntryByTap 不受节流（用户主动点击不能被拦成「点了没反应」）
 *   F. 缓存里的键消失（用户取消总是选择）→ 恢复节流
 *   G. 同步连点 5 次只调用 3 次（计数在调用前 +1，不会超限）
 *   H. 未知触发组不计数
 *   I. setStorageSync 抛错 → 退化为不节流，不阻塞业务
 *   J. getSetting 失败 → refresh 返回 null 且不破坏已有缓存
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const SUBSCRIBE_PATH = path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js')

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
async function checkAsync(fn, message) {
  await fn()
  testCount++
  console.log('PASS:', message)
}

setTimeout(() => {
  fs.writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 10000)

function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/**
 * 在 vm 沙箱里加载真实的 utils/subscribe.js，只顶掉 wx 与 ./request。
 * @param {Object} [behavior] 可变对象，测试中途可改（如让 setStorageSync 开始抛错）
 */
function loadSubscribe(behavior) {
  const b = behavior || {}
  const storage = {}
  const calls = { wechat: [], setting: 0, posts: [] }
  const wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : ''),
    setStorageSync: (k, v) => {
      // 只让「节流计数」这一个键写失败，用于验证节流层的降级行为
      // （其它键写失败是另一类问题，不在本测试范围内）
      if (b.setStorageThrows && k === 'subscribe_popup_throttle') throw new Error('storage limit exceeded')
      storage[k] = v
    },
    requestSubscribeMessage: (opt) => {
      calls.wechat.push(opt.tmplIds.slice())
      if (b.subscribeFail) { if (opt.fail) opt.fail({ errMsg: b.subscribeFail }); return }
      const res = {}
      opt.tmplIds.forEach((id) => { res[id] = b.result || 'accept' })
      if (opt.success) opt.success(res)
    },
    getSetting: (opt) => {
      calls.setting++
      if (b.getSettingFails) { if (opt.fail) opt.fail({ errMsg: 'getSetting:fail' }); return }
      if (opt.success) {
        opt.success({ subscriptionsSetting: { mainSwitch: true, itemSettings: Object.assign({}, b.itemSettings || {}) } })
      }
    }
  }
  const sandbox = {
    wx,
    getApp: () => ({ globalData: {} }),
    require: (p) => {
      const norm = String(p).split('\\').join('/')
      if (/(^|\/)request$/.test(norm)) {
        return {
          get: () => Promise.resolve(null),
          post: (url, data, needAuth, opts) => {
            calls.posts.push({ url, data, needAuth, opts })
            return b.postFails ? Promise.reject(new Error('network')) : Promise.resolve(null)
          },
          put: () => Promise.resolve(null)
        }
      }
      throw new Error('unexpected require: ' + p)
    },
    console, Promise, setTimeout: (f) => f(),
    module: { exports: {} }, exports: {}
  }
  vm.runInNewContext(fs.readFileSync(SUBSCRIBE_PATH, 'utf8'), sandbox, { filename: 'utils/subscribe.js' })
  return { sub: sandbox.module.exports, storage, calls, b }
}

// 触发组 → 组内模板 ID（用于断言微信侧收到的 tmplIds）
function idsOf(sub, trigger) {
  return sub.TRIGGER_GROUPS[trigger].keys.map((k) => sub.TEMPLATE_IDS[k])
}

/**
 * 模拟微信侧的「总是」选择状态。
 * ⚠️ 真实 `subscriptionsSetting.itemSettings` 是**以模板 ID（长串）为键**，不是模板类型名。
 */
function setAlwaysChoice(handle, types, state) {
  const map = {}
  types.forEach((t) => { map[handle.sub.TEMPLATE_IDS[t]] = state })
  handle.b.itemSettings = map
}

async function run() {
  // ---------- A / A2 / B：节流生效与存储结构 ----------
  {
    const { sub, storage, calls, b } = loadSubscribe()
    await checkAsync(async () => {
      // 未勾选总是允许（itemSettings 为空）
      for (let i = 1; i <= 3; i++) {
        const res = await sub.requestTriggerByTap('postPublish')
        assert.strictEqual(res.throttled, undefined, '第 ' + i + ' 次不该被节流')
      }
      assert.strictEqual(calls.wechat.length, 3, '前 3 次应真的调用微信')
      const res4 = await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 3, '第 4 次不得再调用微信')
      assert.strictEqual(res4.throttled, true, '第 4 次应返回 throttled')
      assert.strictEqual(res4.used, 3)
      assert.strictEqual(res4.limit, 3)
      // 第 5、6 次同样不调用
      await sub.requestTriggerByTap('postPublish')
      await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 3, '当天后续调用一律不再弹')
    }, 'A. 未勾选「总是允许」→ 一天最多弹 3 次，之后不再调用微信')

    check(() => {
      const raw = storage['subscribe_popup_throttle']
      assert.ok(raw && typeof raw === 'object', '必须写入 subscribe_popup_throttle')
      assert.strictEqual(raw.day, todayKey(), 'day 必须是本地自然日 YYYY-MM-DD')
      assert.strictEqual(raw.groups.postPublish, 3, '计数按触发组维度存')
      assert.deepStrictEqual(Object.keys(raw.groups), ['postPublish'], '只记被触发过的组')
    }, 'A2. 存储结构：{ day: 本地日期, groups: { 触发组: 次数 } }')

    await checkAsync(async () => {
      // 把 day 改成昨天 → 下一次触发应重新计数
      storage['subscribe_popup_throttle'] = { day: '2000-01-01', groups: { postPublish: 3 } }
      const res = await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(res.throttled, undefined, '跨天后应重置，不该被节流')
      assert.strictEqual(calls.wechat.length, 4, '跨天后应重新调用微信')
      assert.strictEqual(storage['subscribe_popup_throttle'].day, todayKey(), '重置时应写入今天的 day')
      assert.strictEqual(storage['subscribe_popup_throttle'].groups.postPublish, 1, '计数从 1 重新开始')
    }, 'B. 跨天惰性重置（day 不匹配即清零）')

    // 顺带验证 b 未使用（避免误报）
    assert.ok(!b.setStorageThrows)
  }

  // ---------- C / C2：勾选「总是允许」的行为差异 ----------
  {
    const h = loadSubscribe()
    const { sub, calls } = h
    await checkAsync(async () => {
      setAlwaysChoice(h, ['commentNew', 'commentReply'], 'accept')
      await sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(sub.hasAlwaysAllow('postPublish'), true, '组内模板全为 accept → 视为已勾选总是允许')
      assert.strictEqual(sub.getThrottleState('postPublish').alwaysAllow, true)
      // 连调 5 次，全部应真的调用微信（不计数、不受 3 次限制）
      for (let i = 1; i <= 5; i++) await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 5, '勾选总是允许后跳过节流，每次仍调用微信以继续攒额度')
      assert.strictEqual(sub.getThrottleState('postPublish').used, 0, '跳过节流时不写计数')
    }, 'C. 勾选「总是允许」→ 跳过节流（仍调用微信，每次静默 +1 额度）')

    await checkAsync(async () => {
      // 组内只有部分模板是 accept → 不算「已勾选总是允许」
      const partial = loadSubscribe()
      setAlwaysChoice(partial, ['commentNew'], 'accept')
      await partial.sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(partial.sub.hasAlwaysAllow('postPublish'), false, '组内必须全部 accept 才算')
    }, 'C1. 组内只有部分模板 accept → 不算已勾选总是允许')

    await checkAsync(async () => {
      const rejected = loadSubscribe()
      setAlwaysChoice(rejected, ['commentNew', 'commentReply'], 'reject')
      await rejected.sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(rejected.sub.hasAlwaysAllow('postPublish'), false, '总是拒绝 ≠ 总是允许')
      for (let i = 1; i <= 4; i++) await rejected.sub.requestTriggerByTap('postPublish')
      assert.strictEqual(rejected.calls.wechat.length, 3, '「总是拒绝」仍受节流限制')
    }, 'C2.「总是拒绝」不算「总是允许」→ 仍受节流')
  }

  // ---------- D：组间独立 ----------
  {
    const { sub, calls } = loadSubscribe()
    await checkAsync(async () => {
      for (let i = 1; i <= 4; i++) await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 3, 'postPublish 用满 3 次')
      assert.strictEqual(sub.getThrottleState('errandPublish').used, 0, '其它组不受影响')
      await sub.requestTriggerByTap('errandPublish')
      assert.strictEqual(calls.wechat.length, 4, 'errandPublish 第 1 次仍能弹')
      assert.strictEqual(sub.getThrottleState('postPublish').used, 3)
      assert.strictEqual(sub.getThrottleState('errandPublish').used, 1)
    }, 'D. 节流按触发组独立计数')
  }

  // ---------- E：顶部入口不受节流 ----------
  {
    const { sub, calls } = loadSubscribe()
    await checkAsync(async () => {
      for (let i = 1; i <= 4; i++) await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 3, '业务触发已用满')
      await sub.requestEntryByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 4, '顶部入口是用户主动点击，不受节流（否则会「点了没反应」）')
      assert.deepStrictEqual(calls.wechat[3], idsOf(sub, 'postPublish'), '入口申请的是该组模板')
    }, 'E. requestEntryByTap（顶部入口）不受节流限制')
  }

  // ---------- F：缓存撤销后恢复节流 ----------
  {
    const h = loadSubscribe()
    const { sub, calls } = h
    await checkAsync(async () => {
      setAlwaysChoice(h, ['commentNew', 'commentReply'], 'accept')
      await sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(sub.hasAlwaysAllow('postPublish'), true)
      for (let i = 1; i <= 4; i++) await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 4, '跳过节流时不限次数')

      // 用户在设置页改回「每次询问」→ itemSettings 里键消失
      h.b.itemSettings = {}
      await sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(sub.hasAlwaysAllow('postPublish'), false, '键消失必须清掉缓存，否则会永久跳过节流')
      for (let i = 1; i <= 4; i++) await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 7, '恢复节流后只再弹 3 次')
    }, 'F. 取消「总是允许」→ 缓存被清掉并恢复节流')
  }

  // ---------- G：同步连点不超限 ----------
  {
    const { sub, calls } = loadSubscribe()
    await checkAsync(async () => {
      // 不 await，模拟用户快速连点（计数在调用前 +1，因此不会因为并发而超限）
      const pending = []
      for (let i = 0; i < 5; i++) pending.push(sub.requestTriggerByTap('postPublish'))
      const results = await Promise.all(pending)
      assert.strictEqual(calls.wechat.length, 3, '同步连点 5 次只调用 3 次微信')
      assert.strictEqual(results.filter((r) => r.throttled).length, 2, '超出的 2 次返回 throttled')
    }, 'G. 同步连点 5 次 → 只调用 3 次微信（计数在调用前 +1）')
  }

  // ---------- H：未知触发组不计数 ----------
  {
    const { sub, calls } = loadSubscribe()
    await checkAsync(async () => {
      const res = await sub.requestTriggerByTap('notARealTrigger')
      assert.strictEqual(calls.wechat.length, 0)
      assert.strictEqual(res.failed, false)
      assert.strictEqual(sub.getThrottleState('notARealTrigger').used, 0, '未知组不得产生计数')
    }, 'H. 未知触发组（无模板）不调用微信也不计数')
  }

  // ---------- I：存储异常退化为不节流 ----------
  {
    const b = { setStorageThrows: true }
    const { sub, calls } = loadSubscribe(b)
    await checkAsync(async () => {
      for (let i = 1; i <= 5; i++) await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.wechat.length, 5, '存储写失败时退化为不节流，绝不阻塞业务')
    }, 'I. setStorageSync 抛错 → 退化为不节流（不阻塞业务）')
  }

  // ---------- J：getSetting 失败不破坏已有缓存 ----------
  {
    const h = loadSubscribe()
    const { sub } = h
    await checkAsync(async () => {
      setAlwaysChoice(h, ['commentNew', 'commentReply'], 'accept')
      await sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(sub.hasAlwaysAllow('postPublish'), true)
      h.b.getSettingFails = true
      const cache = await sub.refreshAlwaysChoice(['commentNew', 'commentReply'])
      assert.strictEqual(cache, null, 'getSetting 失败应 resolve(null)')
      assert.strictEqual(sub.hasAlwaysAllow('postPublish'), true, '失败时保留旧缓存，不清空')
    }, 'J. getSetting 失败 → 返回 null 且保留旧缓存')
  }

  // ---------- K：命中节流时上报日志 ----------
  {
    const { sub, calls } = loadSubscribe()
    await checkAsync(async () => {
      for (let i = 1; i <= 4; i++) await sub.requestTriggerByTap('postPublish')
      const hits = calls.posts.filter((p) => p.url === '/subscribe/throttled')
      assert.strictEqual(hits.length, 1, '第 4 次命中节流时应上报一条日志（前 3 次不报）')
      const payload = hits[0].data
      assert.strictEqual(payload.tplType, 'commentNew', 'tpl_type 取组内首个模板类型（服务端只认模板类型）')
      assert.strictEqual(payload.triggerLabel, '评论通知', '带上渠道文案，后台直接可读')
      assert.strictEqual(payload.used, 3)
      assert.strictEqual(payload.limit, 3)
      assert.strictEqual(hits[0].needAuth, true, '接口走 auth，必须带登录态')
      assert.strictEqual(hits[0].opts.silent, true, '静默上报，不能弹 loading 打扰用户')

      // 再命中几次 → 每次都上报（与 skipped 一样按次记录，便于看频率）
      await sub.requestTriggerByTap('postPublish')
      await sub.requestTriggerByTap('postPublish')
      assert.strictEqual(calls.posts.filter((p) => p.url === '/subscribe/throttled').length, 3)
    }, 'K. 命中节流时上报 /subscribe/throttled（含模板类型、渠道文案、次数）')

    await checkAsync(async () => {
      // 上报失败绝不能影响节流判定本身
      const failing = loadSubscribe({ postFails: true })
      for (let i = 1; i <= 4; i++) await failing.sub.requestTriggerByTap('postPublish')
      assert.strictEqual(failing.calls.wechat.length, 3, '上报失败不影响「前 3 次调用微信」')
      const res = await failing.sub.requestTriggerByTap('postPublish')
      assert.strictEqual(res.throttled, true, '上报失败不影响节流判定')
      assert.strictEqual(failing.calls.wechat.length, 3, '仍然不再调用微信')
    }, 'K2. 上报失败不影响节流判定（fire-and-forget）')
  }
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
