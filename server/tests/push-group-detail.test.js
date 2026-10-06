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
 *   ⑤ 「点击此处即可跳转」必须走 webview → web-static/wechat-qr.html 并带 qr/text 参数 ——
 *      小程序内长按只能识别小程序码，个人微信二维码必须进 H5 长按；
 *      且 qr 参数必须是 https（contact-admin 同款校验），否则 H5 拉到空图；
 *   ⑥ 只有 copyText 的卡片（如「添加墙墙微信」）不能让按钮点了没反应；
 *   ⑦ 后端 build/parse 两头都要带 content + images，且 images 只收 https、限 3 张；
 *   ⑧ 后台表单里 pushGroup 自己的「启用状态」开关与全站通用开关不得同时出现。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
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
  assert.ok(LIST_WXML.indexOf('长按二维码保存图片') > -1, '弹窗要有「长按二维码保存图片」副标题（与图一口径一致）')
  assert.ok(LIST_WXML.indexOf('如果是二维码的话长按图片即可识别') > -1, '弹窗底部提示缺失')
  assert.ok(LIST_WXML.indexOf('点击此处即可跳转') > -1, '弹窗主按钮文案应为「点击此处即可跳转」')
  assert.ok(LIST_WXSS.indexOf('.qr-mask') > -1 && LIST_WXSS.indexOf('.qr-dialog') > -1,
    '弹窗的遮罩/面板样式缺失，弹层会渲染成一片没有背景的裸内容')
  assert.ok(LIST_WXSS.indexOf('.qr-btn') > -1, '主按钮样式缺失（绿色圆角按钮）')
}, '弹窗结构')

// ===== ④ 二维码图渲染 + 跳转口径 =====
check(() => {
  assert.ok(LIST_WXML.indexOf('show-menu-by-longpress="{{true}}"') > -1,
    '二维码图要开 show-menu-by-longpress，否则长按没有「保存图片」菜单')
  assert.ok(LIST_WXSS.indexOf('.qr-img') > -1, '二维码图样式缺失')

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
  assert.ok(openFn.indexOf("link.indexOf('/pages/') === 0") > -1,
    '站内 /pages/ 路径要直接进，不能塞进 webview')
  // 口径⑥：只有 copyText 的卡片不能点了没反应
  assert.ok(openFn.indexOf('copyText') > -1,
    '只剩 copyText 的卡片（如「添加墙墙微信」）必须走复制兜底，否则按钮点了没反应')
}, '弹窗跳转与兜底')

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
