// 一次性工具：扫描 tests/*.test.js，生成 package.json 里 scripts.test 的完整链。
// 用途：避免再出现「新增测试文件忘了补进 scripts.test，npm test 静默漏跑」的问题。
// 用法：node scripts/_gen_test_script.js          —— 只打印统计
//       node scripts/_gen_test_script.js --write  —— 直接写回 package.json
const fs = require('fs')
const path = require('path')

const testsDir = path.join(__dirname, '..', 'tests')
const pkgPath = path.join(__dirname, '..', 'package.json')

const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()

if (!files.length) {
  console.error('未找到任何测试文件，拒绝生成空脚本')
  process.exit(1)
}

const script = files.map((f) => 'node tests/' + f).join(' && ')

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const before = (pkg.scripts.test.match(/node tests\/[\w\-.]+\.test\.js/g) || []).length

console.log('tests/ 下测试文件数:', files.length)
console.log('原 test 脚本引用数:', before)
if (before !== files.length) {
  const prev = (pkg.scripts.test.match(/node tests\/([\w\-.]+\.test\.js)/g) || []).map((s) =>
    s.replace('node tests/', '')
  )
  const missing = files.filter((f) => !prev.includes(f))
  const extra = prev.filter((f) => !files.includes(f))
  if (missing.length) console.log('遗漏未接入:', missing.length, '\n  ' + missing.join('\n  '))
  if (extra.length) console.log('脚本引用了不存在的文件:', extra.length, '\n  ' + extra.join('\n  '))
}

if (process.argv.includes('--write')) {
  pkg.scripts.test = script
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log('已写回 package.json，共接入', files.length, '个测试文件')
} else {
  console.log('（未写入。加 --write 可写回）')
}
