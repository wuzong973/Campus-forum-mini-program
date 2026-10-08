/**
 * 「信息推送群」页面护栏（无需真机/无需数据库，全部读源码断言）
 *
 * 演进（2026-10-06）：
 *   第一版 —— 用户侧点卡片是「直接跳群链接 / 直接复制微信号」，看不到这个群是什么。
 *   第二版 —— 点卡片进**详情整页**（图标/标题/描述/富文本/配图 + 底部按钮）。
 *   第三版（当前，用户口径）—— 页面**只显示卡片**；点卡片弹**二维码弹窗**，
 *   样式与 `components/contact-admin` 的二维码弹层一致（长按保存 / 点击此处即可跳转）。
 *   二维码图取该卡片的 `images[0]`（后台「配图」第 1 张），标题取卡片 `title`。
 *   `pages/push-group-detail/` 整页已删除，本护栏随之把断言指向本页。
 *
 * 这层护栏要守住的点（每条都对应一个真会犯的错）：
 *   ① 详情整页必须已下线 —— 否则「只显示卡片 + 弹二维码」被改回去一半都没人发现；
 *   ② 点卡片不得跳页 / 不得直接跳 link / 不得直接复制 —— 只能是「打开二维码弹窗」；
 *   ③ 二维码必须取 `images[0]`（用户明确口径）—— 取错字段（iconPath / 新增字段）弹窗就永远空白；
 *   ④ 弹层必须用 root-portal + 遮罩 —— 卡片自身 press-spring 的 transform 会劫持 fixed 包含块；
 *   ⑤ 二维码识别走**原生长按菜单** `show-menu-by-longpress` + `bindtap="toggleQrZoom"`
 *      的**页面内就地放大**（**不得走 wx.previewImage**：那是微信自带查看器，页面里的
 *      长按菜单注入不进去，用户实测「放大后长按没菜单」；且 previewImage 里再长按对
 *      个人好友码根本识别不出）。放大态 = 深色满屏 + 隐藏标题栏 + 点任意处退出
 *      （口径对齐微信图片查看器；本页与 contact-admin 两处实现必须同款，见 ④b 组）；
 *      「点击此处即可跳转」则走 webview → web-static/wechat-qr.html 并带 qr/text 参数，
 *      且 qr 参数必须是 https（contact-admin 同款校验），否则 H5 拉到空图；
 *   ⑥ 只有 copyText 的卡片（如「添加墙墙微信」）不能让按钮点了没反应；
 *   ⑦ 后端 build/parse 两头都要带 content + images，且 images 只收 https、限 3 张；
 *   ⑧ 后台表单里 pushGroup 自己的「启用状态」开关与全站通用开关不得同时出现。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const NL = String.fromCharCode(10)
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 按名字取函数体：扫描「参数括号收口后紧跟 {」的那一处，避免命中调用行 */
function functionBody(src, name) {
  const re = new RegExp('(?:^|[^\\w.])' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g')
  const m = re.exec(src)
  if (!m) return ''
  const open = src.lastIndexOf('{', m.index + m[0].length)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open)
}

/** 取 wxss 里某个选择器的规则体：先剥注释，再按 { } 配对扫描（不能用 indexOf('}') 收口） */
function cssRule(src, selector) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
  const idx = code.indexOf(selector)
  if (idx === -1) return ''
  const open = code.indexOf('{', idx)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(open, i + 1) }
  }
  return code.slice(open)
}

const APP_JSON = read('app.json')
const LIST_JS = read('pages/push-groups/index.js')
const LIST_WXML = read('pages/push-groups/index.wxml')
const LIST_JSON = read('pages/push-groups/index.json')
const LIST_WXSS = read('pages/push-groups/index.wxss')
const CTRL = read('server/controllers/configController.js')
const EDIT_WXML = read('pkg-admin/admin/edit/index.wxml')
const EDIT_JS = read('pkg-admin/admin/edit/index.js')

// ===== ① 详情整页已下线 =====
check(() => {
  assert.ok(APP_JSON.indexOf('pages/push-group-detail/index') === -1,
    '卡片详情整页应已下线并从 app.json 摘除；若仍注册，说明改造被回退了一半')
  assert.ok(!fs.existsSync(path.join(ROOT, 'pages/push-group-detail')),
    'pages/push-group-detail 目录应已删除')
}, '详情整页已下线')

