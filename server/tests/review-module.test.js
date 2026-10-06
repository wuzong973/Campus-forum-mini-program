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
      // 评价页新增分身开关依赖匿名身份工具：桩返回固定分身身份
      if (/utils\/anonymousIdentity$/.test(key)) return stubs.anonymousIdentity || { generate: () => ({ nickName: '分身同学', avatarUrl: '/assets/avatar1/1.jpg' }) }
      if (/utils\/campus$/.test(key)) return require('../../utils/campus')
      if (/utils\/review$/.test(key)) return require('../../utils/review')
      // 评论「…」菜单的拉黑走 utils/request.post('/message/block')，
      // 因此评价页现在直接依赖 request 模块。桩返回固定成功响应即可 ——
      // 这里不校验拉黑请求本身（那是 review-comment-parity.test.js 的职责）。
      if (/utils\/request$/.test(key)) return stubs.request || { get: () => Promise.resolve({}), post: () => Promise.resolve({}) }
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

// ----- B1b. 列表卡片文案：容器「有 x 条评论」/ 子级「分数 + x人已评」-----
// 根级食堂 / 商圈不可评分：卡片不显示分数，计数为聚合后的评论条数。
function listCardTextTests() {
  check(() => {
    // 容器（根级食堂）：无分数，「有 x 条评论」取 commentTotal
    const container = review.decorateTarget({
      id: 9, category: 'canteen', name: '一饭堂', parentId: null, ratingCount: 0, ratingAvg: 0, commentTotal: 6
    })
    assert.strictEqual(container.scoreText, '', '根级食堂不得显示分数')
    assert.strictEqual(container.ratedCountText, '有 6 条评论', '根级食堂计数应为聚合评论数')

    // 容器（根级商圈）同样处理
    const biz = review.decorateTarget({
      id: 11, category: 'business', name: '万科里', parentId: null, ratingCount: 0, ratingAvg: 0, commentTotal: 3
    })
    assert.strictEqual(biz.scoreText, '', '根级商圈不得显示分数')
    assert.strictEqual(biz.ratedCountText, '有 3 条评论')

    // 无子级评论 → 0
    const empty = review.decorateTarget({ id: 10, category: 'canteen', name: '2饭', parentId: null, commentTotal: 0 })
    assert.strictEqual(empty.ratedCountText, '有 0 条评论', '无评论也要给出 0，不得显示「暂无」')

    // 子级档口：保留自身分数与评分人数
    const child = review.decorateTarget({
      id: 31, category: 'canteen', name: '泰岛蛋', parentId: 9, ratingCount: 2, ratingAvg: 3, commentCount: 6
    })
    assert.strictEqual(child.scoreText, '3.0', '子级档口显示自身分数')
    assert.strictEqual(child.ratedCountText, '2人已评', '子级档口保留评分人数口径')

    // 课程：不受影响（parentId 为 null 但 category=course）
    const course = review.decorateTarget({
      id: 7, category: 'course', name: '高数', grade: '大一', parentId: null, ratingCount: 5, ratingAvg: 4.2
    })
    assert.strictEqual(course.scoreText, '4.2', '课程仍显示分数')
    assert.strictEqual(course.ratedCountText, '5人已评', '课程保留人已评口径')

    // 无评分课程：显示「暂无」（此分支不得被容器逻辑吃掉）
    const noScore = review.decorateTarget({ id: 8, category: 'course', name: '新课程', parentId: null, ratingCount: 0 })
    assert.strictEqual(noScore.scoreText, '暂无', '无评分课程应显示暂无')
    assert.strictEqual(noScore.ratedCountText, '0人已评')
  }, '列表卡片文案（容器「有 x 条评论」/ 子级「分数 + x人已评」）')
}

