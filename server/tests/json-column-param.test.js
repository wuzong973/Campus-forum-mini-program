/**
 * JSON 列参数序列化测试（无需数据库）
 *
 * 覆盖的坑（线上真实踩过，2026-09-10）：
 *   mysql2 会把 JSON 列的取值解析成 JS 数组/对象；数组直接当 `?` 参数用会被 mysql2
 *   转义成「逗号分隔的多个值」，一个占位符撑成 N 个值 →
 *   ER_WRONG_VALUE_COUNT_ON_ROW / Column count doesn't match value count at row 1。
 *   表现：migrations 里「补建审核通过申请的群聊记录」每次启动都失败，
 *   群聊审核通过后用户端看不到群聊。详见 docs/03_业务功能_社区与内容.md（§2 社团模块）
 *
 * 另覆盖同批修复的两个行为：
 *   - 群聊审核通过时把申请单的图片介绍同步到群聊（此前漏了 images 列，图片介绍丢失）；
 *   - 自愈补建不再把管理员主动删除过的群聊重新挂回用户端。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

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

const { toJsonColumn } = require('../utils/helpers')

// ===== 1) toJsonColumn 的边界行为 =====
check(() => {
  assert.strictEqual(toJsonColumn(['a', 'b']), '["a","b"]', '数组应序列化为 JSON 字符串')
  assert.strictEqual(toJsonColumn({ nickName: '路人' }), '{"nickName":"路人"}', '对象应序列化为 JSON 字符串')
  assert.strictEqual(toJsonColumn('["a"]'), '["a"]', '已经是字符串时不应重复序列化')
  assert.strictEqual(toJsonColumn(null), null)
  assert.strictEqual(toJsonColumn(undefined), null)
  assert.strictEqual(toJsonColumn(''), null)
}, 'toJsonColumn 边界')

// ===== 2) 群聊审核通过：图片介绍必须同步，且以字符串形式入参 =====
const POOL_PATH = require.resolve('../config/pool')
const captured = []
const applyRow = {
  id: 7,
  name: '新生交流群',
  category: '新生群',
  campus: '佛山校区',
  intro: '欢迎新生',
  // 模拟 mysql2 把 JSON 列解析成数组
  images: ['https://payun01.cn/uploads/a.jpg', 'https://payun01.cn/uploads/b.jpg'],
  avatar_url: 'https://payun01.cn/uploads/cover.jpg',
  qrcode_url: 'https://payun01.cn/uploads/qr.jpg',
  gzh_qrcode_url: ''
}

const fakePool = {
  async query(sql, params) {
    captured.push({ sql, params: params || [] })
    if (/FROM group_chat_apply WHERE id = \?/.test(sql)) return [[applyRow]]
    if (/SELECT id FROM group_chat WHERE apply_id = \?/.test(sql)) return [[]]
    return [[]]
  }
}
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
const groupChatController = require('../controllers/groupChatController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

async function main() {
  {
    captured.length = 0
    const res = makeRes()
    await groupChatController.reviewApply(
      { params: { id: '7' }, body: { action: 'approve' }, userId: 1, ip: '127.0.0.1' },
      res
    )
    check(() => {
      assert.strictEqual(res.body.code, 200, '审核通过应返回成功：' + JSON.stringify(res.body))
    }, '审核通过接口')

    const insert = captured.find((q) => /INSERT INTO group_chat /.test(q.sql))
    check(() => {
      assert.ok(insert, '应执行群聊 INSERT')
      assert.ok(/\(apply_id, name, category, campus, intro, images,/.test(insert.sql), 'INSERT 应包含 images 列')
    }, 'INSERT 含 images 列')

    check(() => {
      // 第 6 个参数是 images（apply_id, name, category, campus, intro, images, ...）
      const imagesParam = insert.params[5]
      assert.strictEqual(typeof imagesParam, 'string', 'images 参数必须是字符串，不能是数组')
      assert.deepStrictEqual(JSON.parse(imagesParam), applyRow.images, '图片介绍应与申请单一致')
    }, 'images 参数已序列化')
  }

  // ===== 3) 自愈补建：不得复活管理员删过的群聊，且 images 先序列化 =====
  {
    const migrationSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
    check(() => {
      const block = migrationSrc.match(/自愈修复：审核通过但未上架群聊[\s\S]*?\n  \}/)
      assert.ok(block, '应能定位到自愈补建代码块')
      assert.doesNotMatch(block[0], /g\.deleted = 0/,
        'JOIN 不应带 deleted = 0：否则管理员主动删除的群聊会在每次启动被复活')
      assert.match(block[0], /LEFT JOIN group_chat g ON g\.apply_id = a\.id\b/)
      assert.match(block[0], /toJsonColumn\(apply\.images\)/,
        '补建时 images 必须经 toJsonColumn 序列化，否则一个占位符撑成 N 个值')
    }, '自愈补建 SQL')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('JSON column param tests failed:', err.message)
  process.exit(1)
})
