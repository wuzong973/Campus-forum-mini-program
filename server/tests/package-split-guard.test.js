// 分包与体积护栏：锁住「分包归属 + 主包无孤立 JS」这些**结构性**约束，
// 以及体积的**防增长**阈值。
//
// 背景（2026-10-07）：
//   1) 主包内不应存在主包未使用的 JS（utils/driving-school.js、group-chat.js、review.js）
//      → 已迁入对应分包，本测试锁住不再回流
//   2) 「账号与设置」4 页迁入 pkg-user，避免主包继续膨胀
//   3) 体积：开发者工具的建议值是「主包 1.5 M / 图片音频 200 K」，
//      但 2026-10-07 产品决策为**画质优先**——图标/头像/校历都保留原始分辨率，
//      因此这两条建议值不再作为断言，改为守平台硬上限（主包 2 M）与防增长阈值。
//      若日后要把建议值重新点亮，正确做法是把资源迁 CDN 或继续拆分包，而不是降采样。
//
// 这些约束的特点：**破了不报错，只在开发者工具里变红 / 真机上才看得出**，
// 所以用测试固化。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))

const app = JSON.parse(read('app.json'))
const project = JSON.parse(read('project.config.json'))
const SUBPKG = app.subPackages.map((s) => s.root)

const MAIN_LIMIT = 2 * 1024 * 1024
const MEDIA_LIMIT = 700 * 1024
const MEDIA_RE = /\.(png|jpe?g|gif|webp|bmp|svg|mp3|m4a|aac|wav|ogg)$/i

// packOptions.ignore：主包体积必须按「真实打包结果」算，否则 docs/、server/ 会把数字撑爆
const ig = (project.packOptions && project.packOptions.ignore) || []
const IG_FOLDERS = ig.filter((i) => i.type === 'folder').map((i) => i.value)
const IG_FILES = ig.filter((i) => i.type === 'file').map((i) => i.value)
const HARD_SKIP = ['node_modules', '.git']

const inSubPkg = (rel) => SUBPKG.some((s) => rel.indexOf(s + '/') === 0)

const allFiles = []
;(function walk(dir) {
  const relDir = path.relative(root, dir).split(path.sep).join('/')
  const top = relDir.split('/')[0]
  if (relDir && (HARD_SKIP.indexOf(top) >= 0 || IG_FOLDERS.indexOf(top) >= 0)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const rel = path.relative(root, abs).split(path.sep).join('/')
    if (e.isDirectory()) { walk(abs); continue }
    if (IG_FILES.indexOf(rel) >= 0) continue
    allFiles.push({ rel, size: fs.statSync(abs).size })
  }
})(root)

function volume(rel) {
  const files = allFiles.filter((f) => (rel ? f.rel.indexOf(rel + '/') === 0 : !inSubPkg(f.rel)))
  return {
    n: files.length,
    size: files.reduce((s, f) => s + f.size, 0),
    media: files.filter((f) => MEDIA_RE.test(f.rel)).reduce((s, f) => s + f.size, 0)
  }
}

// ===== 1. 主包大小 =====

const main = volume('')
// 2026-10-07 产品决策：图标/头像画质优先，不再为压体积而降采样资源。
// 因此这里守的是「平台硬上限 + 防增长」，而不是开发者工具那条 1.5 M 建议值：
// 小程序主包硬上限 2 M，留 200 KB 余量给后续功能。
assert.ok(main.size <= MAIN_LIMIT,
  '主包 ' + (main.size / 1024).toFixed(0) + ' KB 超过 2 M 平台硬上限 ' + (MAIN_LIMIT / 1024).toFixed(0) +
  ' KB（超 ' + ((main.size - MAIN_LIMIT) / 1024).toFixed(0) + ' KB）')

assert.ok(main.size <= MAIN_LIMIT - 200 * 1024,
  '主包余量不足 200 KB（当前 ' + ((MAIN_LIMIT - main.size) / 1024).toFixed(0) + ' KB），接近平台硬上限需先拆分包')

// ===== 2. 图片 / 音频总量（整个代码包）=====

// 开发者工具的 200 KB 建议值在「保留原始画质」的前提下无法满足（96 个默认头像 + 75 个图标
// + 校历原图）。这里退一步守「不失控增长」：超出即说明又塞进了大批未优化资源。
const mediaTotal = allFiles.filter((f) => MEDIA_RE.test(f.rel)).reduce((s, f) => s + f.size, 0)
assert.ok(mediaTotal <= MEDIA_LIMIT,
  '图片/音频合计 ' + (mediaTotal / 1024).toFixed(1) + ' KB 超过 ' + (MEDIA_LIMIT / 1024).toFixed(0) +
  ' KB 防增长阈值（超 ' + ((mediaTotal - MEDIA_LIMIT) / 1024).toFixed(1) + ' KB）')

// 大图护栏：单张过大既拖慢首屏也不适合放进包内，应改走 CDN
const fat = allFiles.filter((f) => MEDIA_RE.test(f.rel) && f.size > 200 * 1024)
assert.deepStrictEqual(fat.map((f) => f.rel + ' (' + (f.size / 1024).toFixed(0) + 'KB)'), [],
  '存在单张超过 200 KB 的资源，应上传 CDN 而不是打进包内')

// ===== 3. 主包内不得有「只被分包引用」的 JS =====

