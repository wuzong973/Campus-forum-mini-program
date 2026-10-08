/**
 * 用户端「社团&组织」社团列表下发测试（无需数据库）
 *
 * 覆盖链路：公开接口 GET /club/categories（clubController.listCategories）
 *   → utils/club-data.js mapServerCategory（页面渲染结构）
 * 断言分类下必须带出启用中的社团，即后台审核通过的社团可见。
 *
 * 背景：此前的缺陷是 clubController.mapCategoryRow(row, clubs) 声明了 clubs 形参
 * 却从未写进返回值，公开接口因此永远不下发社团列表；用户端 mapServerCategory 把
 * 缺失的 clubs 兜底成 []，导致每张分类卡片都显示「0 个重点社团」——管理端因为
 * 手写 `clubs: grouped[row.id] || []` 而正常，所以只有用户端看不见。
 * 详见 docs/03_业务功能_社区与内容.md（§2 社团模块）
 */
const assert = require('assert')
const path = require('path')

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

// ===== 桩：数据库 =====
// 分类与社团都按真实的 WHERE 语义过滤，保证断言验的是「接口是否下发」而不是桩的行为
const CATEGORIES = [
  { id: 1, slug: 'art', name: '艺术类', icon_char: '艺', slogan: '捕捉灵感', color: '#8B5CF6', scope: '[]', features: '[]', scope_intro: '', position: '', contact: '', sort_order: 1, status: 1, deleted: 0 },
  { id: 2, slug: 'sport', name: '体育类', icon_char: '体', slogan: '挥洒汗水', color: '#16B364', scope: '[]', features: '[]', scope_intro: '', position: '', contact: '', sort_order: 2, status: 1, deleted: 0 },
  { id: 3, slug: 'tech', name: '科技类', icon_char: '科', slogan: '探索前沿', color: '#2E6BFF', scope: '[]', features: '[]', scope_intro: '', position: '', contact: '', sort_order: 3, status: 1, deleted: 0 }
]

const CLUBS = [
  // 后台审核通过后落库的社团（campus = '' 表示全部校区可见）
  { id: 11, category_id: 1, name: '武术社', tags: '武术', intro: '晨练传统', recruit: '', campus: '', sort_order: 0, status: 1, deleted: 0 },
  // 佛山校区审核通过的社团
  { id: 12, category_id: 1, name: '你好', tags: '', intro: '佛山校区社团', recruit: '', campus: '佛山校区', sort_order: 0, status: 1, deleted: 0 },
  // 已下架 / 已删除的朝下不应出现在公开接口
  { id: 13, category_id: 1, name: '已下架社', tags: '', intro: '', recruit: '', campus: '', sort_order: 0, status: 0, deleted: 0 },
  { id: 14, category_id: 1, name: '已删除社', tags: '', intro: '', recruit: '', campus: '', sort_order: 0, status: 1, deleted: 1 },
  // 其他校区的社团：广州校区
  { id: 15, category_id: 2, name: '篮球社', tags: '篮球', intro: '半场训练', recruit: '', campus: '广州校区', sort_order: 0, status: 1, deleted: 0 }
]

const fakePool = {
  queries: [],
  async query(sql, params) {
    fakePool.queries.push({ sql, params: params || [] })
    if (/FROM club_category/.test(sql)) {
      // 公开接口带 `AND status = 1`（只看启用分类），管理端接口不带
      const enabledOnly = /status = 1/.test(sql)
      return [CATEGORIES.filter((row) => row.deleted === 0 && (!enabledOnly || row.status === 1))]
    }
    if (/FROM club\s/.test(sql)) return [filterClubs(sql, params || [])]
    return [[]]
  }
}

// 按 SQL 里的两个可选条件（status = 1 / campus IN (...) OR campus = ''）过滤
function filterClubs(sql, params) {
  const onlyEnabled = /AND status = 1/.test(sql)
  const campusExpr = sql.match(/campus IN \(([^)]*)\)/)
  const campusCount = campusExpr ? (campusExpr[1].match(/\?/g) || []).length : 0
  const categoryIds = params.slice(0, params.length - campusCount)
  const campusValues = campusCount ? params.slice(params.length - campusCount) : []
  return CLUBS.filter((row) => {
    if (row.deleted !== 0) return false
    if (categoryIds.indexOf(row.category_id) < 0) return false
    if (onlyEnabled && row.status !== 1) return false
    if (campusExpr && campusValues.indexOf(row.campus) < 0 && row.campus !== '') return false
    return true
  })
}

// 用假 pool 顶掉真实连接池后再加载控制器（middleware/auth、adminAudit 也会拿到这个假 pool）
const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
const clubController = require('../controllers/clubController')
const { mapServerCategory } = require('../../pkg-feature/utils/club-data')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

async function listCategories(campus) {
  const res = makeRes()
  await clubController.listCategories({ query: campus === undefined ? {} : { campus } }, res)
  return res
}

