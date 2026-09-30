/**
 * 校园服务 H5 打开能力测试（无需数据库 / 无需真机）
 *
 * 需求：自助购电 / 订水系统 / 教务系统三处内置 H5 网页，让用户能打开。
 * 探测结论（curl 实测）：
 *   订水  https://wx.dingbaoxiaoyuan.com  200 但 X-Frame-Options: DENY → 不可 iframe，
 *         且为 http 站点（https 页 iframe 嵌 http 被混合内容拦截）→ 复制链接微信内打开
 *   购电  http://bd.bdfairy.cn/selectservice 无 https 且依赖微信 OAuth → 复制链接引导
 *   教务  https://jw.gdipu.edu.cn/jsxsd/ 200，但响应头带 X-Frame-Options: SAMEORIGIN
 *         → 禁止被 iframe 内嵌，且该域名非小程序业务域名（无法申请）→ 复制链接引导浏览器打开
 *         （旧方案 payun01.cn/embed.html iframe 内嵌会被浏览器拒绝，只剩空白兜底页）
 * 机制：web-view 业务域名只校验初始 src（payun01.cn 已配），页面内部 iframe 不受限；
 *       webview 中转页对非白名单域名自动「复制链接 + 引导浏览器打开」（现成兜底）。
 *
 * 覆盖：
 *   A. embed.html 白名单含 720yun + 教务域名，iframe + 复制兜底齐备
 *   B. 订水直跳小程序；购电复制链接后在微信内打开
 *   C. schedule-home 教务页底部「教务系统跳转网址」入口与 goJwWebsite 接线
 *   D. deploy 清单含 embed.html
 */
const assert = require('assert')
const path = require('path')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

setTimeout(() => {
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 8000)

function read(p) {
  return require('fs').readFileSync(path.join(MINI_PROGRAM_ROOT, p), 'utf8')
}

function run() {
  // A. embed.html 白名单与兜底
  check(() => {
    const embed = read('web-static/embed.html')
    assert.ok(embed.indexOf("'https://www.720yun.com/'") > -1, '白名单含 720yun 全景')
    assert.ok(
      embed.indexOf("'https://jw.gdipu.edu.cn/jsxsd'") === -1,
      '教务域名已移出白名单（官网 X-Frame-Options: SAMEORIGIN，内嵌必被拦；改走同源反代）',
    )
    assert.ok(embed.indexOf('<iframe') > -1, 'iframe 内嵌')
    assert.ok(embed.indexOf('copyBtn') > -1, '复制链接兜底按钮')
    assert.ok(embed.indexOf('ALLOWED_PREFIXES.some') > -1, '前缀校验防跳板')
  }, 'A. embed.html 白名单（720yun）/iframe/复制兜底齐备')

  // B. 订水/购电均复制链接引导
  check(() => {
    const apiJs = read('utils/api.js')
    assert.ok(apiJs.indexOf("'订水系统': { link: 'http://wx.dingbaoxiaoyuan.com/home' }") > -1, '订水 fallback 为 H5 链接')
    assert.ok(apiJs.indexOf('SERVICE_COPY_LINK_SERVICES') > -1, '订水/购电必须强制走复制链接')
    assert.ok(apiJs.indexOf("'wx87e233f212ca096e'") === -1, '订水不得再配置小程序 AppID')
    assert.ok(apiJs.indexOf("'自助购电': { link: 'http://bd.bdfairy.cn' }") > -1, '购电 fallback 为 http 直链')
    assert.ok(apiJs.indexOf('payun01.cn/services/?service=water') === -1, '不再走被拦的二次跳转中转页')
    assert.ok(apiJs.indexOf('SERVICE_LINK_OVERRIDES') === -1, '购电不应强制改到代理链接')
    const webviewJs = read('pages/webview/index.js')
    assert.ok(webviewJs.indexOf('blockedUrl') > -1 && webviewJs.indexOf('setClipboardData') > -1, 'webview 对非白名单域名自动复制引导')
    assert.ok(webviewJs.indexOf("'payun01.cn'") > -1, 'webview 白名单含自身域名（embed.html 可打开）')
    const indexJs = read('pages/index/index.js')
    // 订水：复制链接 + 微信内打开引导
    assert.ok(indexJs.indexOf("item.name === '订水系统'") > -1, '订水专属跳转分支先于通用 link 分支')
    assert.ok(indexJs.indexOf('该服务需在微信内打开') > -1, '订水应使用复制链接引导')
    // 购电：目标站无 HTTPS 且依赖微信 OAuth，复制链接后微信内打开
    assert.ok(indexJs.indexOf("item.name === '自助购电'") > -1, '首页需有购电专属分支')
    assert.ok(indexJs.indexOf('该服务需在微信内打开') > -1, '购电应使用复制链接引导')
  }, 'B. 订水/购电均复制链接微信内打开')

  // C. 教务页底部入口与接线
  //    官网 X-Frame-Options: SAMEORIGIN + 域名无法申请业务域名 → 经本站同源反代在小程序内打开
  check(() => {
    const homeWxml = read('pkg-schedule/schedule-home/index.wxml')
    assert.ok(homeWxml.indexOf('教务系统跳转网址') > -1, '教务页底部有「教务系统跳转网址」入口')
    assert.ok(homeWxml.indexOf('{{jwWebsiteUrl}}') > -1, '入口展示的地址走统一常量（避免 http / 漏结尾斜杠）')
    assert.ok(homeWxml.indexOf('http://jw.gdipu.edu.cn/jsxsd') === -1, '不得再展示 http 旧地址')
    assert.ok(homeWxml.indexOf('bindtap="goJwWebsite"') > -1, '入口绑定 goJwWebsite')
    const homeJs = read('pkg-schedule/schedule-home/index.js')
    assert.ok(homeJs.indexOf('goJwWebsite') > -1, 'js 实现 goJwWebsite')
    assert.ok(
      homeJs.indexOf('const JW_WEBSITE_URL = "https://jw.gdipu.edu.cn/jsxsd/"') > -1,
      '官网地址为 https 且带结尾斜杠（不带斜杠会 302）',
    )
    assert.ok(
      homeJs.indexOf('const JW_WEBSITE_PROXY_URL = "https://payun01.cn/jsxsd/"') > -1,
      '小程序内打开走本站同源反代（payun01.cn/jsxsd/）',
    )
    assert.ok(homeJs.indexOf('JW_WEBSITE_PROXY_URL || JW_WEBSITE_URL') > -1, '反代置空时回退到复制链接兜底')
    assert.ok(homeJs.indexOf('payun01.cn/embed.html?src=') === -1, '不得再经 embed.html iframe 内嵌（会被 X-Frame-Options 拦）')
    const webviewJs = read('pages/webview/index.js')
    assert.ok(webviewJs.indexOf("'payun01.cn'") > -1, 'web-view 白名单含 payun01.cn（反代页可打开）')
    assert.ok(webviewJs.indexOf("'jw.gdipu.edu.cn'") === -1, 'web-view 白名单不得加教务域名（未配业务域名，直连会被平台拦）')
  }, 'C. 教务页底部入口 + goJwWebsite 经本站同源反代打开官网')

  // D. 部署清单
  check(() => {
    const deploy = read('deploy.py')
    assert.ok(deploy.indexOf('("web-static/embed.html", "embed.html")') > -1, 'deploy 清单含 embed.html')
    assert.ok(deploy.indexOf('vr.html') === -1, '旧 vr.html 条目已移除')
  }, 'D. deploy.py 静态清单含 embed.html')
}

try {
  run()
  console.log(testCount + ' tests passed.')
  process.exit(0)
} catch (err) {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
}
