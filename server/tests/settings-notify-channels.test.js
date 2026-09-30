/**
 * 设置页「通知渠道」开关测试（无需数据库 / 无需真机）
 *
 * 需求：通知卡片现有两项下方新增六个渠道主开关（评论通知/私信通知/审核结果通知/
 * 代拿跑腿通知/活动结果通知/提现结果通知），右侧带展开箭头，可展开子开关栏；
 * 「新的评论提醒」「评论回复通知」移入评论通知展开栏（与发布页弹窗共用同一份存储）。
 *
 * 覆盖：
 *   A. 默认全开 / 从两份存储恢复上次选择（评论键联动发布页、其余走 notify_channel_prefs）
 *   B. 展开箭头只切可见性，重复展开/收起不丢状态
 *   C. 主开关级联：关→全部子项同步关闭（含发布页共用键）；开→全部开启
 *   D. 子开关独立切换；主开关随「是否全部开启」联动
 *   E. 持久化分键正确：评论键不含其他渠道、渠道键不含评论键、发布页 granted* 字段保留
 *   F. wxml/js 接线护栏（六个渠道、三個 handler、双向绑定不被误删）
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

function loadSettingsPage() {
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'settings', 'index.js'), 'utf8')
  const state = { storage: {} }
  const wxStub = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value },
    removeStorageSync: (key) => { delete state.storage[key] }
  }
  // 「显示每日热榜」按用户维度偏好桩：与 utils/hot-rank.js 同源语义（读写 dailyHot_by_user）
  const appStub = { globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: null } }
  const currentUid = () => {
    const info = appStub.globalData.userInfo
    return (info && info.id) || 'guest'
  }
  const hotRankStub = {
    isDailyHotVisible: () => {
      const map = wxStub.getStorageSync('dailyHot_by_user') || {}
      return map[currentUid()] === undefined ? true : !!map[currentUid()]
    },
    setDailyHotVisible: (visible) => {
      const map = wxStub.getStorageSync('dailyHot_by_user') || {}
      map[currentUid()] = !!visible
      wxStub.setStorageSync('dailyHot_by_user', map)
    }
  }
  // 订阅授权桩：记录 requestSubscribe 调用并模拟全部授权成功
  const subscribeCalls = []
  const subscribeStub = {
    requestSubscribe: (types) => {
      subscribeCalls.push((types || []).slice())
      return Promise.resolve({ accepted: (types || []).slice(), rejected: [] })
    }
  }
  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    getApp: () => appStub,
    wx: wxStub,
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/utils\/hot-rank$/.test(norm)) return hotRankStub
      // 「卡片动效」开关与通知无关，本测试不断言它，桩里返回默认开启即可
      if (/utils\/motion$/.test(norm)) return {
        isCardFxPreferred: () => true,
        setCardFxPreferred: () => {},
        isCardFxOff: () => false,
        isLowEndDevice: () => false,
        getBenchmarkLevel: () => -1
      }
      if (/utils\/subscribe$/.test(norm)) return subscribeStub
      // 设置页 GET/PUT /user/info 水合「隐藏主页帖子」，本测试不断言，返回 null 让其短路
      if (/utils\/request$/.test(norm)) return {
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
  return { makeInstance, state, pageConfig }
}

function channelOf(inst, key) {
  const index = inst.data.notifyChannels.findIndex((c) => c.key === key)
  assert.ok(index > -1, '渠道存在: ' + key)
  return { channel: inst.data.notifyChannels[index], index }
}

function run() {
  const { makeInstance, state, pageConfig } = loadSettingsPage()
  const CHANNEL_NAMES = ['评论通知', '私信通知', '审核结果通知', '活动审核通知', '代拿/跑腿通知', '活动结果通知', '活动订阅', '提现结果通知']

  // A1. 首次进入：八个渠道齐全、全部默认关闭（需求：默认关闭，手动开启才生效）
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    assert.deepStrictEqual(inst.data.notifyChannels.map((c) => c.name), CHANNEL_NAMES, '八个渠道名称与顺序')
    inst.data.notifyChannels.forEach((c) => assert.strictEqual(c.on, false, c.key + ' 默认关闭'))
    Object.keys(inst.data.channelPrefs).forEach((k) => assert.strictEqual(inst.data.channelPrefs[k], false, k + ' 默认关闭'))
  }, 'A1. 首次进入八个渠道齐全且全部默认关闭')

  // A2. 从两份存储恢复上次选择，主开关按「全部子项开启」推导
  check(() => {
    state.storage = {
      subscribe_comment_prefs: { commentNew: false, grantedCommentNew: true },
      notify_channel_prefs: { errandAccepted: false, withdrawSuccess: false }
    }
    const inst = makeInstance()
    inst.onLoad()
    assert.strictEqual(inst.data.channelPrefs.commentNew, false)
    assert.strictEqual(inst.data.channelPrefs.commentReply, false, '缺失键回落默认关闭')
    assert.strictEqual(inst.data.channelPrefs.errandAccepted, false)
    assert.strictEqual(inst.data.channelPrefs.withdrawSuccess, false)
    assert.strictEqual(inst.data.channelPrefs.withdrawResult, false, '提现结果通知缺失键回落默认关闭')
    assert.strictEqual(channelOf(inst, 'comment').channel.on, false, '全部关闭→父开关闭合')
    assert.strictEqual(channelOf(inst, 'errand').channel.on, false)
    assert.strictEqual(channelOf(inst, 'withdraw').channel.on, false)
    assert.strictEqual(channelOf(inst, 'message').channel.on, false)
    assert.strictEqual(channelOf(inst, 'activity').channel.on, false)
  }, 'A2. 从共用评论键与渠道键恢复选择，缺失键回落默认关闭')

  // B. 展开箭头只切可见性，收起再展开保留开关状态
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'comment' } } })
    assert.strictEqual(channelOf(inst, 'comment').channel.open, true)
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'comment', key: 'commentReply' } }, detail: { value: true } })
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'comment' } } })
    assert.strictEqual(channelOf(inst, 'comment').channel.open, false)
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'comment' } } })
    assert.strictEqual(channelOf(inst, 'comment').channel.open, true)
    assert.strictEqual(inst.data.channelPrefs.commentReply, true, '再次展开保留之前的开关状态')
    assert.strictEqual(inst.data.channelPrefs.commentNew, false, '未操作的子开关保持默认关闭')
  }, 'B. 展开箭头切换可见性，展开/收起不重置子开关状态')

  // C1. 关闭评论主开关 → 两个子开关同步关闭并写入发布页共用键
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    inst.onChannelMainChange({ currentTarget: { dataset: { key: 'comment' } }, detail: { value: false } })
    assert.strictEqual(channelOf(inst, 'comment').channel.on, false)
    const comment = state.storage.subscribe_comment_prefs
    assert.strictEqual(comment.commentNew, false)
    assert.strictEqual(comment.commentReply, false)
  }, 'C1. 关闭评论主开关：两个子开关同步全部关闭（需求级联）')

  // C2. 主开关关闭不丢发布页写入的授权结果字段；再开主开关→全部开启
  check(() => {
    state.storage = { subscribe_comment_prefs: { commentNew: true, commentReply: true, grantedCommentNew: true, grantedCommentReply: true } }
    const inst = makeInstance()
    inst.onLoad()
    inst.onChannelMainChange({ currentTarget: { dataset: { key: 'comment' } }, detail: { value: false } })
    inst.onChannelMainChange({ currentTarget: { dataset: { key: 'comment' } }, detail: { value: true } })
    const comment = state.storage.subscribe_comment_prefs
    assert.strictEqual(comment.grantedCommentNew, true, '发布页授权结果字段不被覆盖丢失')
    assert.strictEqual(comment.grantedCommentReply, true)
    assert.strictEqual(comment.commentNew, true)
    assert.strictEqual(comment.commentReply, true)
    assert.strictEqual(channelOf(inst, 'comment').channel.on, true)
  }, 'C2. 主开关再开启恢复全开，发布页 granted* 字段保留')

  // D. 子开关独立切换 + 主开关联动
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    // 跑腿三子项（默认全关）：先开两个→父开关开启；关掉一个→父开关保持开启（仍有子项开）
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'errand' } } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandAccepted' } }, detail: { value: true } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandFinished' } }, detail: { value: true } })
    assert.strictEqual(inst.data.channelPrefs.errandCancelled, false, '未操作的子开关保持默认关闭')
    assert.strictEqual(channelOf(inst, 'errand').channel.on, true, '部分开启→父开关保持开启')
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandFinished' } }, detail: { value: false } })
    assert.strictEqual(inst.data.channelPrefs.errandFinished, false)
    assert.strictEqual(inst.data.channelPrefs.errandAccepted, true, '其余子开关不受影响')
    assert.strictEqual(channelOf(inst, 'errand').channel.on, true, '部分开启→父开关保持开启')
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandCancelled' } }, detail: { value: true } })
    assert.strictEqual(channelOf(inst, 'errand').channel.on, true, '子项全开后父开关开启')
    // 全部子项关闭 → 父开关才自动关闭
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandAccepted' } }, detail: { value: false } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandFinished' } }, detail: { value: false } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'errand', key: 'errandCancelled' } }, detail: { value: false } })
    assert.strictEqual(inst.data.channelPrefs.errandAccepted, false)
    assert.strictEqual(inst.data.channelPrefs.errandFinished, false)
    assert.strictEqual(channelOf(inst, 'errand').channel.on, false, '全部子项关闭后父开关联动关闭')
  }, 'D. 子开关独立切换不影响其余子开关，部分开启父保持开、全关父自动关')

  // D1b. 连续快速点击（交互冲突）：事件按到达顺序依次收敛，最终状态与最后一次一致
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'comment' } } })
    // 快速连点同一子开关：关→开→关→开，最终应为开
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'comment', key: 'commentReply' } }, detail: { value: false } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'comment', key: 'commentReply' } }, detail: { value: true } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'comment', key: 'commentReply' } }, detail: { value: false } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'comment', key: 'commentReply' } }, detail: { value: true } })
    assert.strictEqual(inst.data.channelPrefs.commentReply, true, '连点后最终与最后一次一致')
    assert.strictEqual(state.storage.subscribe_comment_prefs.commentReply, true, '持久化与最终状态一致')
    // 快速连点父开关：开→关→开，最终全部子开关应为开
    inst.onChannelMainChange({ currentTarget: { dataset: { key: 'comment' } }, detail: { value: false } })
    inst.onChannelMainChange({ currentTarget: { dataset: { key: 'comment' } }, detail: { value: true } })
    assert.strictEqual(inst.data.channelPrefs.commentNew, true)
    assert.strictEqual(inst.data.channelPrefs.commentReply, true)
    assert.strictEqual(channelOf(inst, 'comment').channel.on, true, '父开关连点后状态自洽')
  }, 'D1b. 连续快速点击父/子开关：状态按事件顺序收敛、双向一致')

  // D2. 审核结果渠道：三个子开关独立 + 级联（活动审核通知已拆为独立渠道）
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    // 展开后子开关名称与顺序；活动审核为独立单子项渠道
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'audit' } } })
    const audit = channelOf(inst, 'audit').channel
    assert.deepStrictEqual(audit.subs.map((s) => s.name), [ '认证审核通知', '审核结果通知', '审核通过' ])
    assert.deepStrictEqual(channelOf(inst, 'activityAudit').channel.subs.map((s) => s.name), [ '活动审核结果' ])
    // 先开启三个子项（auditCert/audit/auditPass）
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'audit', key: 'auditCert' } }, detail: { value: true } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'audit', key: 'audit' } }, detail: { value: true } })
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'audit', key: 'auditPass' } }, detail: { value: true } })
    // 单独关闭「审核通过」→ 其余两个不受影响，父开关保持开启（仍有子项开启）
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'audit', key: 'auditPass' } }, detail: { value: false } })
    assert.strictEqual(inst.data.channelPrefs.auditPass, false)
    assert.strictEqual(inst.data.channelPrefs.auditCert, true, '其余子开关不受影响')
    assert.strictEqual(inst.data.channelPrefs.audit, true, '其余子开关不受影响')
    assert.strictEqual(channelOf(inst, 'audit').channel.on, true, '部分开启→父开关保持开启')
    // 关闭主开关 → 全部子开关同步关闭（需求级联）
    inst.onChannelMainChange({ currentTarget: { dataset: { key: 'audit' } }, detail: { value: false } })
    assert.strictEqual(inst.data.channelPrefs.auditPass, false)
    assert.strictEqual(inst.data.channelPrefs.auditCert, false)
    assert.strictEqual(inst.data.channelPrefs.audit, false)
    assert.strictEqual(channelOf(inst, 'audit').channel.on, false)
    // 收起再展开 → 保留之前的状态
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'audit' } } })
    inst.onToggleChannelOpen({ currentTarget: { dataset: { key: 'audit' } } })
    assert.strictEqual(inst.data.channelPrefs.auditCert, false, '再次展开保留之前的开关状态')
    assert.strictEqual(channelOf(inst, 'audit').channel.open, true)
  }, 'D2. 审核结果渠道三子开关：独立切换、主开关级联全关、展开保留状态')

  // E. 持久化分键：评论键与渠道键互不混入
  check(() => {
    state.storage = {}
    const inst = makeInstance()
    inst.onLoad()
    inst.onChannelSubChange({ currentTarget: { dataset: { channel: 'message', key: 'message' } }, detail: { value: true } })
    const channelStore = state.storage.notify_channel_prefs
    const commentStore = state.storage.subscribe_comment_prefs
    assert.strictEqual(channelStore.message, true)
    assert.ok(!('commentNew' in channelStore) && !('commentReply' in channelStore), '渠道键不含评论子开关')
    assert.strictEqual(commentStore.commentNew, false, '评论子开关仍写入共用评论键（默认关闭值）')
    assert.ok(!('message' in commentStore), '评论键不含其他渠道子开关')
  }, 'E. 持久化分键正确（评论走共用键，其余走渠道键，互不混入）')

  // F. wxml/js 接线护栏
  check(() => {
    const wxml = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'settings', 'index.wxml'), 'utf8')
    // 渠道名是 data 驱动渲染，wxml 只断言结构绑定
    assert.ok(wxml.indexOf('wx:for="{{notifyChannels}}"') > -1, 'wxml 必须循环渲染八个渠道')
    assert.ok(wxml.indexOf('wx:for="{{channel.subs}}"') > -1, 'wxml 必须循环渲染子开关栏')
    assert.ok(wxml.indexOf('wx:if="{{channel.open}}"') > -1, '子开关栏受 open 控制展开')
    assert.ok(wxml.indexOf("bindchange=\"onChannelMainChange\"") > -1)
    assert.ok(wxml.indexOf("bindchange=\"onChannelSubChange\"") > -1)
    assert.ok(wxml.indexOf("catchtap=\"onToggleChannelOpen\"") > -1)
    assert.ok(wxml.indexOf('checked="{{channel.on}}"') > -1)
    assert.ok(wxml.indexOf('checked="{{channelPrefs[sub.key]}}"') > -1)
    assert.ok(wxml.indexOf('channel-arrow {{channel.open') > -1, '展开箭头样式类')
    const js = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'settings', 'index.js'), 'utf8')
    CHANNEL_NAMES.forEach((name) => assert.ok(js.indexOf(name) > -1, 'js 渠道定义含: ' + name))
    assert.ok(js.indexOf("'subscribe_comment_prefs'") > -1, '评论子开关必须读写发布页共用键')
    assert.ok(js.indexOf("'notify_channel_prefs'") > -1)
    assert.ok(js.indexOf('新的评论提醒') > -1 && js.indexOf('评论回复通知') > -1, '两个评论子开关已移入设置页')
    assert.ok(js.indexOf('新活动提醒') > -1 && js.indexOf('活动参与成功提醒') > -1 && js.indexOf('活动报名通知') > -1, '活动订阅三个子开关已移入设置页')
    assert.ok(js.indexOf('认证审核通知') > -1 && js.indexOf('审核结果通知') > -1 && js.indexOf('审核通过') > -1, '审核结果渠道三个子开关齐备')
    assert.ok(!/activitySubscription/.test(js), '旧的 activitySubscription 平开关已升级为渠道')
  }, 'F. wxml/js 接线护栏（渠道结构、三个 handler、共用键不被误删）')

  // G. 弹窗触发组 ↔ 设置页渠道子开关 互通护栏（结构化核对，防两侧漂移）
  check(() => {
    const subscribeSrc = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'utils', 'subscribe.js'), 'utf8')
    // 1) 逐行提取真实 TRIGGER_GROUPS 的 keys（容忍行尾逗号）
    const groupSubs = {}
    subscribeSrc.split('\n').forEach((line) => {
      const m = line.match(/^  (postPublish|withdraw|activityIndex|activityPublish|activitySignup|errandPublish|message): \{ prefsKey: '([^']+)', keys: \[(.+?)\], grantedKeys: \[(.+?)\] \},?\r?$/)
      if (m) groupSubs[m[1]] = { prefsKey: m[2], keys: m[3].split(',').map((s) => s.trim().replace(/'/g, '')), grantedKeys: m[4].split(',').map((s) => s.trim().replace(/'/g, '')) }
    })
    assert.deepStrictEqual(Object.keys(groupSubs).sort(), ['activityIndex', 'activityPublish', 'activitySignup', 'errandPublish', 'message', 'postPublish', 'withdraw'], '七组触发组定义齐备')
    // 2) 结构化提取真实渠道子开关（pageConfig.data）
    const channelSubs = {}
    pageConfig.data.notifyChannels.forEach((ch) => { channelSubs[ch.key] = ch.subs.map((s) => s.key) })
    // 3) 触发组 → 渠道映射：组内每个开关必须在对应渠道中存在（互通的硬约束）
    const map = { postPublish: 'comment', withdraw: 'withdraw', activityIndex: 'activitySub', activityPublish: 'activityAudit', activitySignup: 'activity', errandPublish: 'errand', message: 'message' }
    Object.keys(map).forEach((trigger) => {
      const missing = groupSubs[trigger].keys.filter((k) => !(channelSubs[map[trigger]] || []).includes(k))
      assert.strictEqual(missing.length, 0, '触发组 ' + trigger + ' 的开关必须在设置页渠道 ' + map[trigger] + ' 中：缺 ' + missing.join(','))
    })
    // 4) 反向：渠道子开关里无弹窗触点的仅允许审核三类（纯偏好管理）
    const allGroupKeys = Object.keys(groupSubs).reduce((acc, g) => acc.concat(groupSubs[g].keys), [])
    const noTrigger = Object.keys(channelSubs).reduce((acc, ck) => acc.concat(channelSubs[ck].filter((k) => !allGroupKeys.includes(k))), [])
    assert.deepStrictEqual(noTrigger.sort(), ['audit', 'auditCert', 'auditPass'], '无触点子开关白名单（超出即需接入弹窗或补充白名单）')
    // 5) 全部渠道子开关必须已注册真实模板 ID（否则授权申请会被静默过滤）
    const ids = [...subscribeSrc.matchAll(/^  ([A-Za-z]+): '/gm)].map((m) => m[1]).filter((k) => !['activity', 'errand', 'interact'].includes(k))
    const noId = allSubKeysOf(channelSubs).filter((k) => !ids.includes(k))
    assert.deepStrictEqual(noId, [], '每个渠道子开关都必须有真实模板 ID，缺: ' + noId.join(','))
    function allSubKeysOf(chs) { return Object.keys(chs).reduce((acc, ck) => acc.concat(chs[ck]), []) }
  }, 'G. 弹窗触发组与设置页渠道子开关互通护栏（七组全覆盖 + 模板 ID 全注册）')
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
