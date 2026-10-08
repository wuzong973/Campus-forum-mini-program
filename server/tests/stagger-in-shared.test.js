// 列表入场交错动画（app.wxss 的 .anim-stagger）的接入护栏。
//
// 与 card-fx-shared.test.js 同一类问题：动画属于「漏接不报错、只是静默没效果」的接线，
// 用源码断言锁住共享层的关键属性与接入页清单。
// 设计说明见 docs/02_前端与UI交互.md §五。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
// 注释不参与断言：解释「为什么不用 xx」的散文会被整文件扫描误判成违规
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const app = strip(read('app.wxss'))

// ===== 共享层自身 =====

// .anim-stagger 必须存在且用专属关键帧（不能复用 slide-up：那是直线 ease-out，没有弹性）
assert.ok(/\.anim-stagger\s*\{[^}]*animation:\s*stagger-in/.test(app),
  '.anim-stagger 必须挂 stagger-in 关键帧；换成 ease-out 直线曲线就丢了弹性')
assert.ok(/@keyframes\s+stagger-in/.test(app), '缺 stagger-in 关键帧')

// 弹性来自缓动曲线 y 控制点 > 1（位移落定前轻微越过终点再回弹）。
// 锁曲线第二个参数 > 1：改成 ≤1 的普通贝塞尔曲线，回弹就消失了
const bezier = app.match(/\.anim-stagger\s*\{[^}]*cubic-bezier\(([^)]*)\)/)
assert.ok(bezier, '.anim-stagger 必须显式写弹性 cubic-bezier')
const pts = bezier[1].split(',').map(Number)
assert.ok(pts.length === 4 && pts[1] > 1 && pts[1] < 1.4,
  '弹性曲线 y1 控制点应在 (1, 1.4) 区间：≤1 没有回弹，≥1.4 多卡同时入场会显得"蹦"')

// 交错延迟走 --i 变量（页面写 style="--i: ..."），这是项目已上线的范式
assert.ok(/animation-delay:\s*calc\(var\(--i,\s*0\)\s*\*\s*\d+ms\)/.test(app),
  '交错延迟必须用 calc(var(--i, 0) * Nms)，写死 animation-delay 会破坏逐项错峰')

// 关键帧只允许动合成器属性：加 width/margin/box-shadow 之类会在滚动长列表里逐帧重排
const kf = app.match(/@keyframes\s+stagger-in\s*\{[\s\S]*?\n\}/)
assert.ok(kf, '找不到 stagger-in 关键帧体')
assert.ok(!/\b(width|height|margin|padding|top|left|right|bottom|box-shadow|filter)\s*:/.test(kf[0]),
  'stagger-in 关键帧只允许 transform/opacity（合成器属性），出现布局属性会引发逐帧重排')

// 降级：与 card-fx 共用 fx-off；OS 减弱动效兜底
assert.ok(/\.fx-off\.anim-stagger\s*\{[^}]*animation:\s*none/.test(app),
  '缺 .fx-off.anim-stagger 降级：用户关掉动效 / 低端机挂 fx-off 时入场动画必须停')
assert.ok(/prefers-reduced-motion[^{]*\{[^}]*\.anim-stagger\s*\{[^}]*animation:\s*none/.test(app),
  '缺 prefers-reduced-motion 下停 .anim-stagger 的兜底')

// ===== 接入清单 =====
// 铺开每一波时往这里加条目；cap 字段是该页 --i 的封顶上限（应与 wxml 里的 index < N 一致）
const SURFACES = [
  { file: 'pages/index/index', name: '首页帖子流 + 今日热帖卡' },
  { file: 'pages/hot-rank/index', name: '热榜帖子榜' },
  { file: 'pages/search/index', name: '搜索结果 + 今日热榜' },
  { file: 'pages/errand/index', name: '跑腿接单大厅' },
  { file: 'pages/errand-order/index', name: '我的跑腿订单' },
  { file: 'pages/errand-message/index', name: '跑腿会话列表' },
  { file: 'pkg-feature/pages/activity/index', name: '活动列表' },
  { file: 'pkg-feature/pages/club/detail', name: '社团分类下社团列表' },
  { file: 'pkg-feature/pages/club/club-detail', name: '社团成员/近期活动' },
  { file: 'pkg-feature/pages/group-chat/list', name: '群聊列表' },
  { file: 'pkg-feature/pages/driving-school/index', name: '驾校列表' },
  { file: 'pages/campus-service/index', name: '校园卡入口卡' },
  { file: 'pkg-feature/pages/feedback/index', name: '意见反馈列表' },
  { file: 'pkg-feature/pages/wallet/index', name: '钱包收益明细' },
  { file: 'pages/my-messages/index', name: '我的消息三个 tab' },
  { file: 'pages/my-posts/index', name: '我的帖子四个子列表' },
  { file: 'pages/my-interactions/index', name: '我的互动记录' },
  { file: 'pages/profile/index', name: '个人主页帖子' },
  { file: 'pages/post-detail/index', name: '帖子详情评论区' },
  { file: 'pkg-feature/pages/review/list', name: '评价广场' },
  { file: 'pkg-feature/pages/review/target', name: '评价详情评论' },
  { file: 'pkg-feature/pages/announcements/index', name: '更新公告' },
  { file: 'pkg-user/pages/blacklist/index', name: '黑名单两个 tab' },
  { file: 'pkg-feature/pages/help/index', name: 'FAQ 列表' },
  { file: 'pkg-feature/pages/rules/index', name: '校规列表' },
  { file: 'pkg-feature/pages/repair/index', name: '维修预约订单' },
  { file: 'pkg-feature/pages/service-all/index', name: '服务广场分区' },
  { file: 'pkg-admin/admin/index', name: '后台管理列表' },
  { file: 'pkg-schedule/schedule-exam/index', name: '考试安排' },
  { file: 'pkg-schedule/schedule-grade/index', name: '成绩列表' },
  { file: 'pkg-schedule/schedule-calendar/index', name: '校历重要日期' },
  { file: 'pkg-schedule/schedule-edit/index', name: '课表课程列表' }
]

SURFACES.forEach((s) => {
  const wxml = read(s.file + '.wxml')
  const label = s.file + '(' + s.name + ')'

  assert.ok(wxml.indexOf('anim-stagger') >= 0, label + ' 没挂 anim-stagger，入场交错整块不生效')
  // --i 必须封顶：全量 index 会让长列表后段项延迟 360ms+ 才出现，显得迟钝
  assert.ok(/index\s*<\s*\d+\s*\?\s*index\s*:\s*0/.test(wxml),
    label + ' 的 --i 没有按 index 封顶（应写成 {{index < 6 ? index : 0}}）')
})

console.log('stagger-in shared layer test passed. (' + SURFACES.length + ' surface(s))')