// ===== ② 点卡片 = 弹二维码弹窗 =====
check(() => {
  const body = functionBody(LIST_JS, 'onCardTap')
  assert.ok(body, '列表页找不到 onCardTap 函数体')
  assert.ok(body.indexOf('navigateTo') === -1, '点卡片不得再跳页（应弹出二维码弹窗）')
  assert.ok(body.indexOf('push-group-detail') === -1, '点卡片不得再指向已删除的详情整页')
  assert.ok(body.indexOf('url: card.link') === -1, '列表页不得直接跳群链接（应交给弹窗按钮）')
  assert.ok(body.indexOf('setClipboardData') === -1, '列表页不得直接复制微信号')
  assert.ok(body.indexOf('qrCard') > -1, '点卡片应把卡片对象塞进 qrCard 以打开弹窗')
  // 口径③：二维码取 images[0]。必须落在函数体内 —— 查全文会被注释里的 `images[0]` 蒙混过关
  assert.ok(/images\[0\]/.test(body),
    '二维码必须明确取 images[0]（用户口径：配图第 1 张），取错下标弹窗就是空的')
}, '点卡片打开二维码弹窗')

// ===== ③ 弹窗结构 =====
check(() => {
  assert.ok(LIST_WXML.indexOf('<root-portal wx:if="{{qrCard}}">') > -1,
    '弹窗必须用 root-portal：卡片的 press-spring transform 会把 position:fixed 包含块劫持到卡片内，弹窗被压变形')
  assert.ok(LIST_WXML.indexOf('catchtap="closeQr"') > -1, '点遮罩/关闭按钮应能关闭弹窗')
  assert.ok(LIST_WXML.indexOf('catchtap="stopPropagation"') > -1, '弹层内容区要吞掉点击，否则一点就穿透到遮罩把弹窗关掉')
  assert.ok(LIST_WXML.indexOf('{{qrCard.title}}') > -1, '弹窗标题应展示卡片 title')
  assert.ok(LIST_WXML.indexOf('长按图片可保存或识别') > -1, '弹窗要有说明「长按可保存或识别」的提示')
  assert.ok(LIST_WXML.indexOf('放大后长按图片即可识别或保存') === -1,
    '旧文案承诺「放大后长按即可识别」，但个人好友码在小程序内识别不出来，属于误导')
  assert.ok(LIST_WXML.indexOf('点击此处即可跳转') > -1, '弹窗主按钮文案应为「点击此处即可跳转」')
  assert.ok(LIST_WXSS.indexOf('.qr-mask') > -1 && LIST_WXSS.indexOf('.qr-dialog') > -1,
    '弹窗的遮罩/面板样式缺失，弹层会渲染成一片没有背景的裸内容')
  assert.ok(LIST_WXSS.indexOf('.qr-btn') > -1, '主按钮样式缺失（绿色圆角按钮）')
}, '弹窗结构')

