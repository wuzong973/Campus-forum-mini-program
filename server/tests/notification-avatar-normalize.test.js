/**
 * 头像「读取出口」归一化回归测试（无需数据库）
 *
 * 覆盖的线上现象（微信开发者工具控制台红色报错）：
 *   [渲染层网络层错误] Failed to load image
 *   http://127.0.0.1:53585/__pageframe__/assets/avatar1/考拉(2).jpg
 *
 * 根因：库里仍有重命名前的旧素材路径，且部分接口把快照头像原样下发 ——
 *   `system_notification.actor_avatar` 里的 `/assets/avatar1/老虎 (2).jpg`
 *   （含空格 + 半角括号，真机/开发者工具都解析失败）会直接进消息列表的 <image>；
 *   `private_conversation.peer_avatar` 兜底同理。
 * 修复：通知列表与会话列表在出口统一归一化 ——
 *   1) 旧文件名按改名规则纠正（考拉 (2).jpg → 考拉2.jpg）
 *   2) 纠正后仍不在素材池内的匿名路径 → 稳定映射到池内形象（绝不放行不存在的路径）
 *   3) 匿名形象正则识别、actorUserId 置 0 的行为保持不变（不暴露匿名者）
 */
const assert = require('assert')

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

const { ANONYMOUS_AVATARS } = require('../utils/defaultProfile')

// ===== 桩：数据库 =====
const NOTIFICATION_ROWS = [
  {
    id: 1, type: 'comment', title: '你的帖子有新评论', content: '1', related_id: 5,
    is_read: 0, created_at: '2026-09-06 21:57:53', actor_user_id: 66, actor_nick: '味中的炊烟',
    actor_avatar: '/assets/avatar1/老虎 (2).jpg', post_title: '', comment_images: null,
    actor_real_nick: null, actor_real_avatar: null, related_post_title: '求助',
  },
  {
    id: 2, type: 'like', title: '你的帖子收到了点赞', content: '', related_id: 6,
    is_read: 0, created_at: '2026-09-06 22:00:00', actor_user_id: 70, actor_nick: '普通人',
    // 普通用户头像的旧路径： 1%20(9).jpg → avatar_09.jpg
    actor_avatar: '/assets/avatar2/1%20(9).jpg', post_title: '', comment_images: null,
    actor_real_nick: null, actor_real_avatar: null, related_post_title: '帖子标题',
  },
  {
    id: 3, type: 'comment', title: '你的帖子有新评论', content: '', related_id: 7,
    is_read: 1, created_at: '2026-09-06 22:10:00', actor_user_id: 0, actor_nick: '深夜的山谷',
    // 纠正后仍不在池内的历史脏数据（凭空写进来的路径）
    actor_avatar: '/assets/avatar1/不存在的动物.jpg', post_title: '', comment_images: null,
    actor_real_nick: null, actor_real_avatar: null, related_post_title: '帖子标题',
  },
  {
    id: 4, type: 'comment', title: '你的帖子有新评论', content: '', related_id: 8,
    is_read: 1, created_at: '2026-09-06 22:20:00', actor_user_id: 88, actor_nick: '上传用户',
    // 真实上传的头像（https）必须原样保留
    actor_avatar: 'https://payun01.cn/uploads/abc.jpeg', post_title: '', comment_images: null,
    actor_real_nick: null, actor_real_avatar: null, related_post_title: '帖子标题',
  },
]

const CONVERSATION_ROWS = [
  {
    // 匿名会话但没存分身档案 → 兜底用对方真实头像，且必须是纠正后的路径
    id: 53, peer_id: 66, persona_key: '', unread_count: 2, last_message_text: 'hi',
    last_message_time: '2026-09-11 20:00:00', is_anonymous: 1, anon_peer_identity: null,
    peer_is_anonymous: 0, peer_nick: 'A.Twelve', peer_avatar: '/assets/avatar2/1%20(9).jpg',
  },
  {
    // 存了旧名分身档案 → 昵称头像都取分身，头像纠正为池内新名
    id: 54, peer_id: 67, persona_key: '/assets/avatar1/考拉 (2).jpg', unread_count: 0,
    last_message_text: '你好', last_message_time: '2026-09-11 19:00:00', is_anonymous: 0,
    anon_peer_identity: '{"nickName":"冰冷的冰雹","avatarUrl":"/assets/avatar1/考拉 (2).jpg"}',
    peer_is_anonymous: 1, peer_nick: '你好', peer_avatar: '/assets/avatar2/avatar_39.jpg',
  },
]