// ----- B1c. 静态护栏：父级评分入口已彻底移除 -----
function parentEntryRemovedTests() {
  const fs = require('fs')
  const read = (rel) => fs.readFileSync(path.join(MINI_PROGRAM_ROOT, rel), 'utf8')
  const listWxml = read('pages/review/list.wxml')
  const listJs = read('pages/review/list.js')
  const listWxss = read('pages/review/list.wxss')

  check(() => {
    assert.ok(!/看食堂评分与评价/.test(listJs + listWxml), '「看食堂评分与评价」入口必须已删除')
    assert.ok(!/看商圈评分与评价/.test(listJs + listWxml), '「看商圈评分与评价」入口必须已删除')
    assert.ok(!/parentEntryText/.test(listJs + listWxml), 'parentEntryText 数据字段必须已删除')
    assert.ok(!/onParentTap/.test(listJs + listWxml), 'onParentTap 必须已删除')
    assert.ok(!/parent-bar-link/.test(listWxml + listWxss), '入口链接样式 parent-bar-link 必须已删除')
    assert.ok(!/parent-bar--hover/.test(listWxml + listWxss), '入口 hover 态必须已删除（容器不可点击）')
    // parent-bar 本身保留：仅作层级标识（显示当前所在食堂/商圈名称）
    assert.match(listWxml, /class="parent-bar"/, 'parent-bar 应保留为不可点击的层级标识')
    assert.ok(!/class="parent-bar spring-btn"/.test(listWxml), 'parent-bar 不得再绑定点击（不得带 spring-btn）')
  }, '父级（食堂/商圈）评分入口已彻底移除')
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

// ----- B2a. 详情页：容器（根级食堂/商圈）不显示评分卡 -----
// 根级食堂/商圈不可评分：详情页不得渲染星级卡与评分人数；子级档口仍正常显示。
async function containerDetailTests() {
  function makeStub(target) {
    return {
      getReviewTargetDetail: () => Promise.resolve({ target }),
      getReviewComments: () => Promise.resolve({ list: [], total: 0, hasMore: false })
    }
  }

  // 容器：rateable=false → scoreText / ratingCountText 置空（WXML 据 target.rateable 隐藏星级卡）
  {
    const page = createPage(
      loadPage('pages/review/target.js', {
        api: makeStub({
          id: 9, category: 'canteen', name: '一饭堂', campus: '佛山校区', parentId: null,
          rateable: false, ratingCount: 0, ratingAvg: 0, commentCount: 6, likeCount: 0
        })
      }),
      { id: '9' }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.strictEqual(page.data.target.rateable, false, '容器 rateable 应透传到端上')
      assert.strictEqual(page.data.scoreText, '', '容器不得显示分数')
      assert.strictEqual(page.data.ratingCountText, '', '容器不得显示评分人数')
      assert.strictEqual(page.data.subtitle, '佛山校区', '容器副标题取校区')
    }, '详情页容器不显示评分卡')

    // 星级卡在 WXML 里必须按 rateable 隐藏（静态断言）
    const wxml = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages/review/target.wxml'), 'utf8')
    check(() => {
      const rateCard = wxml.slice(wxml.indexOf('class="rate-card"') - 120, wxml.indexOf('class="rate-card"') + 20)
      assert.match(rateCard, /target\.rateable !== false/, '星级卡必须按 target.rateable 隐藏')
      const headScore = wxml.slice(wxml.indexOf('class="head-score"') - 120, wxml.indexOf('class="head-score"') + 20)
      assert.match(headScore, /target\.rateable !== false/, '头部评分徽章必须按 target.rateable 隐藏')
    }, '详情页 WXML 评分区按 rateable 隐藏')
  }

  // 子级档口：rateable=true → 正常显示分数与评分人数
  {
    const page = createPage(
      loadPage('pages/review/target.js', {
        api: makeStub({
          id: 31, category: 'canteen', name: '泰岛蛋', campus: '佛山校区', parentId: 9, parentName: '一饭堂', floor: '1层',
          rateable: true, ratingCount: 2, ratingAvg: 3, commentCount: 6, likeCount: 1
        })
      }),
      { id: '31' }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.strictEqual(page.data.scoreText, '3.0', '子级档口显示分数')
      assert.strictEqual(page.data.ratingCountText, '2人评分', '子级档口显示评分人数')
    }, '详情页子级档口正常显示评分')
  }
}

