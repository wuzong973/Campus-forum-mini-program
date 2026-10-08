/**
 * 首页宫格入口可用性护栏（源码级，无需真机 / 无需数据库）
 *
 * 背景：小程序曾因首页「找驾校」等入口点进去只弹出「即将上线」被微信审核驳回
 *      （《微信小程序平台运营规范常见拒绝情形》3.3 运营内容不完整）。
 *
 * 规则：首页宫格中的每个入口都必须能进入真实可用的内容 ——
 *      端上页面 / 服务端下发的外部小程序或 H5 / 首页分类列表。
 *      没有落地目标的入口不得出现在宫格中，端上也不得再出现「即将上线」提示。
 *
 * 改动宫格时，请同步维护下面的 ROW1 / ROW2 / 各入口登记表，测试会做双向校验。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const INDEX_JS = read('pages/index/index.js')
const SERVICE_ALL_JS = read('pkg-feature/pages/service-all/index.js')
const API_JS = read('utils/api.js')
const APP_JSON = JSON.parse(read('app.json'))
const SCHEDULE_HOME_JS = read('pkg-schedule/schedule-home/index.js')
const SCHEDULE_HOME_WXML = read('pkg-schedule/schedule-home/index.wxml')

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

// 首页宫格第一行（服务端教务 / 生活服务）——完整 12 列
const ROW1 = [
  '课程表', '教务系统', '成绩查询', '考试安排', '校历', '校园地图',
  '自助购电', '订水系统', '校车时刻', '乘车码', '轻友指南', '教务文档'
]

// 首页宫格第二行（端上固定目录）——完整 12 列
const ROW2 = [
  '校园活动', '广轻群聊', '社团&组织', '校园评价', '找驾校', '校园市场',
  '广轻义修', '校园卡', '速印', '失物招领', '返乡大巴', '特惠寄件'
]

// 暂无落地页的入口白名单：宫格内除「已登记落地方式」外的入口必须恰好等于这份名单。
// 现在 24 个入口全部有真实落地页，因此为空 —— 一旦有人新增了没有跳转的入口，用例会失败。
const PENDING_ENTRIES = []

// 端上页面型入口：首页源码里必须出现对应跳转目标
const PAGE_ENTRIES = [
  ['找驾校', '/pkg-feature/pages/driving-school/index'],
  ['校园活动', '/pkg-feature/pages/activity/index'],
  ['广轻群聊', '/pkg-feature/pages/group-chat/index'],
  ['社团&组织', '/pkg-feature/pages/club/index'],
  ['校园评价', '/pkg-feature/pages/review/index'],
  ['广轻义修', '/pkg-feature/pages/repair/index'],
  ['校园地图', '/pkg-feature/pages/campus-map/index'],
  ['考试安排', '/pkg-schedule/schedule-exam/index'],
  ['成绩查询', '/pkg-schedule/schedule-grade/index'],
  ['教务系统', '/pkg-schedule/schedule-home/index'],
  ['课程表', '/pages/schedule/index'],
  ['校历', '/pkg-schedule/schedule-calendar/index'],
  ['教务文档', '/pkg-schedule/schedule-home/index'],
  // 校园服务六项：共用一个页面，靠 ?id= 区分内容
  ['校车时刻', '/pages/campus-service/index'],
  ['轻友指南', '/pages/campus-service/index'],
  ['校园卡', '/pages/campus-service/index'],
  ['速印', '/pages/campus-service/index'],
  ['返乡大巴', '/pages/campus-service/index'],
  ['特惠寄件', '/pages/campus-service/index'],
  // 校园市场：独立的市场页（租赁服务 / 校园数码 / 校园家政 / DIY电脑 四个后台可编辑分类）
  ['校园市场', '/pkg-feature/pages/market/index']
]

// 映射到首页分类的入口
const CATEGORY_ENTRIES = [
  ['失物招领', '失物寻物']
]

// 依赖服务端下发跳转配置（外部小程序 / H5）的入口
const SERVER_LINK_ENTRIES = ['自助购电', '订水系统', '乘车码']

function extractRow1(source) {
  const start = source.indexOf('const row1 = [')
  assert.ok(start >= 0, '未找到 row1 定义')
  const body = source.slice(start, source.indexOf(']', start))
  return (body.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1))
}

function extractRow2(source) {
  const start = source.indexOf('const row2 = [')
  assert.ok(start >= 0, '未找到 row2 定义')
  const body = source.slice(start, source.indexOf(']', start))
  const names = []
  const re = /name: '([^']+)'/g
  let match
  while ((match = re.exec(body))) names.push(match[1])
  return names
}

// ---------------------------------------------------------------------
// A. 宫格名单与在册登记一致（双向）
// ---------------------------------------------------------------------
function gridRosterTests() {
  check(() => {
    assert.deepStrictEqual(extractRow1(INDEX_JS), ROW1)
  }, '首页宫格第一行与在册入口一致')

  check(() => {
    assert.deepStrictEqual(extractRow2(INDEX_JS), ROW2)
  }, '首页宫格第二行与在册入口一致')

  check(() => {
    assert.deepStrictEqual(ROW1.length, 12, '第一行应为 12 项（完整宫格）')
    assert.deepStrictEqual(ROW2.length, 12, '第二行应为 12 项（完整宫格）')
  }, '宫格保持完整 12 列 × 2 行')

  check(() => {
    // 宫格内除「已登记落地方式」外的入口，必须恰好等于已登记的待办名单；
    // 多出来说明悄悄新增了没有跳转的入口，少一个说明忘了同步这份名单
    const registered = PAGE_ENTRIES.map((e) => e[0])
      .concat(CATEGORY_ENTRIES.map((e) => e[0]))
      .concat(SERVER_LINK_ENTRIES)
    const unregistered = ROW1.concat(ROW2).filter((name) => registered.indexOf(name) < 0)
    assert.deepStrictEqual(
      unregistered.slice().sort(),
      PENDING_ENTRIES.slice().sort(),
      '未登记落地方式的入口应与 PENDING_ENTRIES 完全一致'
    )
  }, '未登记入口与待办名单一致')

  check(() => {
    // 这些入口点击会走兜底提示，必须存在兜底分支，不能静默无响应
    assert.match(INDEX_JS, /服务暂未开放/, '缺少兜底提示文案')
  }, '暂无落地页的入口有兜底提示')
}

// ---------------------------------------------------------------------
// B. 每个入口都能落到真实内容
// ---------------------------------------------------------------------
function entryDestinationTests() {
  for (const [name, url] of PAGE_ENTRIES) {
    check(() => {
      assert.ok(INDEX_JS.indexOf(url) >= 0, name + ' 缺少跳转目标 ' + url)
    }, '入口可跳转：' + name)
  }

  for (const [name, category] of CATEGORY_ENTRIES) {
    check(() => {
      assert.ok(
        INDEX_JS.indexOf("applyCategoryByName('" + category + "')") >= 0,
        name + ' 未映射到首页分类 ' + category
      )
    }, '入口可映射到分类：' + name)
  }

  for (const name of SERVER_LINK_ENTRIES) {
    check(() => {
      const start = API_JS.indexOf('const SERVICE_FALLBACK_LINKS = {')
      assert.ok(start >= 0, '未找到 SERVICE_FALLBACK_LINKS')
      // 对象内含嵌套花括号，取到行首的闭合花括号为止
      const end = API_JS.indexOf('\n}', start)
      const body = API_JS.slice(start, end > start ? end : start + 800)
      assert.ok(body.indexOf("'" + name + "'") >= 0, name + ' 缺少服务端跳转兜底配置')
    }, '入口有服务端跳转兜底：' + name)
  }

  const EXT_FILES = ['index.js', 'index.wxml', 'index.wxss', 'index.json']
  for (const page of ['driving-school', 'campus-service']) {
    check(() => {
      // 页面可能位于主包 pages/ 或分包 pkg-feature/pages/（找驾校已拆入分包）
      const roots = [
        { dir: path.join(ROOT, 'pages', page), reg: 'pages/' + page },
        { dir: path.join(ROOT, 'pkg-feature', 'pages', page), reg: 'pkg-feature/pages/' + page }
      ]
      const hit = roots.find((r) => EXT_FILES.every((file) => fs.existsSync(path.join(r.dir, file))))
      assert.ok(hit, '缺少文件 pages/' + page + '/ 或 pkg-feature/pages/' + page + '/')
    }, '页面文件齐备：pages/' + page)

    check(() => {
      const registered = APP_JSON.pages.concat(
        (APP_JSON.subPackages || []).reduce((all, sp) => all.concat((sp.pages || []).map((pp) => sp.root + '/' + pp)), [])
      )
      assert.ok(
        registered.indexOf('pages/' + page + '/index') >= 0 || registered.indexOf('pkg-feature/pages/' + page + '/index') >= 0,
        'app.json 未注册 pages/' + page + '/index 或 pkg-feature/pages/' + page + '/index'
      )
    }, '页面已在 app.json 注册：pages/' + page)
  }
}

// ---------------------------------------------------------------------
// C. 端上不再出现「即将上线」占位提示
// ---------------------------------------------------------------------
// 「即将上线」占位 toast（注释里提到这个词不算，只拦真正会弹出的提示）
const PLACEHOLDER_TOAST = /showToast\(\s*\{[^}]*即将上线/

function noPlaceholderTests() {
  check(() => {
    assert.ok(!PLACEHOLDER_TOAST.test(INDEX_JS), '首页仍存在「即将上线」提示')
  }, '首页不再出现「即将上线」')

  check(() => {
    assert.ok(!PLACEHOLDER_TOAST.test(SERVICE_ALL_JS), '全部服务页仍存在「即将上线」提示')
  }, '全部服务页不再出现「即将上线」')

  check(() => {
    assert.strictEqual(SCHEDULE_HOME_JS.indexOf('即将上线'), -1, '教务首页仍存在「即将上线」提示')
    assert.strictEqual(SCHEDULE_HOME_WXML.indexOf('onComingSoon'), -1, '教务首页仍绑定占位入口')
  }, '教务首页不再出现占位入口')
}

function main() {
  gridRosterTests()
  entryDestinationTests()
  noPlaceholderTests()
  console.log(testCount + ' tests passed.')
}

main()
