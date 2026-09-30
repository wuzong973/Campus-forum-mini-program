// H2/H3 回归：课表「编辑/删除」必须走单条 PUT/DELETE 接口，而不是新增重复或清空重插。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'scheduleRoutes.js'), 'utf8')
const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scheduleController.js'), 'utf8')
const api = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'api.js'), 'utf8')
const editPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-edit', 'index.js'), 'utf8')

// 后端路由
assert.match(routes, /router\.put\('\/course\/:id', auth, scheduleController\.updateCourse\)/)
assert.match(routes, /router\.delete\('\/course\/:id', auth, scheduleController\.deleteCourse\)/)
// 控制器：UPDATE/DELETE 均带 user_id 越权保护
assert.match(controller, /UPDATE user_schedule[\s\S]*WHERE id = \? AND user_id = \?/)
assert.match(controller, /DELETE FROM user_schedule WHERE id = \? AND user_id = \?/)

// 前端 API 暴露
assert.match(api, /function updateScheduleCourse\(/)
assert.match(api, /function deleteScheduleCourse\(/)
assert.match(api, /request\.put\(`\/schedule\/course\/\$\{courseId\}`/)
assert.match(api, /request\.del\(`\/schedule\/course\/\$\{courseId\}`/)

// 编辑页：保存走 update、删除走 deleteScheduleCourse，且不再「清空整表 + 逐条重插」
assert.match(editPage, /api\.updateScheduleCourse\(/)
assert.match(editPage, /api\.deleteScheduleCourse\(/)
assert.ok(!/api\.clearSchedule\(\)\.then\(\(\) => \{\s*courses\.forEach/.test(editPage), '删除课程不应再用清空重插')

console.log('Schedule course CRUD test passed.')