const sourceFiles = allFiles.filter((f) => /\.(js|wxml|wxss|json|wxs)$/.test(f.rel) && f.rel !== 'project.config.json')
const mainSource = sourceFiles.filter((f) => !inSubPkg(f.rel))
const textOf = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// 只检查 utils/ 下的工具模块：页面入口（pages/*/index.js）与自定义组件天然
// 分别由 app.json、usingComponents 引用，不是 require 关系，不该被这条规则误伤
const mainUtils = mainSource.filter((f) => /^utils\/[^/]+\.js$/.test(f.rel))
const orphans = mainUtils.filter((u) => {
  const base = u.rel.replace(/\.js$/, '').split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp("require\\((['\"])[^'\"]*" + base + "\\1\\)")
  return !mainSource.some((f) => f.rel !== u.rel && re.test(textOf(f.rel)))
})
assert.deepStrictEqual(orphans.map((o) => o.rel), [],
  '主包内存在只被分包使用的 JS，应移到对应分包（当前：' + orphans.map((o) => o.rel).join(', ') + '）')

// ===== 4. 已迁出的 4 个模块必须在分包内且依赖可解析 =====

;['group-chat', 'review', 'club-data', 'driving-school'].forEach((n) => {
  assert.ok(!exists('utils/' + n + '.js'), 'utils/' + n + '.js 应已迁出主包')
  assert.ok(exists('pkg-feature/utils/' + n + '.js'), 'pkg-feature/utils/' + n + '.js 缺失')
})

// 分包内不能再用 `./xxx` 指回主包 utils —— 迁移时最容易漏的一类断链
;['group-chat', 'review', 'club-data', 'driving-school'].forEach((n) => {
  const rel = 'pkg-feature/utils/' + n + '.js'
  const dir = path.dirname(path.join(root, rel))
  const src = read(rel)
  const requires = src.match(/require\((['"])(\.[^'"]+)\1\)/g) || []
  requires.forEach((m) => {
    const target = m.match(/require\((['"])(\.[^'"]+)\1\)/)[2]
    const ok = fs.existsSync(path.join(dir, target)) || fs.existsSync(path.join(dir, target + '.js'))
    assert.ok(ok, rel + ' 内 ' + target + ' 解析不到（迁移后相对层级需要 +1）')
  })
})

// driving-school 被 pkg-admin 与 pkg-feature 同时使用，跨分包不能互相 require → 各存一份。
// 两份必须逐字节一致，否则一处修 bug 另一处继续错（同 server/utils 与前端的三处同源范式）
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex')
assert.ok(exists('pkg-admin/utils/driving-school.js'), 'pkg-admin/utils/driving-school.js 缺失（pkg-admin 仍在引用）')
assert.strictEqual(sha('pkg-admin/utils/driving-school.js'), sha('pkg-feature/utils/driving-school.js'),
  '两份 driving-school.js 不一致：pkg-admin 与 pkg-feature 必须保持同源')

// ===== 5. 页面分包归属（pkg-user）=====

const USER_PAGES = ['account-settings', 'settings', 'profile-edit', 'blacklist']
USER_PAGES.forEach((pg) => {
  const full = 'pages/' + pg + '/index'
  assert.ok(app.pages.indexOf(full) < 0, full + ' 仍在主包 pages 中（应已迁入 pkg-user）')
  const pkg = app.subPackages.find((s) => s.root === 'pkg-user')
  assert.ok(pkg && pkg.pages.indexOf(full) >= 0, full + ' 未注册进 pkg-user 分包')
  assert.ok(exists('pkg-user/pages/' + pg + '/index.js'), 'pkg-user/pages/' + pg + '/index.js 缺失')
})

// 分包要预加载，否则「我的 → 设置」首次进入会白屏等下载
assert.ok(app.preloadRule['pages/user/index'] &&
  app.preloadRule['pages/user/index'].packages.indexOf('pkg-user') >= 0,
  'pages/user/index 需 preloadRule 预载 pkg-user，否则设置类页面首次进入有下载等待')

// 迁走的页面路径引用不能残留（旧路径不会报错，只会静默跳到不存在页面）
// app.json 例外：分包里的页面路径是相对 root 写的（"pages/settings/index" 属 pkg-user），
// 这是正确写法，由上面第 5 段单独校验归属
const staleRefs = []
sourceFiles.forEach((f) => {
  if (f.rel === 'app.json') return
  const t = textOf(f.rel)
  USER_PAGES.forEach((pg) => {
    const needle = 'pages/' + pg + '/index'
    let i = t.indexOf(needle)
    while (i >= 0) {
      if (t.substr(i - 'pkg-user/'.length, 'pkg-user/'.length) !== 'pkg-user/') {
        staleRefs.push(f.rel + ' -> ' + needle)
      }
      i = t.indexOf(needle, i + 1)
    }
  })
})
assert.deepStrictEqual(staleRefs, [], '仍残留旧页面路径引用：' + staleRefs.join('; '))

console.log('package split guard passed. (主包 ' + (main.size / 1024).toFixed(0) + ' KB / 上限 ' +
  (MAIN_LIMIT / 1024).toFixed(0) + ' KB, 图片 ' + (mediaTotal / 1024).toFixed(1) + ' KB / 防增长 ' +
  (MEDIA_LIMIT / 1024).toFixed(0) + ' KB, 主包 utils ' + mainUtils.length + ' 个均有主包引用)')