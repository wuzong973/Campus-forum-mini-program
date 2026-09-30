/**
 * 匿名形象路径（/assets/avatar1/）纠正测试（无需数据库）
 *
 * 覆盖用户上报的两条控制台错误之一：
 *   [渲染层网络层错误] Failed to load image .../assets/avatar1/XX%20(2).jpg
 * 聊天页 / 消息详情页 / 用户主页的头像长期图裂并持续刷报错。
 *
 * 根因：素材池里「考拉 (2).jpg」「老虎 (2).jpg」这类含空格与半角括号的文件名在真机上
 * 解析失败，文件已重命名为「考拉2.jpg」「老虎2.jpg」（见 utils/anonymousIdentity.js 注释），
 * 但**库里仍有旧路径存量**，且服务端 parseAnonymousIdentity 过去只校验
 * `startsWith('/assets/avatar1/')`，不校验文件名是否真实存在 —— 任何脏路径都能入库并
 * 一路渲染到 <image>。旧头像归一化只覆盖 avatar2 的 `1 (N).jpg` 形态，不认识 avatar1。
 *
 * 修复后要求：
 *   1) 旧文件名按改名规则纠正（含 %20 编码形态）；
 *   2) 纠正不了的历史脏数据稳定映射到素材池内形象，绝不回落真实资料（否则暴露匿名者）；
 *   3) 常量里的每个路径都必须在包内 assets/avatar1/ 真实存在 —— 这是本次缺陷的形态本身；
 *   4) 服务端各读取出口（评论列表、帖子详情）下发的头像必须都在素材池内。
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

const profile = require('../utils/defaultProfile')

// ===== 1) 旧文件名纠正 =====
check(() => {
  assert.strictEqual(
    profile.normalizeLegacyAvatarUrl('/assets/avatar1/考拉 (2).jpg'),
    '/assets/avatar1/考拉2.jpg',
    '含空格的旧名应纠正为改后的文件名',
  )
  assert.strictEqual(
    profile.normalizeLegacyAvatarUrl('/assets/avatar1/考拉%20(2).jpg'),
    '/assets/avatar1/考拉2.jpg',
    'URL 编码的空格（%20）同样要能纠正 —— 真机报错里就是这种形态',
  )
  assert.strictEqual(
    profile.normalizeLegacyAvatarUrl('/assets/avatar1/老虎%20(2).jpg'),
    '/assets/avatar1/老虎2.jpg',
  )
  assert.strictEqual(
    profile.normalizeLegacyAvatarUrl('/assets/avatar1/熊猫.jpg'),
    '/assets/avatar1/熊猫.jpg',
    '合法路径不应被改动',
  )
}, '旧文件名纠正')

check(() => {
  assert.strictEqual(
    profile.normalizeLegacyAvatarUrl('/assets/avatar2/1 (9).jpg'),
    '/assets/avatar2/avatar_09.jpg',
    'avatar2 的旧路径规则不能被 avatar1 的改动破坏',
  )
  assert.strictEqual(profile.normalizeLegacyAvatarUrl('/assets/avatar2/1.jpg'), '/assets/avatar2/1.jpg')
  assert.strictEqual(profile.normalizeLegacyAvatarUrl(''), '')
}, 'avatar2 规则未回归')

// ===== 2) 素材池白名单 =====
check(() => {
  assert.ok(profile.isAnonymousAvatarUrl('/assets/avatar1/考拉2.jpg'), '池内素材应通过')
  assert.ok(profile.isAnonymousAvatarUrl('/assets/avatar1/熊猫.jpg'))
  assert.ok(!profile.isAnonymousAvatarUrl('/assets/avatar1/态态 (2).jpg'), '不存在的路径不应通过白名单')
  assert.ok(!profile.isAnonymousAvatarUrl('/assets/avatar1/不存在的动物.jpg'))
  assert.ok(!profile.isAnonymousAvatarUrl('https://evil.example.com/a.jpg'), '外链不应通过')
  assert.ok(!profile.isAnonymousAvatarUrl(''), '空值不应通过')
}, '素材池白名单')

check(() => {
  const a = profile.pickAnonymousAvatar('态态')
  const b = profile.pickAnonymousAvatar('态态')
  const c = profile.pickAnonymousAvatar('另一个昵称')
  assert.strictEqual(a, b, '同一昵称必须稳定映射到同一形象（否则每次刷新都换脸）')
  assert.ok(profile.isAnonymousAvatarUrl(a), '稳定映射的结果必须落在素材池内')
  assert.ok(profile.isAnonymousAvatarUrl(c))
}, '稳定映射')

// ===== 3) 常量与包内素材一一对应（本次缺陷的形态本身）=====
check(() => {
  const dir = path.join(__dirname, '..', '..', 'assets', 'avatar1')
  const files = fs.readdirSync(dir)
  const declared = profile.ANONYMOUS_AVATARS.map((url) => url.replace('/assets/avatar1/', ''))
  const missing = declared.filter((name) => files.indexOf(name) === -1)
  assert.deepStrictEqual(missing, [], '素材池里声明了但包内不存在的文件：' + missing.join(', '))
  const unlisted = files.filter((name) => declared.indexOf(name) === -1)
  assert.deepStrictEqual(unlisted, [], '包内有但素材池未声明的文件：' + unlisted.join(', '))
  // 文件名不得含空格与半角括号：真机对这类路径解析不一致，正是本次报错的成因
  const risky = files.filter((name) => /[\s()]/.test(name))
  assert.deepStrictEqual(risky, [], '素材文件名不得含空格或半角括号：' + risky.join(', '))
}, '素材池与包内文件一致')

// 客户端常量与服务端常量必须同源，否则会出现「发出去的合法形象自己校验不通过」
check(() => {
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'avatar.js'), 'utf8')
  const block = client.match(/const ANONYMOUS_AVATARS = \[([\s\S]*?)\]/)
  assert.ok(block, '客户端 utils/avatar.js 应声明 ANONYMOUS_AVATARS')
  const clientList = block[1].match(/'\/assets\/avatar1\/[^']+'/g).map((s) => s.slice(1, -1))
  assert.deepStrictEqual(clientList, profile.ANONYMOUS_AVATARS,
    '客户端与素材池列表必须逐项一致（顺序也无所谓，但内容必须相同）')
}, '两端素材池同源')

// ===== 4) 服务端读取出口必须下发池内路径 =====
const POOL_PATH = require.resolve('../config/pool')
const dirty = JSON.stringify({ nickName: '态态', avatarUrl: '/assets/avatar1/态态 (2).jpg' })
const legacy = JSON.stringify({ nickName: '考拉', avatarUrl: '/assets/avatar1/考拉 (2).jpg' })

const fakePool = {
  async query(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    if (/SELECT COUNT\(\*\) as total FROM forum_comment/.test(text)) return [[{ total: 2 }]]
    if (/FROM forum_comment c LEFT JOIN sys_user u/.test(text)) {
      return [[
        { id: 1, post_id: 9, user_id: 77, content: '历史脏数据', images: null, anonymous_identity: dirty, nick_name: '真实昵称', avatar_url: 'https://payun01.cn/uploads/a.jpg', like_count: 0, is_liked: 0, created_at: '2026-09-11 20:00:00' },
        { id: 2, post_id: 9, user_id: 78, content: '旧文件名', images: null, anonymous_identity: legacy, nick_name: '另一个真实昵称', avatar_url: 'https://payun01.cn/uploads/b.jpg', like_count: 0, is_liked: 0, created_at: '2026-09-11 20:01:00' },
      ]]
    }
    if (/FROM forum_post p LEFT JOIN sys_user u ON p\.user_id = u\.id WHERE p\.id = \?/.test(text)) {
      return [[{
        id: 9, user_id: 88, title: '匿名帖', category: '日常话题', content: 'x', images: null,
        like_count: 0, comment_count: 0, favorite_count: 0, follow_count: 0, share_count: 0, view_count: 0,
        status: 1, pinned: 0, review_note: '', created_at: '2026-09-11 20:00:00',
        anonymous_identity: dirty, nick_name: '真实昵称', avatar_url: 'https://payun01.cn/uploads/c.jpg',
        campus: '南海北校区', is_verified: 0, cert_label: '', allow_anonymous_pm: 1, post_count: 1, components: null, contact: null,
      }]]
    }
    return [[]]
  },
}
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const commentController = require('../controllers/commentController')
const postController = require('../controllers/postController')

function makeRes() {
  return {
    locals: {}, statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function main() {
  // 评论列表：匿名身份必须被纠正为可用路径，且不能被判成「非匿名」而漏出真实资料
  {
    const res = makeRes()
    await commentController.list({ query: { postId: '9' }, userId: 5 }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '评论列表应返回成功：' + JSON.stringify(res.body))
      const list = res.body.data.list
      assert.strictEqual(list.length, 2, '应返回两条评论')

      const broken = list.find((c) => c.nick_name === '态态')
      assert.ok(broken, '成立：昵称保留，说明匿名身份没有被判成 null')
      assert.ok(profile.isAnonymousAvatarUrl(broken.avatar_url),
        '凭空写进来的历史脏路径必须被映射到素材池内形象，实际：' + broken.avatar_url)

      const renamed = list.find((c) => c.nick_name === '考拉')
      assert.strictEqual(renamed.avatar_url, '/assets/avatar1/考拉2.jpg',
        '旧文件名应按改名规则纠正（这是真机报错里的形态）')

      // 最关键的一条：匿名身份绝不能被降级成真实资料，否则等于把匿名者暴露出去
      list.forEach((c) => {
        assert.strictEqual(c.is_anonymous, true, '匿名评论必须仍被视为匿名')
        assert.ok(String(c.nick_name).indexOf('真实昵称') === -1, '不得回落到真实昵称')
        assert.ok(String(c.avatar_url).indexOf('payun01.cn') === -1, '不得回落到真实头像')
      })
    }, '评论列表出口')
  }

  // 帖子详情：mapPost 走同一套匿名解析
  {
    const res = makeRes()
    await postController.detail({ params: { id: '9' }, userId: 5, query: {} }, res)
    check(() => {
      assert.strictEqual(res.body.code, 200, '帖子详情应返回成功：' + JSON.stringify(res.body))
      assert.strictEqual(res.body.data.isAnonymous, true, '匿名帖仍应标记为匿名')
      assert.ok(profile.isAnonymousAvatarUrl(res.body.data.avatarUrl),
        '匿名帖头像必须落在素材池内，实际：' + res.body.data.avatarUrl)
    }, '帖子详情出口')
  }

  // ===== 5) 迁移脚本结构护栏 =====
  {
    const migrations = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
    check(() => {
      assert.match(migrations, /repairAnonymousAvatarPaths\(\)/, '启动迁移应调用匿名形象路径修复')
      assert.match(migrations, /'forum_post', 'anonymous_identity'/, '应修复帖子匿名身份')
      assert.match(migrations, /'forum_comment', 'anonymous_identity'/, '应修复评论匿名身份')
      assert.match(migrations, /'system_notification', 'actor_avatar'/, '应修复通知里的头像快照')
      assert.match(migrations, /'private_conversation', 'persona_key'/, '应修复会话的分身隔离键')
      assert.match(migrations, /toJsonColumn\(value\)/, 'JSON 列写回必须经 toJsonColumn 序列化')
    }, '迁移脚本')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('anonymous avatar path tests failed:', err.message)
  process.exit(1)
})
