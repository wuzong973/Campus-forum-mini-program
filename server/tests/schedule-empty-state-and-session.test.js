/**
 * 课表空态 / 周次跳转 / 登录态失效统一处理 回归测试（无需数据库、无需真机）
 *
 * 背景（2026-09-18 生产问题）：
 *   ① 用户反馈「手动添加了课表但不显示」——实际是课表页只渲染当前选中周，
 *      而大一军训 2 周、课程普遍从第 3 周开始，本周恰好没课 → 显示「暂无课程」，
 *      并且周次导航栏当时挂在 `courses.length > 0` 上，本周没课时**根本无法切周**，
 *      用户彻底卡死，只能得出「课表没导入成功」的错误结论。
 *      实测：192 个有课表的用户里只有 56 人（29%）在第 2 周有课。
 *   ② 用户反馈「账号密码正确却提示未登录」——实际是本地 JWT 已过期（服务端 7 天），
 *      而前端只在「90 天未活跃」时才清 token，中间是僵尸登录态：守卫放行、
 *      服务端每个鉴权接口 401，且 401 被静默吞掉。
 *
 * 覆盖：
 *   A. utils/token.js —— JWT 载荷解码与过期判定（真实模块）
 *   B. utils/login-expiry.js —— token 过期 / 90 天未活跃 两条判据（vm）
 *   C. utils/request.js —— 401 统一提示「去登录」、去重、游客不弹（vm）
 *   D. pages/schedule/index.js —— 空态区分、首个有课周、自动跳周、手动添加定位（vm）
 *   E. 源码级护栏 —— 周次导航不再依赖 courses.length；手动添加不再谎报成功
 *   F. 服务端 JWT 有效期已由 7d 调整为 30d
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const SERVER_ROOT = path.join(__dirname, '..')
const MINI_PROGRAM_ROOT = path.join(SERVER_ROOT, '..')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message)
    throw err
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// 构造一个只有载荷有意义的三段式 JWT（服务端不验签，前端也只看 exp）
function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return header + '.' + body + '.test-signature'
}

const DAY_MS = 24 * 60 * 60 * 1000

// =====================================================================
// A. utils/token.js（无 wx 依赖，直接 require 真实模块）
// =====================================================================
const tokenUtil = require('../../utils/token')

check(() => {
  const token = makeJwt({ userId: 106, iat: 1, exp: Math.floor((Date.now() + 5 * DAY_MS) / 1000) })
  assert.strictEqual(tokenUtil.decodeTokenPayload(token).userId, 106)
  assert.strictEqual(tokenUtil.isTokenExpired(token), false, '未到期的 token 不应判过期')
}, 'A1. 未过期 token 解码正确且不判过期')

check(() => {
  const token = makeJwt({ userId: 106, exp: Math.floor((Date.now() - 1000) / 1000) })
  assert.strictEqual(tokenUtil.isTokenExpired(token), true, '已过期的 token 必须判过期')
}, 'A2. 已过期 token 判过期')

check(() => {
  // 距过期不足 60s 的余量内也提前视为过期，避免「本地还有 1 秒、服务端已过期」的抖动
  const token = makeJwt({ userId: 106, exp: Math.floor((Date.now() + 10 * 1000) / 1000) })
  assert.strictEqual(tokenUtil.isTokenExpired(token), true, '进入安全余量后应提前判过期')
}, 'A3. 进入 60s 安全余量即提前判过期')

check(() => {
  // 无法解析时退回「交给服务端判定」，不得误伤正常用户
  assert.strictEqual(tokenUtil.isTokenExpired('t'), false)
  assert.strictEqual(tokenUtil.isTokenExpired(''), false)
  assert.strictEqual(tokenUtil.isTokenExpired('a.b'), false)
  assert.strictEqual(tokenUtil.decodeTokenPayload('a.@@@.c'), null)
}, 'A4. 非标准/不可解析 token 不判过期（安全降级）')

check(() => {
  // 小程序运行时没有 atob，必须自带 base64 解码；这里验证非 ASCII 载荷不会抛错
  const token = makeJwt({ userId: 1, nick: '广东轻工', exp: Math.floor((Date.now() + DAY_MS) / 1000) })
  assert.strictEqual(tokenUtil.decodeTokenPayload(token).nick, '广东轻工')
}, 'A5. 自实现 base64 解码可处理多字节字符')

// =====================================================================
// B. utils/login-expiry.js（vm 加载真实模块）
// =====================================================================
function loadLoginExpiry(initialStorage) {
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'login-expiry.js'), 'utf8')
  const storage = Object.assign({}, initialStorage)
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    require: (name) => {
      const key = String(name)
      if (/\/token$/.test(key)) return tokenUtil
      throw new Error('测试桩未覆盖的模块：' + key)
    },
    wx: {
      getStorageSync: (k) => (k in storage ? storage[k] : ''),
      setStorageSync: (k, v) => { storage[k] = v },
      removeStorageSync: (k) => { delete storage[k] }
    }
  }
  vm.createContext(sandbox)
  vm.runInNewContext(source, sandbox, { filename: 'utils/login-expiry.js' })
  return { mod: sandbox.module.exports, storage }
}

check(() => {
  const future = makeJwt({ userId: 1, exp: Math.floor((Date.now() + 30 * DAY_MS) / 1000) })
  const env = loadLoginExpiry({ token: future, userInfo: { id: 1 }, lastActiveTime: Date.now() })
  assert.strictEqual(env.mod.checkLoginExpiry(), false, 'token 未过期且近期活跃 → 不清理')
  assert.strictEqual(env.storage.token, future, 'token 应保留')
}, 'B1. token 有效且近期活跃：不清理登录态')

check(() => {
  // 核心回归：token 过期但未满 90 天 —— 旧实现在这里会放行，形成僵尸登录态
  const expired = makeJwt({ userId: 1, exp: Math.floor((Date.now() - DAY_MS) / 1000) })
  const env = loadLoginExpiry({ token: expired, userInfo: { id: 1 }, lastActiveTime: Date.now() })
  const result = env.mod.checkLoginExpiry()
  assert.deepStrictEqual(plain(result), { reason: 'token-expired' }, 'token 过期应返回 token-expired')
  assert.strictEqual(env.storage.token, undefined, '过期 token 必须被清除')
  assert.strictEqual(env.storage.userInfo, undefined, '过期时也应清除用户信息')
}, 'B2. token 过期（未满 90 天）即清理并标记 token-expired')

check(() => {
  const future = makeJwt({ userId: 1, exp: Math.floor((Date.now() + 30 * DAY_MS) / 1000) })
  const env = loadLoginExpiry({ token: future, lastActiveTime: Date.now() - 91 * DAY_MS })
  const result = env.mod.checkLoginExpiry()
  assert.deepStrictEqual(plain(result), { reason: 'inactive' }, '超 90 天未活跃应返回 inactive')
  assert.strictEqual(env.storage.token, undefined)
}, 'B3. 90 天未活跃仍会清理并标记 inactive')

check(() => {
  const env = loadLoginExpiry({})
  assert.strictEqual(env.mod.checkLoginExpiry(), false, '未登录不应触发任何清理')
  assert.ok(env.storage.lastActiveTime > 0, '未登录也应记录活跃时间')
}, 'B4. 无 token：不清理且记录活跃时间')

// =====================================================================
// C. utils/request.js（vm 加载真实模块，驱动 wx.request 回 401）
// =====================================================================
function loadRequest(options) {
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'request.js'), 'utf8')
  const opts = options || {}
  const token = opts.token === undefined ? 'stale-token' : opts.token
  const modalCalls = []
  const toastCalls = []
  const navCalls = []
  const removed = []
  const app = { globalData: { token: token, userInfo: { id: 1 } }, onLogoutCalls: 0, onLogout() { this.onLogoutCalls += 1 } }
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
    getApp: () => app,
    require: () => ({}),
    wx: {
      request: (config) => {
        config.success({ statusCode: opts.statusCode || 401, data: { code: 401, message: 'Not logged in' }, header: {} })
      },
      showModal: (cfg) => { modalCalls.push(cfg) },
      showToast: (cfg) => { toastCalls.push(cfg) },
      showLoading: () => undefined,
      hideLoading: () => undefined,
      navigateTo: (cfg) => { navCalls.push(cfg.url) },
      removeStorageSync: (k) => { removed.push(k) }
    }
  }
  vm.createContext(sandbox)
  vm.runInNewContext(source, sandbox, { filename: 'utils/request.js' })
  return { request: sandbox.module.exports, app, modalCalls, toastCalls, navCalls, removed }
}

async function requestTests() {
  // C1. 带了 token 却被判 401 → 清 token + 弹一次「去登录」+ 断开旧 WebSocket
  {
    const env = loadRequest({ token: 'stale-token' })
    let caught = null
    await env.request.get('/schedule/bind', {}, true, { silent: true }).catch((e) => { caught = e })
    check(() => {
      assert.ok(caught, '401 应 reject')
      assert.strictEqual(caught.statusCode, 401)
      assert.strictEqual(caught.bizCode, 'UNAUTHORIZED')
      assert.strictEqual(env.app.globalData.token, '', '必须清掉本地 token')
      assert.ok(env.removed.indexOf('token') > -1, '必须清掉存储里的 token')
      assert.strictEqual(env.app.onLogoutCalls, 1, '登录态失效应断开旧身份的 WebSocket')
      // silent:true 也必须提示——这正是当初「点了绑定并同步只弹一句未登录」的根因
      assert.strictEqual(env.modalCalls.length, 1, '登录态失效应弹一次提示（不受 silent 影响）')
      assert.match(env.modalCalls[0].content, /重新登录/)
      assert.strictEqual(env.modalCalls[0].confirmText, '去登录')
      assert.strictEqual(env.toastCalls.length, 0, '不应再叠加一个 toast')
    }, 'C1. 带 token 的 401：清登录态 + 弹一次去登录 + 断开 WS')

    env.modalCalls[0].success({ confirm: true })
    check(() => {
      assert.deepStrictEqual(env.navCalls, ['/pages/login/index'], '确认后应跳登录页')
    }, 'C2. 确认「去登录」跳转登录页')
  }

  // C3. 游客（本地没有 token）→ 不算登录态失效，silent 时完全静默
  {
    const env = loadRequest({ token: '' })
    let caught = null
    await env.request.get('/schedule/list', {}, true, { silent: true }).catch((e) => { caught = e })
    check(() => {
      assert.ok(caught && caught.statusCode === 401)
      assert.strictEqual(env.modalCalls.length, 0, '游客不应被弹「登录已失效」')
      assert.strictEqual(env.toastCalls.length, 0, 'silent 游客请求不应提示')
      assert.strictEqual(env.app.onLogoutCalls, 0, '游客不应触发登出清理')
    }, 'C3. 游客 401：不弹登录失效、不打扰')
  }

  // C4. 游客 + 非 silent（用户主动点的动作）→ 仍保留原来的「未登录」toast
  {
    const env = loadRequest({ token: '' })
    await env.request.post('/schedule/add', {}, true).catch(() => undefined)
    check(() => {
      assert.strictEqual(env.modalCalls.length, 0, '游客不应弹「登录已失效」')
      assert.strictEqual(env.toastCalls.length, 1)
      assert.strictEqual(env.toastCalls[0].title, '未登录')
    }, 'C4. 游客主动操作 401：提示「未登录」但不引导重登')
  }
}

// =====================================================================
// D. pages/schedule/index.js（vm 加载真实页面文件）
// =====================================================================
function loadSchedulePage(options) {
  const opts = options || {}
  const source = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'schedule', 'index.js'), 'utf8')
  const scheduleUtils = require('../../utils/schedule')
  let pageOptions = null
  const toastCalls = []
  const apiCalls = []
  const modalCalls = []
  const actionSheetCalls = []
  const app = {
    globalData: {
      statusBarHeight: 20,
      navBarHeight: 44,
      token: opts.token === undefined ? 'valid-token' : opts.token,
      scheduleConfig: { startDate: '2026-09-07', hideWeekend: false, reminder: false, bgColor: '#F5F7FA' },
      scheduleJumpToWeek: opts.scheduleJumpToWeek || null
    }
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
      if (/\/schedule$/.test(key)) return scheduleUtils
      if (/\/api$/.test(key)) {
        return {
          getScheduleList: (o) => {
            apiCalls.push(o)
            return Promise.resolve(opts.courses || [])
          },
          clearSchedule: () => (opts.clearFails
            ? Promise.reject(Object.assign(new Error('网络异常，请检查网络'), { isNetwork: true }))
            : Promise.resolve(null))
        }
      }
      if (/\/request$/.test(key)) return { get: () => Promise.resolve(null), post: () => Promise.resolve(null) }
      if (/\/auth$/.test(key)) {
        return {
          isLoggedIn: () => (opts.loggedIn === undefined ? true : opts.loggedIn),
          requireLogin: () => true
        }
      }
      if (/\/refresh$/.test(key)) return { runPullDownRefresh: () => undefined }
      throw new Error('测试桩未覆盖的模块：' + key)
    },
    wx: {
      showToast: (cfg) => { toastCalls.push(cfg) },
      showModal: (cfg) => { modalCalls.push(cfg) },
      showActionSheet: (cfg) => { actionSheetCalls.push(cfg) },
      navigateTo: () => undefined,
      switchTab: () => undefined,
      vibrateShort: () => undefined,
      setStorageSync: () => undefined,
      getStorageSync: () => '',
      setNavigationBarTitle: () => undefined
    }
  }
  vm.createContext(sandbox)
  vm.runInNewContext(source, sandbox, { filename: 'pages/schedule/index.js' })
  assert.ok(pageOptions, '应调用 Page() 注册页面')

  const instance = Object.assign({}, pageOptions)
  instance.data = plain(pageOptions.data)
  instance.setData = function setData(patch) {
    Object.assign(this.data, patch)
  }
  instance.getTabBar = () => ({ setSelected() {} })
  return { page: instance, app, toastCalls, apiCalls, modalCalls, actionSheetCalls }
}

// 模拟 user 106 的真实数据：25 门课，全部从第 3 周开始
const USER_106_COURSES = [
  { id: 1, name: '形势与政策Ⅰ', location: '3410-3413', weekDay: 1, startTime: '10:15', endTime: '11:40', startWeek: 6, endWeek: 9, weekType: 'all' },
  { id: 2, name: '军事理论', location: '2208', weekDay: 1, startTime: '18:30', endTime: '19:55', startWeek: 7, endWeek: 7, weekType: 'all' },
  { id: 3, name: 'C语言程序设计', location: '第四工业实训楼B301', weekDay: 2, startTime: '08:30', endTime: '09:55', startWeek: 3, endWeek: 9, weekType: 'all' },
  { id: 4, name: 'C语言程序设计', location: '第四工业实训楼B301', weekDay: 2, startTime: '08:30', endTime: '09:55', startWeek: 12, endWeek: 14, weekType: 'all' },
  { id: 5, name: '高等数学A（一）', location: '1216', weekDay: 3, startTime: '08:30', endTime: '09:55', startWeek: 3, endWeek: 9, weekType: 'all' }
]

function normalize(list) {
  const scheduleUtils = require('../../utils/schedule')
  return list.map((item, index) => scheduleUtils.normalizeCourse(item, index))
}

async function schedulePageTests() {
  // D1. 本周没课但学期有课 → 空态必须能区分，并给出首个有课周
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES) })
    env.page.data.currentWeek = 2
    env.page.setData({ allCourses: normalize(USER_106_COURSES) })
    env.page.applyCurrentWeekCourses(env.page.data.allCourses)
    check(() => {
      assert.strictEqual(env.page.data.courses.length, 0, '第 2 周确实没有课')
      assert.strictEqual(env.page.data.semesterCourseCount, 5, '应记录本学期总课程数')
      assert.strictEqual(env.page.data.firstCourseWeek, 3, '首个有课周应为第 3 周')
    }, 'D1. 本周无课但学期有课：空态可区分（semesterCourseCount / firstCourseWeek）')

    // D2. 首次进入自动跳到首个有课周，用户不必自己找
    await env.page.loadSchedule()
    check(() => {
      assert.strictEqual(env.page.data.currentWeek, 3, '应自动跳到第 3 周')
      assert.strictEqual(env.page.data.courses.length, 2, '第 3 周应能看到 3-9 周段的课')
      assert.ok(env.toastCalls.some((c) => /已切到第 3 周/.test(c.title)), '应提示已切换周次')
    }, 'D2. 首次进入本周无课时自动跳到首个有课周')
  }

  // D3. 用户手动翻到空周后不再被反复拽走
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES) })
    env.page.data.currentWeek = 2
    await env.page.loadSchedule()
    env.page.switchWeek(2)
    env.page.maybeJumpToCourseWeek(env.page.data.allCourses)
    check(() => {
      assert.strictEqual(env.page.data.currentWeek, 2, '用户主动停在空周时不应被再次自动跳走')
    }, 'D3. 自动跳周只发生一次，尊重用户手动选择')
  }

  // D4. 当前周已有课 → 不做任何跳转
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES) })
    env.page.data.currentWeek = 3
    await env.page.loadSchedule()
    check(() => {
      assert.strictEqual(env.page.data.currentWeek, 3, '本周有课不应跳转')
      assert.strictEqual(env.toastCalls.length, 0, '不应有切换提示')
    }, 'D4. 当前周有课：不跳周、不提示')
  }

  // D5. 手动添加课程后，定位到用户所选周（而不是停在当前周什么都看不到）
  {
    const env = loadSchedulePage({
      courses: normalize(USER_106_COURSES),
      scheduleJumpToWeek: { startWeek: 13, endWeek: 19, weekType: 'all' }
    })
    env.page.data.currentWeek = 2
    await env.page.onShow()
    check(() => {
      assert.strictEqual(env.page.data.currentWeek, 13, '应定位到新加课程所在的第 13 周')
      assert.strictEqual(env.app.globalData.scheduleJumpToWeek, null, '定位意图消费后必须清空，避免下次 onShow 重复触发')
    }, 'D5. 手动添加课程后自动定位到用户所选的周')
  }

  // D6. 单双周：跳过不匹配的周，落到真正上课的那一周
  {
    const env = loadSchedulePage({ courses: [] })
    check(() => {
      assert.strictEqual(
        env.page.resolveFirstActiveWeek({ startWeek: 10, endWeek: 14, weekType: 'odd' }),
        11,
        '单周课从第 10 周开始，第 11 周才是第一个单周'
      )
      assert.strictEqual(
        env.page.resolveFirstActiveWeek({ startWeek: 10, endWeek: 14, weekType: 'even' }),
        10,
        '双周课第 10 周即可上课'
      )
      assert.strictEqual(
        env.page.resolveFirstActiveWeek({ startWeek: 5, endWeek: 6, weekType: 'odd' }),
        5
      )
      assert.strictEqual(
        env.page.resolveFirstActiveWeek({ startWeek: 4, endWeek: 4, weekType: 'odd' }),
        0,
        '区间内没有匹配单双周的周次应返回 0'
      )
    }, 'D6. 首个有课周计算考虑单双周')
  }

  // D7. 完全没课时：不跳周，语义保持「暂无课程」
  {
    const env = loadSchedulePage({ courses: [] })
    env.page.data.currentWeek = 2
    await env.page.loadSchedule()
    check(() => {
      assert.strictEqual(env.page.data.semesterCourseCount, 0)
      assert.strictEqual(env.page.data.firstCourseWeek, 0)
      assert.strictEqual(env.page.data.currentWeek, 2, '没有课就不该跳周')
    }, 'D7. 学期无课：保持原周次，semesterCourseCount=0')
  }

  // D8. 未登录：不发鉴权请求，且不把「请求失败」渲染成「暂无课程」
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES), loggedIn: false })
    await env.page.loadSchedule()
    check(() => {
      assert.strictEqual(env.apiCalls.length, 0, '未登录不得调用 /schedule/list')
      assert.strictEqual(env.page.data.semesterCourseCount, 0)
    }, 'D8. 未登录不发鉴权请求')
  }

  // D9. 空态跳转按钮
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES) })
    env.page.data.currentWeek = 2
    await env.page.loadSchedule()
    env.page.switchWeek(2)
    env.page.onJumpToFirstCourseWeek()
    check(() => {
      assert.strictEqual(env.page.data.currentWeek, 3, '空态按钮应跳到首个有课周')
    }, 'D9. 空态「跳到第 N 周」按钮生效')
  }

  // D10. 「清空全部课表」也必须等服务端成功再提示（同手动添加的原则）
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES), clearFails: true })
    await env.page.loadSchedule()
    const before = env.page.data.semesterCourseCount
    env.page.onEditSchedule()
    env.actionSheetCalls[0].success({ tapIndex: 1 })
    env.modalCalls[0].success({ confirm: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    check(() => {
      assert.strictEqual(env.page.data.semesterCourseCount, before, '清空失败不得清掉本地列表')
      assert.ok(
        !env.toastCalls.some((c) => /课表已清空/.test(c.title || '')),
        '清空失败不得提示「课表已清空」'
      )
    }, 'D10. 清空课表失败：不谎报成功、列表保持原样')
  }

  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES) })
    await env.page.loadSchedule()
    env.page.onEditSchedule()
    env.actionSheetCalls[0].success({ tapIndex: 1 })
    env.modalCalls[0].success({ confirm: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    check(() => {
      assert.strictEqual(env.page.data.semesterCourseCount, 0, '清空成功应清掉列表')
      assert.strictEqual(env.page.data.firstCourseWeek, 0)
      assert.ok(
        env.toastCalls.some((c) => /课表已清空/.test(c.title || '')),
        '清空成功才提示'
      )
    }, 'D11. 清空课表成功：清列表并提示成功')
  }

  // D12. 点击顶部「第 N 周」→ 打开全周次总览
  {
    const env = loadSchedulePage({ courses: normalize(USER_106_COURSES) })
    env.page.data.currentWeek = 2
    await env.page.loadSchedule()
    env.page.setData({ showSemesterView: false })
    env.page.onWeekTextTap()
    check(() => {
      assert.strictEqual(env.page.data.showSemesterView, true, '点周次应打开全周次总览')
      assert.strictEqual(env.page.data.semesterWeeks.length, 20, '总览应包含全部 20 周')
      const w3 = env.page.data.semesterWeeks[2]
      assert.strictEqual(w3.week, 3)
      assert.ok(w3.courseCount > 0, '第 3 周应显示有课')
      assert.strictEqual(env.page.data.semesterWeeks[1].courseCount, 0, '第 2 周显示 0 门')
    }, 'D12. 点「第 N 周」打开全周次总览（每周课程数可见）')

    // 再点一次收起，与「本学期课表」按钮行为一致
    env.page.onWeekTextTap()
    check(() => {
      assert.strictEqual(env.page.data.showSemesterView, false, '再点一次应收起')
    }, 'D13. 点「第 N 周」可再次收起总览')
  }

  // D14. 学期里一门课都没有时点周次：如实提示，不假装有内容
  {
    const env = loadSchedulePage({ courses: [] })
    await env.page.loadSchedule()
    env.page.onWeekTextTap()
    check(() => {
      assert.strictEqual(env.page.data.showSemesterView, false, '没有课不应展开空总览')
      assert.ok(
        env.toastCalls.some((c) => /还没有课表/.test(c.title || '')),
        '应提示先去添加/同步'
      )
    }, 'D14. 无课程时点周次：如实提示而不是「点了没反应」')
  }
}

// =====================================================================
// E. 源码级护栏
// =====================================================================
check(() => {
  const wxml = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'schedule', 'index.wxml'), 'utf8')
  // 周次导航栏不能再看 courses.length —— 否则「本周没课」= 无法切换周次，
  // 用户根本走不到有课的周，只能得出「课表没导入」的结论。
  const navBlock = wxml.slice(wxml.indexOf('<!-- 周次导航栏'), wxml.indexOf('<!-- 学期课表按钮'))
  assert.ok(navBlock.indexOf('week-nav-bar') > -1, '应能找到周次导航栏')
  assert.ok(!/week-nav-bar[^>]*wx:if/.test(navBlock), '周次导航栏不得再依赖 courses.length 显示')
  assert.ok(/bindtap="onPrevWeek"/.test(navBlock) && /bindtap="onNextWeek"/.test(navBlock))
  // 空态必须区分两种情形
  assert.match(wxml, /semesterCourseCount > 0/, '空态应区分「本学期有课」')
  assert.match(wxml, /第 \{\{currentWeek\}\} 周暂无课程/, '本周无课时应明确说是「第 N 周暂无课程」')
  assert.match(wxml, /最早从第 \{\{firstCourseWeek\}\} 周开始上课/, '应告知首个有课周')
  assert.match(wxml, /bindtap="onJumpToFirstCourseWeek"/, '应提供跳到有课周的入口')
  // 顶部「第 N 周」也要能点开全周次总览（不用一周周点「下一周」去试）
  assert.match(wxml, /class="week-text" bindtap="onWeekTextTap"/, '导航栏「第 N 周」应可点击')
  assert.match(wxml, /class="week-nav-center" bindtap="onWeekTextTap"/, '周次导航条中间的「第 N 周」也应可点击')
  assert.match(wxml, /class="week-caret"/, '可点的周次应有小三角提示')
}, 'E1. 课表页：周次导航不再依赖本周是否有课；空态区分两种情形；周次可点开总览')

check(() => {
  const page = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-schedule', 'schedule-add', 'index.js'), 'utf8')
  assert.ok(!/\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(page), '手动添加不得再用 catch(() => {}) 静默吞掉失败')
  assert.ok(!/setStorageSync\('schedule_courses'/.test(page), '手动添加不应再写没人读的本地死缓存')
  assert.match(page, /scheduleJumpToWeek/, '保存成功后应把定位意图交给课表页')
  assert.match(page, /title: '保存失败'/, '失败时应明确告知保存失败')
  assert.match(page, /statusCode === 401/, '401 交给统一处理，不重复弹窗')
}, 'E2. 手动添加课程：失败必须如实反馈，成功后定位到所选周')

check(() => {
  // 「清空全部课表」是同一类坑：本地写操作不能抢在接口前面提示成功
  for (const rel of ['pages/schedule/index.js', 'pkg-schedule/schedule-edit/index.js']) {
    const src = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, rel), 'utf8')
    assert.ok(
      !/clearSchedule\(\)\s*\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(src),
      `${rel} 清空课表不得 fire-and-forget 后立刻提示成功`
    )
    assert.match(
      src,
      /clearSchedule\(\)[\s\S]{0,240}?\.then\(/,
      `${rel} 清空课表应等接口成功后再提示`
    )
  }
}, 'E4. 清空课表同样必须等服务端成功再提示')

check(() => {
  const authSrc = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'auth.js'), 'utf8')
  assert.match(authSrc, /tokenUtil\.isTokenExpired\(token\)/, 'isLoggedIn 必须校验 token 是否过期')
  const requestSrc = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'request.js'), 'utf8')
  assert.match(requestSrc, /notifyLoginExpired\(\)/, '401 必须走统一提示')
  assert.match(
    requestSrc,
    /if \(hadToken\) \{[\s\S]{0,400}notifyLoginExpired\(\)/,
    '只有「带了 token 仍 401」才提示登录失效'
  )
}, 'E3. 登录态：守卫校验 token 有效期；401 统一提示且不误伤游客')

// =====================================================================
// F. 服务端 JWT 有效期
// =====================================================================
check(() => {
  const jwtSrc = fs.readFileSync(path.join(SERVER_ROOT, 'config', 'jwt.js'), 'utf8')
  assert.match(jwtSrc, /'30d'/, 'JWT 默认有效期应为 30d')
  assert.ok(!/expiresIn:\s*process\.env\.JWT_EXPIRES \|\| '7d'/.test(jwtSrc), '不应再回落到 7d')
}, 'F1. 服务端 JWT 默认有效期 30d')

;(async () => {
  await requestTests()
  await schedulePageTests()
  console.log('\nSchedule empty-state & session tests passed. (' + testCount + ' checks)')
  process.exit(0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
