// M6b 回归：报告点名的 6 个服务不得再出现「即将上线」式死链——
// 要么有真实落地页（站内页 / H5 / 小程序），要么从入口列表中被过滤掉。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = (...seg) => fs.readFileSync(path.join(__dirname, '..', '..', ...seg), 'utf8')
const index = read('pages', 'index', 'index.js')
const serviceAll = read('pkg-feature', 'pages', 'service-all', 'index.js')
const api = read('utils', 'api.js')
const campus = read('utils', 'campus-services.js')

// 1) 校园卡 / 速印(=宅印) / 校车时刻 进入通用服务详情页
const campusNames = ['校车时刻', '校园卡', '速印']
for (const n of campusNames) {
  assert.ok(campus.includes(`name: '${n}'`) || campus.includes(`name: "${n}"`), `campus-services 应含 ${n}`)
  assert.ok(index.includes(`CAMPUS_SERVICE_IDS[item.name]`), '首页应经 CAMPUS_SERVICE_IDS 路由')
  assert.ok(serviceAll.includes(`'${n}': '/pages/campus-service/index'`), `全部服务应登记 ${n} → campus-service`)
}
// 宅印 → 速印 归一（同名才能命中落地页）
assert.ok(/'宅印':\s*'速印'/.test(api), '宅印应归一为速印')

// 2) 图书馆：超星 H5，微信内可打开
assert.ok(/图书馆/.test(index) && /chaoxing\.com/.test(index), '首页图书馆应跳超星 H5')
assert.ok(/item\.name === '图书馆'/.test(serviceAll) && /chaoxing\.com/.test(serviceAll), '全部服务图书馆应可用')

// 3) 校园网 / 选课系统：既无真实链接也不在端上路由表 → 必须从入口中消失（过滤，而非死链）
const gridBlock = index.slice(index.indexOf('const row1'), index.indexOf('const row2KeepJump'))
assert.ok(!gridBlock.includes('校园网'), '首页宫格不应含校园网（无落地页）')
assert.ok(!gridBlock.includes('选课系统'), '首页宫格不应含选课系统（无落地页）')
assert.ok(!serviceAll.includes("'校园网': '/pages") && !serviceAll.includes("'选课系统': '/pages"), '全部服务路由表不应含校园网/选课系统')
// 且 service-all 通过 isServiceAvailable 过滤无落地目标的服务
assert.ok(/\.filter\(isServiceAvailable\)/.test(serviceAll), '全部服务应过滤不可用条目')
assert.ok(/function isServiceAvailable/.test(serviceAll), '应存在可用性判定函数')

// 4) 全站不得出现「即将上线」用户提示（只允许出现在注释里）
for (const [label, src] of [['首页', index], ['全部服务', serviceAll], ['api', api]]) {
  const toastLines = src.split(/\r?\n/).filter((line) => /showToast|showModal/.test(line) && line.includes('即将上线'))
  assert.strictEqual(toastLines.length, 0, `${label} 不应有「即将上线」toast`)
}

console.log('Service dead-link (M6b) test passed.')
