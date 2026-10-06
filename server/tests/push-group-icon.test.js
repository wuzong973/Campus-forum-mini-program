/**
 * 「信息推送群」卡片图标图片上传测试（无需数据库）
 *
 * 背景（2026-10-02）：后台「信息推送群」编辑表单只支持 emoji / ≤4 字短文本图标，
 * 缺少上传图片的入口。本次给卡片补上 iconPath 字段（存 system_content.body 的 JSON 里），
 * 与 icon 并存、端上优先渲染图片。
 *
 * 覆盖的坑：
 *   ① buildPushGroupPayload 曾把 iconPath 直接丢掉（只写 desc/icon/theme/link/copyText），
 *      上传图片后在用户端永远不显示；
 *   ② iconPath 是非 https 地址时必须拒绝（端上 <image> 加载 http/相对路径会被微信拦掉）；
 *   ③ 老数据没有 iconPath 字段时不得报错、不得清空已有卡片；
 *   ④ 端上图标三态：有图片用图片 → 有 icon 用 icon → 都没有才不渲染。
 *
 * 做法：与 review-module.test.js 一样用假池加载 configController 断言 SQL 与入参，
 * 再静态断言后台/用户端的渲染分支存在。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const MINI_PROGRAM_ROOT = path.join(__dirname, '..', '..')

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

// ===== 假池加载 configController =====
const POOL_PATH = require.resolve('../config/pool')
const fakePool = {
  queries: [],
  queue: [],
  async query(sql, params) {
    fakePool.queries.push({ sql, params: params || [] })
    return fakePool.queue.length ? fakePool.queue.shift() : [[]]
  }
}
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
const configController = require('../controllers/configController')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

// 从写库参数里取出 body(JSON) 并解析，验证 iconPath 真的落到 meta
function writtenMeta() {
  const write = fakePool.queries.find((q) => /INSERT INTO system_content|UPDATE system_content/.test(q.sql))
  assert.ok(write, '应发生写库')
  const raw = /INSERT/.test(write.sql) ? write.params[2] : write.params[1]
  return JSON.parse(raw)
}

async function main() {
  const ICON = 'https://payun01.cn/uploads/aaa-bbb.jpg'

  // 新建卡片：带 iconPath → 必须写进 meta
  {
    fakePool.queries.length = 0
    fakePool.queue = [[{ insertId: 7 }]]
    const res = makeRes()
    await configController.createPushGroup({
      userId: 1,
      body: { title: '点击加入跑腿群', desc: '平台0抽成', icon: '🏃', iconPath: ICON, theme: 'blue' }
    }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '带图片图标的新建应成功')
      const meta = writtenMeta()
      assert.strictEqual(meta.iconPath, ICON, 'iconPath 必须写入 body(JSON)')
      assert.strictEqual(meta.icon, '🏃', '图片与文字图标应并存（端上优先图片）')
    }, '推送群新建写入 iconPath')
  }

  // 编辑卡片：带 iconPath
  {
    fakePool.queries.length = 0
    fakePool.queue = [[{ affectedRows: 1 }]]
    const res = makeRes()
    await configController.savePushGroup({
      userId: 1,
      params: { id: '7' },
      body: { title: '标题', icon: '🧺', iconPath: ICON }
    }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200)
      assert.strictEqual(writtenMeta().iconPath, ICON, '编辑也必须保存 iconPath')
    }, '推送群编辑保存 iconPath')
  }

  // 非法地址：必须拒绝且不写库
  {
    const cases = [
      ['http://payun01.cn/uploads/a.jpg', 'http 非 https 应拒绝'],
      ['/uploads/a.jpg', '相对路径应拒绝'],
      ['javascript:alert(1)', '非 URL 协议应拒绝'],
      ['ftp://a.com/x.jpg', '非 https 协议应拒绝']
    ]
    let rejected = 0
    for (const [value, why] of cases) {
      fakePool.queries.length = 0
      const res = makeRes()
      await configController.createPushGroup({
        userId: 1, body: { title: '标题', icon: 'x', iconPath: value }
      }, res)
      check(() => {
        assert.strictEqual(res.body.code, 400, value + ' → ' + why)
        assert.strictEqual(fakePool.queries.length, 0, value + ' 非法时不得写库')
      }, '推送群图标非法地址拦截：' + value)
      rejected += 1
    }
    check(() => { assert.strictEqual(rejected, cases.length) }, '非法地址用例全部跑到')
  }

  // 超长地址：必须拒绝
  {
    fakePool.queries.length = 0
    const res = makeRes()
    await configController.createPushGroup({
      userId: 1, body: { title: '标题', icon: 'x', iconPath: 'https://a.cn/' + 'a'.repeat(300) + '.jpg' }
    }, res)
    check(() => {
      assert.strictEqual(res.body.code, 400, '超长地址应 400')
      assert.strictEqual(fakePool.queries.length, 0, '拒绝时不得写库')
    }, '推送群图标超长地址拦截')
  }

  // 留空 / 缺字段：必须照常通过（老数据兼容），iconPath 记为 ''
  {
    fakePool.queries.length = 0
    fakePool.queue = [[{ insertId: 8 }]]
    const res = makeRes()
    await configController.createPushGroup({
      userId: 1, body: { title: '老卡片', desc: '旧数据没有 iconPath', icon: '💬' }
    }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '缺 iconPath 不得报错')
      assert.strictEqual(writtenMeta().iconPath, '', '缺字段时 iconPath 应落为空串')
    }, '推送群缺 iconPath 兼容')
  }

  // 读取：iconPath 要透出给端上
  {
    fakePool.queries.length = 0
    fakePool.queue = [
      [[{ total: 1 }]], // seedPushGroupsIfEmpty 的 COUNT
      [[{ id: 7, title: '跑腿群', body: JSON.stringify({ desc: '0抽成', icon: '🏃', iconPath: ICON, theme: 'blue', link: '', copyText: '' }), status: 1, sort_order: 1, updated_at: null }]]
    ]
    const res = makeRes()
    await configController.pushGroups({ user: { role: 'user', id: 1 } }, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(() => {
      assert.strictEqual(res.body.code, 200)
      const card = res.body.data.list[0]
      assert.strictEqual(card.iconPath, ICON, '读取必须透出 iconPath')
      assert.strictEqual(card.icon, '🏃', 'icon 仍应保留')
    }, '推送群读取透出 iconPath')
  }

  // ===== 端上渲染：图标三态 =====
  {
    const wxml = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pages/push-groups/index.wxml'), 'utf8')
    check(() => {
      assert.match(wxml, /item\.iconPath/, '用户端必须渲染 iconPath')
      assert.match(wxml, /card-icon-img/, '图片图标应有独立 class（尺寸/圆角不被文字样式影响）')
    }, '用户端图标三态渲染')
  }

  {
    const adminWxml = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-admin/admin/edit/index.wxml'), 'utf8')
    check(() => {
      assert.match(adminWxml, /chooseFormImage/, '后台必须提供上传图片入口')
      assert.match(adminWxml, /iconPath/, '上传入口必须绑定 iconPath 字段')
    }, '后台图标上传入口')

    const adminJs = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-admin/admin/edit/index.js'), 'utf8')
    check(() => {
      // pushGroup 表单是扁平结构（form.iconPath），其他表单在 form.meta.* —— 必须分支处理，
      // 否则上传后写到 form.meta.iconPath，保存时读到空值 → 静默丢失
      assert.match(adminJs, /pushGroup/, 'chooseFormImage 必须区分 pushGroup 表单')
    }, '后台图标字段写入路径')

    // 入口跳转：后台列表页应把新建/编辑导到独立编辑页
    const listJs = fs.readFileSync(path.join(MINI_PROGRAM_ROOT, 'pkg-admin/admin/index.js'), 'utf8')
    check(() => {
      assert.ok(listJs.indexOf("'/pkg-admin/admin/edit/index?scope=pushGroup'") >= 0,
        '后台列表页未把信息推送群新建/编辑导到独立编辑页')
    }, '后台入口跳转独立编辑页')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Push group icon tests failed:', err.message)
  process.exit(1)
})
