/**
 * 社团详情页测试（无需真机 / 无需数据库）
 * 用 vm 加载真实页面文件 pkg-feature/pages/club/club-detail.js，注入假 wx 与假 api 桩。
 *
 * 覆盖：
 *   - 无 id（深链被截断）→ 直接空态且不打接口
 *   - 正常渲染：名称/简介/分类/校区/成员/近期活动，tags 拆数组、时间裁剪、报名文案
 *   - ISO（UTC）时间输入必须换算成本地时区（否则显示会差 8 小时）
 *   - 接口 404（社团不存在/已下架/已删除）→ notFound 空态，而不是白屏或误报网络错误
 *   - 网络异常 → loadError 可重试态
 *   - 响应缺 club → 按不存在处理
 *   - 点击近期活动 → 跳活动详情
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-feature', 'pages', 'club', 'club-detail.js'), 'utf8')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

// ===== 桩 =====
const realClubData = require('../../pkg-feature/utils/club-data')

let apiCalls = []
let apiResult = null
let apiError = null
const apiStub = {
  getClubDetail(id) {
    apiCalls.push(id)
    if (apiError) return Promise.reject(apiError)
    return Promise.resolve(apiResult)
  }
}

let navTitle = ''
let toastText = ''
let navigatedTo = null
let backCalled = 0
const wxStub = new Proxy({
  setNavigationBarTitle: (opt) => { navTitle = opt.title },
  showToast: (opt) => { toastText = opt.title },
  vibrateShort: () => undefined,
  navigateTo: (opt) => { navigatedTo = opt.url },
  navigateBack: () => { backCalled += 1 },
  redirectTo: () => { backCalled += 1 },
  stopPullDownRefresh: () => undefined,
  setClipboardData: () => undefined
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
  // api 打桩（不真请求）；club-data 用真实模块，锁住 themeFromColor 的导出名
  require: (name) => (/utils\/api$/.test(String(name)) ? apiStub : realClubData),
  getApp: () => ({ globalData: {} }),
  getCurrentPages: () => [],
  wx: wxStub
}
let pageDefinition = null
sandbox.Page = (definition) => { pageDefinition = definition }
vm.createContext(sandbox)
vm.runInNewContext(source, sandbox, { filename: 'pkg-feature/pages/club/club-detail.js' })

check(() => {
  assert.ok(pageDefinition, '应调用 Page() 注册页面')
}, '页面加载')

function createPage(options) {
  const page = Object.create(pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  page.onLoad(options || {})
  return page
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

const SERVER_RESPONSE = {
  club: {
    id: 31, name: '武术社', tags: '武术 · 散打 · 传统套路',
    intro: '晨练传统，多次在校运会开幕式带来压轴表演。',
    recruit: '每学期初招新，晨练自愿参加',
    campus: '', categoryId: 1, categoryName: '艺术类', categoryColor: '#8B5CF6',
    // 与「申请创建社团」页同名的字段
    clubType: '学生社团',
    avatarUrl: 'https://cdn.example.com/avatar.png',
    qrcodeUrl: 'https://cdn.example.com/club-qr.png',
    adminQrcodeUrl: 'https://cdn.example.com/admin-qr.png',
    gzhQrcodeUrl: '',
    images: ['https://cdn.example.com/i1.png', 'https://cdn.example.com/i2.png', '', null],
    status: 1, createdAt: '2026-09-10 20:05:00', updatedAt: '2026-09-10 20:05:00'
  },
  creation: {
    appliedAt: '2026-09-10 20:00:00', approvedAt: '2026-09-10 20:05:00',
    reviewNote: '', creator: { userId: 21, nickName: '阿武', avatarUrl: '' }, reviewer: null
  },
  members: [
    { userId: 21, nickName: '阿武', avatarUrl: '', role: '负责人' },
    { userId: 1, nickName: '管理员', avatarUrl: 'https://cdn.example.com/a.png', role: '审核管理员' }
  ],
  activities: [
    { id: 106, title: '期末汇报演出', activityStart: '2026-09-10 19:00:00', location: '大礼堂', campus: '', coverUrl: '', capacity: 100, signupCount: 88 },
    { id: 107, title: '晨练打卡', activityStart: null, location: '', campus: '广州校区', coverUrl: '', capacity: 0, signupCount: 3 }
  ]
}

async function main() {
  // 1) 无 id：不打接口，直接空态
  {
    apiCalls = []
    apiResult = null
    apiError = null
    const page = createPage({})
    check(() => {
      assert.deepStrictEqual(apiCalls, [], '没有唯一标识时不应请求接口')
      assert.strictEqual(page.data.loading, false)
      assert.strictEqual(page.data.notFound, true, '无 id 应按不存在处理')
    }, '无 id 直接空态')
  }

  // 2) 正常渲染
  {
    apiCalls = []
    apiResult = SERVER_RESPONSE
    apiError = null
    navTitle = ''
    const page = createPage({ id: '31' })
    await flush()
    check(() => {
      assert.deepStrictEqual(apiCalls, [31], '应以数字 id 请求详情')
      assert.strictEqual(page.data.loading, false)
      assert.strictEqual(page.data.notFound, false)
      assert.strictEqual(page.data.club.name, '武术社')
      assert.strictEqual(page.data.club.char, '武', '应预计算首字符徽标')
      assert.deepStrictEqual(plain(page.data.club.tagList), ['武术', '散打', '传统套路'],
        'tags 应按 · 拆成数组供 wx:for 渲染')
      assert.strictEqual(page.data.campusText, '全部校区', '空校区应显示「全部校区」')
      assert.strictEqual(page.data.theme.deep, '#8B5CF6', '应从分类主色推导主题')
      assert.strictEqual(navTitle, '武术社', '请求返回后应把社团名设为导航栏标题')
    }, '正常渲染基础信息')

    check(() => {
      assert.strictEqual(page.data.members.length, 2)
      assert.strictEqual(page.data.members[0].char, '阿', '头像缺失时应用昵称首字符兜底')
      assert.strictEqual(page.data.members[1].role, '审核管理员')
    }, '成员列表渲染')

    // 与「申请创建社团」页同名的媒体字段：空 URL 必须被过滤，避免渲染出空图
    check(() => {
      const media = page.data.media
      assert.strictEqual(media.avatarUrl, 'https://cdn.example.com/avatar.png', '社团头像应透传')
      assert.strictEqual(media.qrcodeUrl, 'https://cdn.example.com/club-qr.png', '社团二维码应透传')
      assert.strictEqual(media.adminQrcodeUrl, 'https://cdn.example.com/admin-qr.png', '负责人微信二维码应透传')
      assert.strictEqual(media.gzhQrcodeUrl, '', '选填公众号二维码为空时应是空串（wx:if 不渲染）')
      assert.deepStrictEqual(plain(media.images), ['https://cdn.example.com/i1.png', 'https://cdn.example.com/i2.png'],
        '图片介绍应过滤掉空串与非字符串项')
    }, '申请页媒体字段')

    check(() => {
      // 二维码/图片预览：gallery 场景应带上全部图片供左右滑动
      let preview = null
      wxStub.previewImage = (opt) => { preview = opt }
      page.onPreview({ currentTarget: { dataset: { url: 'https://cdn.example.com/i2.png', urls: page.data.media.images } } })
      assert.deepStrictEqual(plain(preview.urls), ['https://cdn.example.com/i1.png', 'https://cdn.example.com/i2.png'],
        '预览应带全部图片')
      assert.strictEqual(preview.current, 'https://cdn.example.com/i2.png', '预览应定位到点击的那张')
      // 单图场景（如二维码）：urls 缺失时用 [url]
      page.onPreview({ currentTarget: { dataset: { url: 'https://cdn.example.com/admin-qr.png' } } })
      assert.deepStrictEqual(plain(preview.urls), ['https://cdn.example.com/admin-qr.png'], '无 urls 时应预览单图')
      delete wxStub.previewImage
    }, '图片预览')

    check(() => {
      const acts = page.data.activities
      assert.strictEqual(acts[0].timeText, '09-10 19:00', '活动时间应裁剪成 MM-DD HH:mm')
      assert.strictEqual(acts[0].signupText, '88/100 人已报名', '有名额上限应显示报名/上限')
      assert.strictEqual(acts[1].timeText, '时间待定', '空时间应显示「时间待定」')
      assert.strictEqual(acts[1].signupText, '3 人已报名', '无名额上限只显示报名人数')
    }, '近期活动渲染')

    check(() => {
      assert.strictEqual(page.data.creation.appliedText, '2026-09-10 20:00', '时间应裁掉秒')
      assert.strictEqual(page.data.creation.approvedText, '2026-09-10 20:05')
      assert.strictEqual(page.data.club.clubType, '学生社团', '社团类型应与申请页一致（展示在创建信息里）')
    }, '创建信息渲染')
  }

  // 3) 列表页带入 name：先占住导航栏标题
  {
    apiCalls = []
    apiResult = SERVER_RESPONSE
    navTitle = ''
    createPage({ id: '31', name: encodeURIComponent('武术社') })
    check(() => {
      assert.strictEqual(navTitle, '武术社', 'onLoad 就应先用带入的名称占住标题，避免闪「社团详情」')
    }, '名称占位标题')
  }

  // 4) ISO（UTC）时间：必须换算成本地时区，不能直接裁剪（否则差 8 小时）
  {
    apiCalls = []
    apiResult = Object.assign({}, SERVER_RESPONSE, {
      creation: Object.assign({}, SERVER_RESPONSE.creation, {
        appliedAt: '2026-09-10T12:14:37.000Z'
      })
    })
    apiError = null
    const page = createPage({ id: '31' })
    await flush()
    check(() => {
      const text = page.data.creation.appliedText
      assert.match(text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '应格式化成本地时间，实际是 ' + text)
      // 往返校验（与时区无关）：裁掉秒后应与原时刻在同一分钟
      const original = new Date('2026-09-10T12:14:37.000Z').getTime()
      const minuteStart = original - (original % 60000)
      const parsed = new Date(text.replace(' ', 'T') + ':00').getTime()
      assert.strictEqual(parsed, minuteStart, '本地化换算应表示同一分钟（' + text + '）')
    }, 'ISO 时间本地化')
  }

  // 5) 404：社团不存在 / 已下架 / 已删除 → 空态（不是白屏，也不是网络错误）
  {
    apiCalls = []
    apiResult = null
    apiError = Object.assign(new Error('社团不存在或已下线'), { statusCode: 404 })
    const page = createPage({ id: '31' })
    await flush()
    check(() => {
      assert.strictEqual(page.data.loading, false)
      assert.strictEqual(page.data.notFound, true, '404 应展示不存在空态')
      assert.strictEqual(page.data.loadError, false, '404 不应误报为网络错误')
    }, '404 空态')
  }

  // 6) 网络异常 → 可重试态
  {
    apiResult = null
    apiError = Object.assign(new Error('网络异常'), { isNetwork: true })
    toastText = ''
    const page = createPage({ id: '31' })
    await flush()
    check(() => {
      assert.strictEqual(page.data.loadError, true, '网络异常应进入可重试态')
      assert.strictEqual(page.data.notFound, false)
      assert.strictEqual(toastText, '网络异常', '应 toast 提示失败原因')
    }, '网络异常态')
  }

  // 7) 响应成功但没带 club：按不存在处理，不留白屏
  {
    apiResult = { club: null, members: [], activities: [] }
    apiError = null
    const page = createPage({ id: '31' })
    await flush()
    check(() => {
      assert.strictEqual(page.data.notFound, true, '响应缺 club 应按不存在处理')
    }, '空响应兜底')
  }

  // 8) 点击近期活动 → 跳活动详情
  {
    apiResult = SERVER_RESPONSE
    apiError = null
    const page = createPage({ id: '31' })
    await flush()
    navigatedTo = null
    page.onActivityTap({ currentTarget: { dataset: { id: 106 } } })
    check(() => {
      assert.strictEqual(navigatedTo, '/pkg-feature/pages/activity/detail?id=106', '应跳转到活动详情页')
    }, '活动跳转')
  }

  // 9) 下拉刷新：不存在态不再打接口；正常态刷新
  {
    apiCalls = []
    apiResult = null
    apiError = Object.assign(new Error('社团不存在或已下线'), { statusCode: 404 })
    const page = createPage({ id: '31' })
    await flush()
    apiCalls = []
    page.onPullDownRefresh()
    check(() => {
      assert.deepStrictEqual(apiCalls, [], '不存在态下拉刷新不应重复请求')
    }, '不存在态不刷新')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Club detail page tests failed:', err.message)
  process.exit(1)
})