// ----- B2b. 详情页：评价回复（两级树 / 回复态 / 计数以服务端为准） -----
// 回归点：① 回复入口原本完全缺失；② 顶层评价的回复要能折叠展开；
//         ③ 「回复 xxx」前缀只在回复「回复」时出现；④ 计数不得本地 +1 漂移。
function makeReplyApiStub(state) {
  const flatComments = [
    { id: 11, nickName: '甲', content: '顶层评价', parentId: 0, likeCount: 0, liked: false, createdAt: '2025-01-16 17:22:00' },
    { id: 12, nickName: '乙', content: '回复顶层', parentId: 11, likeCount: 0, liked: false, createdAt: '2025-01-16 17:23:00' },
    { id: 13, nickName: '丙', content: '回复乙', parentId: 11, likeCount: 0, liked: false, createdAt: '2025-01-16 17:24:00' }
  ]
  return {
    calls: state.calls,
    getReviewTargetDetail() {
      return Promise.resolve({
        target: { id: 7, category: 'canteen', name: '一饭堂', campus: '佛山校区', ratingCount: 0, commentCount: 3, likeCount: 0 }
      })
    },
    getReviewComments() {
      // 服务端口径：total = 顶层 1 + 回复 2 = 3；list 为扁平（含 parentId）
      return Promise.resolve({ list: flatComments.slice(), total: 3, hasMore: false })
    },
    addReviewComment(id, content, images, anonymous, parentId) {
      const requested = Number(parentId) || 0
      state.calls.push({ id, content, parentId: requested })
      // 服务端两级收口：回复「回复」时挂到其所属顶层评价下（此处 12/13 的顶层都是 11）
      const parent = flatComments.find((c) => c.id === requested)
      const pid = parent ? (Number(parent.parentId) || Number(parent.id)) : 0
      return Promise.resolve({
        // 服务端回传的是全量重算结果，端上不得自行 +1
        comment: { id: 14, nickName: '我', content, likeCount: 0, liked: false, parentId: pid, createdAt: '2025-01-16 18:00:00' },
        parentId: pid,
        commentCount: 4
      })
    },
    likeReviewComment() { return Promise.resolve({ liked: true, likeCount: 1 }) }
  }
}

