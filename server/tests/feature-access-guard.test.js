/**
 * 校园功能统一访问控制测试（无需数据库 / 无需真机）
 *
 * 需求：校园活动 / 广轻群聊 / 社团&组织 / 校园评价 四个功能，仅允许
 *   「已登录 且（已登录过教务系统 或 已完成骑手认证）」的用户使用；
 *   未满足条件时拦截并引导先完成教务系统登录或骑手认证。
 *
 * 覆盖：
 *   A. utils/auth.js 的 requireFeatureAccess 全部分支（vm 加载真实模块，单 realm 顺序驱动：
 *      通过可变的登录态 / 教务绑定开关 / 骑手认证存储逐场景切换，避免多 realm 交叉）
 *      —— 未登录拦截、骑手认证直通、教务绑定直通、双无拦截引导、正向缓存与失效、autoBack
 *   B. 四个功能页 onShow 守卫接线（vm 加载真实页面文件，桩 auth/api）
 *      —— 守卫不通过不得加载数据；通过才加载；功能名与 autoBack 传参正确
 *   C. 两个入口（首页宫格 / 全部服务页）接线（源码级护栏断言）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')

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

// 看门狗：任何用例挂起（promise 未落定）时强制失败退出，而不是静默 drain
setTimeout(() => {
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// =====================================================================
// A. requireFeatureAccess 全分支（单 realm，可变状态）
// =====================================================================
function loadAuthModule(initial) {
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'auth.js'), 'utf8')

  // 可变状态：用例间直接切换，不再重建 realm
  const state = {
    token: initial.token || '',
    jwBound: initial.jwBound === true,
    riderApproved: initial.riderApproved === true
  }
  const requestCalls = []
  const requestStub = {
    get(url) {
      requestCalls.push(url)
      return state.jwBound
        ? Promise.resolve({ bound: true, username: '20230001' })
        : Promise.resolve({ bound: false })
    },
    put() { return Promise.resolve({}) }
  }
  const modalCalls = []
  const actionSheetCalls = []
  const navCalls = []
  const backCalls = []
  const storage = {}
  const app = { globalData: { token: '', userInfo: null } }
  Object.defineProperty(app.globalData, 'token', {
    get() { return state.token },
    set(v) { state.token = v }
  })

  const wxStub = new Proxy({
    showModal: (opt) => { modalCalls.push(opt) },
    showActionSheet: (opt) => { actionSheetCalls.push(opt) },
    navigateTo: (opt) => { navCalls.push(opt.url) },
    navigateBack: () => { backCalls.push('back') },
    switchTab: () => { backCalls.push('switchTab') },
    getStorageSync: (key) => {
      if (key === 'runner_verification') return state.riderApproved ? { verificationStatus: 'approved' } : ''
      return storage[key]
    },
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  }, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) })

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Date,
    Math,
    require: (name) => {
      const key = String(name)
      if (/\/request$/.test(key)) return requestStub
      if (/\/login-expiry$/.test(key)) return { recordActiveTime() {} }
      // utils/auth.js 的 isLoggedIn() 会用 token 里的 exp 判过期；
      // 用例里用的是假 token（'t'），这里固定为「未过期」，保持判定可预期。
      if (/\/token$/.test(key)) {
        return {
          isTokenExpired: () => false,
          tokenExpiresAt: () => 0,
          decodeTokenPayload: () => null,
          EXPIRY_SKEW_MS: 60000
        }
      }
      if (/\/syncQueue$/.test(key)) return { queueProfile() {} }
      if (/\/avatar$/.test(key)) {
        return {
          getDefaultProfile: () => ({ avatarUrl: '', nickName: '' }),
          isStoredAvatar: () => false,
          normalizeLegacyAvatar: (v) => v,
          isDefaultName: () => false
        }
      }
      // 卡片动效开关与页面准入逻辑无关，桩里返回默认开启
      if (/\/motion$/.test(key)) return {
        isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false,
        isLowEndDevice: () => false, getBenchmarkLevel: () => -1
      }
      throw new Error('测试桩未覆盖的模块：' + key)
    },
    getApp: () => app,
    getCurrentPages: () => [],
    wx: wxStub
  }
  vm.createContext(sandbox)
  vm.runInNewContext(source, sandbox, { filename: 'utils/auth.js' })
  const auth = sandbox.module.exports
  assert.ok(typeof auth.requireFeatureAccess === 'function', 'auth.js 应导出 requireFeatureAccess')
  return { auth, state, app, storage, requestCalls, modalCalls, actionSheetCalls, navCalls, backCalls }
}

async function authBranchTests() {
  const env = loadAuthModule({})

  // ===== A1. 未登录：拦截 + 引导去登录，不查教务绑定 =====
  let p = env.auth.requireFeatureAccess('校园活动', { autoBack: true })
  check(() => {
    assert.strictEqual(env.requestCalls.length, 0, '未登录不得查询教务绑定')
    assert.strictEqual(env.modalCalls.length, 1)
    assert.match(env.modalCalls[0].content, /需要先登录/)
    assert.strictEqual(env.modalCalls[0].confirmText, '去登录')
  }, '未登录拦截提示')
  env.modalCalls[0].success({ confirm: true })
  const ok1 = await p
  check(() => {
    assert.strictEqual(ok1, false, '未登录应拦截')
    assert.deepStrictEqual(env.navCalls, ['/pages/login/index'], '确认后引导去登录页')
  }, '未登录确认去登录')

  // ===== A2. 登录 + 骑手认证通过：直通，不打接口 =====
  env.state.token = 't'
  env.state.riderApproved = true
  const ok2 = await env.auth.requireFeatureAccess('校园评价', { autoBack: true })
  check(() => {
    assert.strictEqual(ok2, true, '骑手认证通过应放行')
    assert.strictEqual(env.requestCalls.length, 0, '骑手认证通过无需查教务绑定')
  }, '骑手认证直通')

  // ===== A3. 骑手未认证 + 教务系统已绑定：直通 =====
  // 先清除 A2 建立的正向缓存，确保真正走到教务绑定查询分支
  env.auth.logout()
  env.state.token = 't'
  env.state.riderApproved = false
  env.state.jwBound = true
  const ok3 = await env.auth.requireFeatureAccess('广轻群聊', { autoBack: true })
  check(() => {
    assert.strictEqual(ok3, true, '教务系统已登录（绑定凭证存在）应放行')
    assert.strictEqual(env.requestCalls.length, 1, '应查询一次教务绑定')
  }, '教务绑定直通')

  // ===== A4. 双无：拦截 + 引导二选一 =====
  // 清除 A3 建立的正向缓存
  env.auth.logout()
  env.state.token = 't'
  env.state.riderApproved = false
  env.state.jwBound = false
  let p4 = env.auth.requireFeatureAccess('社团&组织', { autoBack: true })
  await settled()
  check(() => {
    assert.strictEqual(env.modalCalls.length, 2, '双无应弹「访问受限」（累计第 2 个弹窗）')
    const modal = env.modalCalls[1]
    assert.match(modal.content, /教务系统登录/)
    assert.match(modal.content, /骑手认证/)
    assert.strictEqual(modal.confirmText, '去完成')
    assert.strictEqual(modal.cancelText, '返回')
  }, '双无拦截提示')
  env.modalCalls[1].success({ confirm: true })
  const ok4 = await p4
  check(() => {
    assert.strictEqual(ok4, false)
    assert.strictEqual(env.actionSheetCalls.length, 1, '确认后应弹出二选一')
    assert.deepStrictEqual(plain(env.actionSheetCalls[0].itemList), ['登录教务系统', '完成骑手认证'])
  }, '二选一动作面板')
  env.actionSheetCalls[0].success({ tapIndex: 0 })
  env.actionSheetCalls[0].success({ tapIndex: 1 })
  check(() => {
    assert.deepStrictEqual(env.navCalls.slice(-2),
      ['/pkg-schedule/schedule-login/index', '/pkg-feature/pages/rider-verify/index'],
      '两个选项应分别跳教务登录页 / 骑手认证页')
  }, '二选一跳转')

  // ===== A5. autoBack：功能页内取消退出；入口处取消留在原页面 =====
  let p5 = env.auth.requireFeatureAccess('校园活动', { autoBack: true })
  await settled()
  env.modalCalls[2].success({ confirm: false })
  const ok5 = await p5
  check(() => {
    assert.strictEqual(ok5, false)
    assert.strictEqual(env.backCalls.length, 1, '功能页守卫取消应退回上一页')
  }, 'autoBack=true 取消退出')

  let p5b = env.auth.requireFeatureAccess('校园活动', { autoBack: false })
  await settled()
  env.modalCalls[3].success({ confirm: false })
  const ok5b = await p5b
  check(() => {
    assert.strictEqual(ok5b, false)
    assert.strictEqual(env.backCalls.length, 1, '入口守卫取消应留在原页面（不新增退栈）')
  }, 'autoBack=false 取消不退出')

  // ===== A6. 正向缓存：通过后短时重复校验不打接口；不通过不缓存 =====
  env.state.jwBound = true
  const callsBefore = env.requestCalls.length
  const ok6 = await env.auth.requireFeatureAccess('校园活动', { autoBack: true })
  const afterPass = env.requestCalls.length
  await env.auth.requireFeatureAccess('广轻群聊', { autoBack: true })
  await env.auth.requireFeatureAccess('校园评价', { autoBack: true })
  check(() => {
    assert.strictEqual(ok6, true)
    assert.strictEqual(afterPass, callsBefore + 1, '通过时应恰查询一次教务绑定')
    assert.strictEqual(env.requestCalls.length, afterPass, '通过后 60s 内重复校验应命中缓存')
  }, '正向缓存')

  // 清除 A6 通过时建立的正向缓存，验证「不通过」本身不走缓存
  env.auth.logout()
  env.state.token = 't'
  env.state.riderApproved = false
  env.state.jwBound = false
  let p6 = env.auth.requireFeatureAccess('校园活动', { autoBack: false })
  await settled()
  env.modalCalls[4].success({ confirm: false })
  const ok6b = await p6
  check(() => {
    assert.strictEqual(ok6b, false)
    assert.strictEqual(env.requestCalls.length, afterPass + 1, '不通过不得缓存（否则完成认证返回后仍被拦）')
  }, '不通过不缓存')

  // ===== A7. 退出登录清除正向缓存：重新走未登录拦截 =====
  env.auth.logout()
  check(() => {
    assert.ok(!('token' in env.storage), 'logout 应清除本地 token')
  }, 'logout 清理登录态')
  let p7 = env.auth.requireFeatureAccess('校园活动', { autoBack: true })
  check(() => {
    assert.strictEqual(env.modalCalls.length, 6)
    assert.match(env.modalCalls[5].content, /需要先登录/, 'logout 后缓存应失效（重走未登录拦截）')
  }, 'logout 后缓存失效')
  env.modalCalls[5].success({ confirm: false })
  const ok7 = await p7
  check(() => {
    assert.strictEqual(ok7, false)
  }, 'logout 后拦截生效')
}

// 微任务排空：让 getJwBound 的 then 链跑完
async function settled() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

// =====================================================================
// B. 四个功能页 onShow 守卫接线（vm 加载真实页面文件）
// =====================================================================
function makePageSandbox(pagePath, stubs) {
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, pagePath), 'utf8')
  let pageDefinition = null
  const guardCalls = []
  const apiCallsLog = stubs.apiCallsLog || []
  const wxStub = new Proxy(Object.assign({
    setNavigationBarTitle: () => undefined,
    showToast: () => undefined,
    showModal: () => undefined,
    vibrateShort: () => undefined,
    navigateTo: () => undefined,
    navigateBack: () => undefined,
    switchTab: () => undefined,
    stopPullDownRefresh: () => undefined,
    getStorageSync: () => '',
    setStorageSync: () => undefined,
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 })
  }, stubs.wx || {}), { get: (target, prop) => (prop in target ? target[prop] : () => undefined) })

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Date,
    Math,
    require: (name) => {
      const key = String(name)
      if (/utils\/auth$/.test(key)) {
        return {
          isLoggedIn: () => true,
          requireLogin: () => true,
          requireFeatureAccess: (featureName, options) => {
            guardCalls.push({ featureName, options })
            return stubs.guardPass ? Promise.resolve(true) : Promise.resolve(false)
          }
        }
      }
      if (/utils\/api$/.test(key)) {
        return stubs.api
      }
      if (/utils\/club-data$/.test(key)) {
        // 真实 club-data 内部引用宿主 realm 的真实 api（会触发 wx.request），
        // 这里用桥接桩：沿用真实模块的静态分类数据，数据请求转发到测试 api 桩
        const realClubData = require('../../pkg-feature/utils/club-data')
        return {
          CLUB_CATEGORIES: realClubData.CLUB_CATEGORIES,
          fetchCategories: (campus) => stubs.api.getClubCategories(campus)
        }
      }
      if (/utils\/group-chat$/.test(key)) return require('../../pkg-feature/utils/group-chat')
      if (/utils\/campus$/.test(key)) return require('../../utils/campus')
      if (/utils\/review$/.test(key)) return require('../../pkg-feature/utils/review')
      if (/utils\/subscribe$/.test(key)) {
        // 活动页 2026-09-12 新增依赖：本测试只关心访问守卫，订阅模块用静默桩
        return {
          requestSubscribe: () => Promise.resolve({ accepted: [], rejected: [] }),
          reportQuota: () => Promise.resolve(null),
          fetchQuota: () => Promise.resolve(null),
          TEMPLATE_IDS: {}
        }
      }
      // 卡片动效开关与页面准入逻辑无关，桩里返回默认开启
      if (/\/motion$/.test(key)) return {
        isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false,
        isLowEndDevice: () => false, getBenchmarkLevel: () => -1
      }
      throw new Error('测试桩未覆盖的模块：' + key)
    },
    getApp: () => ({ globalData: { token: 't', userInfo: { id: 1, phone: '13800000000' } } }),
    getCurrentPages: () => [],
    wx: wxStub
  }
  sandbox.Page = (definition) => { pageDefinition = definition }
  vm.createContext(sandbox)
  vm.runInNewContext(source, sandbox, { filename: pagePath })
  assert.ok(pageDefinition, pagePath + ' 应调用 Page() 注册页面')
  return { pageDefinition, guardCalls, apiCallsLog }
}

function createPage(pageDefinition, options) {
  const page = Object.create(pageDefinition)
  page.data = plain(pageDefinition.data)
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((key) => {
      if (key.indexOf('.') === -1 && key.indexOf('[') === -1) {
        this.data[key] = patch[key]
        return
      }
      const keys = key.replace(/\]/g, '').split(/[.\[]/)
      let obj = this.data
      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === undefined) obj[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}
        obj = obj[keys[i]]
      }
      obj[keys[keys.length - 1]] = patch[key]
    })
    if (typeof cb === 'function') cb()
  }
  if (options && options.onLoad) page.onLoad(options.onLoadArgs || {})
  return page
}

async function pageWiringTests() {
  const apiCallsLog = []

  // B1. 校园活动
  {
    const apiStub = {
      getActivities() {
        apiCallsLog.push('activity.load')
        return Promise.resolve({ list: [], total: 0, hasMore: false })
      }
    }
    const first = makePageSandbox('pkg-feature/pages/activity/index.js', { api: apiStub, guardPass: false, apiCallsLog })
    const page = createPage(first.pageDefinition)
    await page.onShow()
    check(() => {
      assert.deepStrictEqual(plain(first.guardCalls), [{ featureName: '校园活动', options: { autoBack: true } }])
      assert.strictEqual(apiCallsLog.length, 0, '守卫不通过不得加载活动数据')
      assert.strictEqual(page.data.loaded, false)
    }, '活动页守卫拦截')

    const second = makePageSandbox('pkg-feature/pages/activity/index.js', { api: apiStub, guardPass: true, apiCallsLog })
    const page2 = createPage(second.pageDefinition)
    await page2.onShow()
    check(() => {
      assert.strictEqual(apiCallsLog.length, 1, '守卫通过应加载活动数据')
    }, '活动页守卫放行')
  }

  // B2. 广轻群聊
  {
    const apiStub = {
      getGroupChatList() {
        apiCallsLog.push('group.list')
        return Promise.resolve({ list: [] })
      },
      getGroupChatCategories() {
        apiCallsLog.push('group.cats')
        return Promise.resolve([])
      },
      getMyGroupChatApplies() {
        apiCallsLog.push('group.applies')
        return Promise.resolve({ list: [] })
      }
    }
    const first = makePageSandbox('pkg-feature/pages/group-chat/index.js', { api: apiStub, guardPass: false, apiCallsLog })
    const page = createPage(first.pageDefinition, { onLoad: true })
    const beforeB2 = apiCallsLog.length
    await page.onShow()
    check(() => {
      assert.deepStrictEqual(plain(first.guardCalls), [{ featureName: '广轻群聊', options: { autoBack: true } }])
      assert.strictEqual(apiCallsLog.length, beforeB2, '守卫不通过不得加载群聊数据')
    }, '群聊页守卫拦截')

    const second = makePageSandbox('pkg-feature/pages/group-chat/index.js', { api: apiStub, guardPass: true, apiCallsLog })
    const page2 = createPage(second.pageDefinition, { onLoad: true })
    const beforeB2b = apiCallsLog.length
    await page2.onShow()
    check(() => {
      assert.ok(apiCallsLog.length > beforeB2b, '守卫通过应加载群聊数据')
    }, '群聊页守卫放行')
  }

  // B3. 社团&组织
  {
    const apiStub = {
      getClubCategories() {
        apiCallsLog.push('club.cats')
        return Promise.resolve([])
      },
      getMyClubApplies() {
        apiCallsLog.push('club.applies')
        return Promise.resolve({ list: [] })
      }
    }
    const first = makePageSandbox('pkg-feature/pages/club/index.js', { api: apiStub, guardPass: false, apiCallsLog })
    const page = createPage(first.pageDefinition, { onLoad: true })
    const beforeB3 = apiCallsLog.length
    await page.onShow()
    check(() => {
      assert.deepStrictEqual(plain(first.guardCalls), [{ featureName: '社团&组织', options: { autoBack: true } }])
      assert.strictEqual(apiCallsLog.length, beforeB3, '守卫不通过不得加载社团数据')
    }, '社团页守卫拦截')

    const second = makePageSandbox('pkg-feature/pages/club/index.js', { api: apiStub, guardPass: true, apiCallsLog })
    const page2 = createPage(second.pageDefinition, { onLoad: true })
    const beforeB3b = apiCallsLog.length
    await page2.onShow()
    check(() => {
      assert.ok(apiCallsLog.length > beforeB3b, '守卫通过应加载社团数据')
    }, '社团页守卫放行')
  }

  // B4. 校园评价
  {
    const first = makePageSandbox('pkg-feature/pages/review/index.js', { api: {}, guardPass: false })
    const page = createPage(first.pageDefinition, { onLoad: true })
    await page.onShow()
    check(() => {
      assert.deepStrictEqual(plain(first.guardCalls), [{ featureName: '校园评价', options: { autoBack: true } }])
    }, '评价页守卫接线')
  }
}

// =====================================================================
// C. 入口接线护栏（源码级断言）
// =====================================================================
function entryWiringTests() {
  const indexSource = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'index', 'index.js'), 'utf8')
  const serviceAllSource = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-feature', 'pages', 'service-all', 'index.js'), 'utf8')

  const entries = [
    ['校园活动', '/pkg-feature/pages/activity/index'],
    ['广轻群聊', '/pkg-feature/pages/group-chat/index'],
    ['社团&组织', '/pkg-feature/pages/club/index'],
    ['校园评价', '/pkg-feature/pages/review/index']
  ]
  for (const [name, url] of entries) {
    check(() => {
      const pattern = new RegExp(
        "item\\.name === '" + name + "'[\\s\\S]{0,400}?requireFeatureAccess\\('" + name + "', \\{ autoBack: false \\}\\)[\\s\\S]{0,200}?navigateTo\\(\\{ url: '" + url + "' \\}\\)"
      )
      assert.match(indexSource, pattern, '首页宫格入口应先过统一守卫再跳转：' + name)
    }, '首页入口接线：' + name)
  }

  check(() => {
    assert.match(serviceAllSource, /FEATURE_GUARDS/)
    assert.ok(serviceAllSource.indexOf("'\/pkg-feature\/pages\/club\/index': '社团&组织'") >= 0)
    assert.ok(serviceAllSource.indexOf("'\/pkg-feature\/pages\/group-chat\/index': '广轻群聊'") >= 0)
    assert.ok(serviceAllSource.indexOf("'\/pkg-feature\/pages\/activity\/index': '校园活动'") >= 0)
    assert.match(serviceAllSource, /requireFeatureAccess\(guardName, \{ autoBack: false \}\)/)
  }, '全部服务页入口接线')
}

// =====================================================================
async function main() {
  await authBranchTests()
  await pageWiringTests()
  entryWiringTests()
  console.log(testCount + ' tests passed.')
  // B 段为加载真实页面在宿主 realm 引入了 club-data → 真实 api/request 模块链，
  // 会遗留活动句柄导致进程不自然退出，测试完成后显式收尾（看门狗仅兜底真挂起）
  process.exit(0)
}

main().catch((err) => {
  console.error('Feature access guard tests failed:', err && err.message)
  process.exit(1)
})
