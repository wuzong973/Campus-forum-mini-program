// 审计修复回归：M-1 校园地图标记点击、M-2 服务可配置化、L-2 后台销量误导移除。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const read = (...seg) => fs.readFileSync(path.join(__dirname, '..', '..', ...seg), 'utf8')

// ---- M-1 campus-map onMarkerTap ----
const map = read('pages', 'campus-map', 'index.js')
assert.ok(/onMarkerTap\(e\)/.test(map), 'campus-map 应定义 onMarkerTap')
assert.ok(/markerId/.test(map) && /selectedPlace/.test(map), 'onMarkerTap 应据 markerId 更新 selectedPlace')
const mapWxml = read('pages', 'campus-map', 'index.wxml')
assert.ok(/bindmarkertap="onMarkerTap"/.test(mapWxml), 'wxml 绑定应与已定义方法对应')

// ---- M-2 服务可配置化：schema ----
const init = read('server', 'sql', 'init.sql')
assert.ok(/`mini_app_id` varchar\(64\)/.test(init), 'service_item 应有 mini_app_id 列')
assert.ok(/`icon_path` varchar\(256\)/.test(init), 'service_item 应有 icon_path 列')
const mig = read('server', 'utils', 'migrations.js')
assert.ok(/ensureColumn\('service_item', 'mini_app_id'/.test(mig), '迁移应补 mini_app_id')
assert.ok(/ensureColumn\('service_item', 'icon_path'/.test(mig), '迁移应补 icon_path')
// 读取回传
const svcCtl = read('server', 'controllers', 'serviceController.js')
assert.ok(/miniAppId: i\.mini_app_id/.test(svcCtl) && /iconPath: i\.icon_path/.test(svcCtl), 'serviceController.list 应回传 miniAppId/iconPath')
// 后台 CRUD 接口
const adminCtl = read('server', 'controllers', 'adminController.js')
for (const fn of ['listServices', 'createService', 'updateService', 'deleteService']) {
  assert.ok(new RegExp('exports\\.' + fn + ' = async').test(adminCtl), `adminController 应有 ${fn}`)
}
const adminRoutes = read('server', 'routes', 'adminRoutes.js')
assert.ok(/router\.get\('\/services', requireAdmin\('config\.manage'\), controller\.listServices\)/.test(adminRoutes), 'GET /services 需 config.manage')
assert.ok(/router\.delete\('\/services\/:id', requireAdmin\('config\.manage'\), controller\.deleteService\)/.test(adminRoutes), 'DELETE /services/:id 需 config.manage')
// 后台前端接线
const adminApi = read('pkg-admin', 'utils', 'admin.js')
assert.ok(/services: \(\) => get\('\/services'\)/.test(adminApi) && /createService:/.test(adminApi) && /deleteService:/.test(adminApi), 'admin.js 应有服务方法')
const adminJs = read('pkg-admin', 'admin', 'index.js')
assert.ok(/key: 'services'/.test(adminJs) && /loadServices\(\)/.test(adminJs), '后台页应有服务标签/加载接线')
assert.ok(/beginServiceCreate|beginServiceEdit|toggleService|deleteService/.test(adminJs), '后台页应有服务操作方法')
const adminWxml = read('pkg-admin', 'admin', 'index.wxml')
assert.ok(/activeTab === 'services'/.test(adminWxml), '后台 WXML 应有服务列表块')
// 服务表单已从抽屉迁到独立编辑页：入口跳转 + 编辑页按 scope 渲染 + 保存校验
assert.ok(/navigateTo\(\{ url: '\/pkg-admin\/admin\/edit\/index\?scope=service'/.test(adminJs),
  '后台服务新建/编辑入口应跳独立编辑页')
const editJs = read('pkg-admin', 'admin', 'edit', 'index.js')
const editWxml = read('pkg-admin', 'admin', 'edit', 'index.wxml')
assert.ok(/scope === 'service'/.test(editJs) && /scope === 'service'/.test(editWxml),
  '独立编辑页应有 service 分支（加载 + 校验 + 表单）')

// ---- L-2 后台销量误导移除 ----
assert.ok(!/SUM\(sales_count\)/.test(adminCtl), '概览统计不应再 SUM(sales_count)')
assert.ok(!/sales_count salesCount/.test(adminCtl), '物品列表不应再取 sales_count')
assert.ok(!/items\.sales|虚拟物品销量|item\.salesCount/.test(adminWxml), '后台 WXML 不应再展示销量')

console.log('Audit fixes (M-1/M-2/L-2) test passed.')