const fakePool = {
  async query(sql) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    if (/FROM system_notification n/.test(text)) return [NOTIFICATION_ROWS]
    if (/SELECT COUNT\(\*\) AS total FROM system_notification/.test(text)) return [[{ total: NOTIFICATION_ROWS.length }]]
    if (/FROM private_conversation c LEFT JOIN sys_user u/.test(text)) return [CONVERSATION_ROWS]
    return [[]]
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
// 会话控制器依赖的外部服务（本测试不涉及），用空实现顶掉，避免连真实资源
const WS_PATH = require.resolve('../ws/wsServer')
require.cache[WS_PATH] = {
  id: WS_PATH, filename: WS_PATH, loaded: true,
  exports: { init: () => undefined, sendToUser: () => undefined, broadcast: () => undefined, isOnline: () => false },
}
const SUB_PATH = require.resolve('../services/subscribeService')
require.cache[SUB_PATH] = { id: SUB_PATH, filename: SUB_PATH, loaded: true, exports: {} }

const notificationController = require('../controllers/notificationController')
const messageController = require('../controllers/messageController')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

async function main() {
  // ===== 1) 通知快照头像归一化 =====
  const res = makeRes()
  await notificationController.list({ query: {}, userId: 66 }, res)
  const list = res.body.data.list
  const byId = (id) => list.find((item) => item.id === id)

  check(() => {
    assert.strictEqual(res.body.code, 200, '通知列表应返回成功：' + JSON.stringify(res.body))
    assert.strictEqual(list.length, 4, '应返回全部通知')
  }, '通知列表加载')

  check(() => {
    assert.strictEqual(byId(1).actorAvatar, '/assets/avatar1/老虎2.jpg',
      '「老虎 (2).jpg」应纠正为素材池内真实存在的「老虎2.jpg」')
    assert.ok(ANONYMOUS_AVATARS.indexOf(byId(1).actorAvatar) > -1, '纠正结果必须在素材池白名单内')
    assert.strictEqual(byId(1).actorUserId, 0, '匿名形象头像不返回真实用户 id（防止点进主页暴露身份）')
  }, '匿名旧名纠正')

  check(() => {
    assert.strictEqual(byId(2).actorAvatar, '/assets/avatar2/avatar_09.jpg',
      '普通头像旧路径 1%20(9).jpg 应纠正为 avatar_09.jpg')
  }, '普通头像旧路径纠正')

  check(() => {
    const avatar = byId(3).actorAvatar
    assert.notStrictEqual(avatar, '/assets/avatar1/不存在的动物.jpg', '池外路径不得原样下发')
    assert.ok(ANONYMOUS_AVATARS.indexOf(avatar) > -1, '池外匿名路径应稳定映射到池内形象，实际：' + avatar)
  }, '池外匿名路径稳定映射')

  check(() => {
    assert.strictEqual(byId(4).actorAvatar, 'https://payun01.cn/uploads/abc.jpeg', '真实上传头像应原样保留')
  }, '外链头像不受影响')

  // ===== 2) 会话列表兜底头像归一化 =====
  const convRes = makeRes()
  await messageController.conversations({ userId: 66 }, convRes)
  const convs = convRes.body.data.list
  const conv = (id) => convs.find((c) => c.id === id)

  check(() => {
    assert.strictEqual(convRes.body.code, 200, '会话列表应返回成功：' + JSON.stringify(convRes.body))
    assert.strictEqual(conv(53).peerAvatar, '/assets/avatar2/avatar_09.jpg',
      '无分身档案时兜底的真实头像也必须归一化')
    assert.strictEqual(conv(54).peerAvatar, '/assets/avatar1/考拉2.jpg',
      '分身档案里的「考拉 (2).jpg」应纠正为池内「考拉2.jpg」')
    assert.strictEqual(conv(54).peerNick, '冰冷的冰雹', '昵称仍取分身昵称')
  }, '会话头像归一化')

  // ===== 3) 结构护栏：前端消息页同样的出口也要归一化 =====
  {
    const fs = require('fs')
    const path = require('path')
    const page = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'my-messages', 'index.js'), 'utf8')
    check(() => {
      assert.match(page, /actorAvatar: avatar\.normalizeLegacyAvatar\(item\.actorAvatar/,
        '消息列表的通知头像必须先归一化再上屏')
      assert.match(page, /avatarUrl: avatar\.normalizeLegacyAvatar\(p\.avatarUrl/,
        '蹲贴卡片头像必须先归一化再上屏')
      assert.match(page, /onMsgAvatarError\(/, '通知头像需要加载失败兜底')
      assert.match(page, /onSquatAvatarError\(/, '蹲贴卡片头像需要加载失败兜底')
    }, '前端渲染出口')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('notification avatar normalize tests failed:', err.message)
  process.exit(1)
})
