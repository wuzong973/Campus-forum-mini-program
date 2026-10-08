/**
 * 「显示每日热榜」按用户维度偏好测试（无需数据库 / 无需真机）
 *
 * 需求：开关对每个已登录用户默认开启、各用户独立保存并持久化；关闭后该用户在
 * 首页（预览卡/浮动按钮/最热分类）、帖子详情页、搜索页的热榜内容与入口全部隐藏，
 * 独立热榜页直接退出；重新开启恢复；设置页切换后各页面 onShow 即时同步。
 *
 * 覆盖：
 *   A. utils/hot-rank.js 偏好读写全分支（vm 加载真实模块）：默认开启/往返/用户隔离/未登录 guest/存储结构
 *   B. 设置页接线（真实 hot-rank 同源联动）：onLoad 读取、切换写用户键且不写 system_settings、切用户独立
 *   C. 四个展示页 + 热榜页 + 设置页接线护栏（源码断言）
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
async function checkAsync(fn, message) {
  await fn()
  testCount++
  console.log('PASS:', message)
}

setTimeout(() => {
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// 加载真实 utils/hot-rank.js（wx/getApp 可变状态，format 用宿主真实模块）
function loadHotRank() {
  const state = { storage: {}, userInfo: null }
  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] }
  }
  const appStub = { globalData: { userInfo: null } }
  let exports = null
  const sandbox = {
    wx: wxStub,
    getApp: () => appStub,
    require: (modulePath) => {
      if (/(^|\/)format$/.test(String(modulePath).split('\\').join('/'))) {
        return require(path.join(MINI_PROGRAM_ROOT, 'utils', 'format.js'))
      }
      throw new Error('测试桩未覆盖的模块：' + modulePath)
    },
    module: { exports: {} },
    exports: {},
    console
  }
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'hot-rank.js'), 'utf8')
  vm.runInNewContext(source, sandbox, { filename: 'utils/hot-rank.js' })
  exports = sandbox.module.exports
  assert.strictEqual(typeof exports.isDailyHotVisible, 'function', 'isDailyHotVisible 必须导出')
  assert.strictEqual(typeof exports.setDailyHotVisible, 'function', 'setDailyHotVisible 必须导出')
  return { hotRank: exports, state, appStub }
}

// 加载真实设置页（hot-rank 用上面同源沙箱实例，保证联动可断言）
function loadSettingsPage(hotRankReal, hotState, hotAppStub) {
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-user', 'pages', 'settings', 'index.js'), 'utf8')
  const state = { storage: hotState.storage }
  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] }
  }
  const appStub = { globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: hotAppStub.globalData.userInfo } }
  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => appStub,
    wx: wxStub,
    require: (modulePath) => {
      if (/utils\/hot-rank$/.test(String(modulePath).split('\\').join('/'))) return hotRankReal
      // 「卡片动效」与本测试无关，桩里返回默认开启
      if (/utils\/motion$/.test(String(modulePath).split('\\').join('/'))) return {
        isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false
      }
      if (/utils\/subscribe$/.test(String(modulePath).split('\\').join('/'))) return { requestSubscribe: () => Promise.resolve({ accepted: [], rejected: [] }) }
      // 设置页会 GET/PUT /user/info 水合「隐藏主页帖子」；本测试不断言它，桩里返回 null 让其短路
      if (/utils\/request$/.test(String(modulePath).split('\\').join('/'))) return {
        get: () => Promise.resolve(null), put: () => Promise.resolve({})
      }
      throw new Error('测试桩未覆盖的模块：' + modulePath)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'settings/index.js' })
  assert.ok(pageConfig, 'Page() 未被调用')
  function makeInstance() {
    const inst = Object.assign({}, pageConfig, { data: plain(pageConfig.data) })
    inst.setData = function setData(patch, callback) {
      const apply = (target, keyPath, value) => {
        const keys = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.')
        let node = target
        for (let i = 0; i < keys.length - 1; i++) {
          if (node[keys[i]] === undefined) node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}
          node = node[keys[i]]
        }
        node[keys[keys.length - 1]] = value
      }
      Object.keys(patch).forEach((key) => apply(inst.data, key, patch[key]))
      if (typeof callback === 'function') callback()
    }
    return inst
  }
  return { makeInstance, state, appStub }
}

async function run() {
  // ===== A. 真实 hot-rank 偏好读写 =====
  const { hotRank, state, appStub } = loadHotRank()

  // A1. 默认开启
  check(() => {
    state.storage = {}
    assert.strictEqual(hotRank.isDailyHotVisible(), true, '未记录过的用户默认开启')
  }, 'A1. 每日热榜对未设置过的用户默认开启')

  // A2. 关闭/开启往返
  check(() => {
    state.storage = {}
    hotRank.setDailyHotVisible(false)
    assert.strictEqual(hotRank.isDailyHotVisible(), false)
    hotRank.setDailyHotVisible(true)
    assert.strictEqual(hotRank.isDailyHotVisible(), true)
  }, 'A2. 关闭后读取为关，重新开启恢复')

  // A3. 用户隔离：user 3 关闭不影响 user 7
  check(() => {
    state.storage = {}
    appStub.globalData.userInfo = { id: 3 }
    hotRank.setDailyHotVisible(false)
    assert.strictEqual(hotRank.isDailyHotVisible(), false, 'user 3 已关闭')
    appStub.globalData.userInfo = { id: 7 }
    assert.strictEqual(hotRank.isDailyHotVisible(), true, 'user 7 不受影响，默认开启')
    hotRank.setDailyHotVisible(false)
    assert.strictEqual(hotRank.isDailyHotVisible(), false)
    appStub.globalData.userInfo = { id: 3 }
    assert.strictEqual(hotRank.isDailyHotVisible(), false, '切回 user 3 仍是关闭')
  }, 'A3. 各登录用户开关状态独立保存（3 与 7 互不影响）')

  // A4. 未登录回退 guest
  check(() => {
    state.storage = {}
    appStub.globalData.userInfo = null
    assert.strictEqual(hotRank.isDailyHotVisible(), true, '未登录默认开启')
    hotRank.setDailyHotVisible(false)
    assert.strictEqual(hotRank.isDailyHotVisible(), false)
    appStub.globalData.userInfo = { id: 3 }
    assert.strictEqual(hotRank.isDailyHotVisible(), true, '游客关闭不影响登录用户（user 3 未记录，默认开启）')
  }, 'A4. 未登录回退 guest 维度，与登录用户互不影响（默认开启）')

  // A5. 存储结构
  check(() => {
    state.storage = {}
    appStub.globalData.userInfo = { id: 9 }
    hotRank.setDailyHotVisible(false)
    const map = state.storage.dailyHot_by_user
    assert.ok(map && map['9'] === false, '偏好按用户 id 存于 dailyHot_by_user')
  }, 'A5. 偏好持久化到 dailyHot_by_user 且按用户 id 分键')

  // ===== B. 设置页接线（真实 hot-rank 同源） =====
  const { makeInstance } = loadSettingsPage(hotRank, state, appStub)

  // B1. onLoad 读取当前用户偏好
  check(() => {
    state.storage = {}
    appStub.globalData.userInfo = { id: 3 }
    hotRank.setDailyHotVisible(false)
    const inst = makeInstance()
    inst.onLoad()
    assert.strictEqual(inst.data.dailyHotVisible, false, '设置页展示当前用户已关闭状态')
  }, 'B1. 设置页 onLoad 读取当前用户的每日热榜偏好')

  // B2. 切换开关写用户键且不写 system_settings
  check(() => {
    state.storage = {}
    appStub.globalData.userInfo = { id: 3 }
    const inst = makeInstance()
    inst.onLoad()
    inst.onSettingChange({ currentTarget: { dataset: { key: 'dailyHot' } }, detail: { value: false } })
    assert.strictEqual(hotRank.isDailyHotVisible(), false, '关闭写入用户维度偏好')
    assert.strictEqual(inst.data.dailyHotVisible, false)
    const systemSettings = state.storage.system_settings || {}
    assert.ok(!('dailyHot' in systemSettings), '不得再写设备级 system_settings.dailyHot')
    inst.onSettingChange({ currentTarget: { dataset: { key: 'dailyHot' } }, detail: { value: true } })
    assert.strictEqual(hotRank.isDailyHotVisible(), true, '重新开启恢复')
  }, 'B2. 设置页切换按用户维度持久化，且不写 system_settings')

  // B3. 切换用户后设置页各读各的
  check(() => {
    state.storage = {}
    appStub.globalData.userInfo = { id: 3 }
    hotRank.setDailyHotVisible(false)
    const inst3 = makeInstance()
    inst3.onLoad()
    assert.strictEqual(inst3.data.dailyHotVisible, false)
    appStub.globalData.userInfo = { id: 7 }
    const inst7 = makeInstance()
    inst7.onLoad()
    assert.strictEqual(inst7.data.dailyHotVisible, true, 'user 7 的设置页显示默认开启')
  }, 'B3. 不同用户在设置页看到各自独立的开关状态（默认开启）')

  // ===== C. 页面接线护栏（源码断言） =====
  check(() => {
    const read = (p) => require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, p), 'utf8')
    // 首页：预览卡/加载卡/浮动按钮/最热榜单 分类区
    const indexWxml = read('pages/index/index.wxml')
    assert.ok(indexWxml.indexOf('wx:if="{{dailyHotVisible && hotPosts.length}}"') > -1, '首页热榜预览卡受偏好控制')
    assert.ok(indexWxml.indexOf('wx:elif="{{dailyHotVisible && hotLoading}}"') > -1, '首页热榜加载卡受偏好控制')
    // 按钮弹性按压接入后 class 会带 spring-btn，匹配放宽到 class 内包含 float-btn（意图不变）
    assert.ok(/class="float-btn[^"]*"[^>]*wx:if="\{\{dailyHotVisible\}\}"/.test(indexWxml), '首页每日热榜浮动按钮受偏好控制')
    assert.ok(indexWxml.indexOf('isHotCategory && !dailyHotVisible') > -1, '最热分类关闭时显示关闭提示')
    const indexJs = read('pages/index/index.js')
    assert.ok(indexJs.indexOf('hotRank.isDailyHotVisible()') > -1, '首页 onShow 同步偏好')
    assert.ok(indexJs.indexOf('if (!this.data.dailyHotVisible) return') > -1, 'onTodayHotTap 偏好兜底')
    // 帖子详情页
    const detailWxml = read('pages/post-detail/index.wxml')
    assert.ok(detailWxml.indexOf('wx:if="{{dailyHotVisible && hotPosts.length}}"') > -1, '详情页热榜预览卡受偏好控制')
    assert.ok(detailWxml.indexOf('wx:elif="{{dailyHotVisible && hotLoading}}"') > -1)
    assert.ok(read('pages/post-detail/index.js').indexOf('hotRank.isDailyHotVisible()') > -1, '详情页 onShow 同步偏好')
    // 搜索页
    const searchWxml = read('pages/search/index.wxml')
    assert.ok(searchWxml.indexOf('wx:if="{{!searched && dailyHotVisible}}"') > -1, '搜索页今日热榜区受偏好控制')
    assert.ok(read('pages/search/index.js').indexOf('isDailyHotVisible()') > -1, '搜索页 onShow 同步偏好')
    // 独立热榜页
    const rankJs = read('pages/hot-rank/index.js')
    assert.ok(rankJs.indexOf('isDailyHotVisible()') > -1, '热榜页 onShow 校验偏好')
    assert.ok(rankJs.indexOf('navigateBack') > -1, '关闭时退出热榜页')
    // 设置页
    const settingsWxml = read('pkg-user/pages/settings/index.wxml')
    assert.ok(settingsWxml.indexOf("item.key === 'dailyHot' ? dailyHotVisible") > -1, '设置页每日热榜开关绑定用户偏好字段')
  }, 'C. 五个页面与设置页的接线护栏（偏好隐藏逻辑不被误删）')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
