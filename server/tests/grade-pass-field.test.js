// M1e 回归：后端成绩接口必须派生 pass 字段，前端「挂科标红」才能生效。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const controller = require('../controllers/scheduleController')

const derive = controller.deriveGradePass
assert.ok(typeof derive === 'function', '应导出 deriveGradePass')

const passOf = (score) => derive({ score }).pass
assert.strictEqual(passOf('85'), true, '85 分应通过')
assert.strictEqual(passOf('60'), true, '60 分及格线应通过')
assert.strictEqual(passOf('59'), false, '59 分应挂科')
assert.strictEqual(passOf('不及格'), false, '文字不及格应挂科')
assert.strictEqual(passOf('优秀'), true, '优秀应通过')
assert.strictEqual(passOf('及格'), true, '及格应通过')
assert.strictEqual(passOf('F'), false, '等级 F 应挂科')
assert.strictEqual(passOf('A'), true, '等级 A 应通过')
assert.strictEqual(passOf(''), null, '空成绩不判定（不标红）')
assert.strictEqual(passOf(null), null, 'null 成绩不判定')
// 返回新对象且保留原字段
const g = { name: '高数', score: '58', credit: '4' }
const out = derive(g)
assert.strictEqual(out.pass, false)
assert.strictEqual(out.name, '高数', '不应丢失原字段')
assert.notStrictEqual(out, g, '应返回新对象，不改动入参')

// listGrades 与同步 payload 都接了派生
const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scheduleController.js'), 'utf8')
assert.ok(/rows\.map\(deriveGradePass\)/.test(src), 'listGrades 应 map deriveGradePass')
assert.ok(/\(result\.grades \|\| \[\]\)\.map\(deriveGradePass\)/.test(src), '同步 payload 成绩应 map deriveGradePass')

// 前端确实按 pass===false 标红
const wxml = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-grade', 'index.wxml'), 'utf8')
assert.ok(/item\.pass === false/.test(wxml), '成绩页应依据 pass===false 标红')

console.log('Grade pass derivation (M1e) test passed.')
