/**
 * 找驾校模块测试（无需数据库 / 无需真机）
 *
 * 背景：驾校数据已从静态示例迁移到服务端 driving_school 表，
 * 由管理后台「物品」tab 的「找驾校内容管理」维护；前台按校区（广州/佛山）分类展示。
 *
 * 覆盖四层：
 *   A. 数据模块 utils/driving-school.js —— 校区常量、卡片补全、排序与服务端列表上的筛选纯函数
 *   B. 页面行为 —— 列表页（桩 api 返回样例驾校）校区切换/搜索/标签/排序/重置；详情页取数与兜底
 *   C. 源码护栏 —— 页面注册、交互接线、WXML 表达式合法性
 *   D. 服务端接线护栏 —— 建表迁移、公开路由、管理端 CRUD 路由与权限
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

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


const ds = require(path.join(root, 'utils', 'driving-school.js'))

// 服务端 driving_school 下发结构（mapSchool 输出）的样例数据
const SAMPLE_SCHOOLS = [
  {
    id: 1, name: '驾顺驾校', campus: '佛山校区', region: '南海区',
    address: '佛山市南海区狮山镇华涌村', phone: '13380209901',
    carTypes: 'C1 C2', price: '全包 3200 元', intro: 'AAAA 驾校，费用全包，快至 45 天拿证',
    passRate: 78, level: 'S', tags: ['免费试驾', '包考试费', '包接送'],
    distanceKm: 5.6, cover: 'https://cdn.example.com/a.jpg', images: [], detail: '', status: true, sortOrder: 1
  },
  {
    id: 2, name: '云惠学车惠通驾校', campus: '佛山校区', region: '花都区',
    address: '广州市花都区', phone: '', carTypes: 'C1', price: '3580 元',
    intro: '信誉优良，精心施教', passRate: 92, level: 'A',
    tags: ['包补训费', '包考试费', '包补考费', '包接送'], distanceKm: 5.1,
    cover: '', images: [], detail: '', status: true, sortOrder: 2
  },
  {
    id: 3, name: '学车通·赤岗训练场', campus: '广州校区', region: '海珠区',
    address: '广州市海珠区赤岗路', phone: '020-88888888', carTypes: 'C1 C2 B', price: '3980 元起',
    intro: '大学城直营场地，支持周末集训', passRate: 98, level: 'S',
    tags: ['免费试驾', '包考试费', '驾驶模拟器'], distanceKm: 3.2,
    cover: '', images: [], detail: '', status: true, sortOrder: 3
  }
]

// =====================================================================
// A. 数据模块（纯函数）
// =====================================================================
function dataModuleTests() {
  check(() => {
    assert.deepStrictEqual(ds.CAMPUS_OPTIONS, ['广州校区', '佛山校区'], '校区分类仅保留两个主校区')
    assert.deepStrictEqual(ds.ENROLL_STEPS, ['选驾校', '预报名', '签合同', '缴学费', '体检/面签'])
    assert.ok(ds.SERVICE_TAGS.length >= 5 && ds.SORT_OPTIONS.length === 4)
  }, '基础常量：校区分类与报名流程')

  check(() => {
    const card = ds.buildSchoolCard(SAMPLE_SCHOOLS[0], 0)
    assert.strictEqual(card.distanceText, '5.6km', '距离文案以 km 结尾')
    assert.strictEqual(card.passRateText, '78%', '通过率文案')
    assert.strictEqual(card.levelText, 'S')
    assert.strictEqual(card.carTypesText, 'C1 C2', '班型/车型字段透传')
    assert.strictEqual(card.priceText, '全包 3200 元', '价格字段透传')
    assert.strictEqual(card.addressText, SAMPLE_SCHOOLS[0].address, '地址字段透传')
    assert.strictEqual(card.phoneText, '13380209901', '联系方式字段透传')
    assert.ok(card.coverTheme.indexOf('gradient') >= 0, '封面兜底配色')
    assert.strictEqual(card.firstChar, '驾', '首字兜底')
    assert.ok(card.tagList.length <= 5, '卡片标签最多 5 个')
  }, '卡片补全字段（含新增的地址/电话/班型/价格）')

  check(() => {
    const gz = ds.filterSchools(SAMPLE_SCHOOLS, { campus: '广州校区' })
    assert.deepStrictEqual(gz.map((item) => item.id), [3], '校区筛选应精确命中')
    const fs2 = ds.filterSchools(SAMPLE_SCHOOLS, { campus: '佛山校区' })
    assert.ok(fs2.every((item) => item.campus === '佛山校区'), '结果校区应一致')
    assert.strictEqual(ds.filterSchools(SAMPLE_SCHOOLS, {}).length, 3, '不传校区=全量')
  }, '校区筛选')

  check(() => {
    const hit = ds.filterSchools(SAMPLE_SCHOOLS, { keyword: '赤岗' })
    assert.ok(hit.some((item) => item.id === 3), '按名称/地址搜索应命中')
    assert.strictEqual(ds.filterSchools(SAMPLE_SCHOOLS, { keyword: '不存在的驾校xyz' }).length, 0, '无匹配返回空')
  }, '关键词搜索')

  check(() => {
    const cards = ds.filterSchools(SAMPLE_SCHOOLS, { tags: ['包接送'] })
    assert.ok(cards.every((item) => item.tags.indexOf('包接送') >= 0), '结果都应含该标签')
    const both = ds.filterSchools(SAMPLE_SCHOOLS, { tags: ['包接送', '包考试费'] })
    assert.ok(both.every((item) => item.tags.indexOf('包接送') >= 0 && item.tags.indexOf('包考试费') >= 0), '多标签 AND 语义')
  }, '服务标签筛选（全部命中）')

  check(() => {
    // 样例通过率 78 / 92 / 98，等级 S / A / S
    assert.deepStrictEqual(ds.filterSchools(SAMPLE_SCHOOLS, { minPassRate: 90 }).map((i) => i.id), [2, 3], '90% 以上应滤掉 78%')
    assert.deepStrictEqual(ds.filterSchools(SAMPLE_SCHOOLS, { minPassRate: 0 }).map((i) => i.id), [1, 2, 3], '"不限" 即不设下限')
    assert.deepStrictEqual(ds.filterSchools(SAMPLE_SCHOOLS, { levels: ['S'] }).map((i) => i.id), [1, 3], '等级单选')
    assert.deepStrictEqual(ds.filterSchools(SAMPLE_SCHOOLS, { levels: ['A', 'B'] }).map((i) => i.id), [2], '等级多选为 OR 语义')
    assert.deepStrictEqual(ds.filterSchools(SAMPLE_SCHOOLS, { minPassRate: 90, levels: ['S'] }).map((i) => i.id), [3], '两组条件 AND')
    assert.deepStrictEqual(ds.PASS_RATE_FILTERS.map((i) => i.key), ['any', '80', '90'], '通过率档位')
    assert.deepStrictEqual(ds.LEVEL_FILTERS, ['S', 'A', 'B'], '等级档位')
  }, '通过率与推荐等级筛选')

  check(() => {
    const byDistance = ds.filterSchools(SAMPLE_SCHOOLS, { sortKey: 'distance' })
    for (let i = 1; i < byDistance.length; i += 1) {
      assert.ok(byDistance[i - 1].distanceKm <= byDistance[i].distanceKm, '离校最近=距离升序')
    }
    const byRate = ds.filterSchools(SAMPLE_SCHOOLS, { sortKey: 'passRate' })
    for (let i = 1; i < byRate.length; i += 1) {
      assert.ok(byRate[i - 1].passRate >= byRate[i].passRate, '通过率最高=降序')
    }
    const order = { S: 3, A: 2, B: 1 }
    const byLevel = ds.filterSchools(SAMPLE_SCHOOLS, { sortKey: 'level' })
    for (let i = 1; i < byLevel.length; i += 1) {
      assert.ok((order[byLevel[i - 1].level] || 0) >= (order[byLevel[i].level] || 0), '推荐等级 S>A>B')
    }
    const byDefault = ds.filterSchools(SAMPLE_SCHOOLS, { sortKey: 'default' })
    assert.deepStrictEqual(byDefault.map((item) => item.id), [1, 2, 3], '综合=sortOrder 升序')
  }, '排序：距离 / 通过率 / 推荐等级 / 综合')
}

// =====================================================================
// B. 页面行为（桩 api，加载真实页面文件）
// =====================================================================
const wxStub = {
  vibrateShort() {},
  showToast() {},
  showModal() {},
  navigateTo() {},
  navigateBack() {},
  redirectTo() {},
  previewImage() {},
  setClipboardData() {},
  stopPullDownRefresh() {},
  setNavigationBarTitle() {},
  getStorageSync: () => '',
  setStorageSync() {},
  request() {}
}
global.wx = wxStub
global.getApp = () => ({ globalData: {} })

// 页面 require 真实 utils/api（纯 Node 下可加载），再把驾校两个方法换成桩数据
const api = require(path.join(root, 'utils', 'api.js'))
api.getDrivingSchools = () => Promise.resolve(SAMPLE_SCHOOLS.slice())
api.getDrivingSchoolDetail = (id) => Promise.resolve(SAMPLE_SCHOOLS.find((item) => String(item.id) === String(id)) || null)
// 运营位配置：默认全部「未配置」，页面应回落到内置默认文案；下面有用例单独覆盖已配置的情况
api.getDrivingPromo = () => Promise.resolve(null)
api.getDrivingServiceTags = () => Promise.resolve(null)
api.getDrivingGuidePage = () => Promise.resolve(null)

function loadPage(relPath) {
  let def = null
  const prev = global.Page
  global.Page = (d) => { def = d }
  delete require.cache[require.resolve(path.join(root, relPath))]
  require(path.join(root, relPath))
  global.Page = prev
  const page = Object.create(def)
  page.data = JSON.parse(JSON.stringify(def.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

async function pageBehaviorTests() {
  // 列表页：初始加载 → 校区切换 → 搜索 → 标签 → 排序 → 重置
  {
    const page = loadPage('pages/driving-school/index.js')
    await page.onLoad()
    check(() => {
      assert.strictEqual(page.data.loading, false)
      assert.strictEqual(page.data.campus, '广州校区', '默认落在第一个校区分类')
      assert.strictEqual(page.data.totalCount, 1, '初始仅显示默认校区（广州）的驾校')
    }, '列表页初始加载')

    check(() => {
      page.onCampusTap({ currentTarget: { dataset: { index: '1' } } })
      assert.strictEqual(page.data.campus, '佛山校区')
      assert.ok(page.data.schools.length === 2 && page.data.schools.every((item) => item.campus === '佛山校区'), '切校区后仅显示该校区驾校')
      page.onCampusTap({ currentTarget: { dataset: { index: '0' } } })
      assert.strictEqual(page.data.schools.length, 1, '广州校区一家')
    }, '列表页校区切换')

    check(() => {
      page.onCampusTap({ currentTarget: { dataset: { index: '1' } } })
      page.onKeywordInput({ detail: { value: '惠通' } })
      assert.strictEqual(page.data.schools.length, 1, '佛山校区内按关键词命中 1 家')
      page.onKeywordInput({ detail: { value: '不存在的驾校xyz' } })
      assert.strictEqual(page.data.schools.length, 0, '无匹配应为空')
      page.onClearKeyword()
      assert.strictEqual(page.data.totalCount, 2, '清空关键词恢复当前校区全量')
    }, '列表页搜索与清空')

    check(() => {
      page.onToggleTag({ currentTarget: { dataset: { tag: '包接送' } } })
      assert.ok(page.data.tagOptions.find((o) => o.name === '包接送').selected, '标签选中态同步')
      assert.ok(page.data.schools.every((item) => item.tags.indexOf('包接送') >= 0))
      page.onToggleTag({ currentTarget: { dataset: { tag: '包接送' } } })
      assert.strictEqual(page.data.activeTags.length, 0, '再次点击取消')
    }, '列表页标签筛选与取消')

    check(() => {
      const index = page.data.sortLabels.indexOf('离校最近')
      page.onSortChange({ detail: { value: String(index) } })
      assert.strictEqual(page.data.sortKey, 'distance')
      assert.strictEqual(page.data.sortLabel, '离校最近')
      page.onResetFilter()
      assert.strictEqual(page.data.sortLabel, '')
      assert.strictEqual(page.data.totalCount, 2, '重置回到当前校区全量（不切校区）')
    }, '列表页排序与重置')
  }

  // 详情页：取数 + 无效 id 兜底
  {
    const page = loadPage('pages/driving-school/detail.js')
    await page.onLoad({ id: '1' })
    check(() => {
      assert.ok(page.data.school, '详情页应加载到驾校')
      assert.strictEqual(page.data.school.name, '驾顺驾校')
      assert.strictEqual(page.data.school.phoneText, '13380209901', '联系方式应透传到详情')
      assert.strictEqual(page.data.activeStep, 0, '默认停在第一步「选驾校」')
      assert.strictEqual(page.data.loading, false)
    }, '详情页加载')

    check(() => {
      page.onStepTap({ currentTarget: { dataset: { index: 3 } } })
      assert.strictEqual(page.data.activeStep, 3)
      assert.match(page.data.stepTip, /缴学费/)
      page.onStepTap({ currentTarget: { dataset: { index: 99 } } })
      assert.strictEqual(page.data.activeStep, 3, '非法下标不得改变状态')
    }, '详情页报名流程切换')

    const bad = loadPage('pages/driving-school/detail.js')
    await bad.onLoad({ id: '999999' })
    check(() => {
      assert.strictEqual(bad.data.school, null, '无效 id 不应渲染页面内容')
    }, '详情页无效 id 兜底')
  }

  // 运营位配置：未配置回落内置默认，配置后覆盖，下线状态同样回落
  {
    const page = loadPage('pages/driving-school/index.js')
    await page.onLoad()
    check(() => {
      assert.strictEqual(page.data.promo.title, '校园圈学车', '未配置时用默认主标题')
      assert.deepStrictEqual(page.data.promo.tags, ['离校近', '价格低', '拿本快'], '未配置时用默认卖点标签')
      assert.strictEqual(page.data.tagOptions.length, 8, '未配置时标签池回落到内置 8 个')
    }, '运营位未配置时回落默认')

    api.getDrivingPromo = () => Promise.resolve({
      title: '寒假学车季', sub: '', btnText: '去对比', tags: ['拿本快'],
      image: 'https://cdn.example.com/p.png', status: true
    })
    api.getDrivingServiceTags = () => Promise.resolve({ tags: ['包接送', '免费试驾'], status: true })
    const configured = loadPage('pages/driving-school/index.js')
    await configured.onLoad()
    check(() => {
      assert.strictEqual(configured.data.promo.title, '寒假学车季')
      assert.strictEqual(configured.data.promo.sub, '', '后台留空则不补默认副标题')
      assert.deepStrictEqual(configured.data.promo.tags, ['拿本快'], '标签数量随配置变化')
      assert.strictEqual(configured.data.promo.image, 'https://cdn.example.com/p.png')
      assert.deepStrictEqual(configured.data.tagOptions.map((t) => t.name), ['包接送', '免费试驾'], '筛选面板改读后台标签池')
    }, '运营位配置生效')

    api.getDrivingPromo = () => Promise.resolve({ title: '已下线不该出现', status: false })
    api.getDrivingServiceTags = () => Promise.resolve({ tags: ['不该出现'], status: false })
    const offline = loadPage('pages/driving-school/index.js')
    await offline.onLoad()
    check(() => {
      assert.strictEqual(offline.data.promo.title, '校园圈学车', '横幅下线时回落默认文案')
      assert.strictEqual(offline.data.tagOptions[0].name, '免费试驾', '标签池下线时回落内置')
    }, '运营位下线时回落默认')

    // 与「未配置」区分开：保存过但清空 = 用户端真的不再显示这一组筛选
    api.getDrivingServiceTags = () => Promise.resolve({ tags: [], status: true })
    const cleared = loadPage('pages/driving-school/index.js')
    await cleared.onLoad()
    check(() => {
      assert.deepStrictEqual(cleared.data.tagOptions, [], '已保存为空配置时不回落内置')
    }, '标签池保存为空则整组隐藏')
    api.getDrivingPromo = () => Promise.resolve(null)
    api.getDrivingServiceTags = () => Promise.resolve(null)
  }

  // 学车指南页：已换成后台可编辑的自定义页面（标题 + 分段正文 + 图片）
  {
    const empty = loadPage('pages/driving-school/guide.js')
    await empty.onLoad()
    check(() => {
      assert.strictEqual(empty.data.page, null, '后台未发布时不渲染内容卡')
      assert.strictEqual(empty.data.loaded, true, '加载完成要给出空态标记')
    }, '学车指南空态')

    api.getDrivingGuidePage = () => Promise.resolve({
      title: '学车全流程', content: '第一段说明\n\n第二段说明\n \n',
      images: ['https://cdn.example.com/g.png'], status: true
    })
    const filled = loadPage('pages/driving-school/guide.js')
    await filled.onLoad()
    check(() => {
      assert.strictEqual(filled.data.page.title, '学车全流程')
      assert.deepStrictEqual(filled.data.blocks.map((b) => b.type), ['p', 'p'], '正文按段渲染，空段照旧丢弃')
      assert.deepStrictEqual(
        filled.data.blocks.map((b) => b.runs.map((r) => r.t).join('')),
        ['第一段说明', '第二段说明'],
        '纯文本经标记解析器应与旧的逐行切段得到同样的文字（老内容零迁移的底线）'
      )
      assert.strictEqual(filled.data.page.images.length, 1)
      assert.strictEqual(filled.data.page.updatedAtText, '', '缺 updatedAt 时不应渲染 undefined 文本')
    }, '学车指南渲染后台内容')
    api.getDrivingGuidePage = () => Promise.resolve(null)
  }
}

// =====================================================================
// C. 源码护栏（前台页面）
// =====================================================================
function sourceGuardTests() {
  const appJson = JSON.parse(read('app.json'))
  const pages = ['index', 'detail', 'guide', 'landing']

  for (const name of pages) {
    check(() => {
      const dir = path.join(root, 'pages', 'driving-school')
      for (const ext of ['js', 'wxml', 'wxss', 'json']) {
        assert.ok(fs.existsSync(path.join(dir, name + '.' + ext)), '缺少 pages/driving-school/' + name + '.' + ext)
      }
      assert.ok(
        appJson.pages.indexOf('pages/driving-school/' + name) >= 0,
        'app.json 未注册 pages/driving-school/' + name
      )
    }, '找驾校页面齐备并已注册：' + name)
  }

  const listWxml = read('pages/driving-school/index.wxml')
  const listJs = read('pages/driving-school/index.js')
  const detailWxml = read('pages/driving-school/detail.wxml')

  check(() => {
    assert.ok(listWxml.indexOf('bindtap="onCampusTap"') >= 0, '校区分类应可切换')
    assert.ok(listWxml.indexOf('bindinput="onKeywordInput"') >= 0, '缺少搜索接线')
    assert.ok(listWxml.indexOf('bindchange="onSortChange"') >= 0, '缺少排序接线')
    assert.ok(listWxml.indexOf('bindtap="onToggleTag"') >= 0, '缺少标签筛选接线')
    assert.ok(listWxml.indexOf('item.carTypesText') >= 0, '卡片应展示班型/车型')
    assert.ok(listWxml.indexOf('item.priceText') >= 0, '卡片应展示价格')
    assert.ok(listWxml.indexOf('item.addressText') >= 0, '卡片应展示地址')
    assert.ok(listWxml.indexOf('item.phoneText') >= 0, '卡片应展示联系方式')
    // 运营横幅改为进入独立的「校园圈学车」落地页（内容后台单独编辑，与学车指南分开）
    assert.ok(listWxml.indexOf('bindtap="openPromoLanding"') >= 0, '运营横幅应可进入校园圈学车落地页')
    assert.ok(listJs.indexOf("url: '/pages/driving-school/landing'") >= 0, '落地页跳转目标缺失')
    assert.ok(listWxml.indexOf('regionOptions') === -1, '旧区域分类应已移除')
  }, '列表页交互接线与字段')

  check(() => {
    assert.ok(listJs.indexOf('api.getDrivingSchools') >= 0, '列表页应改为服务端取数')
    assert.match(listJs, /navigateTo\(\{ url: '\/pages\/driving-school\/detail\?id=' \+ id \}\)/, '卡片点击应进详情')
  }, '列表页数据源与跳转目标')

  check(() => {
    assert.ok(read('pages/driving-school/detail.js').indexOf('api.getDrivingSchoolDetail') >= 0, '详情页应改为服务端取数')
    assert.ok(detailWxml.indexOf('<contact-admin') >= 0, '详情页底部「立即咨询」应接 contact-admin')
    assert.ok(detailWxml.indexOf('bindtap="onStepTap"') >= 0, '报名流程应可点击')
    assert.ok(detailWxml.indexOf('wx:if="{{images.length}}"') >= 0, '场地展示应无图不渲染')
    assert.ok(detailWxml.indexOf('school.phoneText') >= 0, '详情应展示招生电话')
    assert.ok(detailWxml.indexOf('school.carTypesText') >= 0, '详情应展示班型/车型')
  }, '详情页接线')

  // WXML 表达式安全：踩过 pkg-admin 的编译报错（{{(a || '').length}}）
  const wxmlFiles = ['pages/driving-school/index.wxml', 'pages/driving-school/detail.wxml', 'pages/driving-school/guide.wxml']
  for (const file of wxmlFiles) {
    const source = read(file)
    check(() => {
      const mustaches = source.match(/\{\{[^}]*\}\}/g) || []
      const bad = mustaches.filter((expr) => /\)\s*\./.test(expr))
      assert.deepStrictEqual(bad, [], 'WXML 不支持 (表达式).属性：' + bad.join(' | '))
    }, 'WXML 表达式合法（无 (表达式).属性）：' + path.basename(file))

    check(() => {
      const mustaches = source.match(/\{\{[^}]*\}\}/g) || []
      const bad = mustaches.filter((expr) => /[a-zA-Z_$][\w$.]*\s*\(/.test(expr))
      assert.deepStrictEqual(bad, [], 'WXML 不支持在 {{}} 里调用方法：' + bad.join(' | '))
    }, 'WXML 表达式合法（无方法调用）：' + path.basename(file))
  }
}

// =====================================================================
// D. 服务端与管理后台接线护栏
// =====================================================================
function serverWiringTests() {
  check(() => {
    const app = read('server/app.js')
    assert.ok(app.indexOf('require("./routes/drivingSchoolRoutes")') >= 0, 'app.js 应挂载驾校路由')
    assert.ok(app.indexOf('app.use("/api/v1/driving-school", drivingSchoolRoutes)') >= 0, '驾校公开路由前缀应为 /api/v1/driving-school')
    const routes = read('server/routes/drivingSchoolRoutes.js')
    assert.ok(routes.indexOf("router.get('/list'") >= 0 && routes.indexOf("router.get('/detail/:id'") >= 0, '公开列表/详情路由应在位')
  }, '服务端公开路由')

  check(() => {
    const adminRoutes = read('server/routes/adminRoutes.js')
    assert.ok(adminRoutes.indexOf("router.get('/driving-schools', requireAdmin('config.manage')") >= 0, '管理端列表应挂 config.manage')
    assert.ok(adminRoutes.indexOf("router.post('/driving-schools'") >= 0, '管理端新增路由应在位')
    assert.ok(adminRoutes.indexOf("router.put('/driving-schools/:id'") >= 0, '管理端编辑路由应在位')
    assert.ok(adminRoutes.indexOf("router.delete('/driving-schools/:id'") >= 0, '管理端删除路由应在位')
  }, '管理端 CRUD 路由与权限')

  check(() => {
    const migrations = read('server/utils/migrations.js')
    assert.ok(migrations.indexOf('CREATE TABLE IF NOT EXISTS driving_school') >= 0, 'migrations 应包含 driving_school 建表')
    for (const column of ['car_types', 'price', 'address', 'phone', 'cover', 'campus', 'sort_order']) {
      assert.ok(migrations.indexOf(column) >= 0, '建表应含字段 ' + column)
    }
  }, 'driving_school 建表迁移')

  check(() => {
    const controller = read('server/controllers/drivingSchoolController.js')
    assert.ok(controller.indexOf("CAMPUS_VALUES = ['广州校区', '佛山校区']") >= 0, '服务端校区白名单应仅两个主校区')
    assert.ok(controller.indexOf('exports.adminCreate') >= 0 && controller.indexOf('exports.adminUpdate') >= 0, '管理端处理函数应在位')
  }, '服务端控制器约束')

  check(() => {
    const adminJs = read('pkg-admin/admin/index.js')
    for (const handler of ['beginDrivingSchoolCreate', 'beginDrivingSchoolEdit', 'toggleDrivingSchool', 'deleteDrivingSchool']) {
      assert.ok(adminJs.indexOf(handler) >= 0, '后台缺少处理函数 ' + handler)
    }
    assert.ok(/navigateTo\(\{ url: '\/pkg-admin\/admin\/edit\/index\?scope=drivingSchool'/.test(adminJs),
      '后台驾校新建/编辑入口应跳独立编辑页')
    // 表单已迁到独立编辑页：图片上传（addImages）与封面（chooseSchoolCover）都在新页
    const editJs = read('pkg-admin/admin/edit/index.js')
    const editWxml = read('pkg-admin/admin/edit/index.wxml')
    for (const handler of ['addImages', 'chooseSchoolCover']) {
      assert.ok(editJs.indexOf(handler) >= 0, '编辑页缺少处理函数 ' + handler)
    }
    assert.ok(editJs.indexOf("scope === 'drivingSchool'") >= 0, '编辑页应有驾校保存分支')
    const adminWxml = read('pkg-admin/admin/index.wxml')
    assert.ok(adminWxml.indexOf('找驾校内容管理') >= 0, '「物品」tab 应含找驾校内容管理模块')
    assert.ok(editWxml.indexOf('drivingSchoolCampusOptions') >= 0, '编辑页表单应含校区归属选择')
    const wrapper = read('pkg-admin/utils/admin.js')
    assert.ok(wrapper.indexOf("'/driving-schools'") >= 0, '后台 API 包装应挂 /driving-schools')
  }, '管理后台驾校内容模块接线')
}

// =====================================================================
// E. 服务端解析函数（回归护栏：图片 URL 曾被 parseTags 的 16 字截断全部截坏）
// =====================================================================
function serverParserTests() {
  const POOL_PATH = require.resolve('../config/pool')
  require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: { query: async () => [[]] } }
  const ctrl = require('../controllers/drivingSchoolController')
  const LONG = 'https://payun01.cn/uploads/f24acd4a-3c5d-4aa4-a147-a950db8bc7d5.jpg'

  check(() => {
    assert.deepStrictEqual(ctrl.parseImageList([LONG]), [LONG], '完整 URL 不得被截断')
    assert.deepStrictEqual(ctrl.parseImageList(JSON.stringify([LONG])), [LONG], 'JSON 串入参同样保留完整 URL')
    assert.deepStrictEqual(ctrl.parseImageList(LONG + ' ' + LONG), [LONG, LONG], '空格分隔的多张图应各自完整')
    assert.deepStrictEqual(ctrl.parseImageList(['http://x.com/a.png', '', null]), [], '非 https 与空值应过滤')
    assert.strictEqual(ctrl.parseImageList(new Array(12).fill(LONG)).length, 9, '最多 9 张')
  }, '图片列表不截断 URL')

  check(() => {
    const long = '用一流的服务和教学质量来赢得市场口碑' // 18 字
    assert.deepStrictEqual(ctrl.parseTags([long]), [long], '标签不得被静默截断')
    assert.deepStrictEqual(ctrl.parseTags('免费试驾，包考试费、包接送'), ['免费试驾', '包考试费', '包接送'], '中英文分隔符都要拆')
    assert.strictEqual(ctrl.parseTags(new Array(12).fill('标签')).length, 8, '最多 8 个标签')
  }, '标签解析只拆不截')

  check(() => {
    const base = { name: '驾顺驾校', campus: '佛山校区', level: 'S' }
    const overlong = ctrl.normalizeSchool(Object.assign({}, base, { tags: '用一流的服务和教学质量来赢得市场口碑' }))
    assert.ok(overlong.error && /不能超过 16 字/.test(overlong.error), '超长标签应明确报错：' + JSON.stringify(overlong.error))
    const ok = ctrl.normalizeSchool(Object.assign({}, base, { tags: '免费试驾，包考试费' }))
    assert.ok(!ok.error, '正常标签应通过')
    assert.deepStrictEqual(JSON.parse(ok.data.tags), ['免费试驾', '包考试费'])
    assert.strictEqual(ctrl.normalizeSchool(Object.assign({}, base, { cover: '/local/path.png' })).data.cover, '', '非 https 封面应清空')
  }, 'normalizeSchool 写入校验')

  check(() => {
    const base = { name: '驾顺驾校', campus: '佛山校区', level: 'S' }
    const withCoord = ctrl.normalizeSchool(Object.assign({}, base, { lat: '23.09', lng: '113.15' }))
    assert.strictEqual(withCoord.data.lat, 23.09, '后台选点坐标应透传')
    assert.strictEqual(withCoord.data.lng, 113.15)
    const junk = ctrl.normalizeSchool(Object.assign({}, base, { lat: 'abc', lng: -1 }))
    assert.strictEqual(junk.data.lat, 0, '非数字坐标归零（= 未选点）')
    assert.strictEqual(junk.data.lng, 0, '负数坐标归零')
    const none = ctrl.normalizeSchool(base)
    assert.strictEqual(none.data.lat, 0, '编辑时漏传 lat/lng 会清掉坐标，所以必须显式归零而非 undefined')
  }, '坐标字段归一化')
}

// 地图链路的接线护栏：坐标只能由后台人工选点，服务端不得再自动地理编码
function mapEntryGuardTests() {
  const controller = read('server/controllers/drivingSchoolController.js')
  const migrations = read('server/utils/migrations.js')
  const adminJs = read('pkg-admin/admin/index.js')
  const editJs = read('pkg-admin/admin/edit/index.js')
  const editWxml = read('pkg-admin/admin/edit/index.wxml')
  const detailWxml = read('pages/driving-school/detail.wxml')
  const detailJs = read('pages/driving-school/detail.js')

  check(() => {
    assert.ok(migrations.indexOf("ensureColumn('driving_school', 'lat'") >= 0, 'migrations 应补 lat 列')
    assert.ok(migrations.indexOf("ensureColumn('driving_school', 'lng'") >= 0, 'migrations 应补 lng 列')
    assert.ok(controller.indexOf('geocode') < 0, '服务端不得再自动地理编码（机构名只解析到区县级，会钉错位置）')
  }, '坐标列与服务端不自动解析')

  check(() => {
    const editMeta = read('pkg-admin/utils/admin-edit-meta.js')
    assert.ok(editJs.indexOf('wx.chooseLocation(') >= 0, '编辑页表单应提供地图选点')
    assert.ok(editJs.indexOf("'form.lat'") >= 0 && editJs.indexOf("'form.lng'") >= 0, '选点结果要写回表单')
    assert.ok(/lat: Number\(form\.lat\) \|\| 0/.test(editMeta), '提交体必须带上 lat/lng，否则编辑会清空已有坐标')
    assert.ok(editJs.indexOf('lat: Number(row.latitude) || 0') >= 0, '编辑时要回填已有坐标')
    assert.ok(editWxml.indexOf('bindtap="chooseSchoolLocation"') >= 0, '选点入口需接线')
    assert.ok(editWxml.indexOf('catchtap="clearSchoolLocation"') >= 0, '要能清除坐标')
  }, '后台选点接线')

  check(() => {
    assert.ok(detailWxml.indexOf('wx:if="{{school.latitude && school.longitude}}"') >= 0, '无坐标不得渲染地图入口')
    assert.ok(detailWxml.indexOf('catchtap="onOpenLocation"') >= 0, '地图入口需接线')
    assert.ok(detailJs.indexOf('wx.openLocation(') >= 0, '点击应调起微信原生地图')
  }, '详情页地图入口')

  // 每所驾校一张咨询二维码：配了就直接弹本驾校的码，没配则保持原有全站管理员微信流程
  check(() => {
    assert.ok(migrations.indexOf("ensureColumn('driving_school', 'contact_qr'") >= 0, 'migrations 应补 contact_qr 列')
    assert.ok(migrations.indexOf("ensureColumn('driving_school', 'contact_name'") >= 0, 'migrations 应补 contact_name 列')
    const base = { name: '驾顺驾校', campus: '佛山校区', level: 'S' }
    const ctrl2 = require('../controllers/drivingSchoolController')
    const withQr = ctrl2.normalizeSchool(Object.assign({}, base, {
      contactQr: 'https://payun01.cn/uploads/qr.png', contactName: '驾顺客服'
    }))
    assert.strictEqual(withQr.data.contact_qr, 'https://payun01.cn/uploads/qr.png', '二维码应落库')
    assert.strictEqual(withQr.data.contact_name, '驾顺客服', '昵称应落库')
    const badQr = ctrl2.normalizeSchool(Object.assign({}, base, { contactQr: '/local/qr.png' }))
    assert.strictEqual(badQr.data.contact_qr, '', '非 https 二维码必须清空，否则用户端会弹一张坏图')
    assert.ok(detailWxml.indexOf('override-image="{{school.contactQr}}"') >= 0, '详情页要把本驾校二维码传给组件')
    assert.ok(detailWxml.indexOf('direct="{{true}}"') >= 0, '「立即咨询」必须直接弹二维码，不再经过联系管理员菜单')
    const comp = read('components/contact-admin/contact-admin.js')
    assert.ok(comp.indexOf('overrideImage') >= 0 && comp.indexOf('overrideTitle') >= 0, '组件需支持局部覆盖')
    assert.ok(/if \(this\.data\.overrideImage\)/.test(comp), '有覆盖值时不得再拉全站公告配置盖掉它')
    assert.ok(editWxml.indexOf('bindtap="chooseSchoolQr"') >= 0, '编辑页表单需提供二维码上传')
    const editMeta = read('pkg-admin/utils/admin-edit-meta.js')
    assert.ok(editMeta.indexOf('contactQr: String(form.contactQr') >= 0, '提交体要带二维码，否则编辑会清空已上传的码')
  }, '每所驾校一张咨询二维码')
}

// 驾校详情页左下角入口按钮文字：存储随「学车指南」这条自定义页面走，
// 运营横幅不得再带同名字段（两个入口写同一语义会互相覆盖）
function guideBtnTextGuardTests() {
  check(() => {
    const detailJs = read('pages/driving-school/detail.js')
    assert.ok(detailJs.indexOf('api.getDrivingGuidePage()') >= 0, '端上要从指南页面接口取入口按钮文字')
    assert.ok(detailJs.indexOf('guideBtnText: ds.DEFAULT_GUIDE_BTN_TEXT') >= 0, '默认值取独立常量，不再挂在横幅兜底对象上')
    assert.ok(detailJs.indexOf('promo.guideBtnText') < 0, '不得再从运营横幅读这个字段')

    const editorJs = read('pages/banner-detail/index.js')
    assert.ok(editorJs.indexOf('isDrivingGuide') >= 0, '编辑器要按 scope 区分是否显示该字段')
    assert.ok(editorJs.indexOf("payload.guideBtnText = String(form.guideBtnText || '').trim()") >= 0, '保存时提交该字段')
    const editorWxml = read('pages/banner-detail/index.wxml')
    assert.ok(editorWxml.indexOf('wx:if="{{isDrivingGuide}}"') >= 0, '输入框只对学车指南 scope 显示')
    assert.ok(editorWxml.indexOf('data-field="guideBtnText"') >= 0, '输入框要接到 form.guideBtnText')
  }, '入口按钮文字改由学车指南页面配置')

  check(() => {
    const ctrl = read('server/controllers/configController.js')
    assert.ok(/if \(type === DRIVING_GUIDE_TYPE\) \{[\s\S]{0,200}meta\.guideBtnText = guideBtnText/.test(ctrl),
      '只有 drivingGuide 类型写这个键，其他自定义页面的 body 结构不受影响')
    assert.ok(ctrl.indexOf("guideBtnText: String(meta.guideBtnText || '')") >= 0, '读取时要回传该字段')
    assert.ok(ctrl.indexOf('入口按钮文字不能超过12字') >= 0, '服务端要有 12 字上限，与端上 maxlength 同口径')
    const promoBlock = ctrl.slice(ctrl.indexOf('exports.drivingPromo'), ctrl.indexOf('exports.saveDrivingPromo'))
    assert.ok(promoBlock.indexOf('guideBtnText') < 0, 'drivingPromo 不得再回传 guideBtnText')
    assert.ok(ctrl.slice(ctrl.indexOf('exports.saveDrivingPromo')).indexOf('guideBtnText') < 0, 'saveDrivingPromo 不得再接收 guideBtnText')

    assert.ok(read('pkg-admin/admin/index.wxml').indexOf('guideBtnText') < 0, '后台横幅表单不应再留这个输入框')
    assert.ok(read('pkg-admin/admin/index.js').indexOf('guideBtnText') < 0, '后台横幅的读取与提交都不应再带这个字段')
  }, '服务端落点与旧入口收尾')
}

async function main() {
  dataModuleTests()
  await pageBehaviorTests()
  sourceGuardTests()
  serverWiringTests()
  serverParserTests()
  mapEntryGuardTests()
  guideBtnTextGuardTests()
  console.log(testCount + ' tests passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
