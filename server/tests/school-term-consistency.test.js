// 学期/教学周一致性回归（M1a 起始日、M1b 总周数、L1a 周日锚点）
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const schedule = require('../../utils/schedule')

// M1a：前端默认学期起始日 = 本学期第 1 教学周周一，且与后端一致
assert.strictEqual(schedule.DEFAULT_SEMESTER_START, '2026-09-07')
assert.strictEqual(schedule.DEFAULT_TOTAL_WEEKS, 20)

// M1b：后端 clampNumber 的默认总周数实参为 20（不再 19）
const svc = fs.readFileSync(path.join(__dirname, '..', 'services', 'jwScheduleSyncService.js'), 'utf8')
assert.ok(/JW_TOTAL_WEEKS,\s*(?:\/\/[^\n]*\n\s*)?20,/.test(svc), '后端默认总周数应为 20')
assert.ok(!/JW_TOTAL_WEEKS,\s*(?:\/\/[^\n]*\n\s*)?19,/.test(svc), '后端默认总周数不应再是 19')
assert.ok(svc.indexOf('"2026-09-07"') > -1, '后端学期起始日默认应为周一 2026-09-07')

// 前端不再残留上一学期硬编码 2026-03-02
for (const rel of ['../../app.js', '../../pages/schedule/index.js', '../../pkg-schedule/schedule-home/index.js']) {
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8')
  assert.ok(!src.includes('2026-03-02'), `${rel} 不应再出现旧学期默认值 2026-03-02`)
}

// L1a：校历与课表按同一「周一锚点」计算第几周
const cal = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-calendar', 'index.js'), 'utf8')
assert.ok(/week1Monday/.test(cal), '校历周次计算应改为周一锚点')
assert.ok(!/weekBase/.test(cal), '校历不应再保留周日残周口径')

// 数值等价：对若干日期，校历公式(周一=firstWeekSunday+1)与 computeAcademicWeek 完全一致
const week1Monday = new Date(2026, 8, 7)
function calWeek(y, m, d, totalWeeks) {
  const one = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const t = one(new Date(y, m - 1, d))
  const elapsed = Math.floor((t - one(week1Monday)) / 86400000)
  if (elapsed < 0) return 1
  return Math.min(Math.floor(elapsed / 7) + 1, totalWeeks)
}
for (const [y, m, d] of [[2026,9,6],[2026,9,7],[2026,9,12],[2026,9,13],[2026,9,14],[2026,10,1]]) {
  const viaHelper = schedule.computeAcademicWeek('2026-09-07', 20, new Date(y, m - 1, d)).currentWeek
  const viaCal = calWeek(y, m, d, 20)
  assert.strictEqual(viaHelper, viaCal, `${y}-${m}-${d} 两页周次应一致（课表 ${viaHelper} vs 校历 ${viaCal}）`)
}
// 边界周日 9/13 与 9/12 同属第 1 周（旧校历会算成第 2 周 → 与课表不一致）
assert.strictEqual(schedule.computeAcademicWeek('2026-09-07', 20, new Date(2026, 8, 13)).currentWeek, 1)
assert.strictEqual(schedule.computeAcademicWeek('2026-09-07', 20, new Date(2026, 8, 14)).currentWeek, 2)
// 超过总周数标记过期
assert.strictEqual(schedule.computeAcademicWeek('2026-09-07', 20, new Date(2027, 2, 1)).isExpired, true)

// =====================================================================
// 周日期一致性（2026-09-20 线上问题：同一份课表在手机端与开发者工具显示不同的「本周」日期）
//
// 现象：手机端「第 3 周 9.20-9.26」、开发者工具「第 3 周 9.14-9.20」，表头列也差一天。
// 两条独立根因：
//   ① 起始日存在「周日锚点」写法 —— 校历图注写的是「教学周 2026年9月6日 起」，
//      用户可在「设置开始日期」里照抄 2026-09-06。它与周一锚点 2026-09-07 只差 1 天，
//      但 computeAcademicWeek 的 floor(天数差/7)+1 在周日这个边界上会差一周
//      （9/20 用 9/06 起算是第 3 周、用 9/07 起算才是第 2 周）。
//   ② switchWeek() 只改 currentWeek、不重算 currentWeekText —— 点「下一周」或
//      「本周无课自动跳到有课周」之后，标题与表头进了新周，卡片日期还停在上周。
// =====================================================================

// A. 周日锚点归一到周一（parseSemesterStart）
{
  const sunday = schedule.parseSemesterStart('2026-09-06')
  assert.strictEqual(sunday.getDate(), 7, '周日锚点 2026-09-06 应归一到周一 2026-09-07')
  assert.strictEqual(sunday.getDay(), 1, '归一后必须是周一')
  const monday = schedule.parseSemesterStart('2026-09-07')
  assert.strictEqual(monday.getDate(), 7, '本来就是周一的值不应被改动')
  // 2026-09-20（周日）对两种写法都必须是第 2 周
  const daySep20 = new Date(2026, 8, 20)
  assert.strictEqual(schedule.computeAcademicWeek('2026-09-06', 20, daySep20).currentWeek, 2,
    '周日锚点起始日必须得到与周一锚点相同的周次')
  assert.strictEqual(schedule.computeAcademicWeek('2026-09-07', 20, daySep20).currentWeek, 2)
  // 没传起始日时回落到本学期默认值（9/07）
  assert.strictEqual(schedule.computeAcademicWeek(undefined, 20, daySep20).currentWeek, 2,
    '缺省起始日应回落 DEFAULT_SEMESTER_START 而不是上一学期')
}

// B. 页面行为：周次切换必须同步刷新日期区间（vm 加载真实页面文件）
const vm = require('vm')
const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')

