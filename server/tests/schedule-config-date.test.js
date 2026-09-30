// 课表「开始日期」校验回归：形状对但日历非法的日期（2026-02-30）不能让 MySQL 抛 500，
// 也不能被离线队列永久重发。
// 背景：线上 PUT /api/v1/schedule/config 累计 1671 次 500 / 695 次 200，
// 实测 ER_TRUNCATED_WRONG_VALUE 正是这类值造成的，而 flushScheduleConfig 失败不清队列 → 每次冷启动重打一次。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const schedule = require('../../utils/schedule')

// ===== A. 纯函数：isRealDate =====
;[
  ['2026-09-07', true],
  ['2026-02-29', false],           // 2026 非闰年
  ['2024-02-29', true],            // 2024 闰年
  ['2026-02-30', false],
  ['2026-13-01', false],
  ['2026-09-32', false],
  ['2026-09-00', false],
  ['2026-00-10', false],
  ['2026-9-7', false],             // 必须补零，与端上展示/服务端解析口径一致
  ['2026/09/07', false],
  ['', false],
  [null, false],
  [undefined, false]
].forEach(([value, expected]) => {
  assert.strictEqual(schedule.isRealDate(value), expected, 'isRealDate(' + JSON.stringify(value) + ') 应为 ' + expected)
})

// Date 顺延会吞掉非法日期，确认 parseLocalDate 确实不可当校验用（回归时别误信它）
assert.strictEqual(schedule.parseLocalDate('2026-02-30').getMonth(), 2, 'parseLocalDate 会把 2-30 顺延到 3 月，不能用于校验')

// ===== A2. 历史脏值自愈：legalizeStartDate =====
;[
  ['2026-09-07', '2026-09-07'],          // 合法值原样保留
  ['2026-02-30', '2026-03-02'],          // 顺延结果与端上显示一致，用户无感
  ['2026-13-01', '2027-01-01'],
  ['2026-9-7', '2026-09-07'],            // 未补零也顺手规整
  ['abc', schedule.DEFAULT_SEMESTER_START],
  ['', schedule.DEFAULT_SEMESTER_START],
  [null, schedule.DEFAULT_SEMESTER_START],
  [undefined, schedule.DEFAULT_SEMESTER_START]
].forEach(([value, expected]) => {
  assert.strictEqual(schedule.legalizeStartDate(value), expected, 'legalizeStartDate(' + JSON.stringify(value) + ')')
})
;['2026-02-30', '2026-13-01', 'abc', '2026-9-7'].forEach((value) => {
  const once = schedule.legalizeStartDate(value)
  assert.ok(schedule.isRealDate(once), '纠正结果必须是真实日期：' + value + ' -> ' + once)
  assert.strictEqual(schedule.legalizeStartDate(once), once, '纠正必须幂等：' + value)
})

// ===== B. 源码护栏：三处都必须改到 =====
const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scheduleController.js'), 'utf8')
const syncQueue = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'syncQueue.js'), 'utf8')
const schedulePage = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'schedule', 'index.js'), 'utf8')

// 服务端：updateConfig 在打库前校验，非法直接 400（fail 默认码）
const updateConfig = controller.slice(controller.indexOf('exports.updateConfig'))
assert.match(updateConfig, /if \(startDate && !isRealDate\(startDate\)\)/, '服务端必须先校验 startDate 再打库')
assert.ok(
  updateConfig.indexOf('isRealDate(startDate)') < updateConfig.indexOf('pool.query'),
  '校验必须早于任何 pool.query，否则仍是先 500 再返回'
)
assert.match(controller, /function isRealDate\(/, '服务端需要自己的 isRealDate（不能 require 端上工具）')
assert.match(controller.slice(0, controller.indexOf('exports.updateConfig')), /function isRealDate\(/, 'isRealDate 定义应在使用之前')

// 端上设置日期：用 isRealDate，不再只跑形状正则
assert.match(schedulePage, /scheduleUtils\.isRealDate\(res\.content\)/, '设置开始日期应校验真实日期')
assert.ok(
  !/\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(res\.content\)/.test(schedulePage),
  '设置弹窗不应再只用形状正则放行 2026-02-30'
)

// 离线队列：4xx 明确拒绝时清队列，避免每次冷启动重打一次坏 payload
const flush = syncQueue.slice(syncQueue.indexOf('async function flushScheduleConfig'))
assert.match(flush, /err\.statusCode >= 400 && err\.statusCode < 500/, '4xx 应丢弃队列内容')
assert.match(flush, /wx\.removeStorageSync\(SCHEDULE_QUEUE_KEY\)/, '丢弃队列要落到 removeStorageSync')
assert.match(flush, /throw err/, '清完仍要抛出，让调用方的 catch 生效')
assert.match(flush, /payload\.startDate = schedule\.legalizeStartDate\(payload\.startDate\)/, '发送前必须先自愈队列里的日期')
assert.ok(flush.indexOf('legalizeStartDate') < flush.indexOf('request.put'), '自愈必须早于发送，否则这一轮仍是坏值')

// app.js：本地配置里的历史脏值在冷启动时就纠正并回写，否则用户下次改任意一项都会重新入队坏值
const appJs = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8')
assert.match(appJs, /scheduleUtil\.legalizeStartDate\(this\.globalData\.scheduleConfig\.startDate\)/, 'app 启动需自愈本地 startDate')
assert.match(appJs, /wx\.setStorageSync\(['"]scheduleConfig['"]/, '纠正后要回写本地 storage')

// ===== C. bg_color 超长回归：渐变串（~45 字符）进 VARCHAR(16) 会 ER_DATA_TOO_LONG → 500，
// 5xx 不清离线队列，之后提醒开关 / 隐藏周末等所有配置保存全部跟着 500 =====
const migrations = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
const initSql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'init.sql'), 'utf8')
assert.match(updateConfig, /bgColor\.length <= 128/, '服务端必须钳制 bgColor 长度，超长回退默认色而不是 500')
assert.ok(!/bg_color` varchar\(16\)/.test(initSql), 'init.sql 的 bg_color 不得回退到 VARCHAR(16)')
assert.match(initSql, /`bg_color` varchar\(128\) DEFAULT '#F5F7FA'/, 'init.sql 的 bg_color 应为 VARCHAR(128)')
assert.ok(!/bg_color VARCHAR\(16\)/.test(migrations), 'migrations.js 的 bg_color 不得回退到 VARCHAR(16)')
assert.match(migrations, /bg_color VARCHAR\(128\)/, 'migrations.js 的 bg_color 应为 VARCHAR(128)')
assert.match(migrations, /MODIFY COLUMN bg_color VARCHAR\(128\)/, '存量部署要靠 MODIFY 补列宽（ensureColumn 不改已存在列的类型）')
assert.match(flush, /payload\.bgColor\s*=[\s\S]{0,120}length <= 128/, '离线队列发送前要自愈超长 bgColor')
assert.ok(flush.indexOf('payload.bgColor') < flush.indexOf('request.put'), 'bgColor 自愈必须早于发送')

console.log('Schedule config date validation test passed.')
