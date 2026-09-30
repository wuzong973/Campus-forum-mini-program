// 首页轮播「按压式卡片」接线护栏：倾斜/缩小/光斑三件事都依赖 wxml-js-wxss 三处同时到位，
// 少任何一处都不会报错，只会静默变成普通按压，所以用源码断言锁住。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const wxml = read('pages/index/index.wxml')
const js = read('pages/index/index.js')
const wxss = read('pages/index/index.wxss')

// 只取轮播那一段，避免误匹配页面里其它 pressable 元素
const card = wxml.slice(wxml.indexOf('<swiper-item'), wxml.indexOf('</swiper-item>'))
assert.ok(card, '未找到轮播卡片片段')

assert.ok(card.indexOf('bindtouchstart="onBannerTouchStart"') >= 0, '卡片要接住按下事件（倾斜方向依赖触点坐标）')
assert.ok(card.indexOf('bindtouchend="onBannerTouchEnd"') >= 0, '卡片要接住松手事件（否则按下去弹不回来）')
assert.ok(card.indexOf('bindtouchcancel="onBannerTouchEnd"') >= 0, '滑动打断 touchend 时也要复原')
assert.ok(card.indexOf('id="banner-{{index}}"') >= 0, '每张卡片要有独立 id，供 boundingClientRect 取当前那张的位置')
assert.ok(card.indexOf('style="{{bannerTiltStyle}}"') >= 0, '倾斜与光斑位置通过内联 style 下发')
assert.ok(card.indexOf('bannerPressedIndex === index') >= 0, '按压态必须按 index 逐张判定，否则整组轮播一起动')
assert.ok(card.indexOf('class="banner-spot"') >= 0, '缺少光斑元素')
assert.ok(card.indexOf('pressable') < 0, '轮播卡片不能再挂全局 pressable：它的 :active scale/opacity 会与按压动效打架')

assert.ok(js.indexOf('bannerPressedIndex: -1') >= 0, 'data 里要有未受力初值')
assert.ok(/bannerTiltStyle: '[^']*scale\(1\)/.test(js), '初值必须是不倾斜不缩小的具体变换，避免首帧从 none 过渡')
assert.ok(js.indexOf('onBannerTouchStart(e)') >= 0 && js.indexOf('onBannerTouchEnd()') >= 0, '缺少按压处理函数')
assert.ok(js.indexOf('buildTiltStyle') >= 0, '倾斜样式应集中在一处构造')
assert.ok(js.indexOf(', 0.965)') >= 0, '按下要缩小到 0.965')
assert.ok(/buildTiltStyle\(0, 0, 50, 50, 1\)/.test(js), '松手要回到 scale(1) 的完整数值，不能清空 style')
assert.ok(js.indexOf('perspective(') >= 0, 'rotateX/rotateY 需要 perspective 才有 3D 感')

