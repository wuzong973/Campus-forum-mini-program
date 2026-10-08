/**
 * 本地模块引用完整性测试（无需真机 / 无需数据库）
 *
 * 用途：扫 pages / components / pkg-admin / pkg-schedule / custom-tab-bar 里所有
 * `const { a, b } = require('./本模块')`，
 * 用**真实 require** 取出目标模块的导出名逐个核对，抓出「引用了不存在的导出」。
 *
 * 为什么需要它：解构一个不存在的导出**不会在 require 时报错**，只会在用到时炸成
 * `Cannot read properties of undefined`。2026-09-10 线上就踩过一次：
 * `pkg-feature/pages/club/detail.js` 引用了 `utils/campus.js` 里从未存在过的 `CAMPUS_OPTIONS`，
 * 结果一进社团分类详情页就抛 `Cannot read properties of undefined (reading 'indexOf')`，
 * 页面白屏（开发者工具控制台报 weapp:///pkg-feature/pages/club/detail.js）。
 *
 * 说明：依赖小程序运行时的模块（需要真实 wx 能力）加载会失败，这类会被跳过并计数，
 * 不会产生误报；因此本测试只做「零误报」的保守校验。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

// 让 utils/ 下的模块能顺利加载：给一个万能 wx 桩
global.wx = new Proxy({}, { get: () => () => undefined })
global.getApp = () => ({ globalData: { userInfo: {} } })
global.getCurrentPages = () => []
global.App = () => {}
global.Page = () => {}
global.Component = () => {}

const ROOT = path.join(__dirname, '..', '..')
const SCAN_ROOTS = ['pages', 'pkg-feature', 'components', 'pkg-admin', 'pkg-schedule', 'custom-tab-bar']

function collectJsFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectJsFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function resolveLocal(fromFile, request) {
  const target = path.resolve(path.dirname(fromFile), request)
  return [target, target + '.js', path.join(target, 'index.js')]
    .find((p) => fs.existsSync(p) && fs.statSync(p).isFile())
}

const exportsCache = new Map()
// 返回导出名集合；模块因依赖小程序运行时加载失败时返回 null（跳过，不误报）
function realExports(absPath) {
  if (exportsCache.has(absPath)) return exportsCache.get(absPath)
  let result = null
  try {
    result = new Set(Object.keys(require(absPath) || {}))
  } catch (e) {
    result = null
  }
  exportsCache.set(absPath, result)
  return result
}

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

const files = []
for (const root of SCAN_ROOTS) {
  const dir = path.join(ROOT, root)
  if (fs.existsSync(dir)) collectJsFiles(dir, files)
}

assert.ok(files.length > 50, '应扫描到足够多的页面/组件文件，实际 ' + files.length)

const problems = []
let checkedRefs = 0
let skippedModules = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\((['"])([^'"]+)\2\)/g)) {
    const request = m[3]
    if (!request.startsWith('.')) continue
    const target = resolveLocal(file, request)
    if (!target) continue
    const exported = realExports(target)
    if (!exported) { skippedModules++; continue }
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(':')[0].trim()
      if (!name) continue
      checkedRefs++
      if (!exported.has(name)) {
        problems.push(rel + ' 从 ' + request + ' 取了 `' + name + '`，但该模块只导出: ' + [...exported].join(', '))
      }
    }
  }
}

check(() => {
  assert.deepStrictEqual(problems, [],
    '发现引用了不存在的导出（解构不报错，用到时才炸 Cannot read properties of undefined）：\n  - ' + problems.join('\n  - '))
}, '本地模块导出名引用')

check(() => {
  assert.ok(checkedRefs > 50, '校验的引用数偏少（' + checkedRefs + '），扫描逻辑可能失效')
}, '扫描覆盖率')

console.log(testCount + ' tests passed.（校验 ' + checkedRefs + ' 处引用，跳过 ' + skippedModules + ' 个需小程序运行时的模块）')
