/**
 * 校园服务模块测试（校车时刻 / 轻友指南 / 校园卡 / 速印 / 返乡大巴 / 特惠寄件）
 *
 * 背景：首页宫格里这 6 个入口原先没有落地页，点击只弹「服务暂未开放」，
 *      与「运营内容不完整」的审核驳回同类。现在统一收敛到 pages/campus-service，
 *      由 utils/campus-services.js 提供内容，本测试守住三件事：
 *   A. 数据模块 —— 6 个服务内容完整（作用/场景/流程/提示/FAQ 都不为空）
 *   B. 页面行为 —— 加载真实页面按 id 渲染，未知 id 走兜底，FAQ 可展开
 *   C. 源码护栏 —— 页面注册、首页与全部服务页的路由接线、名字与宫格同步、
 *                  以及 WXML 表达式合法性
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

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

const campusServices = require(path.join(ROOT, 'utils', 'campus-services.js'))

// 与首页宫格保持一致的 6 个入口（改名时两处必须一起改，下面的用例会校验）
const EXPECTED = [
  ['校车时刻', 'school-bus'],
  ['轻友指南', 'campus-guide'],
  ['校园卡', 'campus-card'],
  ['速印', 'print'],
  ['返乡大巴', 'home-bus'],
  ['特惠寄件', 'express']
]

// =====================================================================
// A. 数据模块
// =====================================================================
function dataModuleTests() {
  check(() => {
    assert.strictEqual(campusServices.SERVICES.length, EXPECTED.length, '服务数量应为 6')
    const ids = campusServices.SERVICES.map((item) => item.id)
    assert.strictEqual(new Set(ids).size, ids.length, 'id 不能重复')
    assert.deepStrictEqual(
      campusServices.SERVICES.map((item) => [item.name, item.id]),
      EXPECTED,
      '服务名与 id 必须与首页宫格一致'
    )
  }, '服务清单与首页宫格一致')

  for (const [name] of EXPECTED) {
    check(() => {
      const service = campusServices.SERVICES.find((item) => item.name === name)
      assert.ok(service, name + ' 不存在')
      assert.ok(service.icon && service.icon.indexOf('/assets/') === 0, name + ' 缺少图标')
      assert.ok(service.tagline && service.tagline.length >= 6, name + ' 缺少一句话定位')
      if (service.id === 'school-bus') {
        // 校车时刻只留时刻表 + 流程 + 提示 + FAQ：两段介绍性文字已按产品决定删除，页面整卡不渲染
        assert.ok(!service.summary, '校车时刻不应再配置作用说明')
        assert.ok(!(service.scenes || []).length, '校车时刻不应再配置适用场景')
      } else {
        assert.ok(service.summary && service.summary.length >= 20, name + ' 缺少作用说明')
        assert.ok((service.scenes || []).length >= 3, name + ' 适用场景应至少 3 条')
      }
      assert.ok((service.steps || []).length >= 3, name + ' 使用流程应至少 3 步')
      assert.ok((service.tips || []).length >= 3, name + ' 温馨提示应至少 3 条')
      assert.ok((service.faqs || []).length >= 3, name + ' 常见问题应至少 3 条')
      assert.ok(service.info && service.info.title, name + ' 缺少关键信息标题')
      assert.ok(service.info.emptyText, name + ' 关键信息未填写时必须有降级文案')
      for (const faq of service.faqs) {
        assert.ok(faq.q && faq.a, name + ' 的常见问题缺少问或答')
      }
    }, '内容完整：' + name)
  }

  check(() => {
    // 关键信息属于运营数据：校车时刻已按校方公示填入，其余服务仍走降级展示
    const withInfo = campusServices.SERVICES.filter((item) => campusServices.hasServiceInfo(item))
    assert.deepStrictEqual(withInfo.map((item) => item.id), ['school-bus'], '当前仅校车时刻填写了关键信息')
    assert.strictEqual(campusServices.hasServiceInfo(null), false)
    assert.strictEqual(campusServices.hasServiceInfo({}), false)
    assert.strictEqual(campusServices.hasServiceInfo({ info: { items: [] } }), false)
    assert.strictEqual(campusServices.hasServiceInfo({ info: { items: [{ title: 'x' }] } }), true)
  }, '关键信息降级判定')

  check(() => {
    const list = campusServices.getServiceList()
    assert.strictEqual(list.length, 6)
    assert.ok(list.every((item) => item.id && item.name && item.icon && item.tagline))
    assert.strictEqual(campusServices.getServiceById('school-bus').name, '校车时刻')
    assert.strictEqual(campusServices.getServiceById(''), null)
    assert.strictEqual(campusServices.getServiceById('not-exist'), null)
    assert.strictEqual(campusServices.getServiceById(null), null)
  }, '列表与按 id 取数')
}

// =====================================================================
// B. 页面行为（加载真实页面文件）
// =====================================================================
const wxStub = {
  vibrateShort() {},
  showToast() {},
  showModal() {},
  navigateTo() {},
  navigateBack() {},
  switchTab() {},
  setNavigationBarTitle() {},
  previewImage() {},
  // 校园卡页会惰性 require utils/api → utils/request；空 request 让网络 Promise 挂起，
  // 页面静态渲染断言不受影响
  request() {},
  getStorageSync() { return '' },
  setStorageSync() {}
}
global.wx = wxStub
// utils/request.js 顶层引用 getApp（小程序运行时全局），纯 Node 环境需补桩
global.getApp = () => ({ globalData: {} })

// 真机 setData 支持 'service.faqs[0].expanded' 这类路径写法，桩里要一并支持，
// 否则页面用路径更新时数据不会变化，用例会误判
function setByPath(target, pathStr, value) {
  const tokens = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  for (let i = 0; i < tokens.length - 1; i += 1) {
    cursor = cursor[tokens[i]]
    if (cursor === undefined || cursor === null) return
  }
  cursor[tokens[tokens.length - 1]] = value
}

function loadPage() {
  let def = null
  const prev = global.Page
  global.Page = (d) => { def = d }
  const target = path.join(ROOT, 'pages', 'campus-service', 'index.js')
  delete require.cache[require.resolve(target)]
  require(target)
  global.Page = prev
  const page = Object.create(def)
  page.data = JSON.parse(JSON.stringify(def.data))
  page.setData = function (patch) {
    Object.keys(patch || {}).forEach((key) => {
      if (key.indexOf('.') >= 0 || key.indexOf('[') >= 0) setByPath(this.data, key, patch[key])
      else this.data[key] = patch[key]
    })
  }
  return page
}

function pageBehaviorTests() {
  for (const [name, id] of EXPECTED) {
    check(() => {
      const page = loadPage()
      page.onLoad({ id })
      const service = page.data.service
      assert.ok(service, name + ' 应能加载')
      assert.strictEqual(service.name, name)
      assert.strictEqual(service.id, id)
      assert.strictEqual(page.data.hasInfo, id === 'school-bus', name + ' hasInfo 应与运营数据填写状态一致')
      if (id === 'school-bus') {
        assert.ok(page.data.infoItems.length >= 9, '校车时刻应渲染结构化班次/线路/站点信息')
        const kinds = page.data.infoItems.reduce((set, item) => {
          item.lines.forEach((line) => set.add(line.kind))
          return set
        }, new Set())
        assert.ok(kinds.has('times'), '发车时间行应渲染为时间胶囊')
        assert.ok(kinds.has('flow'), '线路站点行应渲染为流程时间轴')
      }
      // 校车时刻不配 scenes，页面必须归一化成数组，否则 WXML 里 scenes.length 会炸
      assert.ok(Array.isArray(service.scenes), 'scenes 必须归一化为数组')
      assert.ok(service.steps.length >= 3 && service.faqs.length >= 3)
      assert.ok(service.faqs.every((item) => item.expanded === false), 'FAQ 默认收起')
      // 可选项必须补成数组，避免 WXML 里出现 undefined.length
      assert.ok(Array.isArray(service.links), 'links 必须归一化为数组')
      assert.ok(Array.isArray(service.tips) && Array.isArray(service.info.items))
    }, '页面按 id 渲染：' + name)
  }

  check(() => {
    const page = loadPage()
    page.onLoad({ id: 'campus-card' })
    const first = page.data.service.faqs[0]
    assert.strictEqual(first.expanded, false)
    page.onToggleFaq({ currentTarget: { dataset: { index: 0 } } })
    assert.strictEqual(page.data.service.faqs[0].expanded, true, '点击应展开')
    page.onToggleFaq({ currentTarget: { dataset: { index: 0 } } })
    assert.strictEqual(page.data.service.faqs[0].expanded, false, '再次点击应收起')
    // 非法下标不应报错
    page.onToggleFaq({ currentTarget: { dataset: { index: 99 } } })
    assert.strictEqual(page.data.service.faqs[0].expanded, false)
  }, '常见问题展开与收起')

  check(() => {
    const page = loadPage()
    page.onLoad({ id: 'not-exist' })
    assert.strictEqual(page.data.service, null, '未知 id 不应渲染页面内容')
    page.onLoad({})
    assert.strictEqual(page.data.service, null, '缺少 id 不应渲染页面内容')
  }, '未知 id 兜底')

  check(() => {
    const page = loadPage()
    page.onLoad({ id: 'campus-guide' })
    const links = page.data.service.links
    assert.ok(links.length >= 1, '轻友指南应有相关入口')
    assert.strictEqual(links[0].url, '/pages/campus-map/index', '轻友指南应能跳到校园地图')
  }, '相关入口（轻友指南 → 校园地图）')
}

// =====================================================================
// C. 源码护栏
// =====================================================================
function sourceGuardTests() {
  const appJson = JSON.parse(read('app.json'))
  const indexJs = read('pages/index/index.js')
  const serviceAllJs = read('pages/service-all/index.js')
  const pageWxml = read('pages/campus-service/index.wxml')

  check(() => {
    for (const ext of ['js', 'wxml', 'wxss', 'json']) {
      assert.ok(
        fs.existsSync(path.join(ROOT, 'pages', 'campus-service', 'index.' + ext)),
        '缺少 pages/campus-service/index.' + ext
      )
    }
    assert.ok(appJson.pages.indexOf('pages/campus-service/index') >= 0, 'app.json 未注册')
  }, '页面文件齐备并已注册')

  check(() => {
    assert.ok(indexJs.indexOf("require('../../utils/campus-services')") >= 0, '首页未引入服务数据源')
    assert.match(indexJs, /CAMPUS_SERVICE_IDS\[item\.name\]/, '首页缺少按名字取 id 的分支')
    assert.match(indexJs, /url: '\/pages\/campus-service\/index\?id=' \+ campusServiceId/, '首页跳转缺少 id 参数')
  }, '首页宫格路由接线')

  check(() => {
    assert.ok(serviceAllJs.indexOf("require('../../utils/campus-services')") >= 0, '全部服务页未引入数据源')
    assert.match(serviceAllJs, /CAMPUS_SERVICE_IDS\[item\.name\]/, '全部服务页缺少按名字取 id 的分支')
    for (const [name] of EXPECTED) {
      assert.ok(serviceAllJs.indexOf("'" + name + "': '/pages/campus-service/index'") >= 0, '全部服务页未登记：' + name)
    }
  }, '全部服务页路由接线')

  check(() => {
    // 宫格里的名字与数据源的 name 必须一致，否则 CAMPUS_SERVICE_IDS 查不到、点击无反应
    const row1Start = indexJs.indexOf('const row1 = [')
    const row2Start = indexJs.indexOf('const row2 = [')
    const grid = indexJs.slice(row1Start, indexJs.indexOf(']', row2Start))
    for (const [name] of EXPECTED) {
      assert.ok(grid.indexOf("'" + name + "'") >= 0, '首页宫格缺少入口：' + name)
    }
  }, '名字与首页宫格同步')

  check(() => {
    assert.ok(pageWxml.indexOf('<contact-admin>') >= 0, '关键信息降级处应接 contact-admin')
    assert.ok(pageWxml.indexOf('{{service.info.emptyText}}') >= 0, '缺少降级文案渲染')
    assert.ok(pageWxml.indexOf('bindtap="onToggleFaq"') >= 0, '常见问题缺少接线')
    assert.ok(pageWxml.indexOf('bindtap="onLinkTap"') >= 0, '相关入口缺少接线')
    assert.match(pageWxml, /wx:if="\{\{hasInfo\}\}"/, '关键信息应按 hasInfo 分支渲染')
  }, '页面渲染与接线')

  for (const file of ['pages/campus-service/index.wxml']) {
    const source = read(file)
    check(() => {
      const mustaches = source.match(/\{\{[^}]*\}\}/g) || []
      const bad = mustaches.filter((expr) => /\)\s*\./.test(expr))
      assert.deepStrictEqual(bad, [], 'WXML 不支持 (表达式).属性：' + bad.join(' | '))
    }, 'WXML 表达式合法（无 (表达式).属性）')

    check(() => {
      const mustaches = source.match(/\{\{[^}]*\}\}/g) || []
      const bad = mustaches.filter((expr) => /[a-zA-Z_$][\w$.]*\s*\(/.test(expr))
      assert.deepStrictEqual(bad, [], 'WXML 不支持在 {{}} 里调用方法：' + bad.join(' | '))
    }, 'WXML 表达式合法（无方法调用）')
  }
}

function main() {
  dataModuleTests()
  pageBehaviorTests()
  sourceGuardTests()
  console.log(testCount + ' tests passed.')
  process.exit(0)
}

main()
