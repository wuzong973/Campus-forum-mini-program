// 后台「驾校筛选标签」chip 编辑器护栏：删除动画是两段式的（先标 removing 播动画，再移出数组），
// 且必须靠 max-width/margin 收位来让后面的标签补位——只写 transform 不会重排，动画完会突然跳位。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const wxml = read('pkg-admin/admin/index.wxml')
const js = read('pkg-admin/admin/index.js')
const wxss = read('pkg-admin/admin/index.wxss')

// 编辑器整体：chip 列表 + 末尾输入框，旧的 textarea 写法必须消失
assert.ok(wxml.indexOf('class="tag-editor"') >= 0, '缺少 chip 容器')
assert.ok(wxml.indexOf("{{item.removing ? 'tag-chip--removing' : ''}}") >= 0, 'chip 要按 removing 状态挂动画类')
assert.ok(wxml.indexOf('catchtap="removeDrivingTag"') >= 0, '× 必须用 catchtap，否则会冒泡触发外层手势')
assert.ok(wxml.indexOf('data-index="{{index}}"') >= 0, '× 要带下标')
assert.ok(wxml.indexOf('bindconfirm="addDrivingTags"') >= 0, '输入框回车应能添加')
assert.ok(wxml.indexOf('drivingTagsText') < 0, 'textarea 旧写法要清掉')
assert.ok(wxml.indexOf('drivingTagsCount') < 0, '计数改用 drivingTags.length 后不应再留旧字段')

// 两段式删除 + 与后端一致的约束
assert.ok(js.indexOf('.removing\']: true') >= 0, '第一步：先标 removing 播动画')
assert.ok(js.indexOf('setTimeout(') >= 0 && js.indexOf('item.name !== tag.name') >= 0, '第二步：动画结束再移出数组')
assert.ok(js.indexOf('if (!tag || tag.removing) return') >= 0, '动画期间重复点 × 要忽略')
assert.ok(js.indexOf('> 8') >= 0 && js.indexOf('>= 12') >= 0, '单个 8 字 / 最多 12 个的前端校验要与服务端同口径')
assert.ok(js.indexOf('filter((item) => !item.removing)') >= 0, '保存时要排除动画中的标签，避免把正在删的又存回去')
assert.ok(js.indexOf('savedTags || drivingSchool.SERVICE_TAGS') >= 0, '未配置时要预填内置标签池，否则后台显示空、用户端却有 8 个')

// 补位动画必须收占位宽度与外边距
assert.ok(/@keyframes tag-collapse\s*\{[\s\S]*max-width:\s*0;[\s\S]*margin-right:\s*0/.test(wxss), 'collapse 关键帧要同时收 max-width 与 margin，后面的标签才会补位')
assert.ok(/\.tag-chip--removing\s*\{[^}]*animation:\s*tag-collapse/.test(wxss), 'removing 类要挂 collapse 动画')
assert.ok(/\.tag-chip--removing\s*\{[^}]*pointer-events:\s*none/.test(wxss), '动画中不应再响应点击')
assert.ok(js.indexOf('}, 240)') >= 0, '移出时机要与动画时长（.24s）对齐')

console.log('tag chip editor test passed.')
