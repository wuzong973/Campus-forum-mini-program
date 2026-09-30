/**
 * 管理后台「订阅消息日志」接口护栏（无需数据库）
 *
 * 加载**真实** controllers/adminController.js，只顶掉外部依赖（pool / 各 service），
 * 直接调用 listSubscribeLogs 并检查：
 *   A. 路由已注册且权限正确、controller 有导出
 *   B. 「? 占位符个数 === 绑定参数个数」——本项目踩过这类错位（少传参数不报错，
 *      只是把 WHERE 的值错位到 OFFSET），必须在有筛选条件时也成立
 *   C. 返回结构含 list/total/page/hasMore/quota/pendingTotal，供管理端渲染
 */
const assert = require('assert')
const path = require('path')
const fs = require('fs')
const Module = require('module')

const SERVER = path.join(__dirname, '..')
const CONTROLLER = path.join(SERVER, 'controllers', 'adminController.js')

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

function injectModule(resolvedPath, exportsObj) {
  const m = new Module(resolvedPath, null)
  m.filename = resolvedPath
  m.loaded = true
  m.exports = exportsObj
  require.cache[resolvedPath] = m
}

function countPlaceholders(sql) {
  return (String(sql).match(/\?/g) || []).length
}

function loadController() {
  const queries = []
  const pool = {
    query(sql, params) {
      queries.push({ sql: String(sql), params: params || [] })
      const s = String(sql)
      // COUNT 查询返回一行 total
      if (/SELECT COUNT\(\*\) total/.test(s)) return Promise.resolve([[{ total: 3 }]])
      if (/FROM user_subscribe_quota/.test(s)) return Promise.resolve([[{ tplType: 'commentNew', users: 2, remain: 5, sent: 1 }]])
      if (/FROM subscribe_pending_message/.test(s)) return Promise.resolve([[{ total: 4 }]])
      return Promise.resolve([[{ id: 1, userId: 7, tplType: 'commentNew', status: 'sent' }]])
    }
  }
  injectModule(require.resolve(path.join(SERVER, 'config', 'pool.js')), pool)
  injectModule(require.resolve(path.join(SERVER, 'middleware', 'auth.js')), {
    success: (res, data) => { res.body = { code: 0, data } },
    fail: (res, message, status) => { res.body = { code: 1, message }; res.statusCode = status },
    permissionsFor: () => []
  })
  injectModule(require.resolve(path.join(SERVER, 'utils', 'helpers.js')), {
    clampPageSize: (value, max) => Math.min(Math.max(parseInt(value, 10) || 20, 1), max || 100),
    safeMessage: (e) => (e && e.message) || 'error'
  })
  injectModule(require.resolve(path.join(SERVER, 'utils', 'adminAudit.js')), { writeAdminAudit: () => {} })
  injectModule(require.resolve(path.join(SERVER, 'services', 'notificationService.js')), {
    createNotification: () => Promise.resolve(null), withMediaPlaceholder: (c) => c
  })
  injectModule(require.resolve(path.join(SERVER, 'services', 'subscribeService.js')), {
    pushAuditResult: () => Promise.resolve({ sent: false }), pushAuditPass: () => Promise.resolve({}), pushAuditCert: () => Promise.resolve({}),
    // adminController 用它给日志/额度行补中文标签
    labelOf: (tplType) => (tplType === 'commentNew' ? '新的评论提醒' : tplType)
  })
  injectModule(require.resolve(path.join(SERVER, 'controllers', 'paymentController.js')), {})

  delete require.cache[CONTROLLER]
  return { ctl: require(CONTROLLER), queries }
}

function makeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this } }
}

