/**
 * 校园地图「360VR 全景」按钮测试（无需数据库 / 无需真机）
 *
 * 背景：720yun 是第三方网页，直链 web-view 会被微信拦截（业务域名无法配置到第三方站点）。
 * 方案：自建 H5 中转页 https://payun01.cn/embed.html（业务域名已配），页面内 iframe 嵌 720yun
 * 全景（业务域名只校验 web-view 初始 src，页面内部 iframe 不受白名单限制，订水页同模式）。
 *
 * 覆盖：
 *   A. 佛山校区点击 → navigateTo webview 打开 embed.html 且带编码后的 720yun src
 *   B. 非佛山校区点击 → 仅提示，不跳转
 *   C. 中转页 + wxml 接线护栏（embed.html 存在、720yun 白名单校验、部署清单含 embed.html）
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

function loadCampusMap(state) {
  const source = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.js'), 'utf8')
  let pageConfig = null
  const sandbox = {
    Page: (config) => { pageConfig = config },
    wx: {
      getStorageSync: (key) => state.storage[key],
      setStorageSync: (key, value) => { state.storage[key] = value },
      setClipboardData: (opt) => { state.clipCalls.push(opt.data); if (opt.success) opt.success() },
      showToast: (opt) => { state.toasts.push(opt.title) },
      showModal: (opt) => { state.modals.push(opt) },
      navigateTo: (opt) => { state.navCalls.push(opt.url) },
      openLocation: () => {},
      createMapContext: () => ({ moveToLocation: () => {} })
    },
    getApp: () => ({ globalData: { statusBarHeight: 20, campus: 'foshan' } }),
    require: (modulePath) => {
      const norm = String(modulePath).split('\\').join('/')
      if (/(^|\/)refresh$/.test(norm)) return { runPullDownRefresh: () => Promise.resolve() }
      throw new Error('测试桩未覆盖的模块：' + modulePath)
    },
    console,
    Promise,
    setTimeout: (f) => f(),
    module: { exports: {} },
    exports: {}
  }
  vm.runInNewContext(source, sandbox, { filename: 'pages/campus-map/index.js' })
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
  const state = { storage: {}, clipCalls: [], toasts: [], modals: [], navCalls: [] }
  const { makeInstance } = loadCampusMap(state)

  // A. 佛山校区点击 → 经自建 H5 中转页打开（embed.html 内嵌 720yun）
  check(() => {
    state.clipCalls.length = 0; state.navCalls.length = 0; state.modals.length = 0
    const inst = makeInstance()
    inst.setData({ campusKey: 'foshan' })
    inst.openPanorama()
    assert.strictEqual(state.navCalls.length, 1, '应 navigateTo webview 中转页')
    // src 在 h5 内编码一次、整体又编码一次 → 解两层后应出现完整全景链接
    const url = decodeURIComponent(decodeURIComponent(state.navCalls[0]))
    assert.ok(url.indexOf('/pages/webview/index') > -1, '走 webview 中转页')
    assert.ok(url.indexOf('payun01.cn/embed.html') > -1, 'H5 中转页为自建域名的 embed.html')
    assert.ok(url.indexOf('720yun.com') > -1 && url.indexOf('scene_id=982404') > -1, 'src 参数携带完整全景链接')
    assert.strictEqual(state.clipCalls.length, 0, '正常路径无需复制链接')
  }, 'A. 佛山校区点击经自建 H5 中转页（embed.html）内嵌全景')

  // B. 非佛山校区点击 → 仅提示
  check(() => {
    state.clipCalls.length = 0; state.navCalls.length = 0; state.toasts.length = 0
    const inst = makeInstance()
    inst.setData({ campusKey: 'guangzhou' })
    inst.openPanorama()
    assert.strictEqual(state.navCalls.length, 0, '非佛山校区不跳转')
    assert.strictEqual(state.toasts.length, 1, '提示仅佛山校区提供')
  }, 'B. 非佛山校区点击仅提示不跳转')

  // C. 中转页与部署接线护栏
  check(() => {
    const vr = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'web-static', 'embed.html'), 'utf8')
    assert.ok(vr.indexOf("'https://www.720yun.com/'") > -1, 'embed.html 白名单含 720yun')
    assert.ok(vr.indexOf('ALLOWED_PREFIXES.some') > -1, 'embed.html 前缀校验防跳板')
    assert.ok(vr.indexOf('<iframe') > -1, 'embed.html 以 iframe 内嵌全景')
    assert.ok(vr.indexOf('copyBtn') > -1, 'embed.html 有复制链接兜底')
    const deploy = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'deploy.py'), 'utf8')
    assert.ok(deploy.indexOf('("web-static/embed.html", "embed.html")') > -1, 'deploy.py 静态清单必须含 embed.html')
    const wxml = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('bindtap="openPanorama"') > -1, '「VR 全景」按钮必须绑定 openPanorama')
  }, 'C. 中转页白名单/部署清单/按钮接线护栏')

  // D. 地图显示对齐参照标准（图一：纯原生 POI 渲染，无自定义猜测坐标）
  check(() => {
    const wxml = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.wxml'), 'utf8')
    assert.ok(wxml.indexOf('enable-poi') > -1, '必须开启原生 POI（校门/建筑/道路/水体标注来自腾讯地图数据）')
    assert.ok(wxml.indexOf('enable-building') > -1, '开启楼块渲染')
    const js = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.js'), 'utf8')
    assert.ok(js.indexOf("iconPath: '/assets/icons/svc-map.png'") > -1, '校门使用自定义标注显示')
    assert.ok(js.indexOf("name: '1号门'") > -1 && js.indexOf("name: '4号门'") > -1, '四个校门口必须上图')
    assert.ok(!/places: \[/.test(js), '未经实测校准的 places 点位数据已移除')
    assert.ok(!/places: \[/.test(js), '未经实测校准的 places 点位数据已移除')
    assert.ok(js.indexOf('function buildCampusOverlays') > -1 && js.indexOf('points: campus.polygon') > -1, '校区围栏用 polyline 渲染')
    assert.ok(js.indexOf('dottedLine: true') > -1, '校区围栏为蓝色虚线')
    assert.ok(js.indexOf('polygons: []') > -1, '不再用 polygon 实线/蓝底遮挡原生地图')
    // 围栏改为「腾讯地图 AOI 轮廓」标定结果：北抵钟边水库南岸、东含宿舍突出块、
    // 西界不再罩住校外力合科技园（旧围栏 113.0268 已移除）
    assert.ok(js.indexOf('113.0268') === -1, '旧围栏西界（罩住校外力合科技园）已移除')
    const polyBlock = js.slice(js.indexOf('polygon: ['), js.indexOf('],', js.indexOf('polygon: [')))
    const lats = [...polyBlock.matchAll(/latitude: ([\d.]+)/g)].map((m) => Number(m[1]))
    const lngs = [...polyBlock.matchAll(/longitude: ([\d.]+)/g)].map((m) => Number(m[1]))
    assert.ok(Math.max(...lats) >= 23.165, '围栏北端应抵钟边水库南岸（≥23.1650）')
    assert.ok(Math.min(...lats) <= 23.1538, '围栏南端应覆盖 2 号门以南（≤23.1538）')
    assert.ok(Math.min(...lngs) >= 113.0295, '围栏西界不应越过 4 号门以西（≥113.0295）')
    assert.ok(Math.max(...lngs) >= 113.0403, '围栏东界应含东北宿舍突出块（≥113.0403）')
    const polyStart = js.indexOf('polygon: [')
    const polyEnd = js.indexOf('],', polyStart)
    const foshanBlock = polyStart > -1 && polyEnd > polyStart ? js.slice(polyStart + 10, polyEnd) : null
    assert.ok(foshanBlock && (foshanBlock.match(/latitude: /g) || []).length >= 9, '佛山围栏为 9+ 顶点贴合轮廓')
    assert.ok(js.indexOf('selectedPlace: { name: campus.fullName') > -1, '底部卡片为校区概览（名称/地址/路线）')
    assert.ok(js.indexOf('wx.openLocation') > -1, '路线按钮导航到校区位置')
    assert.ok(js.indexOf('新港校区正门') === -1 && js.indexOf('南海校区北区 1 号门') === -1, '不准坐标点位不再上图')
  }, 'D. 纯原生 POI 渲染：无自定义猜测坐标，底部卡为校区概览+路线')

  // E. 佛山围栏几何验证：四个校门 + 学校主体（腾讯官方坐标）必须全部落在围栏内
  check(() => {
    const js = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.js'), 'utf8')
    const polyStart = js.indexOf('polygon: [')
    const polyEnd = js.indexOf('],', polyStart)
    const block = polyStart > -1 && polyEnd > polyStart ? js.slice(polyStart + 10, polyEnd) : null
    assert.ok(block, 'foshan polygon 区块定位失败')
    const poly = [...block.matchAll(/latitude: ([\d.]+), longitude: ([\d.]+)/g)]
      .map((m) => ({ latitude: Number(m[1]), longitude: Number(m[2]) }))
    assert.ok(poly.length >= 9, '围栏至少 9 个顶点')
    const pointInPoly = (pt) => {
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].longitude, yi = poly[i].latitude
        const xj = poly[j].longitude, yj = poly[j].latitude
        const intersect = ((yi > pt.latitude) !== (yj > pt.latitude)) &&
          (pt.longitude < ((xj - xi) * (pt.latitude - yi)) / (yj - yi) + xi)
        if (intersect) inside = !inside
      }
      return inside
    }
    // 腾讯地图官方 POI 坐标（WebSearch 权威数据）
    const gates = {
      '1号门': { latitude: 23.15728, longitude: 113.031209 },
      '2号门': { latitude: 23.155882, longitude: 113.032223 },
      '3号门': { latitude: 23.15768, longitude: 113.03638 },
      '4号门': { latitude: 23.160352, longitude: 113.029824 },
      '学校主体': { latitude: 23.158393, longitude: 113.034639 }
    }
    // 校门在 AOI 轮廓上（可能正好落在边上），故允许「界内或距边界 ≤30m」
    const distToBoundary = (pt) => {
      const R = 6371000, rad = (d) => (d * Math.PI) / 180
      const kx = R * Math.cos(rad(pt.latitude)) * Math.PI / 180, ky = R * Math.PI / 180
      let best = Infinity
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length]
        const ax = a.longitude * kx, ay = a.latitude * ky
        const bx = b.longitude * kx, by = b.latitude * ky
        const px = pt.longitude * kx, py = pt.latitude * ky
        const dx = bx - ax, dy = by - ay
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1)))
        best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)))
      }
      return best
    }
    Object.keys(gates).forEach((name) => {
      const g = gates[name]
      const onEdge = distToBoundary(g) <= 30
      assert.ok(pointInPoly(g) || onEdge,
        '围栏必须覆盖 ' + name + ' (' + g.latitude + ',' + g.longitude + ')，实际距边界 ' + distToBoundary(g).toFixed(1) + 'm')
    })
    // 中心点（地图打开落点，从源码读取）也应在围栏内
    const centerMatch = js.match(/latitude: ([\d.]+),\s+longitude: ([\d.]+),\s+scale:/)
    assert.ok(centerMatch, '未能从源码读取地图中心点')
    const center = { latitude: Number(centerMatch[1]), longitude: Number(centerMatch[2]) }
    assert.ok(pointInPoly(center) || distToBoundary(center) <= 50, '地图中心点应在围栏内')
  }, 'E. 佛山围栏几何验证：四个校门与学校主体（官方坐标）全部落在围栏内')

  // F. 佛山围栏几何护栏：顶点数、无自交、面积合理（与腾讯 AOI 轮廓一致）
  check(() => {
    const js = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.js'), 'utf8')
    const polyStart = js.indexOf('polygon: [')
    const block = js.slice(polyStart + 10, js.indexOf('],', polyStart))
    const poly = [...block.matchAll(/latitude: ([\d.]+), longitude: ([\d.]+)/g)]
      .map((m) => ({ latitude: Number(m[1]), longitude: Number(m[2]) }))
    assert.ok(poly.length >= 40, '围栏应贴合真实轮廓（≥40 顶点），实际 ' + poly.length)

    const cross = (o, p, q) => (p.longitude - o.longitude) * (q.latitude - o.latitude) - (p.latitude - o.latitude) * (q.longitude - o.longitude)
    let crossings = 0
    for (let i = 0; i < poly.length; i++) {
      for (let j = i + 2; j < poly.length; j++) {
        if (i === 0 && j === poly.length - 1) continue
        const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[j], d = poly[(j + 1) % poly.length]
        const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) crossings++
      }
    }
    assert.strictEqual(crossings, 0, '围栏不应自交，实际 ' + crossings + ' 处')

    const R = 6371000, rad = (d) => (d * Math.PI) / 180
    const lat0 = poly.reduce((s, p) => s + p.latitude, 0) / poly.length
    const kx = R * Math.cos(rad(lat0)) * Math.PI / 180, ky = R * Math.PI / 180
    let area = 0
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      area += (p.longitude * kx) * (q.latitude * ky) - (q.longitude * kx) * (p.latitude * ky)
    }
    area = Math.abs(area / 2)
    assert.ok(area > 500000 && area < 800000, '围栏面积应在 50~80 万㎡（实测 ' + (area / 10000).toFixed(1) + ' 万㎡）')
  }, 'F. 佛山围栏几何护栏：≥40 顶点 / 无自交 / 面积 50~80 万㎡')

  // G. 广州新港校区围栏几何护栏（与佛山同一套处理：AOI 实描 + 几何校验）
  check(() => {
    const js = require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages', 'campus-map', 'index.js'), 'utf8')
    const gzStart = js.indexOf('guangzhou: {')
    assert.ok(gzStart > -1, '未找到广州校区配置块')
    const polyStart = js.indexOf('polygon: [', gzStart)
    const block = js.slice(polyStart + 10, js.indexOf('],', polyStart))
    const poly = [...block.matchAll(/latitude: ([\d.]+), longitude: ([\d.]+)/g)]
      .map((m) => ({ latitude: Number(m[1]), longitude: Number(m[2]) }))
    assert.ok(poly.length >= 8, '广州围栏应贴合 AOI 轮廓（≥8 顶点），实际 ' + poly.length)

    const cross = (o, p, q) => (p.longitude - o.longitude) * (q.latitude - o.latitude) - (p.latitude - o.latitude) * (q.longitude - o.longitude)
    let crossings = 0
    for (let i = 0; i < poly.length; i++) {
      for (let j = i + 2; j < poly.length; j++) {
        if (i === 0 && j === poly.length - 1) continue
        const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[j], d = poly[(j + 1) % poly.length]
        const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) crossings++
      }
    }
    assert.strictEqual(crossings, 0, '广州围栏不应自交，实际 ' + crossings + ' 处')

    const R = 6371000, rad = (d) => (d * Math.PI) / 180
    const lat0 = poly.reduce((s, p) => s + p.latitude, 0) / poly.length
    const kx = R * Math.cos(rad(lat0)) * Math.PI / 180, ky = R * Math.PI / 180
    let area = 0
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      area += (p.longitude * kx) * (q.latitude * ky) - (q.longitude * kx) * (p.latitude * ky)
    }
    area = Math.abs(area / 2)
    assert.ok(area > 300000 && area < 600000, '广州围栏面积应在 30~60 万㎡（实测 ' + (area / 10000).toFixed(1) + ' 万㎡）')

    // 长宽比须符合墨卡托（东西/南北 ≈ cos(lat) 量级），旧围栏曾相差约 15%
    const dLat = Math.max(...poly.map((p) => p.latitude)) - Math.min(...poly.map((p) => p.latitude))
    const dLng = Math.max(...poly.map((p) => p.longitude)) - Math.min(...poly.map((p) => p.longitude))
    const ratio = (dLng * Math.cos(rad(lat0))) / dLat
    assert.ok(ratio > 0.85 && ratio < 1.15, '广州围栏长宽比应接近 1（墨卡托校正），实际 ' + ratio.toFixed(3))

    // 声明中心必须落在围栏内
    const center = { latitude: 23.091902, longitude: 113.307005 }
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j]
      if (((a.latitude > center.latitude) !== (b.latitude > center.latitude)) &&
          (center.longitude < ((b.longitude - a.longitude) * (center.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude)) inside = !inside
    }
    assert.ok(inside, '广州校区声明中心应落在围栏内')
  }, 'G. 广州围栏几何护栏：≥8 顶点 / 无自交 / 面积 30~60 万㎡ / 长宽比合规 / 中心在界内')
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
