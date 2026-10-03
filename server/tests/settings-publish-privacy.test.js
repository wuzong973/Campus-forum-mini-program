/**
 * 设置页「发布/隐私」开关实效性测试（无需数据库 / 无需真机）
 *
 * 需求：排查图中 5 个开关是否真实生效，摆设的修复完善。
 * 排查结论：
 *   postAnonymous   ✓ 生效（发布页默认匿名）——护栏保护消费点
 *   commentAnonymous ✗ 已删（2026-09-12 用户要求）：评论默认公开，详情页手动切换匿名保留
 *   commentPublic   ✗ 纯摆设（与 commentAnonymous 同一事实的反面，无消费方）——已删除
 *   anonymousMessage ✗ 纯摆设（账号级「允许被匿名私信」在发帖页由服务端字段承载）——已删除
 *   hideProfilePosts ✓ 已接线（服务端驱动）：设置页 PUT /user/info 落库 sys_user.hide_profile_posts，
 *                        服务端对访客过滤帖子数与列表，个人主页按访客视角隐藏帖子 tab/统计
 *
 * 覆盖：
 *   A. 保留开关的消费点存在（源码断言，防误删）
 *   B. 摆设开关已彻底移除（settings 源码零残留）
 *   C. 设置页 vm 行为：写入 system_settings、不再产生 commentPublic 副作用
 *   D. hideProfilePosts → 服务端落库 + 访客过滤 + 个人主页访客视角接线（wxml/js/服务端护栏）
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

setTimeout(() => {
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function read(p) {
  return require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, p), 'utf8')
}

function loadSettingsPage() {
  const source = read('pages/settings/index.js')
  const state = { storage: {} }
  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] },
    showToast: () => {}
  }
  const hotRankStub = {
    isDailyHotVisible: () => true,
    setDailyHotVisible: () => {}
  }
  // 「卡片动效」开关读写走 utils/motion；本测试不断言它，桩里直接返回默认开启
  const motionStub = {
    isCardFxPreferred: () => true,
    setCardFxPreferred: () => {},
    isCardFxOff: () => false,
    isLowEndDevice: () => false,
    getBenchmarkLevel: () => -1
  }
  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: null } }),
    wx: wxStub,
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/utils\/hot-rank$/.test(norm)) return hotRankStub
      if (/utils\/motion$/.test(norm)) return motionStub
      if (/utils\/subscribe$/.test(norm)) return { requestSubscribe: () => Promise.resolve({ accepted: [], rejected: [] }) }
      // 「隐藏主页帖子」开关会同步 /user/info（GET 水合 + PUT 落库），桩里直接成功返回
      if (/utils\/request$/.test(norm)) return {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve({})
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
  return { makeInstance, state }
}

function run() {
  // A. 保留开关的消费点存在
  check(() => {
    const publishJs = read('pages/post-publish/index.js')
    assert.ok(publishJs.indexOf('settings.postAnonymous') > -1, '发布页必须消费 postAnonymous（发帖默认匿名）')
    assert.ok(/secondIdentity: true/.test(publishJs), '发布页按偏好置为匿名')
    const detailJs = read('pages/post-detail/index.js')
    assert.ok(detailJs.indexOf("commentAnonymous: !!((wx.getStorageSync('system_settings') || {}).commentAnonymous)") === -1, '设置开关已删，详情页不得再读 system_settings.commentAnonymous')
    assert.ok(detailJs.indexOf('commentAnonymous: false') > -1, '详情页评论默认公开（手动切换能力保留）')
  }, 'A. postAnonymous 消费点存在；commentAnonymous 已从详情页移除')

  // B. commentPublic/anonymousMessage 已按用户要求恢复（2026-09-12：先删后恢复，恢复语义见 C/F）
  check(() => {
    const settingsJs = read('pages/settings/index.js')
    assert.ok(settingsJs.indexOf("commentPublic: false") > -1, 'DEFAULT_SETTINGS 含 commentPublic（默认关闭）')
    assert.ok(settingsJs.indexOf("anonymousMessage: false") > -1, 'DEFAULT_SETTINGS 含 anonymousMessage（默认关闭）')
    assert.ok(settingsJs.indexOf("key: 'commentPublic'") > -1 && settingsJs.indexOf('评论默认不开启分身') > -1, 'UI 恢复「评论默认不开启分身」')
    assert.ok(settingsJs.indexOf("key: 'anonymousMessage'") > -1 && settingsJs.indexOf('默认允许分身私信') > -1, 'UI 恢复「默认允许分身私信」')
    assert.ok(!/commentAnonymous/.test(settingsJs), '设置页零残留 commentAnonymous（开关/默认值/互斥逻辑已删）')
  }, 'B. commentPublic/anonymousMessage 两开关在位；commentAnonymous 零残留')

  // C. 设置页行为：发布/隐私开关写入 system_settings
  check(() => {
    const { makeInstance, state } = loadSettingsPage()
    const inst = makeInstance()
    inst.onLoad()
    assert.strictEqual(inst.data.settings.postAnonymous, false, '默认关闭')
    inst.onSettingChange({ currentTarget: { dataset: { key: 'postAnonymous' } }, detail: { value: true } })
    assert.strictEqual(state.storage.system_settings.postAnonymous, true, '写入设备级设置')
    assert.strictEqual(inst.data.settings.postAnonymous, true)
    inst.onSettingChange({ currentTarget: { dataset: { key: 'commentPublic' } }, detail: { value: true } })
    const saved = state.storage.system_settings
    assert.strictEqual(saved.commentPublic, true, '评论默认不开启分身独立写入（无互斥副作用）')
    assert.ok(!('commentAnonymous' in saved), '不再写 commentAnonymous 键')
    inst.onSettingChange({ currentTarget: { dataset: { key: 'hideProfilePosts' } }, detail: { value: true } })
    assert.strictEqual(state.storage.system_settings.hideProfilePosts, true, '隐藏主页帖子写入设置')
  }, 'C. 保留开关经设置页写入 system_settings（commentAnonymous 键不再产生）')

  // D. hideProfilePosts → 服务端落库 + 访客过滤 + 个人主页访客视角接线
  //    语义（2026-09-30 起调整）：该开关关闭的是「访客能否看到我的帖子」，
  //    由服务端按 sys_user.hide_profile_posts 过滤；本人主页照常展示自己的帖子。
  check(() => {
    const profileJs = read('pages/profile/index.js')
    assert.ok(profileJs.indexOf('hideProfilePosts') > -1, '个人主页必须读取 hideProfilePosts')
    assert.ok(profileJs.indexOf('visitorHidden: false') > -1, '默认不隐藏（资料加载前）')
    assert.ok(profileJs.indexOf('visitorHidden: !currentUserProfile && !!profile.hideProfilePosts') > -1,
      '仅对访客生效：本人主页不受该开关影响')
    const profileWxml = read('pages/profile/index.wxml')
    assert.ok(profileWxml.indexOf('wx:if="{{!visitorHidden}}"') > -1, '帖子数统计对访客隐藏')
    assert.ok(profileWxml.indexOf("visitorHidden ? '已隐藏主页帖子' : item + ' ' + posts.length") > -1,
      '帖子 tab 文案按访客视角切换')
    assert.ok(profileWxml.indexOf("visitorHidden ? '该用户已隐藏主页帖子' : '还没有发布帖子'") > -1,
      '空态区分「已隐藏」与「还没有发布」')
    assert.ok(!/hideProfilePosts/.test(profileWxml), 'wxml 不得再依赖已删除的本地 hideProfilePosts 变量')
    // 服务端口径：开关必须真正过滤数据，而不是只改文案
    const userController = read('server/controllers/userController.js')
    assert.ok(userController.indexOf('const hidePostsFromVisitor = Number(u.hide_profile_posts) === 1 && Number(currentUserId) !== profileId') > -1,
      'getProfile 对访客归零 postCount')
    assert.ok(userController.indexOf('if (Number((targetUsers[0] || {}).hide_profile_posts) === 1 && Number(currentUserId) !== profileId)') > -1,
      'getProfilePosts 对访客返回空列表')
    assert.ok(userController.indexOf('fields.push("hide_profile_posts = ?")') > -1, 'updateInfo 落库 hide_profile_posts')
    const settingsJs = read('pages/settings/index.js')
    assert.ok(settingsJs.indexOf("request.put('/user/info', { hideProfilePosts: value ? 1 : 0 }") > -1, '设置页开关同步服务端')
  }, 'D. hideProfilePosts 已接线（设置页落库 + 服务端过滤访客 + 个人主页访客视角）')

  // F. anonymousMessage 接线：发帖页「允许被匿名私信」在服务端未设置时回退设备级默认
  check(() => {
    const publishJs = read('pages/post-publish/index.js')
    assert.ok(publishJs.indexOf("(wx.getStorageSync('system_settings') || {}).anonymousMessage") > -1, '发帖页读取设置页「默认允许分身私信」')
    assert.ok(publishJs.indexOf('typeof serverValue === \'boolean\' ? serverValue : localDefault') > -1, '服务端显式设置优先，未设置时用本地默认')
  }, 'F. 默认允许分身私信已接线（服务端未设置时的本地默认，不再纯摆设）')
}

try {
  run()
  console.log(testCount + ' tests passed.')
  process.exit(0)
} catch (err) {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
}