async function main() {
  // 1) 全部校区：每个分类都必须带 clubs 数组，且审核通过的社团在内（回归：此前完全没有 clubs 字段）
  {
    const res = await listCategories('')
    check(() => {
      assert.strictEqual(res.body.code, 200, '接口应返回成功')
      const list = res.body.data.list
      assert.strictEqual(list.length, 3, '应返回 3 个启用分类')
      assert.ok(list.every((row) => Array.isArray(row.clubs)), '每个分类都应带 clubs 数组')
    }, '响应结构')

    check(() => {
      const art = res.body.data.list.find((row) => row.slug === 'art')
      assert.deepStrictEqual(art.clubs.map((c) => c.name), ['武术社', '你好'],
        '艺术类应带出后台审核通过的两个社团')
    }, '审核通过的社团应下发')

    check(() => {
      const sport = res.body.data.list.find((row) => row.slug === 'sport')
      assert.deepStrictEqual(sport.clubs.map((c) => c.name), ['篮球社'], '体育类应带出广州校区社团（全部校区视角）')
      const tech = res.body.data.list.find((row) => row.slug === 'tech')
      assert.deepStrictEqual(tech.clubs, [], '没有社团的分类应为空数组而非缺字段')
    }, '空分类兜底')

    check(() => {
      const names = res.body.data.list.reduce((arr, row) => arr.concat(row.clubs.map((c) => c.name)), [])
      assert.strictEqual(names.indexOf('已下架社'), -1, '已下架社团不应下发')
      assert.strictEqual(names.indexOf('已删除社'), -1, '已删除社团不应下发')
    }, '停用/已删除社团过滤')

    check(() => {
      const art = res.body.data.list.find((row) => row.slug === 'art')
      // 断言「必需字段齐备」而不是「字段全等」：社团详情页后续又用到了
      // clubType / qrcodeUrl / adminQrcodeUrl / gzhQrcodeUrl / images，
      // 全等断言会把这类正常新增误判成回归（曾长期假红）。
      const keys = Object.keys(art.clubs[0])
      const required = ['avatarUrl', 'campus', 'id', 'intro', 'name', 'recruit', 'sortOrder', 'status', 'tags']
      assert.deepStrictEqual(
        required.filter((k) => keys.indexOf(k) === -1),
        [],
        '分类页渲染所需字段不得缺失，实际字段：' + keys.slice().sort().join(', ')
      )
      assert.strictEqual(art.clubs[0].avatarUrl, '', '无头像社团应回退为空串，由前端展示文字徽标兜底')
    }, '社团字段完整性')
  }

  // 2) 用户端映射：服务端响应经 mapServerCategory 后，卡片计数应大于 0
  {
    const res = await listCategories('')
    const pageCategories = res.body.data.list.map(mapServerCategory)
    check(() => {
      const art = pageCategories.find((item) => item.id === 'art')
      assert.strictEqual(art.clubs.length, 2, '用户端艺术类应展示 2 个社团（截图中的「0 个重点社团」即为本 bug）')
      assert.strictEqual(art.clubs[0].name, '武术社')
      assert.strictEqual(art.clubs[0].tags, '武术')
      assert.ok(art.theme && art.theme.deep === '#8B5CF6', '主题色应正确推导')
    }, '用户端卡片数据')

    check(() => {
      const art = pageCategories.find((item) => item.id === 'art')
      // 回归：mapServerCategory 曾把 id 丢在映射层外，分类页点社团永远提示「社团详情暂不可用」
      assert.strictEqual(art.clubs[0].id, 11, '社团唯一标识 id 必须透传，跳详情页靠它匹配')
      assert.strictEqual(art.clubs[1].id, 12, '第二个社团的 id 也应透传')
      assert.strictEqual(art.clubs[1].campus, '佛山校区', '校区应透传')
      assert.strictEqual(art.clubs[0].campus, '', '空校区应保留为空串（全部校区）')
    }, '社团 id 透传')
  }

  // 3) 佛山校区：'' 全部校区社团 + 佛山校区社团都应可见，广州校区社团应被过滤
  {
    const res = await listCategories('佛山校区')
    check(() => {
      const art = res.body.data.list.find((row) => row.slug === 'art')
      assert.deepStrictEqual(art.clubs.map((c) => c.name), ['武术社', '你好'],
        '佛山校区应看到「全部校区」+「佛山校区」的社团')
      const sport = res.body.data.list.find((row) => row.slug === 'sport')
      assert.deepStrictEqual(sport.clubs, [], '佛山校区不应看到广州校区专属社团')
    }, '校区筛选')

    check(() => {
      const clubQuery = fakePool.queries.filter((q) => /FROM club\s/.test(q.sql)).pop()
      assert.ok(/campus IN \(/.test(clubQuery.sql), '已知校区应带上校区过滤条件')
      assert.deepStrictEqual(clubQuery.params.slice(-3), ['佛山校区', '南海南校区', '南海北校区'],
        '主校区应匹配自身及其分校区')
    }, '主校区匹配分校区')
  }

  // 4) 全部校区（campus = ''）：不应带校区过滤条件
  {
    fakePool.queries.length = 0
    await listCategories('')
    check(() => {
      const clubQuery = fakePool.queries.filter((q) => /FROM club\s/.test(q.sql)).pop()
      assert.ok(!/campus IN \(/.test(clubQuery.sql), '全部校区不应过滤校区')
    }, '全部校区不过滤')
  }

  // 5) 未知校区取值：按「不过滤」处理，避免查不到任何社团
  {
    const res = await listCategories('火星校区')
    check(() => {
      const art = res.body.data.list.find((row) => row.slug === 'art')
      assert.deepStrictEqual(art.clubs.map((c) => c.name), ['武术社', '你好'], '未知校区应回退为不过滤')
    }, '未知校区兜底')
  }

  // 6) 分类未启用（status = 0 / deleted = 1）时不出现在公开接口
  {
    CATEGORIES[2].status = 0
    const res = await listCategories('')
    const slugs = res.body.data.list.map((row) => row.slug)
    check(() => {
      assert.strictEqual(slugs.length, 2, '停用分类不应下发')
      assert.strictEqual(slugs.indexOf('tech'), -1, '停用分类不应下发')
    }, '停用分类过滤')
    CATEGORIES[2].status = 1
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Club categories tests failed:', err.message)
  process.exit(1)
})
