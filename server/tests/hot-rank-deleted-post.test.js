/**
 * 「已删除的帖子仍出现在每日热榜」回归测试（无需数据库 / 无需真机）
 *
 * 背景（2026-09-15 排查）：
 *   服务端 `GET /post/hot-rank` 一直带 `p.status = 1`，且生产实测（含 58 条 post.delete
 *   审计记录逐条比对）确认「已删除但 status 仍为 1」的帖子数为 **0** —— 服务端过滤是对的。
 *   真正的问题在**客户端展示逻辑**：
 *     1. `pages/hot-rank/index.js` 与 `pages/search/index.js` 只在 onLoad 拉热榜，
 *        onShow 不刷新。这两个页面会留在导航栈里（点进帖子详情再返回时 onLoad 不重跑），
 *        于是作者/管理员在别处删除的帖子会一直留在榜单上；
 *     2. 首页/详情页热榜请求**失败**时原样保留旧列表，其中可能含刚被删除的帖子；
 *     3. 删除成功到下一次拉取之间存在窗口期，页面持有的旧列表里仍有该帖。
 *
 * 覆盖：
 *   A. utils/hot-rank.js 真实模块：已删帖广播与过滤（含 TTL 过期、无标记时原样返回）
 *   B. buildHotPosts 内置过滤（首页/详情页/搜索页三处共用，天然一致）
 *   C. 热榜页 / 搜索页 onShow 重拉（行为断言：请求次数 +1）
 *   D. 详情页在「404」与「删除成功」两条路径上都广播
 *   E. 首页/详情页热榜请求失败时不再原样保留旧列表
 *   F. 服务端：hotRank 两条查询都必须带 status = 1（行为断言，捕获真实 SQL）
 *   G. 服务端：/api 响应必须带 no-store（杜绝中间层缓存旧热榜）
 */
const assert = require('assert')
const path = require('path')
const vm = require('vm')
const fs = require('fs')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')
const SERVER = path.join(__dirname, '..')

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
  fs.writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 10000)

function plain(v) { return JSON.parse(JSON.stringify(v)) }
function read(rel) { return fs.readFileSync(path.join(MINI_PROGRAM_ROOT, rel), 'utf8') }