async function run() {
  // A. 路由 + 导出
  check(() => {
    const routes = fs.readFileSync(path.join(SERVER, 'routes', 'adminRoutes.js'), 'utf8')
    assert.ok(
      routes.indexOf("router.get('/subscribe-logs', requireAdmin('admin.manage'), controller.listSubscribeLogs)") > -1,
      "必须注册 GET /subscribe-logs（admin.manage 权限）"
    )
    const src = fs.readFileSync(CONTROLLER, 'utf8')
    assert.ok(/exports\.listSubscribeLogs = async/.test(src), 'adminController 必须导出 listSubscribeLogs')
    const api = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'utils', 'admin.js'), 'utf8')
    assert.ok(api.indexOf("subscribeLogs: (data) => get('/subscribe-logs', data)") > -1, '管理端 API 封装必须存在')
    // 「命中节流」上报链路：客户端 fire-and-forget → POST /subscribe/throttled → 写 status='throttled'
    const subRoutes = fs.readFileSync(path.join(SERVER, 'routes', 'subscribeRoutes.js'), 'utf8')
    assert.ok(
      subRoutes.indexOf("router.post('/throttled', auth, controller.throttled)") > -1,
      '必须注册 POST /subscribe/throttled（走 auth）'
    )
    const subCtl = fs.readFileSync(path.join(SERVER, 'controllers', 'subscribeController.js'), 'utf8')
    assert.ok(/exports\.throttled = async/.test(subCtl), 'subscribeController 必须导出 throttled')
    assert.ok(/logThrottleHit/.test(subCtl), 'throttled 必须调用 subscribeService.logThrottleHit')
  }, 'A. 路由注册 + controller 导出 + 管理端 API 封装齐备')

  // B. ? 占位符与绑定参数个数必须一致（有/无筛选条件都要成立）
  await checkAsync(async () => {
    const cases = [
      { name: '无筛选', query: {} },
      { name: '仅状态', query: { status: 'skipped' } },
      { name: '状态+模板', query: { status: 'failed', tplType: 'audit' } },
      { name: '关键词（文本）', query: { keyword: '小明' } },
      { name: '关键词（纯数字 id）', query: { keyword: '42' } },
      { name: '命中节流', query: { status: 'throttled' } },
      { name: '全条件+分页', query: { status: 'sent', tplType: 'message', keyword: '7', page: '3', pageSize: '10' } }
    ]
    for (const c of cases) {
      const { ctl, queries } = loadController()
      const res = makeRes()
      await ctl.listSubscribeLogs({ query: c.query }, res)
      assert.ok(res.body && res.body.code === 0, c.name + '：应返回成功')
      queries.forEach((q) => {
        const holes = countPlaceholders(q.sql)
        assert.strictEqual(
          holes, q.params.length,
          c.name + '：占位符 ' + holes + ' 个但绑定 ' + q.params.length + ' 个参数 → ' + q.sql.slice(0, 90)
        )
      })
      // 分页参数必须真的传进 LIMIT/OFFSET
      const listQuery = queries.find((q) => /ORDER BY l\.id DESC LIMIT \? OFFSET \?/.test(q.sql))
      assert.ok(listQuery, c.name + '：应有带 LIMIT/OFFSET 的列表查询')
      assert.strictEqual(listQuery.params.length >= 2, true)
    }
  }, 'B. 六种筛选组合下「? 个数 === 参数个数」且分页参数到位')

  // C. 返回结构
  await checkAsync(async () => {
    const { ctl } = loadController()
    const res = makeRes()
    await ctl.listSubscribeLogs({ query: { page: '2', pageSize: '20' } }, res)
    const d = res.body.data
    assert.ok(Array.isArray(d.list), '必须返回 list')
    assert.strictEqual(typeof d.total, 'number', '必须返回 total')
    assert.strictEqual(d.page, 2, '必须回显 page')
    assert.strictEqual(typeof d.hasMore, 'boolean', '必须返回 hasMore')
    assert.ok(Array.isArray(d.quota), '必须返回额度概览 quota')
    assert.strictEqual(typeof d.pendingTotal, 'number', '必须返回待补发条数 pendingTotal')
    // 中文标签必须随行下发（管理后台不再显示英文模板键）
    assert.strictEqual(d.list[0].tplLabel, '新的评论提醒', '日志行必须带中文 tplLabel')
    assert.strictEqual(d.quota[0].label, '新的评论提醒', '额度行必须带中文 label')
  }, 'C. 返回结构齐备（list/total/page/hasMore/quota/pendingTotal + 中文标签）')

  // D. 中文标签护栏：模板全有中文 label，服务端导出 labelOf，管理端展示中文
  check(() => {
    const src = fs.readFileSync(path.join(SERVER, 'services', 'subscribeService.js'), 'utf8')
    const cfg = src.match(/const TPL_CONFIG = \{([\s\S]*?)\n\}/)[1]
    const lines = cfg.split('\n').filter((line) => /envKey:/.test(line))
    assert.strictEqual(lines.length, 20, '模板应为 20 个')
    lines.forEach((line) => {
      const m = line.match(/label: '([^']+)'/)
      assert.ok(m, '每个模板都要有 label：' + line.trim().slice(0, 48))
      assert.ok(/[\u4e00-\u9fa5]/.test(m[1]), 'label 必须是中文，不能是英文键名：' + m[1])
    })
    assert.ok(/function labelOf\(/.test(src), 'subscribeService 必须提供 labelOf（中文标签唯一真源）')
    assert.ok(/module\.exports = \{[\s\S]*?\n  labelOf,/.test(src), 'labelOf 必须在 module.exports 中导出')

    const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('{{item.tplLabel}}') > -1, '日志卡片标题必须显示中文 tplLabel')
    assert.ok(wxml.indexOf('{{item.label}}') > -1, '额度看板必须显示中文 label')
    assert.ok(wxml.indexOf('{{item.quotaText}}') > -1, '额度统计文案由 JS 拼装（含服务端未升级时的降级）')
    assert.ok(wxml.indexOf('{{item.errcodeHint}}') > -1, '失败日志必须显示错误码的中文解释')
    assert.ok(!/\{\{item\.tplType\}\}：/.test(wxml), '额度看板不应再以英文模板键开头')
    // 「额度不足」与「发送失败」是两个完全不同的状态，面板必须写清楚，
    // 否则客服会误以为「发送失败 = 用户没额度了」。
    assert.ok(
      /额度不足[^。]*压根没调用微信/.test(wxml),
      '面板必须点明「额度不足 = 没调用微信」'
    )
    assert.ok(
      /发送失败[^。]*与额度无关/.test(wxml),
      '面板必须点明「发送失败 = 与额度无关」'
    )
  }, 'D. 20 个模板全有中文 label + labelOf 导出 + 管理端展示中文')

  // E. 时间必须按本地时区渲染。
  // 曾写成 String(row.createdAt).replace('T',' ').slice(0,19) —— 直接切 ISO 字符串，
  // 显示的是 UTC，比北京时间少 8 小时，排障时会误判失败发生的时间。
  check(() => {
    const js = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.js'), 'utf8')
    assert.ok(/function fmtDateTime\(/.test(js), 'fmtDateTime（本地时区格式化）必须存在')
    assert.ok(
      /timeText: fmtDateTime\(row\.createdAt\)/.test(js),
      '订阅日志时间必须走 fmtDateTime，不能直接切 ISO 字符串'
    )
    assert.ok(
      !/replace\('T', ' '\)\.slice\(0, 19\)/.test(js),
      '不得再用 slice 截 ISO 字符串（那是 UTC 时间）'
    )
  }, 'E. 订阅日志时间按本地时区渲染（不得显示 UTC）')

  // F. status 白名单必须包含 throttled，且枚举已扩展
  check(() => {
    const src = fs.readFileSync(CONTROLLER, 'utf8')
    assert.ok(
      /\['sent', 'merged', 'skipped', 'failed', 'throttled'\]\.includes\(status\)/.test(src),
      "status 白名单必须含 'throttled' —— 漏了会让「命中节流」筛选静默返回全部记录"
    )
    const initSql = fs.readFileSync(path.join(SERVER, 'sql', 'init.sql'), 'utf8')
    assert.ok(
      /enum\('sent','merged','skipped','failed','throttled'\)/.test(initSql),
      'init.sql 的 status 枚举必须含 throttled'
    )
    const migrations = fs.readFileSync(path.join(SERVER, 'utils', 'migrations.js'), 'utf8')
    assert.ok(
      /MODIFY COLUMN status ENUM\('sent','merged','skipped','failed','throttled'\)/.test(migrations),
      'migrations.js 必须把已有库的 status 枚举扩到 throttled（否则写入被截断成空串）'
    )
  }, 'F. status 白名单与数据库枚举都含 throttled')

  // G. 管理后台「命中节流」筛选与文案齐备
  check(() => {
    const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.wxml'), 'utf8')
    const js = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.js'), 'utf8')
    assert.ok(
      /data-status="throttled"[^>]*>命中节流</.test(wxml),
      '筛选栏必须有「命中节流」按钮（排在最后）'
    )
    assert.ok(
      wxml.indexOf('发送失败</view>') < wxml.indexOf('命中节流</view>'),
      '「命中节流」必须排在「发送失败」右边'
    )
    assert.ok(/throttled: '命中节流'/.test(js), '状态文案必须为「命中节流」')
    assert.ok(/throttled: '命中弹窗节流/.test(js), '必须有 throttled 的状态说明')
    // 角标：wxml 里把 throttled 映射到 st-throttled 类，wxss 里给出独立配色
    assert.ok(
      /\? 'throttled' : 'cancelled'/.test(wxml),
      'wxml 必须把 throttled 映射到独立角标类（否则会落到灰色 cancelled）'
    )
    const wxss = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.wxss'), 'utf8')
    assert.ok(/\.st-throttled\s*\{/.test(wxss), 'wxss 必须定义 .st-throttled 配色')
  }, 'G. 管理后台「命中节流」筛选按钮与文案齐备')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
