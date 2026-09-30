/**
 * 社团详情接口测试（无需数据库）
 *
 * 覆盖 GET /club/detail/:id（clubController.detail）：
 *   按社团唯一标识 id 匹配、只返回上架中的社团、不存在/已下架/已删除一律 404、
 *   创建信息（发起人 + 申请/通过时间）、成员列表（负责人 + 审核管理员）、
 *   近期活动（该发起人发布且审核通过，倒序取前 5 场）、敏感字段不外泄。
 *
 * 做法：用假 require.cache 顶掉 ../config/pool，再 require 真实的 clubController，
 * 既能断言 SQL 文本（约束有没有写），也能断言 SQL 参数与最终响应结构。
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

// ===== 桩数据 =====
const CATEGORIES = [
  { id: 1, slug: 'art', name: '艺术类', color: '#8B5CF6', deleted: 0 },
  { id: 2, slug: 'sport', name: '体育类', color: '#16B364', deleted: 0 }
]

const APPLIES = {
  // 正常申请单：21 号用户发起，1 号管理员审核通过
  // 与 club_apply 真实列一致：头像/二维码/图片介绍只存在申请单里（club 表没有这些列）
  111: {
    id: 111, user_id: 21, club_type: '学生社团', category_id: 1, status: 'approved', review_note: '资料齐全',
    reviewed_by: 1, reviewed_at: '2026-09-10 20:05:00', created_at: '2026-09-10 19:00:00',
    avatar_url: 'https://cdn.example.com/avatar.png',
    qrcode_url: 'https://cdn.example.com/club-qr.png',
    admin_qrcode_url: 'https://cdn.example.com/admin-qr.png',
    gzh_qrcode_url: 'https://cdn.example.com/gzh-qr.png',
    images: JSON.stringify(['https://cdn.example.com/i1.png', 'https://cdn.example.com/i2.png'])
  },
  // 发起人自己就是审核人：成员列表不应出现重复行
  112: {
    id: 112, user_id: 21, club_type: '学生社团', category_id: 2, status: 'approved', review_note: '',
    reviewed_by: 21, reviewed_at: '2026-09-10 20:06:00', created_at: '2026-09-10 19:10:00',
    avatar_url: '', qrcode_url: 'https://cdn.example.com/qr-112.png', admin_qrcode_url: '', gzh_qrcode_url: '', images: null
  },
  // 时间字段用真实 Date 对象（模拟 mysql2 的行为）：接口必须转成本地时区 DATETIME 字符串
  113: {
    id: 113, user_id: 22, club_type: '学生社团', category_id: 1, status: 'approved', review_note: '',
    reviewed_by: 1, reviewed_at: new Date(Date.UTC(2026, 8, 10, 12, 21, 58)), created_at: new Date(Date.UTC(2026, 8, 10, 12, 14, 37)),
    avatar_url: '', qrcode_url: '', admin_qrcode_url: '', gzh_qrcode_url: '', images: null
  }
}

const CLUBS = {
  11: { id: 11, category_id: 1, apply_id: 111, name: '武术社', tags: '武术 · 散打', intro: '晨练传统，多次在校运会开幕式表演。', recruit: '每年 9 月招新', campus: '', status: 1, deleted: 0, created_at: '2026-09-10 20:05:00', updated_at: '2026-09-10 20:05:00' },
  12: { id: 12, category_id: 1, apply_id: 111, name: '已下架社', tags: '', intro: '', recruit: '', campus: '', status: 0, deleted: 0, created_at: '2026-09-10 20:05:00', updated_at: '2026-09-10 20:05:00' },
  13: { id: 13, category_id: 1, apply_id: 111, name: '已删除社', tags: '', intro: '', recruit: '', campus: '', status: 1, deleted: 1, created_at: '2026-09-10 20:05:00', updated_at: '2026-09-10 20:05:00' },
  // 管理端手工创建（createClub）：没有 apply_id，没有发起人
  14: { id: 14, category_id: 2, apply_id: null, name: '手工建社', tags: '', intro: '后台直接创建', recruit: '', campus: '广州校区', status: 1, deleted: 0, created_at: '2026-09-10 20:10:00', updated_at: '2026-09-10 20:10:00' },
  15: { id: 15, category_id: 2, apply_id: 112, name: '自审社', tags: '', intro: '发起人即审核人', recruit: '', campus: '', status: 1, deleted: 0, created_at: '2026-09-10 20:06:00', updated_at: '2026-09-10 20:06:00' },
  // 申请单时间是 Date 对象的社团：验证 DATETIME 被转成本地时区字符串
  16: { id: 16, category_id: 1, apply_id: 113, name: '时区社', tags: '', intro: '验证时间序列化', recruit: '', campus: '', status: 1, deleted: 0, created_at: new Date(Date.UTC(2026, 8, 10, 12, 21, 58)), updated_at: new Date(Date.UTC(2026, 8, 10, 12, 21, 58)) }
}

const USERS = [
  { id: 21, nick_name: '阿武', avatar_url: '', phone: '13800000000', openid: 'o_should_not_leak', real_name: '武某某' },
  { id: 1, nick_name: '管理员', avatar_url: 'https://cdn.example.com/a.png', phone: '13900000000', openid: 'o_admin', real_name: '管某某' },
  { id: 22, nick_name: '时间君', avatar_url: '', phone: '13700000000', openid: 'o_clock', real_name: '时某某' }
]

// 6 场活动：验证「只取审核通过 + 未下线」与「倒序取前 5 场」
const ACTIVITIES = [
  { id: 101, user_id: 21, title: '晨练打卡', activity_start: '2026-09-01 07:00:00', activity_end: '2026-09-01 08:00:00', location: '田径场', campus: '广州校区', cover_url: '', capacity: 30, signup_count: 12, status: 1, deleted: 0, audit_status: 'approved' },
  { id: 102, user_id: 21, title: '散打体验课', activity_start: '2026-09-03 19:00:00', activity_end: '2026-09-03 20:30:00', location: '体育馆', campus: '', cover_url: 'https://cdn.example.com/c.png', capacity: 20, signup_count: 20, status: 1, deleted: 0, audit_status: 'approved' },
  { id: 103, user_id: 21, title: '双节棍集训', activity_start: '2026-09-05 19:00:00', activity_end: '2026-09-05 21:00:00', location: '风雨操场', campus: '', cover_url: '', capacity: 0, signup_count: 7, status: 1, deleted: 0, audit_status: 'approved' },
  { id: 104, user_id: 21, title: '校运会表演彩排', activity_start: '2026-09-08 16:00:00', activity_end: '2026-09-08 18:00:00', location: '主操场', campus: '', cover_url: '', capacity: 50, signup_count: 31, status: 1, deleted: 0, audit_status: 'approved' },
  { id: 105, user_id: 21, title: '太极养生课', activity_start: '2026-09-09 07:30:00', activity_end: '2026-09-09 08:30:00', location: '图书馆前', campus: '', cover_url: '', capacity: 40, signup_count: 3, status: 1, deleted: 0, audit_status: 'approved' },
  { id: 106, user_id: 21, title: '期末汇报演出', activity_start: '2026-09-10 19:00:00', activity_end: '2026-09-10 21:00:00', location: '大礼堂', campus: '', cover_url: '', capacity: 100, signup_count: 88, status: 1, deleted: 0, audit_status: 'approved' },
  // 待审核 / 已下架 / 已删除：都不应出现在近期活动里
  { id: 107, user_id: 21, title: '待审核活动', activity_start: '2026-09-11 19:00:00', activity_end: '', location: '', campus: '', cover_url: '', capacity: 0, signup_count: 0, status: 1, deleted: 0, audit_status: 'pending' },
  { id: 108, user_id: 21, title: '已下架活动', activity_start: '2026-09-12 19:00:00', activity_end: '', location: '', campus: '', cover_url: '', capacity: 0, signup_count: 0, status: 0, deleted: 0, audit_status: 'approved' },
  { id: 109, user_id: 21, title: '已删除活动', activity_start: '2026-09-13 19:00:00', activity_end: '', location: '', campus: '', cover_url: '', capacity: 0, signup_count: 0, status: 1, deleted: 1, audit_status: 'approved' },
  // 别人发布的活动：不应混进该社团
  { id: 110, user_id: 999, title: '别人的活动', activity_start: '2026-09-14 19:00:00', activity_end: '', location: '', campus: '', cover_url: '', capacity: 0, signup_count: 0, status: 1, deleted: 0, audit_status: 'approved' },
  // 时间是 Date 对象的活动（user 22 专属，不干扰 user 21 的用例）
  { id: 120, user_id: 22, title: '时区活动', activity_start: new Date(Date.UTC(2026, 8, 10, 13, 0, 0)), activity_end: null, location: '操场', campus: '', cover_url: '', capacity: 10, signup_count: 2, status: 1, deleted: 0, audit_status: 'approved' }
]

// ===== 桩：数据库 =====
// 按 SQL 里的真实条件过滤，保证断言验的是「接口约束」而不是桩的行为：
// 如果哪天 WHERE 里的 status = 1 / deleted = 0 被删掉，下面的 404 用例就会失败。
const fakePool = {
  queries: [],
  async query(sql, params) {
    const args = params || []
    fakePool.queries.push({ sql, params: args })
    if (/FROM club c\b/.test(sql)) return [selectClubDetail(sql, args)]
    if (/FROM sys_user/.test(sql)) return [selectUsers(args)]
    if (/FROM campus_activity/.test(sql)) return [selectActivities(sql, args)]
    return [[]]
  }
}

function joinedClub(club) {
  const category = CATEGORIES.find((row) => row.id === club.category_id && row.deleted === 0) || null
  const apply = club.apply_id ? APPLIES[club.apply_id] : null
  return Object.assign({}, club, {
    category_name: category ? category.name : null,
    category_slug: category ? category.slug : null,
    category_color: category ? category.color : null,
    club_type: apply ? apply.club_type : null,
    applied_at: apply ? apply.created_at : null,
    approved_at: apply ? apply.reviewed_at : null,
    review_note: apply ? apply.review_note : null,
    // 与 club_apply 同名列：club 表没有这些列，LEFT JOIN 后直接可用
    avatar_url: apply ? apply.avatar_url : null,
    qrcode_url: apply ? apply.qrcode_url : null,
    admin_qrcode_url: apply ? apply.admin_qrcode_url : null,
    gzh_qrcode_url: apply ? apply.gzh_qrcode_url : null,
    images: apply ? apply.images : null,
    creator_id: apply ? apply.user_id : null,
    reviewer_id: apply ? apply.reviewed_by : null
  })
}

function selectClubDetail(sql, args) {
  const id = Number(args[0])
  const club = CLUBS[id]
  if (!club) return []
  if (/c\.deleted = 0/.test(sql) && club.deleted !== 0) return []
  if (/c\.status = 1/.test(sql) && club.status !== 1) return []
  return [joinedClub(club)]
}

function selectUsers(args) {
  const ids = args.map(Number)
  return USERS.filter((user) => ids.indexOf(user.id) >= 0)
}

function selectActivities(sql, args) {
  const userId = Number(args[0])
  const skipDeleted = /a\.deleted = 0/.test(sql)
  const skipDisabled = /a\.status = 1/.test(sql)
  const approvedOnly = /audit_status = 'approved'/.test(sql)
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? Number(limitMatch[1]) : Infinity
  let rows = ACTIVITIES.filter((row) => {
    if (Number(row.user_id) !== userId) return false
    if (skipDeleted && row.deleted !== 0) return false
    if (skipDisabled && row.status !== 1) return false
    if (approvedOnly && row.audit_status !== 'approved') return false
    return true
  })
  rows = rows.slice().sort((a, b) => {
    const aNull = a.activity_start ? 1 : 0
    const bNull = b.activity_start ? 1 : 0
    if (aNull !== bNull) return bNull - aNull
    if (a.activity_start === b.activity_start) return b.id - a.id
    return a.activity_start < b.activity_start ? 1 : -1
  })
  return rows.slice(0, limit)
}

// 用假 pool 顶掉真实连接池后再加载控制器
const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
const clubController = require('../controllers/clubController')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

async function detail(id) {
  const res = makeRes()
  await clubController.detail({ params: { id } }, res)
  return res
}

function lastQuery(pattern) {
  return fakePool.queries.filter((q) => pattern.test(q.sql)).pop()
}

async function main() {
  // ===== 1) 正常社团：基础信息 + 创建信息 + 成员 + 活动 =====
  {
    const res = await detail(11)
    check(() => {
      assert.strictEqual(res.statusCode, 200, '应返回 200')
      assert.strictEqual(res.body.code, 200, '业务码应为 200')
    }, '接口成功')

    const { club, creation, members, activities } = res.body.data
    check(() => {
      assert.strictEqual(club.id, 11)
      assert.strictEqual(club.name, '武术社')
      assert.strictEqual(club.tags, '武术 · 散打')
      assert.strictEqual(club.intro, '晨练传统，多次在校运会开幕式表演。')
      assert.strictEqual(club.recruit, '每年 9 月招新')
      assert.strictEqual(club.campus, '', '空校区 = 全部校区')
      assert.strictEqual(club.categoryName, '艺术类', '应带出所属分类名')
      assert.strictEqual(club.categoryColor, '#8B5CF6', '应带出分类主色用于主题推导')
    }, '社团基础信息')

    // 与「申请创建社团」页同名的字段：头像 / 社团二维码 / 负责人微信 / 公众号二维码 / 图片介绍
    check(() => {
      assert.strictEqual(club.clubType, '学生社团', '社团类型应与申请单一致')
      assert.strictEqual(club.avatarUrl, 'https://cdn.example.com/avatar.png', '社团头像应取自申请单')
      assert.strictEqual(club.qrcodeUrl, 'https://cdn.example.com/club-qr.png', '社团二维码应取自申请单')
      assert.strictEqual(club.adminQrcodeUrl, 'https://cdn.example.com/admin-qr.png', '负责人微信二维码应取自申请单')
      assert.strictEqual(club.gzhQrcodeUrl, 'https://cdn.example.com/gzh-qr.png', '公众号二维码应取自申请单')
      assert.deepStrictEqual(club.images, ['https://cdn.example.com/i1.png', 'https://cdn.example.com/i2.png'],
        '图片介绍应是解析后的 URL 数组（JSON 列字符串/数组都能解析）')
      assert.ok(!('clubType' in res.body.data.creation), 'clubType 只放在 club 上，避免两处不一致')
    }, '申请页同名字段')

    check(() => {
      assert.strictEqual(creation.creator.nickName, '阿武', '应带出发起人')
      assert.strictEqual(creation.appliedAt, '2026-09-10 19:00:00', '应带出申请提交时间')
      assert.strictEqual(creation.approvedAt, '2026-09-10 20:05:00', '应带出审核通过时间')
    }, '创建信息')

    check(() => {
      assert.strictEqual(members.length, 2, '成员应包含负责人与审核管理员')
      assert.deepStrictEqual(members.map((m) => [m.nickName, m.role]),
        [['阿武', '负责人'], ['管理员', '审核管理员']], '成员应带角色标注')
      assert.strictEqual(members[0].avatarUrl, '', '头像缺失时给空串而不是 undefined')
    }, '成员列表')

    check(() => {
      assert.strictEqual(activities.length, 5, '近期活动最多 5 场')
      assert.deepStrictEqual(activities.map((a) => a.id), [106, 105, 104, 103, 102],
        '应按活动开始时间倒序，且排除待审核/已下架/已删除/他人发布的活动')
      assert.strictEqual(activities[0].title, '期末汇报演出')
      assert.strictEqual(activities[0].signupCount, 88, '应带出报名人数')
      assert.strictEqual(activities[0].capacity, 100, '应带出名额上限')
    }, '近期活动')
  }

  // ===== 2) 敏感字段不得外泄 =====
  {
    const res = await detail(11)
    const raw = JSON.stringify(res.body)
    check(() => {
      assert.strictEqual(raw.indexOf('13800000000'), -1, '不得带出用户手机号')
      assert.strictEqual(raw.indexOf('o_should_not_leak'), -1, '不得带出 openid')
      assert.strictEqual(raw.indexOf('武某某'), -1, '不得带出真实姓名')
      // 连字段名都不该出现，避免以后有人"顺手"补上
      assert.doesNotMatch(raw, /"(phone|openid|realName|real_name)"/, '响应体不得包含敏感字段')
    }, '敏感字段不外泄')

    const userQuery = lastQuery(/FROM sys_user/)
    check(() => {
      assert.match(userQuery.sql, /SELECT\s+id,\s*nick_name,\s*avatar_url\s+FROM sys_user/i,
        '查用户时只允许 SELECT id / nick_name / avatar_url')
    }, '查用户只取公开字段')
  }

  // ===== 3) SQL 约束必须写在 WHERE 里（而不是靠调用方过滤）=====
  {
    const query = lastQuery(/FROM club c\b/)
    check(() => {
      assert.match(query.sql, /c\.deleted = 0/, '社团查询必须过滤已删除')
      assert.match(query.sql, /c\.status = 1/, '社团查询必须只取上架中的社团')
      assert.match(query.sql, /LEFT JOIN club_apply/, '应 LEFT JOIN 申请单取创建信息')
      assert.match(query.sql, /a\.avatar_url/, '应从申请单带出社团头像')
      assert.match(query.sql, /a\.admin_qrcode_url/, '应从申请单带出负责人微信二维码')
      assert.match(query.sql, /a\.gzh_qrcode_url/, '应从申请单带出公众号二维码')
      assert.match(query.sql, /a\.images/, '应从申请单带出图片介绍')
      assert.deepStrictEqual(query.params, [11], '参数应为社团 id')
    }, '社团查询约束')

    const actQuery = lastQuery(/FROM campus_activity/)
    check(() => {
      assert.match(actQuery.sql, /a\.deleted = 0/)
      assert.match(actQuery.sql, /a\.status = 1/)
      assert.match(actQuery.sql, /audit_status = 'approved'/, '只展示审核通过的活动')
      assert.match(actQuery.sql, /LIMIT 5/, '近期活动最多取 5 条')
      assert.deepStrictEqual(actQuery.params, [21], '活动按社团发起人过滤（无俱乐部归属表时的推导口径）')
    }, '活动查询约束')
  }

  // ===== 4) 已下架 / 已删除 / 不存在 一律 404 =====
  {
    const disabled = await detail(12)
    check(() => {
      assert.strictEqual(disabled.statusCode, 404, '已下架社团应 404')
      assert.strictEqual(disabled.body.code, 404)
      assert.match(disabled.body.message, /不存在或已下线/)
    }, '已下架 404')

    const deleted = await detail(13)
    check(() => assert.strictEqual(deleted.statusCode, 404, '已删除社团应 404'), '已删除 404')

    const missing = await detail(99999)
    check(() => assert.strictEqual(missing.statusCode, 404, '不存在的 id 应 404'), '不存在 404')

    fakePool.queries.length = 0
    for (const bad of ['abc', '0', '-1', '', undefined, null, '1.5']) {
      const res = await detail(bad)
      check(() => assert.strictEqual(res.statusCode, 404, '非法 id(' + String(bad) + ') 应 404'), '非法 id 404')
    }
    check(() => {
      assert.strictEqual(fakePool.queries.length, 0, '非法 id 不应打到数据库')
    }, '非法 id 不打库')
  }

  // ===== 5) 管理端手工创建（无 apply_id）：媒体字段与成员/活动为空，不报错 =====
  {
    const res = await detail(14)
    check(() => {
      assert.strictEqual(res.statusCode, 200, '手工创建的社团也应能打开详情')
      assert.strictEqual(res.body.data.club.name, '手工建社')
      assert.strictEqual(res.body.data.club.campus, '广州校区')
      assert.strictEqual(res.body.data.club.clubType, '学生社团', '无申请单时社团类型回退默认值')
      assert.strictEqual(res.body.data.club.avatarUrl, '', '无申请单时头像为空串')
      assert.strictEqual(res.body.data.club.qrcodeUrl, '')
      assert.strictEqual(res.body.data.club.adminQrcodeUrl, '')
      assert.strictEqual(res.body.data.club.gzhQrcodeUrl, '')
      assert.deepStrictEqual(res.body.data.club.images, [], '无申请单时图片介绍为空数组')
      assert.strictEqual(res.body.data.creation.creator, null, '没有申请单时发起人为 null')
      assert.deepStrictEqual(res.body.data.members, [], '没有发起人时成员为空数组')
      assert.deepStrictEqual(res.body.data.activities, [], '没有发起人时近期活动为空数组')
    }, '无 apply_id 兜底')
  }

  // ===== 6) 发起人即审核人：成员列表不出现重复行 =====
  {
    const res = await detail(15)
    check(() => {
      assert.strictEqual(res.body.data.members.length, 1, '同一人不应既算负责人又算审核管理员')
      assert.strictEqual(res.body.data.members[0].role, '负责人')
    }, '成员去重')
  }

  // ===== 7) 活动量上限：超过 5 场只回 5 场，且是最近 5 场 =====
  {
    const before = ACTIVITIES.length
    for (let i = 0; i < 8; i++) {
      ACTIVITIES.push({
        id: 200 + i, user_id: 21, title: '加场活动' + i,
        activity_start: '2026-10-' + String(i + 1).padStart(2, '0') + ' 19:00:00',
        activity_end: '', location: '', campus: '', cover_url: '',
        capacity: 10, signup_count: i, status: 1, deleted: 0, audit_status: 'approved'
      })
    }
    const res = await detail(11)
    const acts = res.body.data.activities
    check(() => {
      assert.strictEqual(acts.length, 5, '超过 5 场也只回 5 场')
      assert.strictEqual(acts[0].id, 207, '应取时间最晚的一场')
      assert.strictEqual(acts[4].id, 203, '第 5 条应为倒序第 5 条')
    }, '活动数量上限')
    ACTIVITIES.length = before
  }

  // ===== 8) DATETIME 序列化：Date 对象必须转成本地时区 'YYYY-MM-DD HH:mm:ss' =====
  //     （mysql2 返回 Date → res.json 会序列化成 UTC ISO 串，客户端裁剪会差 8 小时）
  {
    const res = await detail(16)
    const data = res.body.data
    const appliedText = data.creation.appliedAt
    const approvedText = data.creation.approvedAt
    const actStartText = data.activities[0].activityStart
    check(() => {
      assert.match(appliedText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        'appliedAt 应是本地时区 DATETIME 字符串，而不是 ' + appliedText)
      assert.match(approvedText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        'approvedAt 应是本地时区 DATETIME 字符串')
      assert.match(actStartText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        'activityStart 应是本地时区 DATETIME 字符串')
      assert.strictEqual(data.activities[0].activityEnd, null, 'NULL 时间应返回 null 而不是空串/undefined')
    }, '时间字段为本地 DATETIME 字符串')

    // 往返校验（与时区无关）：字符串解析回同一时刻，证明没有丢/偏移时区
    check(() => {
      assert.strictEqual(
        new Date(appliedText.replace(' ', 'T')).getTime(),
        Date.UTC(2026, 8, 10, 12, 14, 37),
        'appliedAt 字符串应表示提交申请的同一时刻')
      assert.strictEqual(
        new Date(approvedText.replace(' ', 'T')).getTime(),
        Date.UTC(2026, 8, 10, 12, 21, 58),
        'approvedAt 字符串应表示审核通过的同一时刻')
      assert.strictEqual(
        new Date(actStartText.replace(' ', 'T')).getTime(),
        Date.UTC(2026, 8, 10, 13, 0, 0),
        'activityStart 字符串应表示活动开始的同一时刻')
    }, '时间往返校验')
  }

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('Club detail endpoint tests failed:', err.message)
  process.exit(1)
})
