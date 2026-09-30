// 作息表口径回归：课表节次时间必须与官方教务系统课表一致（2026-09 教务课表页实测）
// 覆盖：前端唯一口径 utils/schedule.js、课表页布局、教务同步服务与 OCR 解析的后端节次表。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const schedule = require('../../utils/schedule')

// 官方教务系统按「两节一行」展示，节次对时间如下
const OFFICIAL_ROWS = [
  { label: '1-2节', startTime: '08:30', endTime: '09:55', period: '上午' },
  { label: '3-4节', startTime: '10:15', endTime: '11:40', period: '上午' },
  { label: '5-6节', startTime: '14:00', endTime: '15:25', period: '下午' },
  { label: '7-8节', startTime: '15:45', endTime: '17:10', period: '下午' },
  { label: '9-10节', startTime: '18:30', endTime: '19:55', period: '晚上' },
  { label: '11-12节', startTime: '20:00', endTime: '21:25', period: '晚上' },
]

assert.strictEqual(schedule.CLASS_ROWS.length, OFFICIAL_ROWS.length, '节次对行数应为 6')
schedule.CLASS_ROWS.forEach((row, i) => {
  const want = OFFICIAL_ROWS[i]
  assert.strictEqual(row.label, want.label, '第 ' + (i + 1) + ' 行标签应为 ' + want.label)
  assert.strictEqual(row.startTime, want.startTime, want.label + ' 上课时间应为 ' + want.startTime)
  assert.strictEqual(row.endTime, want.endTime, want.label + ' 下课时间应为 ' + want.endTime)
  assert.strictEqual(row.period, want.period, want.label + ' 午别应为 ' + want.period)
})

// 教务同步落库的真实时间必须落在正确的节次行（此前整体下移了两节）
const REAL_TIMES = [
  ['08:30', '09:55', 0, 1],
  ['10:15', '11:40', 1, 1],
  ['14:00', '15:25', 2, 1],
  ['15:45', '17:10', 3, 1],
  ['18:30', '19:55', 4, 1],
  ['20:00', '21:25', 5, 1],
  ['14:00', '17:10', 2, 2],
]
REAL_TIMES.forEach(([startTime, endTime, rowIndex, rowSpan]) => {
  const slot = schedule.resolveCourseSlot({ startTime, endTime })
  assert.strictEqual(slot.rowIndex, rowIndex, startTime + '-' + endTime + ' 应落在第 ' + (rowIndex + 1) + ' 行')
  assert.strictEqual(slot.rowSpan, rowSpan, startTime + '-' + endTime + ' 应占 ' + rowSpan + ' 行')
})

// 午别判定与节次行同口径
assert.strictEqual(schedule.getDayPeriod('08:30'), '上午')
assert.strictEqual(schedule.getDayPeriod('14:00'), '下午')
assert.strictEqual(schedule.getDayPeriod('15:45'), '下午')
assert.strictEqual(schedule.getDayPeriod('18:30'), '晚上')
assert.strictEqual(schedule.getDayPeriod('20:00'), '晚上')

// 单节拆分自洽：每节 40 分钟，节次对内休息 5 分钟
const toMin = (t) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1])
schedule.CLASS_PERIODS.forEach((p, i) => {
  assert.strictEqual(toMin(p.endTime) - toMin(p.startTime), 40, '第 ' + p.section + ' 节应为 40 分钟')
  if (i % 2 === 0) {
    const next = schedule.CLASS_PERIODS[i + 1]
    assert.strictEqual(toMin(next.startTime) - toMin(p.endTime), 5, '第 ' + p.section + '、' + next.section + ' 小节间应为 5 分钟')
  }
})

// 课表页不再残留旧的错误节次表（午休 11:45 / 早读 / 19:30-20:10 晚课）
const pageSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'schedule', 'index.js'), 'utf8')
assert.ok(!pageSrc.includes('11:45-12:25'), '课表页不应再有 11:45-12:25 的午休节次')
assert.ok(!pageSrc.includes('19:30-20:10'), '课表页不应再有 19:30-20:10 的晚课节次')
assert.ok(!/const SECTIONS = \[/.test(pageSrc), '课表页应改用 utils/schedule.js 的节次口径')
assert.ok(pageSrc.includes('scheduleUtils.CLASS_ROWS'), '课表页应引用统一节次口径')
assert.ok(pageSrc.includes('resolveCourseSlot'), '课程落位应走 resolveCourseSlot')

// 录入页节次模板同样取自统一口径
const addSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-add', 'index.js'), 'utf8')
assert.ok(addSrc.includes('scheduleUtils.CLASS_ROWS'), '录入页节次模板应复用 CLASS_ROWS')
assert.ok(!addSrc.includes(chr(39) + '11:45' + chr(39)), '录入页不应再提供 11:45 的旧节次模板')

function chr(code) {
  return String.fromCharCode(code)
}

// 后端 OCR 节次表与同步服务兜底节次表都要与前端一致
function parseSectionTime(source, quote) {
  const block = source.match(/const SECTION_TIME = \{([\s\S]*?)\n\}/)
  assert.ok(block, '未找到后端 SECTION_TIME 表')
  const map = {}
  const re = new RegExp('(\\d+):\\s*\\[' + quote + '(\\d\\d:\\d\\d)' + quote + ',\\s*' + quote + '(\\d\\d:\\d\\d)' + quote, 'g')
  let m
  while ((m = re.exec(block[1]))) map[m[1]] = [m[2], m[3]]
  return map
}

const ctrlSrc = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scheduleController.js'), 'utf8')
const svcSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'jwScheduleSyncService.js'), 'utf8')
const backendTables = [
  ['scheduleController.js', parseSectionTime(ctrlSrc, chr(39))],
  ['jwScheduleSyncService.js', parseSectionTime(svcSrc, chr(34))],
]
backendTables.forEach(([name, map]) => {
  assert.strictEqual(Object.keys(map).length, schedule.CLASS_PERIODS.length, name + ' 节次数应为 ' + schedule.CLASS_PERIODS.length)
  schedule.CLASS_PERIODS.forEach((p) => {
    assert.ok(map[p.section], name + ' 缺少第 ' + p.section + ' 节')
    assert.strictEqual(map[p.section][0], p.startTime, name + ' 第 ' + p.section + ' 节上课时间应为 ' + p.startTime)
    assert.strictEqual(map[p.section][1], p.endTime, name + ' 第 ' + p.section + ' 节下课时间应为 ' + p.endTime)
  })
})

// OCR 按「第 N-M 节」回填时不再把节次上限写死为 11
assert.ok(/TOTAL_SECTIONS/.test(ctrlSrc), 'OCR 节次上限应取自节次总数')
assert.ok(!/Math\.min\(11,/.test(ctrlSrc), 'OCR 不应再把节次上限写死为 11')

console.log('Schedule period-times test passed.')
