/**
 * 管理后台「群聊编辑」表单测试（无需数据库 / 无需真机）
 *
 * 背景：群聊编辑表单原先只有名称/类别/校区/介绍/头像/二维码/排序等基础字段，
 *      缺少群公告、群成员与进群权限，且没有表单校验与取消确认。
 *      本次补齐字段（notice / owner_name / member_count / join_mode / need_audit）
 *      并补上校验与交互，测试覆盖三层：
 *
 *   A. 控制器：新字段能落库、非法值被拦下、更新时只提交改动的字段
 *   B. 用户端群详情：进群方式文案各分支正确，且「扫码进群但没传二维码」时整块不渲染
 *   C. 源码护栏：迁移列、后台表单结构、用户端展示位，避免后续改动把字段漏掉
 */
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
    console.error('FAILED:', message || err.message)
    throw err
  }
}

// =====================================================================
// A. 控制器：新字段落库与校验（桩 pool）
// =====================================================================
const POOL_PATH = require.resolve('../config/pool')
const captured = []
// 只关心写库语句：INSERT 返回 insertId、UPDATE 返回 affectedRows，
// 其余（审计日志等）返回空结果集，避免真的连数据库。
async function defaultQuery(sql, params) {
  captured.push({ sql, params: params || [] })
  const head = String(sql).trim().slice(0, 6).toUpperCase()
  if (head === 'INSERT') return [{ insertId: 99, affectedRows: 1 }, []]
  if (head === 'UPDATE') return [{ affectedRows: 1 }, []]
  return [[], []]
}
const fakePool = { query: defaultQuery }
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
const controller = require('../controllers/groupChatController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

function makeReq(body) {
  return { params: {}, body: body || {}, query: {}, userId: 1, ip: '127.0.0.1' }
}

const FULL_BODY = {
  name: '惠州老乡群',
  category: '老乡群',
  campus: '佛山校区',
  intro: '为所有对桌游感兴趣的同学提供尽可能完整的桌游体验',
  notice: '进群请先改备注为「年级-专业-昵称」',
  ownerName: '桌游社-小林',
  memberCount: 236,
  joinMode: 'admin',
  needAudit: 1,
  avatarUrl: 'https://payun01.cn/uploads/avatar.jpg',
  qrcodeUrl: 'https://payun01.cn/uploads/qr.jpg',
  gzhQrcodeUrl: '',
  images: ['https://payun01.cn/uploads/a.jpg'],
  isOfficial: 1,
  customTag: '合作',
  sortOrder: 3,
  status: 1
}

function lastInsert() {
  return captured.filter((q) => /INSERT INTO group_chat \(apply_id/.test(q.sql)).pop()
}

async function controllerTests() {
  // A1. 全字段创建：新列出现在 INSERT 且参数顺序正确
  {
    captured.length = 0
    const res = makeRes()
    await controller.createGroup(makeReq(FULL_BODY), res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '创建群聊应成功：' + JSON.stringify(res.body))
    }, '创建群聊接口')

    const insert = lastInsert()
    check(() => {
      assert.ok(insert, '应执行群聊 INSERT')
      assert.match(insert.sql, /intro, notice, owner_name, member_count, join_mode, need_audit,/, 'INSERT 应包含新列')
    }, 'INSERT 含群公告与成员权限列')

    check(() => {
      // 列顺序：apply_id(NULL), name, category, intro, notice, owner_name, member_count,
      //          join_mode, need_audit, images, avatar_url, qrcode_url, gzh_qrcode_url,
      //          is_official, custom_tag, campus, sort_order, status
      assert.deepStrictEqual(insert.params.slice(0, 8), [
        '惠州老乡群', '老乡群',
        '为所有对桌游感兴趣的同学提供尽可能完整的桌游体验',
        '进群请先改备注为「年级-专业-昵称」', '桌游社-小林', 236, 'admin', 1
      ])
      assert.strictEqual(insert.params[14], '佛山校区', 'campus 应写入')
      assert.strictEqual(insert.params[13], '合作', 'custom_tag 应写入')
      assert.strictEqual(insert.params[16], 1, 'status 应写入')
      assert.strictEqual(insert.params.length, 17, '参数个数应与占位符一致')
    }, '新字段按列顺序写入')
  }

  // A2. 非法值必须被拦下，且不产生写库语句
  const invalidCases = [
    [{ joinMode: 'wechat' }, '进群方式取值不正确'],
    [{ memberCount: 1.5 }, '群成员数需为 0 - 100000 之间的整数'],
    [{ memberCount: -1 }, '群成员数需为 0 - 100000 之间的整数'],
    [{ memberCount: 200000 }, '群成员数需为 0 - 100000 之间的整数'],
    [{ notice: 'a'.repeat(501) }, '群公告需在 500 字以内'],
    [{ ownerName: 'a'.repeat(33) }, '群主昵称需在 32 字以内']
  ]
  for (const [patch, expected] of invalidCases) {
    captured.length = 0
    const res = makeRes()
    await controller.createGroup(makeReq(Object.assign({}, FULL_BODY, patch)), res)
    check(() => {
      assert.strictEqual(res.body.code, 400, '非法值应返回 400：' + JSON.stringify(res.body))
      assert.strictEqual(res.body.message, expected)
      assert.strictEqual(lastInsert(), undefined, '非法值不应写库')
    }, '校验拦截：' + expected)
  }

  // A3. 合法边界：成员数 0 与上限、空公告都允许
  {
    captured.length = 0
    const res = makeRes()
    await controller.createGroup(makeReq(Object.assign({}, FULL_BODY, { memberCount: 100000, notice: '', joinMode: 'invite' })), res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '边界值应通过：' + JSON.stringify(res.body))
      const insert = lastInsert()
      assert.strictEqual(insert.params[5], 100000)
      assert.strictEqual(insert.params[6], 'invite')
      assert.strictEqual(insert.params[3], '', '空公告应写入空串')
    }, '边界值通过：成员数上限与空公告')
  }

  // A4. 更新：只提交改动字段（partial），且不误写其他列
  {
    captured.length = 0
    const res = makeRes()
    await controller.updateGroup(
      Object.assign(makeReq({ notice: '新的群公告', needAudit: 0 }), { params: { id: '9' } }),
      res
    )
    check(() => {
      assert.strictEqual(res.body.code, 200, '更新应成功：' + JSON.stringify(res.body))
      const update = captured.find((q) => /UPDATE group_chat SET \? WHERE id = \?/.test(q.sql))
      assert.ok(update, '应执行 UPDATE')
      assert.deepStrictEqual(Object.keys(update.params[0]).sort(), ['need_audit', 'notice'])
      assert.strictEqual(update.params[1], 9)
    }, '更新只提交改动字段')
  }

  // A5. 空更新体必须报错，避免生成非法 SQL
  {
    captured.length = 0
    const res = makeRes()
    await controller.updateGroup(Object.assign(makeReq({}), { params: { id: '9' } }), res)
    check(() => {
      assert.strictEqual(res.body.message, '没有需要更新的内容')
    }, '空更新体被拦下')
  }

  // A6. mapGroupRow：缺省值兜底（老数据没有新列时不能渲染出 undefined）
  {
    captured.length = 0
    const res = makeRes()
    fakePool.query = async (sql, params) => {
      captured.push({ sql, params: params || [] })
      if (/FROM group_chat g LEFT JOIN/.test(sql)) {
        return [[{ id: 1, name: '老群', status: 1, images: null }]]
      }
      return [[], []]
    }
    await controller.detail({ params: { id: '1' } }, res)
    check(() => {
      const group = res.body.data.group
      assert.strictEqual(group.notice, '')
      assert.strictEqual(group.ownerName, '')
      assert.strictEqual(group.memberCount, 0)
      assert.strictEqual(group.joinMode, 'qrcode', '非法/缺失的 join_mode 应回退到 qrcode')
      assert.strictEqual(group.needAudit, 0)
    }, '详情接口新字段有默认值')
    fakePool.query = defaultQuery
  }
}