assert.ok(/\.banner-item\s*\{[^}]*transition:[^}]*cubic-bezier\(0\.34,\s*1\.56/.test(wxss), '松手回弹要用带过冲的曲线（0.34,1.56,…）')
assert.ok(/\.banner-item\.banner-pressing\s*\{[^}]*transition-duration:\s*0\.16s/.test(wxss), '按下要短促跟手，不能用回弹的长时长')
assert.ok(/\.banner-spot\s*\{[^}]*radial-gradient\(circle at var\(--spot-x/.test(wxss), '光斑圆心要跟随触点变量')
assert.ok(/\.banner-pressing \.banner-spot\s*\{[^}]*transform:\s*scale\(1\)/.test(wxss), '按下时光斑要从大到小聚到触点')
assert.ok(wxss.indexOf('pointer-events: none') >= 0, '光斑不能挡住点击')

// ===== 视觉增强：旋转描边 / 弥散背光 / 触点流光 =====
// 描边与背光已抽进 styles/card-fx.wxss 全站共用。页面里的 @import 不会被解析，
// 所以护栏必须显式读共享文件：结构接线在 index.wxml，样式在共享层。
const fx = read('styles/card-fx.wxss')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

// 倾斜必须持续跟随手指，不能只在 touchstart 算一次
assert.ok(card.indexOf('bindtouchmove="onBannerTouchMove"') >= 0, '卡片要接住 touchmove，否则倾斜不会跟手')
assert.ok(card.indexOf('class="fx-ring"') >= 0, '缺少描边环容器（共享层类名）')
assert.ok(card.indexOf('class="fx-ring-spin"') >= 0, '缺少自转的 conic 层（共享层类名）')
assert.ok(card.indexOf('class="fx-body"') >= 0, '卡面需内缩一层才露得出描边（共享层类名）')
assert.ok(card.indexOf('fx-card') >= 0 && card.indexOf('is-live') >= 0, '卡片要挂 fx-card，可见那张挂 is-live')
assert.ok(card.indexOf('class="banner-shine"') >= 0, '缺少触点流光层')
// 背光不能放进 swiper：swiper 的 overflow:hidden 会把它整层裁掉
assert.ok(wxml.indexOf('class="banner-stage fx-stage') >= 0, '背光要挂在 swiper 之外、且带 fx-stage 以继承 token 默认值的 stage 上')
assert.ok(wxml.indexOf('class="fx-glow ') >= 0, '缺少弥散背光层（共享层类名）')

// —— 共享层 ——
assert.ok(/\.fx-ring\s*\{[^}]*overflow:\s*hidden/.test(fx), '描边环要自带 overflow:hidden：不能指望 3D 变换后的父级裁切')
assert.ok(/\.fx-ring-spin\s*\{[^}]*background:\s*linear-gradient/.test(fx), 'conic 层要先写 linear-gradient 兜底，老内核才不是无边框')
assert.ok(/\.fx-ring-spin\s*\{[^}]*background:\s*conic-gradient/.test(fx), 'conic 兜底之后要覆盖 conic-gradient')
assert.ok(/@keyframes\s+fx-spin/.test(fx), '缺少描边自转关键帧（conic 角度无法直接补间，只能转元素）')
assert.ok(/\.fx-card\.is-live \.fx-ring-spin\s*\{[^}]*animation:/.test(fx), '自转只给 .is-live 的实例，列表项与隐藏帧不空转')
assert.ok(/\.fx-glow-pulse\s*\{[^}]*radial-gradient/.test(fx), '背光用多档 radial-gradient 模拟弥散')
assert.ok(/\.fx-glow\.is-on \.fx-glow-pulse\s*\{[^}]*animation:/.test(fx), '呼吸只给 .is-on 的背光层')
// 方块边长必须由百分比 padding 推导：写死 rpx 换一张比例不同的卡就会露缺口
assert.ok(/\.fx-ring-spin\s*\{[^}]*padding-bottom:\s*\d+%/.test(fx), '描边方块要用百分比 padding 撑成正方形，不能写死 rpx')
assert.ok(/\.fx-off[^{]*\{[^}]*animation:\s*none/.test(fx), '降级要停动画但保留静态描边，不能把效果降成什么都没有')
assert.ok(/prefers-reduced-motion/.test(fx), '缺 OS 级减弱动效兜底')

// —— 首页专属 ——
assert.ok(/\.banner-stage\.fx-paused[^{]*\{[^}]*animation-play-state:\s*paused/.test(wxss), '滚动期间要暂停常驻动画')
assert.ok(/\.banner-shine\s*\{[^}]*calc\(\(var\(--spot-x/.test(wxss), '流光位移要由触点变量驱动，纯 CSS 跟手')
// blur 禁令要先剥注释：注释里解释「为什么不用 blur」的散文会被整文件扫描误判成违规
assert.ok(!/(^|[^-])filter:\s*blur/.test(stripComments(wxss)), '首页常驻层禁止实时 blur（backdrop-filter 除外）')
assert.ok(!/(^|[^-])filter:\s*blur/.test(stripComments(fx)), '共享层禁止实时 blur：它会被接入的每个页面继承，一处 blur 全站掉帧')

// 描边是从卡面四周"扣"出来的：这部分高度必须由 swiper 加回来，
// 否则 .banner-text 会顶到 overflow:hidden 的裁切线上，把顶部标签切掉半截，
// 而且不会有任何报错。改任一数值时这条会拦住。
const swiperH = Number(/\.banner-swiper\s*\{[^}]*height:\s*(\d+)rpx/.exec(wxss)[1])
const fxW = Number(/--fx-w:\s*(\d+)rpx/.exec(fx)[1])
assert.ok(swiperH - fxW * 2 >= 258, '卡面净高度不能低于 258rpx：轮播文字块按这个高度排的版')

assert.ok(js.indexOf('_bannerRect') >= 0, 'touchmove 要复用 touchstart 缓存的 rect，逐帧 createSelectorQuery 会掉帧')
assert.ok(js.indexOf('bannerFxPaused: false') >= 0, 'data 里要有动画暂停初值')
assert.ok(js.indexOf('_pauseBannerFx()') >= 0, '滚动时要触发暂停')
// 暂停/唤醒必须成对：漏了 onShow 这一半不会报错，只会表现成"用了一次后台之后动效再也不动了"
assert.ok(/onShow\(\)[\s\S]*bannerFxPaused: false[\s\S]*onHide\(\)/.test(js), 'onHide 挂的暂停要在 onShow 唤醒，否则切回首页不滚动就永久停在暂停态')
assert.ok(js.indexOf('motion.isCardFxOff()') >= 0, '降级判定要在回到首页时重新同步，否则设置页刚关掉不生效')

console.log('home banner press test passed.')