// ===== 加载真实 utils/hot-rank.js =====
function loadHotRank() {
  const store = {}
  const sandbox = {
    wx: {
      getStorageSync: (k) => store[k],
      setStorageSync: (k, v) => { store[k] = v },
      removeStorageSync: (k) => { delete store[k] }
    },
    getApp: () => ({ globalData: { userInfo: { id: 7 } } }),
    require: (p) => {
      const norm = String(p).split('\\').join('/')
      if (/utils\/format$|^\.\/format$/.test(norm)) return { formatRelativeTime: () => '3 分钟前' }
      throw new Error('hot-rank.js 出现未预期依赖：' + p)
    },
    console,
    module: { exports: {} },
    exports: {}
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(read('utils/hot-rank.js'), sandbox, { filename: 'utils/hot-rank.js' })
  return { hotRank: sandbox.module.exports, store }
}

// ===== 加载页面（api / hot-rank 可控桩） =====
function loadPage(relPath, { hotRankStub, apiStub } = {}) {
  const calls = { getHotPostRank: 0, toast: [], navigateBack: 0 }
  let pageConfig = null
  const sandbox = {
    Page: (c) => { pageConfig = c },
    getApp: () => ({ globalData: { statusBarHeight: 20, userInfo: { id: 7 } } }),
    wx: {
      showToast: (o) => calls.toast.push(o && o.title),
      navigateBack: () => { calls.navigateBack++ },
      switchTab: () => {},
      stopPullDownRefresh: () => {},
      getStorageSync: () => ({}),
      setStorageSync: () => {},
      removeStorageSync: () => {},
      showModal: (o) => { o && o.success && o.success({ confirm: true }) }
    },
    require: (p) => {
      const norm = String(p).split('\\').join('/')
      if (/utils\/api$/.test(norm)) {
        return apiStub || {
          getHotPostRank: () => { calls.getHotPostRank++; return Promise.resolve({ list: [] }) }
        }
      }
      if (/utils\/hot-rank$/.test(norm)) {
        return hotRankStub || {
          isDailyHotVisible: () => true,
          buildHotPosts: (l) => (Array.isArray(l) ? l : []),
          groupHotPosts: (l) => [Array.isArray(l) ? l : []],
          filterRemovedPosts: (l) => (Array.isArray(l) ? l : []),
          markPostRemoved: () => {}
        }
      }
      if (/utils\/format$/.test(norm)) return { formatRelativeTime: () => '刚刚' }
      if (/utils\/refresh$/.test(norm)) return { runPullDownRefresh: () => Promise.resolve() }
      // 卡片动效开关与本页无关，桩里返回默认开启
      if (/utils\/motion$/.test(norm)) return {
        isCardFxPreferred: () => true, setCardFxPreferred: () => {}, isCardFxOff: () => false,
        isLowEndDevice: () => false, getBenchmarkLevel: () => -1
      }
      throw new Error('页面出现未预期依赖：' + p)
    },
    setTimeout: (fn) => { fn(); return 0 },
    clearTimeout: () => {},
    console,
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(read(relPath), sandbox, { filename: relPath })
  assert.ok(pageConfig, relPath + ' 未调用 Page()')
  const makeInstance = () => {
    const inst = Object.assign({}, pageConfig, { data: plain(pageConfig.data) })
    inst.setData = function (patch, cb) {
      Object.keys(patch).forEach((key) => {
        const keys = String(key).replace(/\[(\d+)\]/g, '.$1').split('.')
        let node = inst.data
        for (let i = 0; i < keys.length - 1; i++) {
          if (node[keys[i]] === undefined) node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}
          node = node[keys[i]]
        }
        node[keys[keys.length - 1]] = patch[key]
      })
      if (typeof cb === 'function') cb()
    }
    return inst
  }
  return { makeInstance, calls }
}

const POST = (id, viewCount) => ({
  id, viewCount, content: '内容 ' + id, title: '', createdAt: '2026-09-15 10:00:00'
})

async function run() {
  // ===== A. 真实 utils/hot-rank.js =====
  const { hotRank, store } = loadHotRank()

  check(() => {
    const list = [POST(1), POST(2), POST(3)]
    assert.deepStrictEqual(plain(hotRank.filterRemovedPosts(list)).map((p) => p.id), [1, 2, 3], '无标记时应原样返回')
    hotRank.markPostRemoved(2)
    assert.deepStrictEqual(plain(hotRank.filterRemovedPosts(list)).map((p) => p.id), [1, 3], '标记后必须剔除该帖')
  }, 'A1. markPostRemoved / filterRemovedPosts：标记后从列表剔除')

  check(() => {
    hotRank.markPostRemoved(0)
    hotRank.markPostRemoved(null)
    hotRank.markPostRemoved('abc')
    const map = store[hotRank.REMOVED_POSTS_KEY] || {}
    assert.strictEqual(Object.keys(map).length, 1, '非法 id 不得写入广播表')
  }, 'A2. 非法 id 不写入广播表')

  check(() => {
    // 把时间戳改到 TTL 之外，模拟过期
    const key = hotRank.REMOVED_POSTS_KEY
    store[key] = { 2: Date.now() - hotRank.REMOVED_POSTS_TTL_MS - 1000 }
    assert.deepStrictEqual(plain(hotRank.filterRemovedPosts([POST(1), POST(2)])).map((p) => p.id), [1, 2], 'TTL 过期后不再过滤')
  }, 'A3. 广播带 TTL：过期后不再过滤（避免长期误伤）')

  check(() => {
    hotRank.markPostRemoved(9)
    const built = hotRank.buildHotPosts([POST(1), POST(9)])
    assert.deepStrictEqual(plain(built).map((p) => p.id), [1], 'buildHotPosts 必须内置过滤（三处展示共用）')
    assert.ok(built[0].rankViewText.indexOf('浏览') > -1, '过滤后仍保留展示字段构建')
  }, 'A4. buildHotPosts 内置已删帖过滤（首页/详情页/搜索页共用）')

  // ===== C. 热榜页 / 搜索页 onShow 重拉 =====
  await checkAsync(async () => {
    const { makeInstance, calls } = loadPage('pages/hot-rank/index.js')
    const inst = makeInstance()
    inst.onLoad()
    assert.strictEqual(calls.getHotPostRank, 1, 'onLoad 拉一次')
    await inst.onShow()
    assert.strictEqual(calls.getHotPostRank, 2, 'onShow 必须再拉一次（否则删除的帖子会一直留在榜单上）')
    await inst.onShow()
    assert.strictEqual(calls.getHotPostRank, 3, '每次 onShow 都要重拉')
  }, 'C1. 热榜页 onShow 重拉热榜（不再只靠 onLoad）')

  await checkAsync(async () => {
    const { makeInstance, calls } = loadPage('pages/search/index.js')
    const inst = makeInstance()
    inst.onLoad()
    assert.strictEqual(calls.getHotPostRank, 1, 'onLoad 拉一次')
    await inst.onShow()
    assert.strictEqual(calls.getHotPostRank, 2, 'onShow 必须再拉一次')
  }, 'C2. 搜索页 onShow 重拉今日热榜')

  check(() => {
    const src = read('pages/hot-rank/index.js')
    assert.ok(src.indexOf('filterRemovedPosts') > -1, '热榜页必须在渲染前过滤本地已标记删除的帖子')
    const search = read('pages/search/index.js')
    assert.ok(/if \(this\._loadedOnce\) this\.loadTodayHot\(\)/.test(search), '搜索页 onShow 必须重拉')
  }, 'C3. 源码护栏：热榜页过滤 + 搜索页 onShow 重拉在位')

  // ===== D. 详情页广播 =====
  check(() => {
    const src = read('pages/post-detail/index.js')
    assert.ok(/handlePostMissing\(postId\)/.test(src), 'handlePostMissing 必须接收 postId')
    assert.ok(src.indexOf('hotRank.markPostRemoved(postId)') > -1, '404 路径必须广播已删帖')
    assert.ok(/await api\.deletePost\(post\.id\)[\s\S]{0,220}hotRank\.markPostRemoved\(post\.id\)/.test(src), '删除成功后必须广播已删帖')
    assert.ok(src.indexOf('this.handlePostMissing(id)') > -1, 'loadPost 必须把 id 传给 handlePostMissing')
  }, 'D. 详情页在 404 与删除成功两条路径都广播已删帖')

  // ===== E. 请求失败不再原样保留旧列表 =====
  check(() => {
    const index = read('pages/index/index.js')
    assert.ok(/catch\(\(\) => \{[\s\S]{0,400}filterRemovedPosts\(this\.data\.hotPosts\)/.test(index), '首页热榜拉取失败时必须剔除已删帖')
    const detail = read('pages/post-detail/index.js')
    assert.ok(/filterRemovedPosts\(this\.data\.hotPosts\)/.test(detail), '详情页热榜拉取失败时必须剔除已删帖')
  }, 'E. 热榜拉取失败时剔除已删帖，不再原样保留旧列表')

  // ===== F. 服务端 hotRank 必须带 status = 1（捕获真实 SQL） =====
  await checkAsync(async () => {
    const QUERIES = []
    const ROW = {
      id: 1, user_id: 1, title: '', content: '内容', category: '日常话题', status: 1,
      created_at: '2026-09-15 00:00:00', images: null, anonymous_identity: null, components: null,
      contact: null, like_count: 0, comment_count: 0, favorite_count: 0, follow_count: 0,
      share_count: 0, view_count: 1, nick_name: '昵称', avatar_url: '', campus: '', is_verified: 0,
      cert_label: '', allow_anonymous_pm: 1, post_count: 1, pinned: 0, review_note: ''
    }
    const fakePool = {
      async query(sql, params) {
        QUERIES.push({ sql: String(sql), params: params === undefined ? [] : params })
        return [[ROW]]
      }
    }
    const poolPath = require.resolve(path.join(SERVER, 'config', 'pool'))
    const notifPath = require.resolve(path.join(SERVER, 'services', 'notificationService'))
    const ctrlPath = require.resolve(path.join(SERVER, 'controllers', 'postController'))
    const prevPool = require.cache[poolPath]
    const prevNotif = require.cache[notifPath]
    const prevCtrl = require.cache[ctrlPath]
    require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool }
    require.cache[notifPath] = {
      id: notifPath, filename: notifPath, loaded: true,
      exports: { createNotification: () => Promise.resolve({}), withMediaPlaceholder: (c) => c }
    }
    delete require.cache[ctrlPath]
    try {
      const ctrl = require(ctrlPath)
      const res = { locals: {}, statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
      // limit 设大，强制走「时间窗口不足 → 用更早帖子补齐」的第二条查询，两条都要校验
      await ctrl.hotRank({ query: { period: 'today', limit: '50' }, userId: 0 }, res)
      assert.strictEqual(res.body && res.body.code, 200, 'hotRank 应返回 200')
      assert.ok(QUERIES.length >= 2, 'limit 大于窗口内条数时应触发补齐查询，实际 ' + QUERIES.length)
      QUERIES.forEach((q, i) => {
        if (!/FROM forum_post p/.test(q.sql)) return
        assert.ok(/p\.status = 1/.test(q.sql), '第 ' + (i + 1) + ' 条热榜查询必须带 p.status = 1，否则已删除帖子会进入榜单')
      })
    } finally {
      if (prevPool) require.cache[poolPath] = prevPool; else delete require.cache[poolPath]
      if (prevNotif) require.cache[notifPath] = prevNotif; else delete require.cache[notifPath]
      if (prevCtrl) require.cache[ctrlPath] = prevCtrl; else delete require.cache[ctrlPath]
    }
  }, 'F. 服务端 hotRank 两条查询都带 p.status = 1（已删除帖子不进榜）')

  // ===== G. /api 禁缓存 =====
  check(() => {
    const app = read('server/app.js')
    assert.ok(/app\.use\("\/api",[\s\S]{0,300}Cache-Control[\s\S]{0,60}no-store/.test(app), '/api 响应必须设置 Cache-Control: no-store')
  }, 'G. /api 响应带 no-store，杜绝中间层缓存旧热榜')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
