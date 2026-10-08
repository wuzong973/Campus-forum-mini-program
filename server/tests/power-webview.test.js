const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message)
    throw err
  }
}

function run() {
  check(() => {
    const app = read('server/app.js')
    assert.ok(app.indexOf('require("./routes/powerProxyRoutes")') > -1, '代理路由未引入')
    assert.ok(app.indexOf('app.use("/api/v1/power", powerProxyRoutes)') > -1, '代理路由未挂载')
    assert.ok(
      app.indexOf('app.use("/api/v1/power", powerProxyRoutes)') < app.indexOf('app.use("/api/v1/*"'),
      '代理路由必须在 API 404 兜底前挂载',
    )
  }, 'A. 服务端挂载购电 HTTPS 代理')

  check(() => {
    const proxy = read('server/routes/powerProxyRoutes.js')
    assert.ok(proxy.indexOf('http://bd.bdfairy.cn') > -1, '代理目标错误')
    assert.ok(proxy.indexOf('COOKIE_PREFIX = "bd_power_"') > -1, '代理 Cookie 必须隔离命名')
    assert.ok(proxy.indexOf('rewriteLocation') > -1, '代理必须重写跳转地址')
    assert.ok(proxy.indexOf('rewriteSetCookie') > -1, '代理必须重写 Set-Cookie')
    assert.ok(proxy.indexOf('injectBaseTag') > -1, 'HTML 需注入 base 地址')
    assert.ok(proxy.indexOf('text\\/html|text\\/css') > -1, '文本重写只允许 HTML/CSS')
    assert.ok(proxy.indexOf('application\\/javascript') === -1, '外部 JS 必须原样透传，避免破坏库代码')
  }, 'B. 代理转发、Cookie 与地址重写齐备')

  check(() => {
    const api = read('utils/api.js')
    assert.ok(api.indexOf("'自助购电': { link: 'http://bd.bdfairy.cn' }") > -1, '购电兜底链接缺失')
    assert.ok(api.indexOf('SERVICE_LINK_OVERRIDES') === -1, '购电不应强制改到代理链接')
  }, 'C. 服务列表保留微信内打开的 HTTP 链接')

  check(() => {
    const index = read('pages/index/index.js')
    const serviceAll = read('pkg-feature/pages/service-all/index.js')
    for (const source of [index, serviceAll]) {
      assert.ok(source.indexOf("item.name === '自助购电'") > -1, '缺少购电专属分支')
      assert.ok(source.indexOf('该服务需在微信内打开') > -1, '缺少复制链接引导')
    }
  }, 'D. 首页/全部服务页使用复制链接引导')

  check(() => {
    const deploy = read('deploy.py')
    assert.ok(deploy.indexOf('("server/routes/powerProxyRoutes.js", "routes/powerProxyRoutes.js")') > -1, '部署清单缺少代理路由')
  }, 'E. 部署清单包含代理路由')
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