// ===== ④ 二维码识别路径 + 跳转口径 =====
// 2026-10-07 改成「只走 previewImage」，理由是 show-menu-by-longpress 有四个门槛；
// 2026-10-08 复核：那套理由与官方文档不符（2.7.0 起支持、无域名限制、不受 mode 影响），
// 且本仓库 pkg-schedule/schedule-calendar 一直在用该属性；previewImage 里再长按对个人
// 好友码根本识别不出来（微信限制），用户实测「长按识别不出来」就是这条链路。
// 现在的口径：原生长按菜单给一步到位的保存/识别，另配两个不依赖微信识别能力的兜底按钮。
check(() => {
  // ⚠ 先剥掉 HTML 注释再断言：源码注释里会**解释为什么不用**这个属性，
  // 直接 indexOf 全文会把注释里的属性名当成「用了它」→ 断言被自己的注释触发。
  const WXML_CODE = LIST_WXML.replace(/<!--[\s\S]*?-->/g, '')
  assert.ok(WXML_CODE.indexOf('show-menu-by-longpress') > -1,
    '二维码图必须开原生长按菜单：用户要的是长按一次就能保存 + 识别')
  assert.ok(WXML_CODE.indexOf('bindlongpress=') === -1,
    '开了原生长按菜单就不要再绑 longpress 事件，避免两条长按互相抢')
  // 放大必须留在页面内：wx.previewImage 是微信自带查看器，页面里的
  // show-menu-by-longpress 注入不进去 —— 用户实测「放大后长按没菜单」
  // ⚠ 必须是 catchtap（不是 bindtap）：弹层整层绑了 catchtap="stopPropagation"，
  //   放大态它会把 qrExpanded 收回 false；bindtap 会冒泡上去 → 刚放大就被同一层收起，
  //   端上表现成「点击后无法放大」（2026-10-08 用户实测的回归）。
  assert.ok(WXML_CODE.indexOf('catchtap="toggleQrZoom"') > -1,
    '二维码图要绑 catchtap="toggleQrZoom"（页面内就地放大，且不得冒泡到弹层的退出逻辑）')
  assert.ok(WXML_CODE.indexOf('bindtap="toggleQrZoom"') === -1,
    '不得用 bindtap="toggleQrZoom"：会冒泡到弹层的 stopPropagation，放大后立刻被收起')
  // 先剥掉注释再扫：本文件的注释里会**解释为什么不用** previewImage，
  // 直接 indexOf 全文会被自己的注释触发（项目踩过这个坑）。
  const LIST_JS_CODE = LIST_JS.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((line) => line.trim().indexOf('//') !== 0).join(NL)
  assert.ok(LIST_JS_CODE.indexOf('previewImage') === -1,
    '不得再用 wx.previewImage 放大二维码：那是微信自带查看器，长按菜单注入不进去')
  assert.ok(LIST_WXML.indexOf('qrExpanded') > -1 && LIST_JS.indexOf('qrExpanded') > -1,
    '放大状态 qrExpanded 缺失')
  // 用户 2026-10-08 明确不要弹窗里另放的「识别二维码 / 保存图片」按钮：长按原生菜单已覆盖，
  // 多一排按钮只是把弹窗撑长。识别不出时的可靠路径写进提示文案里。
  assert.ok(LIST_WXML.indexOf('onQrRecognize') === -1 && LIST_WXML.indexOf('onQrSave') === -1,
    '弹窗不要再放「识别图中二维码 / 保存图片到相册」按钮（用户口径：长按原生菜单够用）')
  assert.ok(LIST_WXSS.indexOf('.qr-img') > -1, '二维码图样式缺失')

  // toggleQrZoom 必须真的用一条独立语句 setData 切换 qrExpanded。
  // ⚠ 沿用原来的「语句级」要求：挂到 && / 三元等可能不执行的表达式里，
  //   子串仍在、断言照样通过 —— 那是典型的假绿灯。
  const zoomFn = functionBody(LIST_JS, 'toggleQrZoom')
  assert.ok(zoomFn, '找不到 toggleQrZoom 函数体（点击应页面内放大，而不是走 previewImage）')
  assert.ok(zoomFn.split('\n').some((line) => /^\s*this\.setData\(/.test(line) && line.indexOf('qrExpanded') > -1),
    'toggleQrZoom 必须独立调用 this.setData({ qrExpanded: ... })，否则放大点了没反应')

  const openFn = functionBody(LIST_JS, 'onOpenQrPage')
  assert.ok(openFn, '找不到 onOpenQrPage 函数体')
  assert.ok(openFn.indexOf('/pages/webview/index?url=') > -1,
    'http(s) 链接要按全站口径走 webview')
  // H5 页地址抽成了模块级常量 QR_PAGE_URL，函数体里只有变量名 —— 要连常量定义一起查
  assert.ok(/const QR_PAGE_URL = ['"]https:\/\/[^'"]*wechat-qr\.html['"]/.test(LIST_JS),
    '「点击此处即可跳转」必须走 web-static/wechat-qr.html（个人微信二维码只能进 H5 长按识别）')
  assert.ok(openFn.indexOf('QR_PAGE_URL') > -1, '按钮跳转应使用 QR_PAGE_URL 常量，而不是另写一份地址')
  assert.ok(openFn.indexOf('qr=') > -1 && openFn.indexOf('text=') > -1,
    'H5 页要带 qr（图片）与 text（标题）参数，否则拉到的是默认二维码')
  assert.ok(/\/\^https:\\\/\\\/\//.test(openFn),
    'qr 参数必须是 https（contact-admin 同款校验）：非 https 会被 H5 拒绝，弹窗拉到空图')
  // ⚠ 这条原先是断言源码里存在字面量 `link.indexOf('/pages/') === 0`，
  //   但那是**实现细节**不是行为：2026-10-08 起站内路径统一交给 utils/link.openPath
  //   （为了支持分包 /pkg-feature/pages/... —— 本项目 35 个页面在分包里，
  //   只认 /pages/ 会把它们漏判）。护栏改成断言**行为与顺序**。
  const openIdx = openFn.indexOf('linkUtil.openPath(')
  const webIdx = openFn.indexOf('linkUtil.isWebUrl(')
  assert.ok(openIdx > -1,
    '站内路径（含分包 /pkg-xxx/pages/...）要交给 utils/link.openPath 直接进，不能塞进 webview')
  assert.ok(webIdx > -1, '外链判定要走 utils/link.isWebUrl，别各处再写一套正则')
  assert.ok(openIdx < webIdx,
    'openPath 必须排在 webview 兜底分支之前，否则站内路径会被 webview 抢先接管')
  assert.ok(openFn.indexOf("indexOf('/pages/')") === -1,
    '不得再自己判定 /pages/ 前缀：分包路径会被漏判成外链，直接复制到剪贴板')
  // 口径⑥：只有 copyText 的卡片不能点了没反应
  assert.ok(openFn.indexOf('copyText') > -1,
    '只剩 copyText 的卡片（如「添加墙墙微信」）必须走复制兜底，否则按钮点了没反应')
}, '弹窗跳转与兜底')

// ===== ④b 放大态 = 深色满屏查看器（口径对齐微信图片查看器）=====
// 用户 2026-10-08 实测：点「点击可放大」后得到的是「白底满屏 + 顶部标题被状态栏压住 +
// 底部露出 tabbar 与页面内容」，期望的是「深色满屏、只留二维码大图、零 UI」。
// 本组锁住三件事，每件都是「改回去不报错、只在端上显示旧观感」的静默失效：
//   ① 放大态隐藏整条标题栏；② 不得用 height:100vh（fixed 包含块不含自定义 tabbar）；
//   ③ 放大态没有关闭按钮 → 「点弹层任意处」必须真的收起。
// 两处实现（pages/push-groups 与 components/contact-admin）必须同款。
check(() => {
  const ADMIN_WXML = read('components/contact-admin/contact-admin.wxml')
  const ADMIN_WXSS = read('components/contact-admin/contact-admin.wxss')
  const ADMIN_JS = read('components/contact-admin/contact-admin.js')
  const VIEWS = [
    { label: 'pages/push-groups', wxml: LIST_WXML, wxss: LIST_WXSS, js: LIST_JS, sel: '.qr-dialog.is-expanded', selFull: '.qr-img.is-full' },
    { label: 'components/contact-admin', wxml: ADMIN_WXML, wxss: ADMIN_WXSS, js: ADMIN_JS, sel: '.contact-admin-qr-dialog.is-expanded', selFull: '.contact-admin-qr.is-full' },
  ]

  VIEWS.forEach((v) => {
    // ① 放大态隐藏整条标题栏（否则顶部残留标题/提示，且文案会变成自相矛盾的「点击可缩小」）
    //    先剥注释：注释里会解释「为什么放大态要隐藏标题栏」，直接扫全文会被自己的注释满足
    const headOpen = (v.wxml.replace(/<!--[\s\S]*?-->/g, '')
      .match(/<view[^>]*class="[^"]*qr-head"[^>]*>/) || [''])[0]
    assert.ok(headOpen.indexOf('wx:if="{{!qrExpanded}}"') > -1,
      v.label + ' 的二维码标题栏必须带 wx:if="{{!qrExpanded}}"：放大态要零 UI，只留二维码大图')

    // ② 高度必须分两行写（标准 CSS 回退）：先按视口铺满兜底，再用 calc 往下撑出 tabbar 的高度。
    //    position:fixed 的包含块是「页面视口」，它不含自定义 tabbar（tabbar 在页面流底部，
    //    104rpx + 安全区），只铺 100vh 会在底部漏出 tabbar 与页面内容（用户实测现象）。
    const rule = cssRule(v.wxss, v.sel)
    assert.ok(rule, v.label + ' 找不到 ' + v.sel + ' 规则体')
    assert.ok(/height:\s*calc\([^;]*104rpx/.test(rule),
      v.label + ' 放大态要用 calc 把面板高度撑出 tabbar 的高度（104rpx + 安全区），否则盖不住 tabbar')
    assert.ok(/height:\s*100vh/.test(rule),
      v.label + ' 放大态的 calc 高度前要留 height:100vh 兜底行：env/calc 不生效时也不能塌成窄带')
    assert.ok(!/height:\s*auto/.test(rule),
      v.label + ' 放大态不得用 height:auto（图片是 height:0 + flex:1，撑不起 auto 高度，会塌成只剩 padding）')
    // 2026-10-08 用户实测回归：width:auto 靠 left/right 拉伸会收缩成一条窄带（「弹窗变形错位」）
    assert.ok(/width:\s*100vw/.test(rule),
      v.label + ' 放大态要用 width:100vw 显式铺满，别用 width:auto 靠 left/right 拉伸（实测会收缩成窄条）')
    assert.ok(/background:\s*#000/i.test(rule),
      v.label + ' 放大态要压成深色底（对齐微信图片查看器的观感）')
    assert.ok(/padding:\s*calc\([^)]*safe-area-inset-top/.test(rule),
      v.label + ' 放大态要留出状态栏安全区，否则内容会顶进状态栏')

    // ③ 放大态没有关闭按钮，退出只能靠「点弹层任意处」→ stopPropagation 必须在放大态收起。
    //    断言调用表达式本身：挂到注释或永不进入的分支里，子串仍在、断言照样通过（假绿灯）
    const body = functionBody(v.js, 'stopPropagation')
    assert.ok(body, v.label + ' 找不到 stopPropagation 函数体')
    assert.ok(/this\.setData\(\s*\{\s*qrExpanded:\s*false\s*\}\s*\)/.test(body),
      v.label + ' 的 stopPropagation 必须在放大态收起（this.setData({ qrExpanded: false })）：放大态没有关闭按钮，点任意处是唯一出口')

    // ④ 遮罩的放大态类要与 wxml 对得上（漏挂就是白底漏光）
    //    ⚠ 别写 indexOf('.is-zoom')：改成 .is-zoom-x 仍含该子串 → 空判据
    assert.ok(/\.is-zoom\s*\{/.test(v.wxss), v.label + ' 缺放大态的遮罩样式 .is-zoom')
    assert.ok(v.wxml.indexOf("'is-zoom'") > -1, v.label + ' 的遮罩要在放大态挂 is-zoom')

    // ⑤ 图片点击必须是 catchtap。放大态弹层整层绑了 catchtap="stopPropagation"（点任意处退出放大），
    //    图片若用 bindtap 会冒泡上去 → 刚放大就被同一层立刻收起，端上表现成「点击后无法放大」
    //    （2026-10-08 用户实测的回归，两处实现都犯过）。剥注释再扫：注释里会解释为什么不能用 bindtap。
    const imgTags = (v.wxml.replace(/<!--[\s\S]*?-->/g, '')
      .match(/<image[^>]*toggleQrZoom[^>]*>/g) || []).join('')
    assert.ok(imgTags.indexOf('catchtap="toggleQrZoom"') > -1,
      v.label + ' 的二维码图必须用 catchtap="toggleQrZoom"：bindtap 会冒泡到弹层的退出逻辑')
    assert.ok(imgTags.indexOf('bindtap="toggleQrZoom"') === -1,
      v.label + ' 不得用 bindtap="toggleQrZoom"：刚放大就会被弹层的 stopPropagation 立刻收起')

    // ⑥ 放大态必须临时隐藏自定义 tabBar —— 它由框架渲染在页面内容之上（官方推荐用
    //    cover-view 保证层级；本项目是普通 view，同样在页面之上），z-index 再高也盖不住，
    //    否则放大后底部永远露一条白 tabBar（用户实测）。hidden 字段见 custom-tab-bar。
    const zoomBody = functionBody(v.js, 'toggleQrZoom')
    assert.ok(zoomBody.indexOf('setTabBarHidden(') > -1,
      v.label + ' 的 toggleQrZoom 必须调 setTabBarHidden(...)：自定义 tabBar 层级高于遮罩，放大态要整块隐藏')
    const hideFn = functionBody(v.js, 'setTabBarHidden')
    assert.ok(hideFn, v.label + ' 缺 setTabBarHidden 方法')
    assert.ok(hideFn.indexOf('getTabBar') > -1,
      v.label + ' 的 setTabBarHidden 必须走页面实例的 getTabBar()（每个 tab 页的 tabBar 是独立实例）')
    assert.ok(/if\s*\(\s*tabBar/.test(hideFn),
      v.label + ' 的 setTabBarHidden 必须判空：非 tab 页 getTabBar() 返回 undefined')
    assert.ok(hideFn.indexOf('setData(') > -1,
      v.label + ' 的 setTabBarHidden 必须真的 setData({ hidden })')
    // ⚠ 恢复点漏一个 = 那个 tab 页的 tabBar 永久消失
    assert.ok(functionBody(v.js, 'stopPropagation').indexOf('setTabBarHidden(false)') > -1,
      v.label + ' 的 stopPropagation 收起放大时必须恢复 tabBar（漏了 = tabBar 永久消失）')
    assert.ok(functionBody(v.js, 'closeQr').indexOf('setTabBarHidden(false)') > -1,
      v.label + ' 的 closeQr 必须恢复 tabBar（漏了 = tabBar 永久消失）')

    // ⑧ 放大态的图片必须真的居中 —— 基类有 max-width: 560rpx（≈400px），且靠
    //    margin: 24rpx auto 0 里的 auto 水平居中；.is-full 覆盖 margin 时写成 0 会把
    //    居中一起干掉，不覆盖 max-width 则宽度被卡住。2026-10-08 实测：538px 屏宽下
    //    卡片只占 413px、偏左 63px（用户报「没有居中」）。
    const fullRule = cssRule(v.wxss, v.selFull)
    assert.ok(fullRule, v.label + ' 找不到 ' + v.selFull + ' 规则体')
    assert.ok(/max-width:\s*none/.test(fullRule),
      v.label + ' 放大态图片必须覆盖基类 max-width:560rpx，否则宽度被卡住、看起来没居中')
    assert.ok(/margin:\s*0\s+auto/.test(fullRule),
      v.label + ' 放大态图片的 margin 要保留 auto（水平居中）：写成 margin:0 会靠左贴边')
  })

  // ⑦ custom-tab-bar 必须真的支持 hidden（否则 setData({ hidden: true }) 是空操作）
  const TABBAR_JS = read('custom-tab-bar/index.js')
  const TABBAR_WXML = read('custom-tab-bar/index.wxml')
  assert.ok(/hidden:\s*false/.test(TABBAR_JS),
    'custom-tab-bar 的 data 要有 hidden:false 默认值，否则 setData({ hidden:true }) 不生效')
  assert.ok(TABBAR_WXML.indexOf('wx:if="{{!hidden}}"') > -1,
    'custom-tab-bar 根节点要绑 wx:if="{{!hidden}}"：只在 data 里加 hidden 而不绑 wxml 等于没做')
}, '放大态 = 深色满屏查看器')

// ===== ⑤ 后端两头字段齐备 =====
check(() => {
  const parse = CTRL.slice(CTRL.indexOf('function parsePushGroup'), CTRL.indexOf('PUSH_GROUP_DEFAULTS'))
  assert.ok(parse.indexOf('content:') > -1 && parse.indexOf('images:') > -1,
    'parsePushGroup 要回吐 content 与 images，否则后台回填永远为空、保存一次就把正文抹掉')
  const build = CTRL.slice(CTRL.indexOf('function buildPushGroupPayload'), CTRL.indexOf('exports.createPushGroup'))
  assert.ok(build.indexOf('PUSH_GROUP_CONTENT_MAX') > -1, '正文要有长度上限校验')
  assert.ok(/const PUSH_GROUP_CONTENT_MAX = \d+/.test(CTRL), 'PUSH_GROUP_CONTENT_MAX 未定义')
  assert.ok(/const PUSH_GROUP_IMAGE_MAX = 3/.test(CTRL), '配图上限应为 3 张')
  assert.ok(build.indexOf('isHttpsUrl') > -1 && build.indexOf('PUSH_GROUP_IMAGE_MAX') > -1,
    '配图必须过滤非 https 并按上限截断')
  assert.ok(/JSON\.stringify\(\{[^}]*content[^}]*images/.test(build),
    'content / images 必须写进 body JSON，否则存了等于没存')
}, '后端字段与校验')

// ===== ⑥ 后台表单（本轮用户明确「先不改」，故只守回归） =====
check(() => {
  assert.ok(EDIT_WXML.indexOf('data-key="title"') > -1, '后台卡片标题输入缺失')
  assert.ok(EDIT_WXML.indexOf('addImages') > -1 && EDIT_WXML.indexOf('removeImage') > -1,
    '后台缺少配图上传/移除入口（二维码就存在配图第 1 张，入口没了就配不了二维码）')
  assert.ok(EDIT_WXML.indexOf('form.images.length < 3') > -1, '配图上传按钮应按 3 张上限隐藏')
  assert.ok(EDIT_WXML.indexOf('data-key="link"') > -1, '后台跳转链接输入缺失（弹窗主按钮要用）')
  assert.ok(EDIT_WXML.indexOf('<richtext-editor data-key="content"') > -1, '后台卡片正文未接入编辑器')
  // pushGroup 表单是扁平结构（chooseFormImage 对该表单写 form.iconPath），
  // 缩略图/清除按钮一旦读成 form.meta.iconPath 就永远不显示，上传完看不到也删不掉
  const blockStart = EDIT_WXML.indexOf("<block wx:elif=\"{{scope === 'pushGroup'}}\">")
  assert.ok(blockStart > -1, '找不到卡片表单区块')
  const pushBlock = EDIT_WXML.slice(blockStart, EDIT_WXML.indexOf('</block>', blockStart))
  assert.ok(pushBlock.indexOf('form.meta.') === -1,
    '卡片表单里没有 form.meta，图标/配图必须绑扁平的 form.iconPath 与 form.images')
  // 新建默认值 + 编辑回填 + 提交载荷（已收敛到编辑页的按 scope 分支）
  const pgDef = EDIT_JS.lastIndexOf('async _loadPushGroupForm')
  const loadFn = EDIT_JS.slice(pgDef, EDIT_JS.indexOf('async _loadChatGroupForm', pgDef))
  assert.ok(loadFn.indexOf('images: []') > -1,
    '新建表单默认值缺 images，setData 局部更新会踩到 undefined')
  assert.ok(loadFn.indexOf('row.images') > -1, '编辑回填缺 images')
  assert.ok(EDIT_JS.indexOf('images: Array.isArray(form.images)') > -1, '提交载荷没带 images')
}, '后台表单接线')

// 全站通用开关与卡片自己的开关同时出现 = 两个 switch 绑同一个 form.status
{
  const generic = EDIT_WXML.split('\n').filter((line) => line.indexOf('启用状态（关闭即对用户下线）') > -1)
  const own = EDIT_WXML.split('\n').filter((line) => line.indexOf('启用状态（关闭即对用户隐藏）') > -1)
  check(() => {
    assert.strictEqual(generic.length, 1, '通用启用开关应只有一条，实际 ' + generic.length + ' 条')
    assert.ok(generic[0].indexOf("scope !== 'pushGroup'") > -1,
      '通用启用开关未排除 pushGroup：卡片表单会出现两个绑同一个 form.status 的开关')
    assert.strictEqual(own.length, 1, '卡片自己的启用开关应只有一条')
  }, '启用状态开关不重复')
}

console.log(testCount + ' tests passed.')
