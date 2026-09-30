/**
 * 校园评价模块测试（无需数据库 / 无需真机）
 *
 * 覆盖需求规则：
 *   一、导航层级：专科=大一/大二/大三；本科=大一/大二/大三/大四；专升本=本科一年级/本科二年级
 *       通识课为选修课，三类学历层次通用（恒在次导航首位）
 *   二、评价规则：课程评价不区分校区（查询参数不得带 campus）；
 *       食堂/商圈按校区区分（广州校区/南海南/南海北）；楼层次导航 1层/2层/3层；
 *       添加分类方式与食堂评价一致（发布评分对象）
 *
 * 做法：
 *   A. 真实加载 utils/review.js 与 reviewController 的镜像常量做一致性断言
 *   B. vm 加载真实 pages/review/list.js / target.js / index.js（假 wx / 假 api / 假 auth）
 *      断言三种模式的查询参数、次导航切换、权限拦截与乐观更新
 *   C. 假池加载 reviewController，断言 SQL 约束与「? 个数 === 参数个数」
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
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

const review = require('../../utils/review')
const { getDefaultCampus } = require('../../utils/campus')

// =====================================================================
// A. 导航层级与规则常量
// =====================================================================
check(() => {
  assert.deepStrictEqual(review.getCourseTabs('专科'), ['通识课', '大一', '大二', '大三'], '专本次导航')
  assert.deepStrictEqual(review.getCourseTabs('本科'), ['通识课', '大一', '大二', '大三', '大四'], '本科次导航')
  assert.deepStrictEqual(review.getCourseTabs('专升本'), ['通识课', '本科一年级', '本科二年级'], '专升本次导航')
}, '三类学历层次次导航')

check(() => {
  // 规则一：通识课为选修课，同时适用于专科、本科、专升本三类 → 恒在首位且对三类可见
  ;['专科', '本科', '专升本'].forEach((level) => {
    const tabs = review.getCourseTabs(level)
    assert.strictEqual(tabs[0], '通识课', level + ' 的次导航首位必须是通识课')
  })
  assert.deepStrictEqual(review.levelsForGrade('通识课'), ['专科', '本科', '专升本'], '通识课适用三类')
}, '通识课三类通用')

check(() => {
  // 年级 → 适用层次推导：大一大二大三为专科+本科，大四仅本科，专升本年级仅专升本
  assert.deepStrictEqual(review.levelsForGrade('大一'), ['专科', '本科'])
  assert.deepStrictEqual(review.levelsForGrade('大三'), ['专科', '本科'])
  assert.deepStrictEqual(review.levelsForGrade('大四'), ['本科'])
  assert.deepStrictEqual(review.levelsForGrade('本科一年级'), ['专升本'])
  assert.deepStrictEqual(review.levelsForGrade('本科二年级'), ['专升本'])
}, '年级适用层次推导')

check(() => {
  // 规则三/四：食堂与商圈按校区区分，两级校区模型（与 utils/campus.js 一致）
  assert.deepStrictEqual(review.REVIEW_CAMPUS_MAIN_OPTIONS, ['广州校区', '佛山校区'], '一级主校区')
  assert.deepStrictEqual(
    review.REVIEW_CAMPUS_GROUPS.map((g) => [g.name, g.subs]),
    [['广州校区', ['新港校区', '琶洲校区']], ['佛山校区', ['南海南校区', '南海北校区']]],
    '二级结构：广州→新港/琶洲，佛山→南海南/南海北'
  )
  assert.ok(review.isValidReviewCampus('南海南校区') && review.isValidReviewCampus('琶洲校区'), '分校区取值合法')
  assert.ok(!review.isValidReviewCampus('南海南') && !review.isValidReviewCampus('沙河东区'), '旧扁平值/非法值不合法')
  assert.strictEqual(review.parentMainOf('南海南校区'), '佛山校区', '分校区应解析出所属主校区')
  assert.deepStrictEqual(review.campusMatchList('佛山校区'), ['佛山校区', '南海南校区', '南海北校区'], '主校区命中自身+全部分校区')
  assert.deepStrictEqual(review.campusMatchList('南海南校区'), ['南海南校区'], '分校区精确命中')
  assert.strictEqual(review.normalizeLegacyReviewCampus('南海南'), '南海南校区', '旧存储值应迁移')
  assert.strictEqual(review.normalizeLegacyReviewCampus('南海北'), '南海北校区')
  assert.deepStrictEqual(review.REVIEW_FLOORS, ['1层', '2层', '3层', '4层', '5层', '6层'], '楼层次导航最多六层')
  assert.deepStrictEqual(review.REVIEW_CATEGORIES.map((c) => c.key), ['course', 'canteen', 'business'], '三大评价分类')
}, '校区 / 楼层 / 分类常量')

// =====================================================================
// B. 页面 vm 测试
// =====================================================================
function makeSandbox(stubs) {
  let pageDefinition = null
  const wxStub = new Proxy(Object.assign({
    setNavigationBarTitle: () => undefined,
    showToast: () => undefined,
    showLoading: () => undefined,
    hideLoading: () => undefined,
    vibrateShort: () => undefined,
    navigateTo: () => undefined,
    navigateBack: () => undefined,
    redirectTo: () => undefined,
    stopPullDownRefresh: () => undefined,
    getStorageSync: () => '',
    setStorageSync: () => undefined
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
      if (/utils\/api$/.test(key)) return stubs.api
      if (/utils\/auth$/.test(key)) return stubs.auth || { isLoggedIn: () => true, requireLogin: () => true }
      if (/utils\/wechat$/.test(key)) return stubs.wechat || {}
      if (/utils\/campus$/.test(key)) return require('../../utils/campus')
      if (/utils\/review$/.test(key)) return require('../../utils/review')
      throw new Error('测试桩未覆盖的模块：' + key)
    },
    getApp: () => ({ globalData: {} }),
    getCurrentPages: () => [],
    wx: wxStub
  }
  sandbox.Page = (definition) => { pageDefinition = definition }
  vm.createContext(sandbox)
  return { sandbox, wxStub, pageDefinition: () => pageDefinition }
}

function createPage(pageDefinition, options) {
  const page = Object.create(pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  // 假 setData 必须支持数据路径（'comments[0].liked'），否则断言看不到效果
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
  page.onLoad(options || {})
  return page
}

function loadPage(relativePath, stubs) {
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, relativePath), 'utf8')
  const { sandbox, pageDefinition } = makeSandbox(stubs)
  vm.runInNewContext(source, sandbox, { filename: relativePath })
  const definition = pageDefinition()
  assert.ok(definition, relativePath + ' 应调用 Page() 注册页面')
  return definition
}

// ----- B1. 列表页：三种模式的查询参数与次导航 -----
const listApiCalls = []
const listApiStub = {
  getReviewTargets(query) {
    listApiCalls.push(query)
    return Promise.resolve({ list: [], total: 0, hasMore: false })
  },
  getRandomReviewTarget() {
    return Promise.resolve({ target: { id: 9, name: '瓦罐饭' } })
  }
}
const listPageDef = loadPage('pages/review/list.js', { api: listApiStub })

async function listPageTests() {
  // 课程模式：次导航 = 通识课 + 本科年级；查询带 grade+level、绝不带 campus（规则二）
  {
    listApiCalls.length = 0
    const page = createPage(listPageDef, { category: 'course', level: '本科', grade: '通识课' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.deepStrictEqual(page.data.tabs, ['通识课', '大一', '大二', '大三', '大四'], '课程次导航应按本科展开')
      assert.strictEqual(page.data.activeTab, '通识课')
    }, '课程模式次导航')

    const query = page.buildQuery(1)
    check(() => {
      assert.strictEqual(query.category, 'course')
      assert.strictEqual(query.grade, '通识课')
      assert.strictEqual(query.level, '本科')
      assert.strictEqual('campus' in query, false, '课程评价不区分校区：查询参数不得带 campus')
      assert.strictEqual('parentId' in query, false)
      assert.strictEqual('floor' in query, false)
    }, '课程模式查询参数')

    // 切换学历层次：专升本 → 次导航整体替换，原「通识课」保持选中
    page.onLevelTap({ currentTarget: { dataset: { level: '专升本' } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.deepStrictEqual(page.data.tabs, ['通识课', '本科一年级', '本科二年级'], '专升本次导航')
      assert.strictEqual(page.data.activeTab, '通识课', '切层次后通识课保持选中')
    }, '切换学历层次重建次导航')

    // 点击年级 tab：查询带新 grade
    listApiCalls.length = 0
    page.onTabTap({ currentTarget: { dataset: { tab: '本科一年级' } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.strictEqual(page.data.activeTab, '本科一年级')
      assert.strictEqual(listApiCalls[listApiCalls.length - 1].grade, '本科一年级')
    }, '年级 tab 切换')
  }

  // 食堂根级模式：次导航 = 两个一级主校区；分校区入参归入所属主校区过滤
  {
    listApiCalls.length = 0
    const page = createPage(listPageDef, { category: 'canteen', campus: '南海南校区' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.deepStrictEqual(page.data.tabs, ['广州校区', '佛山校区'], '食堂次导航为一级主校区')
      assert.strictEqual(page.data.activeTab, '佛山校区', '分校区入参应归入所属主校区')
      assert.ok(page.data.randomLabel.indexOf('抽取今日美食') >= 0, '食堂应有抽取今日美食按钮')
    }, '食堂根级次导航')

    const query = page.buildQuery(1)
    check(() => {
      assert.strictEqual(query.category, 'canteen')
      assert.strictEqual(query.campus, '佛山校区', '查询只按主校区过滤（服务端主校区命中其全部分校区数据）')
      assert.strictEqual('grade' in query, false)
    }, '食堂根级查询参数')

    // 切换主校区 → 查询跟随并持久化
    listApiCalls.length = 0
    page.onTabTap({ currentTarget: { dataset: { tab: '广州校区' } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.strictEqual(listApiCalls[listApiCalls.length - 1].campus, '广州校区')
    }, '校区切换查询')
  }

  // 子级模式（食堂窗口）：次导航 = 楼层；查询带 parentId + floor
  {
    listApiCalls.length = 0
    const page = createPage(listPageDef, { category: 'canteen', parentId: '12', parentName: '测试食堂', floor: '2层' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.deepStrictEqual(page.data.tabs, ['1层', '2层', '3层', '4层', '5层', '6层'], '子级次导航按楼层（最多六层）')
      assert.strictEqual(page.data.activeTab, '2层')
    }, '子级楼层次导航')

    const query = page.buildQuery(1)
    check(() => {
      assert.strictEqual(query.parentId, 12)
      assert.strictEqual(query.floor, '2层')
      assert.strictEqual('campus' in query, false, '子级查询不带 campus（跟随父对象）')
    }, '子级查询参数')
  }
}

// ----- B2. 详情页：评分 / 点赞 / 权限 -----
let rateCalls = []
let likeTargetCalls = 0
const targetApiStub = {
  getReviewTargetDetail() {
    return Promise.resolve({
      target: {
        id: 7, category: 'course', name: '电影音乐赏析', grade: '通识课',
        ratingAvg: 4.5, ratingCount: 26, ratingSum: 117, commentCount: 10,
        likeCount: 0, liked: false, myRating: null
      }
    })
  },
  getReviewComments() {
    return Promise.resolve({
      list: [{ id: 1, nickName: '航小子', content: '老师讲课特别好', likeCount: 3, liked: false, createdAt: '2025-01-16 17:22:00' }],
      total: 1, hasMore: false
    })
  },
  rateReviewTarget(id, score) {
    rateCalls.push({ id, score })
    return Promise.resolve({ score, ratingCount: 27, ratingAvg: 4.52 })
  },
  likeReviewTarget() {
    likeTargetCalls += 1
    return Promise.resolve({ liked: true, likeCount: 1 })
  },
  likeReviewComment() {
    return Promise.resolve({ liked: true, likeCount: 4 })
  }
}
const targetPageDef = loadPage('pages/review/target.js', { api: targetApiStub })

async function targetPageTests() {
  rateCalls = []
  likeTargetCalls = 0
  const page = createPage(targetPageDef, { id: '7' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  check(() => {
    assert.strictEqual(page.data.target.name, '电影音乐赏析')
    assert.strictEqual(page.data.scoreText, '4.5', '评分均分应保留一位小数')
    assert.strictEqual(page.data.ratingCountText, '26人评分')
    assert.strictEqual(page.data.subtitle, '通识课', '课程副标题取年级分类（不区分校区）')
    assert.strictEqual(page.data.comments.length, 1)
    assert.strictEqual(page.data.comments[0].timeText.indexOf('1月16日'), 0, '历史时间应显示为 M月D日 HH:mm')
  }, '详情页渲染')

  // 未登录：不允许评分，也不打接口（auth.requireLogin 返回 false 的独立桩）
  {
    const denyAuth = { isLoggedIn: () => false, requireLogin: () => false }
    const denyPageDef = loadPage('pages/review/target.js', { api: targetApiStub, auth: denyAuth })
    const page2 = createPage(denyPageDef, { id: '7' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    rateCalls.length = 0
    await page2.onStarTap({ currentTarget: { dataset: { score: 5 } } })
    check(() => {
      assert.strictEqual(rateCalls.length, 0, '未登录不得调用评分接口')
      assert.strictEqual(page2.data.myRating, 0)
    }, '未登录评分拦截')

    // 未登录同样不得点赞
    likeTargetCalls = 0
    await page2.onTargetLikeTap()
    check(() => {
      assert.strictEqual(likeTargetCalls, 0, '未登录不得调用点赞接口')
    }, '未登录点赞拦截')
  }

  // 登录：评分成功 → 星级与均分更新
  await page.onStarTap({ currentTarget: { dataset: { score: 5 } } })
  check(() => {
    assert.deepStrictEqual(rateCalls, [{ id: 7, score: 5 }])
    assert.strictEqual(page.data.myRating, 5)
    assert.strictEqual(page.data.scoreText, '4.5', '27 人 4.52 均分应显示 4.5')
    assert.strictEqual(page.data.ratingCountText, '27人评分')
  }, '评分成功更新')

  // 同一分重复点击：不再打接口（提示可换星级重评）
  rateCalls.length = 0
  await page.onStarTap({ currentTarget: { dataset: { score: 5 } } })
  check(() => {
    assert.strictEqual(rateCalls.length, 0, '同分重复点击不应重复请求')
  }, '重复评分拦截')

  // 对象点赞
  await page.onTargetLikeTap()
  check(() => {
    assert.strictEqual(likeTargetCalls, 1)
    assert.strictEqual(page.data.liked, true)
    assert.strictEqual(page.data.likeCount, 1)
  }, '对象点赞')

  // 评价点赞乐观更新（数据路径 setData）
  await page.onCommentLikeTap({ currentTarget: { dataset: { id: 1 } } })
  check(() => {
    assert.strictEqual(page.data.comments[0].liked, true, '评价点赞应立即生效')
    assert.strictEqual(page.data.comments[0].likeCount, 4)
  }, '评价点赞乐观更新')
}

// ----- B3. 分类页：校区仅主校区（广州/佛山）选择 + 课程入口不带校区、食堂/商圈入口带校区 -----
{
  const store = { review_campus: '南海北' } // 旧版扁平值：迁移并归入所属主校区「佛山校区」
  const indexPageDef = loadPage('pages/review/index.js', {
    api: {},
    wx: {
      getStorageSync: (key) => store[key] || '',
      setStorageSync: (key, value) => { store[key] = value },
      navigateTo: (opt) => { store.lastNav = opt.url },
      vibrateShort: () => undefined
    }
  })
  const page = createPage(indexPageDef, {})
  check(() => {
    assert.strictEqual(page.data.campus, '佛山校区', '旧存储分校区值应迁移并归入所属主校区')
  }, '分类页校区沿用（旧值迁移 + 归入主校区）')

  page.onCategoryTap({ currentTarget: { dataset: { key: 'course' } } })
  check(() => {
    assert.strictEqual(store.lastNav.indexOf('campus'), -1, '课程入口不得带校区')
  }, '课程入口不带校区')

  page.onCategoryTap({ currentTarget: { dataset: { key: 'canteen' } } })
  check(() => {
    assert.strictEqual(store.lastNav.indexOf(encodeURIComponent('佛山校区')) > -1, true, '食堂入口应带所选主校区')
  }, '食堂入口带校区')

  // 主校区选择：选中即生效并持久化
  page.onCampusChange({ detail: { value: '广州校区' } })
  check(() => {
    assert.strictEqual(page.data.campus, '广州校区')
    assert.strictEqual(store.review_campus, '广州校区', '校区选择应持久化')
    assert.strictEqual(page.data.showCampusPanel, false, '选择后面板关闭')
  }, '主校区选择')

  // 防御性归一：分校区值（面板已不提供）归入所属主校区
  page.onCampusChange({ detail: { value: '南海南校区' } })
  check(() => {
    assert.strictEqual(page.data.campus, '佛山校区', '分校区值应归入所属主校区')
    assert.strictEqual(store.review_campus, '佛山校区')
  }, '分校区值归入主校区')
}

// =====================================================================
// C. 服务端控制器（假池）
// =====================================================================
const POOL_PATH = require.resolve('../config/pool')
const fakePool = {
  queries: [],
  queue: [],
  async query(sql, params) {
    const args = params || []
    fakePool.queries.push({ sql, params: args })
    const next = fakePool.queue.length ? fakePool.queue.shift() : [[]]
    return next
  }
}
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
const reviewController = require('../controllers/reviewController')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

function countPlaceholders(sql) {
  return (String(sql).match(/\?/g) || []).length
}

async function controllerTests() {
  // 课程列表：SQL 必须带 grade + levels 过滤；? 个数 === 参数个数
  {
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ total: 0 }]], // COUNT
      [[]],             // SELECT 列表
      [[]]              // 热门评价
    ]
    const res = makeRes()
    await reviewController.targets({ query: { category: 'course', grade: '大一', level: '本科' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '课程列表应成功')
      const listQuery = fakePool.queries.find((q) => /FROM review_target t/.test(q.sql) && /LIMIT/.test(q.sql))
      assert.ok(listQuery, '应执行列表查询')
      assert.match(listQuery.sql, /t\.grade = \?/, '必须按课程分类过滤')
      assert.match(listQuery.sql, /t\.levels/, '必须按学历层次过滤 levels')
      assert.match(listQuery.sql, /t\.deleted = 0/, '必须过滤已删除')
      assert.match(listQuery.sql, /t\.status = 1/, '必须只取上架对象')
      assert.strictEqual(countPlaceholders(listQuery.sql), listQuery.params.length,
        'SQL ? 个数(' + countPlaceholders(listQuery.sql) + ')必须等于参数个数(' + listQuery.params.length + ')')
    }, '课程列表 SQL 契约')
  }

  // 食堂根级列表：必须按校区 + 根级过滤；主校区命中自身 + 全部分校区
  {
    fakePool.queries.length = 0
    fakePool.queue = [[[{ total: 0 }]], [[]], [[]]]
    const res = makeRes()
    await reviewController.targets({ query: { category: 'canteen', campus: '佛山校区' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      const listQuery = fakePool.queries.find((q) => /LIMIT/.test(q.sql))
      assert.match(listQuery.sql, /t\.parent_id IS NULL/, '根级列表只取父对象')
      assert.match(listQuery.sql, /t\.campus IN/, '食堂必须按校区集合过滤')
      assert.deepStrictEqual(
        listQuery.params.slice(0, -2).slice(-3),
        ['佛山校区', '南海南校区', '南海北校区'],
        '主校区过滤应包含自身 + 两个分校区'
      )
      assert.strictEqual(countPlaceholders(listQuery.sql), listQuery.params.length, '食堂列表参数配平')
    }, '食堂根级 SQL 契约（主校区）')

    // 分校区：精确命中
    fakePool.queries.length = 0
    fakePool.queue = [[[{ total: 0 }]], [[]], [[]]]
    const res2 = makeRes()
    await reviewController.targets({ query: { category: 'canteen', campus: '南海南校区' } }, res2)
    check(() => {
      assert.strictEqual(res2.body.code, 200)
      const listQuery = fakePool.queries.find((q) => /LIMIT/.test(q.sql))
      assert.deepStrictEqual(listQuery.params.slice(0, -2).slice(-1), ['南海南校区'], '分校区应精确过滤')
    }, '食堂根级 SQL 契约（分校区精确命中）')
  }

  // 非法取值：不打到数据库
  {
    fakePool.queries.length = 0
    const res1 = makeRes()
    await reviewController.targets({ query: { category: 'course', grade: '大五', level: '本科' } }, res1)
    const res2 = makeRes()
    await reviewController.targets({ query: { category: 'canteen', campus: '沙河东区' } }, res2)
    check(() => {
      assert.strictEqual(res1.body.code, 400, '非法年级应 400')
      assert.strictEqual(res2.body.code, 400, '非法校区应 400（只允许广州校区/南海南/南海北）')
      assert.strictEqual(fakePool.queries.length, 0, '非法取值不得打到数据库')
    }, '非法取值拦截')
  }

  // 发布课程对象：levels 按年级推导；通识课三类全适用；课程强制无校区
  {
    fakePool.queries.length = 0
    fakePool.queue = [[[]], [{ insertId: 1 }]] // 查重 + INSERT
    const res = makeRes()
    await reviewController.createTarget(
      { userId: 21, body: { category: 'course', name: '动画艺术概论', grade: '通识课' } }, res
    )
    check(() => {
      assert.strictEqual(res.body.code, 200, '发布通识课应成功')
      const insert = fakePool.queries.find((q) => /INSERT INTO review_target/.test(q.sql))
      assert.ok(insert, '应执行 INSERT')
      const data = insert.params[0]
      assert.strictEqual(data.campus, '', '课程不得写入校区（规则二）')
      assert.strictEqual(data.levels, '专科,本科,专升本', '通识课 levels 应为三类全适用（规则一）')
    }, '发布通识课 levels 推导')

    fakePool.queries.length = 0
    fakePool.queue = [[[]], [{ insertId: 2 }]]
    const res2 = makeRes()
    await reviewController.createTarget(
      { userId: 21, body: { category: 'course', name: '高数（大四）', grade: '大四' } }, res2
    )
    check(() => {
      const insert = fakePool.queries.find((q) => /INSERT INTO review_target/.test(q.sql))
      assert.strictEqual(insert.params[0].levels, '本科', '大四课程 levels 应为本科')
    }, '大四课程 levels 推导')
  }

  // 发布子级对象：楼层必填、校区跟随父对象
  {
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 12, campus: '广州校区' }]], // 父对象查询（[rows] 形状）
      [[]],                               // 同名查重（rows 为空）
      [{ insertId: 3 }]                   // INSERT
    ]
    const res = makeRes()
    await reviewController.createTarget(
      { userId: 21, body: { category: 'canteen', name: '瓦罐饭', parentId: 12, floor: '1层' } }, res
    )
    check(() => {
      assert.strictEqual(res.body.code, 200, '发布子级对象应成功')
      const insert = fakePool.queries.find((q) => /INSERT INTO review_target/.test(q.sql))
      const data = insert.params[0]
      assert.strictEqual(data.parent_id, 12)
      assert.strictEqual(data.floor, '1层')
      assert.strictEqual(data.campus, '广州校区', '子级校区应跟随父对象')
    }, '子级对象继承父校区')

    // 楼层上限放宽到六层：6层 必须能发布
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 12, campus: '广州校区' }]],
      [[]],
      [{ insertId: 4 }]
    ]
    const six = makeRes()
    await reviewController.createTarget(
      { userId: 21, body: { category: 'canteen', name: '六楼窗口', parentId: 12, floor: '6层' } }, six
    )
    check(() => {
      assert.strictEqual(six.body.code, 200, '6层 应被接受')
      const insert = fakePool.queries.find((q) => /INSERT INTO review_target/.test(q.sql))
      assert.strictEqual(insert.params[0].floor, '6层')
    }, '楼层上限六层')

    // 楼层超出六层上限 → 400（4层现在合法了，用 7层 做反例）
    fakePool.queries.length = 0
    const bad = makeRes()
    await reviewController.createTarget(
      { userId: 21, body: { category: 'canteen', name: 'X', parentId: 12, floor: '7层' } }, bad
    )
    check(() => {
      assert.strictEqual(bad.body.code, 400, '非法楼层应 400')
      assert.strictEqual(fakePool.queries.length, 0, '非法楼层不得打到数据库')
    }, '非法楼层拦截')
  }

  // 评分：1-5 之外的分数拒绝；合法分数走 upsert + 聚合刷新
  {
    fakePool.queries.length = 0
    const bad1 = makeRes()
    await reviewController.rate({ userId: 21, params: { id: 7 }, body: { score: 0 } }, bad1)
    const bad2 = makeRes()
    await reviewController.rate({ userId: 21, params: { id: 7 }, body: { score: 6 } }, bad2)
    const bad3 = makeRes()
    await reviewController.rate({ userId: 21, params: { id: 7 }, body: { score: 4.5 } }, bad3)
    check(() => {
      assert.strictEqual(bad1.body.code, 400)
      assert.strictEqual(bad2.body.code, 400)
      assert.strictEqual(bad3.body.code, 400, '非整数评分应 400')
      assert.strictEqual(fakePool.queries.length, 0, '非法评分不得打到数据库')
    }, '非法评分拦截')

    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 7 }]],                                  // 对象存在（[rows] 形状）
      [{ affectedRows: 1 }],                          // upsert
      [{ affectedRows: 1 }],                          // 聚合刷新
      [[{ rating_sum: 226, rating_count: 50 }]]       // 读回聚合（[rows] 形状）
    ]
    const ok = makeRes()
    await reviewController.rate({ userId: 21, params: { id: 7 }, body: { score: 5 } }, ok)
    check(() => {
      assert.strictEqual(ok.body.code, 200)
      const upsert = fakePool.queries.find((q) => /ON DUPLICATE KEY UPDATE/.test(q.sql))
      assert.ok(upsert, '重复评分必须走 upsert（再次点击可以重新评分）')
      assert.deepStrictEqual(upsert.params, [7, 21, 5])
      assert.strictEqual(ok.body.data.ratingAvg, 4.52)
    }, '评分 upsert')
  }

  // ===== 管理后台：评分对象治理 =====
  {
    fakePool.queries.length = 0
    fakePool.queue = [[[{ total: 1 }]], [[{
      id: 9, category: 'canteen', parent_id: null, name: '一饭堂', campus: '佛山校区', floor: '',
      grade: '', levels: '', rating_sum: 0, rating_count: 0, comment_count: 0, like_count: 0,
      deleted: 0, created_at: '2026-09-01 10:00:00', updated_at: '2026-09-01 10:00:00',
      parent_name: null, created_by_name: '张三'
    }]]]
    const res = makeRes()
    await reviewController.adminTargets({ query: { category: 'canteen', keyword: '一饭' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      const listQuery = fakePool.queries.find((q) => /LIMIT/.test(q.sql))
      assert.match(listQuery.sql, /t\.deleted = \?/, '后台列表必须按删除状态过滤')
      assert.match(listQuery.sql, /t\.parent_id IS NULL/, '默认只出根条目（食堂/商圈/课程）')
      assert.match(listQuery.sql, /AS child_count/, '根条目要带子条目计数')
      assert.strictEqual(listQuery.params[0], 0, '默认只看未删除')
      assert.strictEqual(res.body.data.list[0].createdByName, '张三', '应带出创建人')
      assert.strictEqual(countPlaceholders(listQuery.sql), listQuery.params.length, '后台列表参数配平')
    }, '后台评分对象列表 SQL 契约')

    // 钻入某个食堂：只出该父对象下的子条目，并回带父条目信息
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ total: 2 }]],
      [[{
        id: 31, category: 'canteen', parent_id: 9, name: '牛肉汤', campus: '', floor: '1层',
        grade: '', levels: '', rating_sum: 0, rating_count: 0, comment_count: 0, like_count: 0,
        deleted: 0, created_at: '2026-09-02 10:00:00', updated_at: '2026-09-02 10:00:00',
        parent_name: '新北餐厅', created_by_name: '李四'
      }]],
      [[{ id: 9, name: '新北餐厅', category: 'canteen', campus: '广州校区' }]]
    ]
    const childRes = makeRes()
    await reviewController.adminTargets({ query: { parentId: '9' } }, childRes)
    check(() => {
      assert.strictEqual(childRes.body.code, 200)
      const listQuery = fakePool.queries.find((q) => /LIMIT/.test(q.sql))
      assert.match(listQuery.sql, /t\.parent_id = \?/, '钻入后只取该父对象下的子条目')
      assert.ok(!/parent_id IS NULL/.test(listQuery.sql), '钻入后不得再限定根条目')
      assert.strictEqual(listQuery.params[0], 0, '未删除')
      assert.strictEqual(listQuery.params[1], 9, '按父对象 id 过滤')
      assert.strictEqual(childRes.body.data.parent.name, '新北餐厅', '应回带父条目供面包屑显示')
      assert.strictEqual(childRes.body.data.list[0].parentId, 9)
      assert.strictEqual(countPlaceholders(listQuery.sql), listQuery.params.length, '子列表参数配平')
    }, '后台两级钻入（父对象下子条目）')

    fakePool.queries.length = 0
    fakePool.queue = [[[{ total: 0 }]], [[]]]
    const deletedRes = makeRes()
    await reviewController.adminTargets({ query: { state: 'deleted' } }, deletedRes)
    check(() => {
      assert.strictEqual(deletedRes.body.code, 200)
      assert.strictEqual(fakePool.queries[0].params[0], 1, 'state=deleted 应查已删除')
    }, '后台列表「已删除」切换')
  }

  {
    fakePool.queries.length = 0
    fakePool.queue = [[[{ id: 9, name: '一饭堂', category: 'canteen', deleted: 0 }]], [{ affectedRows: 4 }], [[]]]
    const res = makeRes()
    await reviewController.adminDeleteTarget({ userId: 1, params: { id: '9' }, ip: '127.0.0.1' }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      assert.strictEqual(res.body.data.affected, 4, '应回报连带删除的条数')
      const soft = fakePool.queries.find((q) => /UPDATE review_target SET deleted = 1/.test(q.sql))
      assert.ok(soft, '必须是软删')
      assert.match(soft.sql, /OR parent_id = \?/, '父对象要连带子对象')
      assert.deepStrictEqual(soft.params, [9, 9])
      assert.ok(!fakePool.queries.some((q) => /DELETE FROM review_target/.test(q.sql)), '不得物理删除评分对象')
      assert.ok(fakePool.queries.some((q) => /INSERT INTO admin_audit_log/.test(q.sql)), '删除要写管理审计')
    }, '后台删除为软删并连带子对象')

    fakePool.queries.length = 0
    fakePool.queue = [[[{ id: 9, name: '一饭堂', category: 'canteen', deleted: 1 }]]]
    const again = makeRes()
    await reviewController.adminDeleteTarget({ userId: 1, params: { id: '9' } }, again)
    check(() => {
      assert.strictEqual(again.body.code, 400, '重复删除应拒绝')
      assert.strictEqual(fakePool.queries.length, 1, '拒绝时不得再写库')
    }, '重复删除拦截')
  }

  {
    // 子对象随父删除后，父仍在删除态时不允许单独恢复子对象
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 12, name: '窗口A', category: 'canteen', parent_id: 9, deleted: 1 }]],
      [[{ deleted: 1 }]]
    ]
    const res = makeRes()
    await reviewController.adminRestoreTarget({ userId: 1, params: { id: '12' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 400, '父对象未恢复时不得恢复子对象')
      assert.ok(!fakePool.queries.some((q) => /UPDATE review_target SET deleted = 0/.test(q.sql)), '拦截时不得写库')
    }, '恢复需先恢复父对象')

    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 9, name: '一饭堂', category: 'canteen', parent_id: null, deleted: 1 }]],
      [{ affectedRows: 1 }],
      [[]]
    ]
    const ok = makeRes()
    await reviewController.adminRestoreTarget({ userId: 1, params: { id: '9' }, ip: '127.0.0.1' }, ok)
    check(() => {
      assert.strictEqual(ok.body.code, 200)
      const restore = fakePool.queries.find((q) => /UPDATE review_target SET deleted = 0/.test(q.sql))
      assert.deepStrictEqual(restore.params, [9], '只恢复该条本身')
    }, '根对象恢复')
  }
}

// =====================================================================
// 运行
// =====================================================================
async function main() {
  await listPageTests()
  await targetPageTests()
  await controllerTests()
  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Review module tests failed:', err.message)
  process.exit(1)
})