function loadSchedulePage(startDate) {
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'schedule', 'index.js'), 'utf8')
  let pageOptions = null
  const app = {
    globalData: {
      statusBarHeight: 20,
      navBarHeight: 44,
      token: 'test-token',
      scheduleConfig: { startDate, hideWeekend: true, reminder: false, bgColor: '#F5F7FA' },
      scheduleJumpToWeek: null,
    },
    saveScheduleConfig: () => undefined,
  }
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Page: (o) => { pageOptions = o },
    getApp: () => app,
    getCurrentPages: () => [],
    require: (name) => {
      const key = String(name)
      if (/\/schedule$/.test(key)) {
        // 把"今天"钉在 2026-09-20：本用例验证的是 9/20（边界周日）必须落第 2 周。
        // initFromConfig 调 computeAcademicWeek 时不传 now（生产语义 = 真实今天），
        // 不钉时钟的话用例会随真实日期漂移（例如 9/30 会算出第 4 周）——
        // 曾因此整周必挂。包装层只注入 now，其余函数原样透传。
        return Object.assign({}, schedule, {
          computeAcademicWeek: (start, weeks) => schedule.computeAcademicWeek(start, weeks, '2026-09-20')
        })
      }
      if (/\/api$/.test(key)) {
        return { getScheduleList: () => Promise.resolve([]), getScheduleConfig: () => Promise.resolve(null) }
      }
      if (/\/request$/.test(key)) return { get: () => Promise.resolve(null), post: () => Promise.resolve(null) }
      if (/\/auth$/.test(key)) return { isLoggedIn: () => true, requireLogin: () => true }
      if (/\/refresh$/.test(key)) return { runPullDownRefresh: () => undefined }
      throw new Error('测试桩未覆盖的模块：' + key)
    },
    wx: {
      showToast: () => undefined,
      showModal: () => undefined,
      showActionSheet: () => undefined,
      navigateTo: () => undefined,
      switchTab: () => undefined,
      vibrateShort: () => undefined,
      setStorageSync: () => undefined,
      getStorageSync: () => '',
      setNavigationBarTitle: () => undefined,
    },
  }
  vm.createContext(sandbox)
  vm.runInNewContext(source, sandbox, { filename: 'pages/schedule/index.js' })
  assert.ok(pageOptions, '应调用 Page() 注册页面')
  const instance = Object.assign({}, pageOptions)
  instance.data = JSON.parse(JSON.stringify(pageOptions.data))
  instance.setData = function setData(patch) { Object.assign(this.data, patch) }
  instance.getTabBar = () => ({ setSelected() {} })
  return instance
}

function headerDate(page) {
  const cell = (page.data.gridItems || []).find((item) => item.id === 'hd-date-0')
  return cell ? cell.text : ''
}

{
  const page = loadSchedulePage('2026-09-07')
  page.initFromConfig()
  assert.strictEqual(page.data.currentWeek, 2, '2026-09-20 相对第 1 周周一应落在第 2 周')
  assert.strictEqual(page.data.currentWeekText, '9.14 - 9.20', '第 2 周日期区间')
  page.applyCurrentWeekCourses([])
  assert.strictEqual(headerDate(page), '9/14', '表头首列与卡片区间同源')

  // 核心回归：切到第 3 周后，标题 / 表头 / 卡片日期三者必须一起走
  page.switchWeek(3)
  assert.strictEqual(page.data.currentWeek, 3)
  assert.strictEqual(page.data.currentWeekText, '9.21 - 9.27',
    '切周后卡片日期区间必须跟着更新（此前只改 currentWeek，卡片停在上周）')
  assert.strictEqual(headerDate(page), '9/21', '切周后表头首列同步')

  // 上一次「下一周」的日期不应残留
  page.onPrevWeek()
  assert.strictEqual(page.data.currentWeekText, '9.14 - 9.20', '上一周按钮同样要刷新日期区间')
}

// C. 周日锚点配置在页面上也不能产生偏移
{
  const viaMonday = loadSchedulePage('2026-09-07')
  viaMonday.initFromConfig()
  const viaSunday = loadSchedulePage('2026-09-06')
  viaSunday.initFromConfig()
  assert.strictEqual(viaSunday.data.currentWeek, viaMonday.data.currentWeek,
    '起始日写成周日时，周次必须与周一锚点一致')
  assert.strictEqual(viaSunday.data.currentWeekText, viaMonday.data.currentWeekText,
    '起始日写成周日时，日期区间必须与周一锚点一致')
}

// D. 源码护栏：不允许再出现「只改周次、不改日期区间」的写法，也不允许残留旧学期默认值
{
  const pageSrc = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'schedule', 'index.js'), 'utf8')
  assert.ok(!/parseLocalDate\(/.test(pageSrc),
    '课表页推算周次/周日期必须走 parseSemesterStart（含周一锚定），不要直接用 parseLocalDate')
  assert.ok(/switchWeek\(week\) \{[\s\S]{0,600}?currentWeekText: this\.weekDateText\(week\)/.test(pageSrc),
    'switchWeek 必须与 currentWeekText 同批更新')
  const homeSrc = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'index', 'index.js'), 'utf8')
  assert.ok(/computeAcademicWeek\(/.test(homeSrc),
    '首页「今天第几周」必须与课表页共用 computeAcademicWeek 口径')
  // 全仓（小程序端）不允许再出现上一学期的默认起始日
  for (const rel of ['pages/schedule/index.js', 'pages/index/index.js', 'pkg-schedule/schedule-home/index.js', 'app.js']) {
    const src = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, rel), 'utf8')
    assert.ok(!src.includes('2026-03-02'), rel + ' 不应再出现上一学期默认值 2026-03-02')
  }
}

console.log('School-term consistency test passed.')