// =====================================================================
// B. 用户端群详情：进群方式文案分支（vm 加载真实页面，桩 api）
// =====================================================================
const API_PATH = require.resolve(path.join(ROOT, 'utils', 'api.js'))
let detailPageDef = null
// 详情页在 require 时就把 api 模块绑定进闭包，因此必须复用同一个桩对象、
// 只替换它返回的数据；每次换新对象的话后续用例仍会拿到第一次的返回值。
let apiPayload = {}
const apiStub = { getGroupChatDetail: () => Promise.resolve(apiPayload) }
require.cache[API_PATH] = { id: API_PATH, filename: API_PATH, loaded: true, exports: apiStub }

function loadDetailPage(group, extra) {
  apiPayload = Object.assign({
    group,
    adminQrcodeUrl: (extra && extra.adminQrcodeUrl) || '',
    gzhQrcodeUrl: (extra && extra.gzhQrcodeUrl) || '',
    images: []
  }, extra || {})
  if (!detailPageDef) {
    global.Page = (def) => { detailPageDef = def }
    require(path.join(ROOT, 'pkg-feature', 'pages', 'group-chat', 'detail.js'))
  }
  const page = Object.create(detailPageDef)
  page.data = JSON.parse(JSON.stringify(detailPageDef.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.groupId = 1
  return page
}

async function detailPageTests() {
  const cases = [
    {
      name: '扫码进群 + 有二维码',
      group: { name: '桌游社', qrcodeUrl: 'https://a.com/qr.png', joinMode: 'qrcode', needAudit: 0 },
      expect: (tip) => assert.match(tip, /微信扫码进群/) && assert.doesNotMatch(tip, /审核/)
    },
    {
      name: '扫码进群 + 需审核',
      group: { name: '桌游社', qrcodeUrl: 'https://a.com/qr.png', joinMode: 'qrcode', needAudit: 1 },
      expect: (tip) => assert.match(tip, /等待管理员审核/)
    },
    {
      name: '扫码进群但没传二维码（整块隐藏）',
      group: { name: '桌游社', qrcodeUrl: '', joinMode: 'qrcode', needAudit: 0 },
      expect: (tip) => assert.strictEqual(tip, '')
    },
    {
      name: '加管理员拉群 + 有管理员二维码',
      group: { name: '桌游社', qrcodeUrl: '', joinMode: 'admin', needAudit: 0 },
      extra: { adminQrcodeUrl: 'https://a.com/admin.png' },
      expect: (tip) => assert.match(tip, /管理员微信/)
    },
    {
      name: '加管理员拉群但没有管理员二维码',
      group: { name: '桌游社', qrcodeUrl: '', joinMode: 'admin', needAudit: 1 },
      expect: (tip) => assert.match(tip, /联系群主或管理员申请入群/) && assert.match(tip, /进群需管理员审核/)
    },
    {
      name: '仅群成员邀请',
      group: { name: '桌游社', qrcodeUrl: '', joinMode: 'invite', needAudit: 0 },
      expect: (tip) => assert.match(tip, /仅支持群内成员邀请/)
    },
    {
      name: '老数据缺少 joinMode（按扫码进群兜底）',
      group: { name: '桌游社', qrcodeUrl: 'https://a.com/qr.png' },
      expect: (tip) => assert.match(tip, /微信扫码进群/)
    }
  ]

  for (const item of cases) {
    const page = loadDetailPage(item.group, item.extra)
    await page.loadDetail()
    check(() => {
      assert.ok(page.data.group, item.name + ' 应加载到群详情')
      item.expect(page.data.joinModeTip)
    }, '群详情进群提示：' + item.name)
  }

  // 群主 / 成员数透传到视图（缺省时不产生 undefined）
  {
    const page = loadDetailPage({ name: '桌游社', ownerName: '小林', memberCount: 236 })
    await page.loadDetail()
    check(() => {
      assert.strictEqual(page.data.group.ownerName, '小林')
      assert.strictEqual(page.data.group.memberCount, 236)
    }, '群主与成员数透传')

    const empty = loadDetailPage({ name: '桌游社' })
    await empty.loadDetail()
    check(() => {
      assert.strictEqual(empty.data.group.ownerName, undefined)
      assert.strictEqual(empty.data.group.memberCount, undefined)
    }, '群主与成员数缺省不报错')
  }
}

// =====================================================================
// C. 源码护栏
// =====================================================================
function sourceGuardTests() {
  const migrations = read('server/utils/migrations.js')
  const initSql = read('server/sql/init.sql')
  const adminWxml = read('pkg-admin/admin/index.wxml')
  const adminJs = read('pkg-admin/admin/index.js')
  const adminWxss = read('pkg-admin/admin/index.wxss')
  // 群聊编辑表单已从抽屉迁到独立编辑页
  const editWxml = read('pkg-admin/admin/edit/index.wxml')
  const editJs = read('pkg-admin/admin/edit/index.js')
  const editWxss = read('pkg-admin/admin/edit/index.wxss')
  const detailWxml = read('pkg-feature/pages/group-chat/detail.wxml')

  // 迁移是给存量库补列、init.sql 是全新库建表，两处类型必须一致，
  // 否则新库与老库的列定义会漂移（init.sql 里带 int(11)/引号默认值，这里只比基础类型）
  const columns = [
    ['notice', "VARCHAR(500)", /`notice`\s+varchar\(500\)/i],
    ['owner_name', 'VARCHAR(32)', /`owner_name`\s+varchar\(32\)/i],
    ['member_count', 'INT NOT NULL DEFAULT 0', /`member_count`\s+int\(\d+\)/i],
    ['join_mode', "VARCHAR(16) NOT NULL DEFAULT 'qrcode'", /`join_mode`\s+varchar\(16\)/i],
    ['need_audit', 'TINYINT(1) NOT NULL DEFAULT 0', /`need_audit`\s+tinyint\(1\)/i]
  ]
  for (const [column, definition, initPattern] of columns) {
    check(() => {
      assert.ok(
        migrations.indexOf("ensureColumn('group_chat', '" + column + "',") >= 0,
        'migrations 缺少 group_chat.' + column
      )
      assert.ok(initSql.indexOf('`' + column + '`') >= 0, 'init.sql 缺少 group_chat.' + column)
    }, '迁移与建表包含 ' + column)
    check(() => {
      assert.match(initSql, initPattern, 'init.sql 中 ' + column + ' 的类型与迁移定义不一致')
      // 迁移里的默认值也应体现在建表语句里，避免新库与老库行为不同
      const defaultMatch = definition.match(/DEFAULT\s+('?[\w]+'?)/)
      if (defaultMatch) {
        const columnLine = initSql.split('\n').find((line) => line.indexOf('`' + column + '`') >= 0) || ''
        assert.ok(
          columnLine.toLowerCase().indexOf(defaultMatch[1].toLowerCase()) >= 0,
          'init.sql 中 ' + column + ' 的默认值应为 ' + defaultMatch[1] + '，实际：' + columnLine.trim()
        )
      }
    }, '列定义一致 ' + column)
  }

  const adminFields = [
    ['群聊名称', 'data-key="name"'],
    ['群公告', 'data-key="notice"'],
    ['群主/负责人', 'data-key="ownerName"'],
    ['群成员数', 'data-key="memberCount"'],
    ['进群方式', 'onChatJoinModeChange'],
    ['进群需审核', 'formNeedAudit'],
    ['群头像', 'data-key="avatarUrl"'],
    ['群二维码', 'data-key="qrcodeUrl"'],
    ['公众号二维码', 'data-key="gzhQrcodeUrl"'],
    ['图片介绍', 'data-max="5"']
  ]
  for (const [label, needle] of adminFields) {
    check(() => {
      assert.ok(editWxml.indexOf(needle) >= 0, '后台群聊表单缺少字段：' + label)
    }, '后台表单字段：' + label)
  }

  check(() => {
    // 长表单按四组分区，且分组标题样式存在
    const groups = ['基础信息', '群成员与进群权限', '展示素材', '展示与状态']
    for (const name of groups) {
      assert.ok(editWxml.indexOf('class="form-group-title">' + name) >= 0, '缺少分组标题：' + name)
    }
    assert.ok(editWxss.indexOf('.form-group-title') >= 0, '缺少分组标题样式')
  }, '后台表单分组结构')

  check(() => {
    assert.ok(editJs.indexOf('群成员数只能填写整数') >= 0, '缺少成员数校验')
    assert.ok(editJs.indexOf('进群方式为「扫码进群」时请先上传群二维码') >= 0, '缺少二维码条件必填校验')
    assert.ok(editJs.indexOf('请选择群类别') >= 0, '缺少类别校验')
    assert.ok(editJs.indexOf('请填写群介绍') >= 0, '缺少群介绍校验')
    assert.ok(editJs.indexOf('排序需填写整数') >= 0, '缺少排序校验')
  }, '后台表单校验完整')

  check(() => {
    // 独立编辑页以快照对比实现「未保存修改」拦截（等价于旧抽屉的 installFormSnapshot）
    assert.ok(editJs.indexOf('_saveSnapshot') >= 0 && editJs.indexOf('_snapshot') >= 0, '缺少表单快照钩子')
    assert.ok(editJs.indexOf('放弃修改') >= 0, '取消时缺少未保存修改确认')
    assert.match(editJs, /onCancel\(\)/, '编辑页取消/返回需接入未保存拦截')
  }, '取消操作有未保存修改确认')

  check(() => {
    assert.ok(editWxml.indexOf('campus-grid--triple') >= 0, '校区选项应改用三列网格')
    assert.ok(editWxss.indexOf('.campus-grid--triple') >= 0, '缺少三列网格样式')
  }, '校区三项不再错位')

  check(() => {
    // 独立编辑页把文案收敛到 _saveLabel(scope, id)：群聊新建=创建群聊、编辑=保存修改
    assert.ok(editJs.indexOf("if (scope === 'chatGroup') return id ? '保存修改' : '创建群聊'") >= 0,
      '保存按钮文案未区分新建/编辑')
  }, '保存按钮文案区分新建与编辑')

  check(() => {
    assert.ok(detailWxml.indexOf('{{group.notice}}') >= 0, '用户端未展示群公告')
    assert.ok(detailWxml.indexOf('{{group.ownerName}}') >= 0, '用户端未展示群主')
    assert.ok(detailWxml.indexOf('{{group.memberCount}}') >= 0, '用户端未展示群成员数')
    assert.ok(detailWxml.indexOf('{{joinModeTip}}') >= 0, '用户端未展示进群方式提示')
  }, '用户端群详情展示新字段')
}

async function main() {
  await controllerTests()
  await detailPageTests()
  sourceGuardTests()
  console.log(testCount + ' tests passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Group chat admin form tests failed:', err && err.message)
  process.exit(1)
})