async function replyPageTests() {
  const state = { calls: [] }
  const page = createPage(loadPage('pages/review/target.js', { api: makeReplyApiStub(state) }), { id: '7' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  check(() => {
    const actual = page.data.comments[0].replies.map((r) => Number(r.parentId))
    assert.strictEqual(actual.length, 2, '应有 2 条回复')
    assert.strictEqual(actual[0], 11, '第 1 条回复的 parentId 指向顶层评价')
    assert.strictEqual(actual[1], 11, '第 2 条回复的 parentId 指向顶层评价')
  }, '回复的 parentId 指向顶层评价')

  check(() => {
    assert.strictEqual(page.data.comments.length, 1, '两级树：只剩 1 条顶层评价')
    assert.strictEqual(page.data.comments[0].replyCount, 2, '两条回复都挂在顶层评价下')
    assert.strictEqual(page.data.commentCount, 3, '评论计数应取服务端 total，不得本地累加')
  }, '评价回复两级树构建')

  // 「回复 xxx」前缀只在回复「回复」时出现：直接回复顶层评价不带前缀
  check(() => {
    page.data.comments[0].replies.forEach((reply) => {
      assert.strictEqual(reply.replyToNick, '', '直接回复顶层评价不应带「回复 xxx」前缀')
    })
  }, '回复顶层评价不带前缀')

  // 点击某条回复 → 进入回复态（replyTo + 前缀昵称 + 聚焦）
  page.onReplyComment({ currentTarget: { dataset: { id: 12, nick: '乙' } } })
  check(() => {
    assert.strictEqual(page.data.replyTo, 12)
    assert.strictEqual(page.data.replyToNick, '乙')
    assert.strictEqual(page.data.inputFocus, true)
  }, '点评论进入回复态')

  page.onCancelReply()
  check(() => {
    assert.strictEqual(page.data.replyTo, 0)
    assert.strictEqual(page.data.replyToNick, '')
    assert.strictEqual(page.data.inputFocus, false)
  }, '取消回复态')

  // 回复发送：parentId 透传；成功后计数取服务端值 4（而不是本地 3+1 或保持 3）
  state.calls.length = 0
  page.setData({ inputText: '这是我的回复', replyTo: 12, replyToNick: '乙' })
  await page.onSend()
  await new Promise((resolve) => setTimeout(resolve, 0))
  check(() => {
    assert.strictEqual(state.calls.length, 1, '应发起一次回复')
    assert.strictEqual(state.calls[0].parentId, 12, 'parentId 必须透传给服务端')
    assert.strictEqual(page.data.commentCount, 4, '评论计数取服务端回传值（不得本地 +1 漂移）')
    assert.strictEqual(page.data.replyTo, 0, '发送成功后退出回复态')
    assert.strictEqual(page.data.comments[0].replyCount, 3, '新回复应挂到顶层评价下')
  }, '回复发送与计数同步')

  // 顶层发布：未进入回复态时 parentId = 0
  state.calls.length = 0
  page.setData({ inputText: '顶层新评价' })
  await page.onSend()
  await new Promise((resolve) => setTimeout(resolve, 0))
  check(() => {
    assert.strictEqual(state.calls[0].parentId, 0, '未进入回复态时 parentId 应为 0')
  }, '顶层发布 parentId=0')
}

// 回复中出现「回复 xxx」前缀：构造「顶层 ← 回复 ← 回复」，第二条回复的父级本身是回复
async function replyToReplyPrefixTests() {
  const api = {
    getReviewTargetDetail: () => Promise.resolve({ target: { id: 7, category: 'canteen', name: 'X', commentCount: 3, ratingCount: 0, likeCount: 0 } }),
    getReviewComments: () => Promise.resolve({
      list: [
        { id: 31, nickName: '甲', content: '顶层', parentId: 0, likeCount: 0, liked: false, createdAt: '2025-01-16 10:00:00' },
        { id: 32, nickName: '乙', content: '回复顶层', parentId: 31, likeCount: 0, liked: false, createdAt: '2025-01-16 10:01:00' },
        { id: 33, nickName: '丙', content: '回复乙', parentId: 32, likeCount: 0, liked: false, createdAt: '2025-01-16 10:02:00' }
      ],
      total: 3, hasMore: false
    })
  }
  const page = createPage(loadPage('pages/review/target.js', { api }), { id: '7' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  check(() => {
    const root = page.data.comments[0]
    // 端上按 parentId 拼树：33 的父级 32 本身是回复 → 仍挂到顶层 31 下并带前缀
    const reply33 = root.replies.find((r) => Number(r.id) === 33) || (page.data.comments[1] && page.data.comments[1].replies.find((r) => Number(r.id) === 33))
    assert.ok(reply33, '回复的回复不得丢失')
    assert.strictEqual(reply33.parentId, 32, '服务端原样下发二级 parentId')
    assert.strictEqual(reply33.replyToNick, '乙', '回复「回复」时应显示「回复 xxx」前缀')
  }, '回复的回复带前缀')
}

// 超过 2 条回复：默认折叠为 2 条，展开态按顶层评价 id 记忆（翻页/重排不丢）
async function replyFoldTests() {
  const list = [{ id: 41, nickName: '楼主', content: '顶层', parentId: 0, likeCount: 0, liked: false, createdAt: '2025-01-16 10:00:00' }]
  for (let i = 0; i < 4; i++) {
    list.push({ id: 42 + i, nickName: '路人' + i, content: '回复' + i, parentId: 41, likeCount: 0, liked: false, createdAt: '2025-01-16 10:0' + i + ':00' })
  }
  const api = {
    getReviewTargetDetail: () => Promise.resolve({ target: { id: 7, category: 'canteen', name: 'X', commentCount: 5, ratingCount: 0, likeCount: 0 } }),
    getReviewComments: () => Promise.resolve({ list: list.slice(), total: 5, hasMore: false })
  }
  const page = createPage(loadPage('pages/review/target.js', { api }), { id: '7' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  check(() => {
    const root = page.data.comments[0]
    assert.strictEqual(root.replyCount, 4)
    assert.strictEqual(root.visibleReplies.length, 2, '超过 2 条回复默认只显示 2 条')
    assert.strictEqual(root.expandedReplies, false)
  }, '回复默认折叠（>2 条）')

  page.onToggleReplies({ currentTarget: { dataset: { index: 0 } } })
  check(() => {
    const root = page.data.comments[0]
    assert.strictEqual(root.expandedReplies, true)
    assert.strictEqual(root.visibleReplies.length, 4, '展开后显示全部回复')
    assert.strictEqual(page.data.expandedReplyIds[41], true, '展开态按顶层评价 id 记忆')
  }, '展开全部回复')

  page.onToggleReplies({ currentTarget: { dataset: { index: 0 } } })
  check(() => {
    assert.strictEqual(page.data.comments[0].visibleReplies.length, 2, '再次点击折叠')
    assert.strictEqual(page.data.expandedReplyIds[41], false)
  }, '折叠回复')
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
  // 根级是容器（不可评分）：commentTotal = 全部子级档口评论条数之和，rateable=false
  {
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ total: 2 }]],
      [[
        { id: 9, category: 'canteen', parent_id: null, name: '一饭堂', campus: '佛山校区', rating_count: 0, rating_sum: 0, comment_count: 0, like_count: 0, hot_comment: '' },
        { id: 10, category: 'canteen', parent_id: null, name: '2饭', campus: '佛山校区', rating_count: 0, rating_sum: 0, comment_count: 0, like_count: 0, hot_comment: '' }
      ]],
      [[]],                          // 热门评价（空）
      [[{ parent_id: 9, total: 6 }]] // 容器评论数聚合：一饭堂 = 6
    ]
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

      // 容器评论数聚合：必须走独立聚合查询（按子级 parent_id 分组），不得 JOIN 到主查询
      const aggQuery = fakePool.queries.find((q) => /GROUP BY t\.parent_id/.test(q.sql))
      assert.ok(aggQuery, '容器评论数必须用独立聚合查询（JOIN SUM 会因一对多重复累加）')
      assert.match(aggQuery.sql, /t\.parent_id IN/, '聚合按子级所属父对象分组')
      assert.match(aggQuery.sql, /c\.deleted = 0 AND c\.status = 1/, '聚合口径与 comment_count 一致（只计有效评论）')
      assert.ok(!/t\.parent_id IN[\s\S]*t\.deleted[\s\S]*GROUP BY/.test(aggQuery.sql), '聚合不得按 target 删除状态过滤（与 comment_count 口径一致）')

      const one = res.body.data.list.find((t) => t.id === 9)
      const two = res.body.data.list.find((t) => t.id === 10)
      assert.strictEqual(one.commentTotal, 6, '一饭堂 commentTotal 应为其档口评论数之和')
      assert.strictEqual(two.commentTotal, 0, '无档口评论的食堂 commentTotal 为 0')
      assert.strictEqual(one.rateable, false, '根级食堂不可评分')
    }, '食堂根级 SQL 契约（主校区 + 容器评论数聚合）')

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

    // 子级列表（档口）：非容器 → rateable=true，commentTotal 取自身 comment_count
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 9, campus: '佛山校区' }]],  // 父对象存在
      [[{ total: 1 }]],
      [[{ id: 31, category: 'canteen', parent_id: 9, name: '泰岛蛋', campus: '佛山校区', floor: '1层', rating_count: 2, rating_sum: 6, comment_count: 6, like_count: 1, hot_comment: '', parent_name: '一饭堂' }]],
      [[]],
      [[]]
    ]
    const res3 = makeRes()
    await reviewController.targets({ query: { category: 'canteen', parentId: '9', floor: '1层' } }, res3)
    check(() => {
      assert.strictEqual(res3.body.code, 200)
      const item = res3.body.data.list[0]
      assert.strictEqual(item.rateable, true, '子级档口可评分')
      assert.strictEqual(item.commentTotal, 6, '子级 commentTotal 取自身评论数')
      assert.strictEqual(item.ratingCount, 2, '子级保留自身评分人数')
    }, '子级档口 rateable / commentTotal')
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

  // 随机抽取：食堂 / 商圈根级不可评分 → 只能在子级档口 / 店铺里抽（否则抽到详情页没有评分卡）
  {
    fakePool.queries.length = 0
    fakePool.queue = [[[{ id: 31, category: 'canteen', parent_id: 9 }]]]
    const res = makeRes()
    await reviewController.random({ query: { category: 'canteen', campus: '佛山校区' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      const pick = fakePool.queries.find((q) => /ORDER BY RAND\(\)/.test(q.sql))
      assert.ok(pick, '应执行随机抽取查询')
      assert.match(pick.sql, /t\.parent_id IS NOT NULL/, '食堂随机抽取必须排除根级容器')
      assert.ok(!/t\.parent_id IS NULL/.test(pick.sql), '不得抽到不可评分的容器')
    }, '食堂随机抽取排除容器')

    // 商圈同样排除容器
    fakePool.queries.length = 0
    fakePool.queue = [[[]]]
    const biz = makeRes()
    await reviewController.random({ query: { category: 'business', campus: '广州校区' } }, biz)
    check(() => {
      const pick = fakePool.queries.find((q) => /ORDER BY RAND\(\)/.test(q.sql))
      assert.match(pick.sql, /t\.parent_id IS NOT NULL/, '商圈随机抽取必须排除根级容器')
    }, '商圈随机抽取排除容器')

    // 课程：本身就是可评分叶子 → 仍取根级
    fakePool.queries.length = 0
    fakePool.queue = [[[{ id: 7, category: 'course' }]]]
    const course = makeRes()
    await reviewController.random({ query: { category: 'course', campus: '佛山校区' } }, course)
    check(() => {
      const pick = fakePool.queries.find((q) => /ORDER BY RAND\(\)/.test(q.sql))
      assert.match(pick.sql, /t\.parent_id IS NULL/, '课程随机抽取仍取根级（课程本身即可评分）')
    }, '课程随机抽取不受影响')
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
      [[{ id: 7, category: 'course', parent_id: null }]], // 对象存在（课程：可评分叶子）
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

    // 根级食堂 / 商圈是容器（挂档口 / 店铺），本身不可评分 → 400，不得写库
    fakePool.queries.length = 0
    fakePool.queue = [[[{ id: 9, category: 'canteen', parent_id: null }]]]
    const container = makeRes()
    await reviewController.rate({ userId: 21, params: { id: 9 }, body: { score: 5 } }, container)
    check(() => {
      assert.strictEqual(container.body.code, 400, '根级食堂不得直接评分')
      assert.ok(
        !fakePool.queries.some((q) => /INSERT INTO review_rating/.test(q.sql)),
        '拒绝容器评分时不得写 review_rating'
      )
    }, '容器（根级食堂/商圈）不可评分')

    // 子级档口 / 店铺仍可正常评分（parent_id 非空）
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 31, category: 'canteen', parent_id: 9 }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [[{ rating_sum: 6, rating_count: 2 }]]
    ]
    const child = makeRes()
    await reviewController.rate({ userId: 21, params: { id: 31 }, body: { score: 3 } }, child)
    check(() => {
      assert.strictEqual(child.body.code, 200, '子级档口应可评分')
      assert.ok(fakePool.queries.some((q) => /INSERT INTO review_rating/.test(q.sql)), '子级评分要落库')
    }, '子级档口可评分')
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
// C2. 评价回复（服务端）：两级收口 + 计数全量重算
// 回归点：① 回复必须写入 parent_id；② 回复「回复」要收口到顶层，不产生三级；
//         ③ 计数一律全量重算，绝不 ±1；④ 分页单元是顶层评价，回复不会变孤儿。
// =====================================================================
async function reviewReplyControllerTests() {
  // 被回复通知走 fire-and-forget（createNotification 不 await），它会异步继续消耗假池的
  // queue。每个用例开头先「排空」：让上一轮遗留的异步查询跑完，避免它偷吃本用例的桩数据。
  async function settle() {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  // 顶层评价：parent_id 全为 0，计数走全量重算
  {
    await settle()
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 7 }]],                                            // 评分对象存在
      [{ insertId: 51 }],                                       // INSERT 评论
      [{ affectedRows: 1 }],                                    // refreshCommentCount
      [{ affectedRows: 1 }],                                    // refreshHotComment
      [[{ id: 51, target_id: 7, parent_id: 0, user_id: 21, content: '顶楼', images: null, anonymous_identity: null, like_count: 0, created_at: '2026-10-02 10:00:00', nick_name: '甲', avatar_url: '', cert_label: '' }]],
      [[{ comment_count: 3 }]]                                  // commentCountOf 读回
    ]
    const res = makeRes()
    await reviewController.addComment({ userId: 21, params: { id: '7' }, body: { content: '顶楼' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '顶层评价应发布成功')
      const insert = fakePool.queries.find((q) => /INSERT INTO review_comment/.test(q.sql))
      assert.ok(insert, '应写入 review_comment')
      assert.match(insert.sql, /parent_id/, 'INSERT 必须显式写 parent_id')
      assert.strictEqual(insert.params[1], 0, '顶层评价 parent_id = 0')
      // 计数必须是全量重算子查询，不得出现 ±1 增量
      const recount = fakePool.queries.find((q) => /UPDATE review_target t SET t\.comment_count/.test(q.sql))
      assert.ok(recount, '必须刷新 comment_count')
      assert.match(recount.sql, /SELECT COUNT\(\*\) FROM review_comment/, '计数必须按明细表全量重算')
      assert.ok(!/\+\s*1\s*$/m.test(recount.sql), '计数不得用 ±1 增量')
      assert.strictEqual(res.body.data.parentId, 0)
      assert.strictEqual(res.body.data.commentCount, 3, '应回传重算后的真实计数')
    }, '顶层评价写入与计数重算')
  }

  // 回复顶层评价：parent_id 原样落库
  {
    await settle()
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 7 }]],                                            // 评分对象存在
      [[{ id: 51, target_id: 7, parent_id: 0, user_id: 22 }]],  // 父评价（顶层）
      [{ insertId: 52 }],                                       // INSERT
      [{ affectedRows: 1 }],                                    // 计数重算
      [{ affectedRows: 1 }],                                    // 热门评价刷新
      [[{ id: 52, target_id: 7, parent_id: 51, user_id: 21, content: '回复', images: null, anonymous_identity: null, like_count: 0, created_at: '2026-10-02 10:01:00', nick_name: '乙', avatar_url: '', cert_label: '' }]],
      [[{ id: 21, nick_name: '乙', avatar_url: '' }]],          // 通知发起人快照
      [{ insertId: 900 }],                                      // 通知落库（fire-and-forget）
      [[]],                                                     // 订阅额度查询（fire-and-forget）
      [[{ comment_count: 4 }]]                                  // commentCountOf
    ]
    const res = makeRes()
    await reviewController.addComment({ userId: 21, params: { id: '7' }, body: { content: '回复', parentId: 51 } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '回复顶层评价应成功')
      const insert = fakePool.queries.find((q) => /INSERT INTO review_comment/.test(q.sql))
      assert.strictEqual(insert.params[1], 51, '回复顶层的 parent_id 应为其 id')
      assert.strictEqual(res.body.data.parentId, 51)
    }, '回复顶层评价落库 parent_id')
  }

  // 回复「回复」：两级收口 —— 挂到该回复所属的顶层评价下，不产生三级
  {
    await settle()
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 7 }]],
      [[{ id: 52, target_id: 7, parent_id: 51, user_id: 22 }]], // 被回复的是一条「回复」
      [{ insertId: 53 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [[{ id: 53, target_id: 7, parent_id: 51, user_id: 21, content: '回复的回复', images: null, anonymous_identity: null, like_count: 0, created_at: '2026-10-02 10:02:00', nick_name: '丙', avatar_url: '', cert_label: '' }]],
      [[{ id: 21, nick_name: '丙', avatar_url: '' }]],
      [{ insertId: 901 }],
      [[]],
      [[{ comment_count: 5 }]]
    ]
    const res = makeRes()
    await reviewController.addComment({ userId: 21, params: { id: '7' }, body: { content: '回复的回复', parentId: 52 } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      const insert = fakePool.queries.find((q) => /INSERT INTO review_comment/.test(q.sql))
      assert.strictEqual(insert.params[1], 51, '回复「回复」必须收口到顶层评价（51），不得挂三级')
      assert.strictEqual(res.body.data.parentId, 51)
    }, '回复的回复两级收口')
  }

  // 跨对象挂载：被回复评价不属于当前评分对象 → 拒绝且不写库
  {
    await settle()
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ id: 7 }]],
      [[{ id: 99, target_id: 8, parent_id: 0, user_id: 22 }]]
    ]
    const res = makeRes()
    await reviewController.addComment({ userId: 21, params: { id: '7' }, body: { content: 'x', parentId: 99 } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 400, '跨评分对象回复应拒绝')
      assert.ok(!fakePool.queries.some((q) => /INSERT INTO review_comment/.test(q.sql)), '拒绝时不得写库')
    }, '跨对象回复拦截')
  }

  // 被回复评价已删除 / 不存在 → 404
  {
    await settle()
    fakePool.queries.length = 0
    fakePool.queue = [[[{ id: 7 }]], [[]]]
    const res = makeRes()
    await reviewController.addComment({ userId: 21, params: { id: '7' }, body: { content: 'x', parentId: 51 } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 404, '被回复评价不存在应 404')
      assert.ok(!fakePool.queries.some((q) => /INSERT INTO review_comment/.test(q.sql)), '拒绝时不得写库')
    }, '被回复评价不存在拦截')
  }

  // 空内容 + 无图 → 400，不打库
  {
    await settle()
    fakePool.queries.length = 0
    const res = makeRes()
    await reviewController.addComment({ userId: 21, params: { id: '7' }, body: { content: '   ' } }, res)
    check(() => {
      assert.strictEqual(res.body.code, 400)
      assert.strictEqual(fakePool.queries.length, 0, '空内容不得打到数据库')
    }, '空评论拦截')
  }

  // 评论列表：分页单元是「顶层评价」，查询必须带 parent_id = 0，且回复一并下发
  {
    await settle()
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ total: 3 }]],                                    // 总条数（顶层 + 回复）
      [[{ total: 1 }]],                                    // 顶层条数（决定 hasMore）
      [[{ id: 51 }]],                                      // 本页顶层 id
      [[                                                   // 全量扁平列表（含回复）
        { id: 51, target_id: 7, parent_id: 0, user_id: 21, content: '顶层', images: null, anonymous_identity: null, like_count: 0, created_at: '2026-10-02 10:00:00', nick_name: '甲', avatar_url: '', cert_label: '', parent_nick_name: null },
        { id: 52, target_id: 7, parent_id: 51, user_id: 22, content: '回复1', images: null, anonymous_identity: null, like_count: 0, created_at: '2026-10-02 10:01:00', nick_name: '乙', avatar_url: '', cert_label: '', parent_nick_name: '甲' },
        { id: 53, target_id: 7, parent_id: 51, user_id: 23, content: '回复2', images: null, anonymous_identity: null, like_count: 0, created_at: '2026-10-02 10:02:00', nick_name: '丙', avatar_url: '', cert_label: '', parent_nick_name: '甲' }
      ]]
    ]
    const res = makeRes()
    await reviewController.comments({ params: { id: '7' }, query: {} }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      const rootQuery = fakePool.queries.find((q) => /LIMIT \? OFFSET \?/.test(q.sql))
      assert.ok(rootQuery, '必须有分页查询')
      assert.match(rootQuery.sql, /c\.parent_id = 0/, '分页单元必须是顶层评价（否则回复会把顶层挤到下一页变成孤儿）')
      assert.strictEqual(res.body.data.total, 3, 'total 口径 = 顶层 + 回复')
      assert.strictEqual(res.body.data.list.length, 3, '本页顶层 + 其全部回复都应下发')
      assert.strictEqual(res.body.data.list[0].id, 51, '顶层排在最前')
      assert.deepStrictEqual(res.body.data.list.slice(1).map((c) => c.parentId), [51, 51], '回复的 parentId 指向顶层')
      assert.strictEqual(res.body.data.list[1].parentNickName, '甲', '应带出父评价昵称供「回复 xxx」展示')
      assert.strictEqual(res.body.data.hasMore, false, '顶层已出完 → 无下一页')
    }, '评论列表按顶层评价分页')
  }
}

// =====================================================================
// 运行
// =====================================================================
async function main() {
  await listPageTests()
  listCardTextTests()
  parentEntryRemovedTests()
  await targetPageTests()
  await containerDetailTests()
  await replyPageTests()
  await replyToReplyPrefixTests()
  await replyFoldTests()
  await controllerTests()
  await reviewReplyControllerTests()
  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Review module tests failed:', err.message)
  process.exit(1)
})
