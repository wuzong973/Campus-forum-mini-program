// 审查修复回归：P02 / P05 / P09 / P11 / P12 / P13 / P14 / P16 / P18 / P19 / P20 / P21 / P22
// 与 tests/audit-fixes.test.js 同风格：对源码接线做静态断言，防止后续改动把修复悄悄回退。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const read = (...seg) => fs.readFileSync(path.join(__dirname, '..', ...seg), 'utf8')
const readRoot = (...seg) => fs.readFileSync(path.join(__dirname, '..', '..', ...seg), 'utf8')

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`PASS: ${label}`)
}

const uploadCtl = read('controllers', 'uploadController.js')
const errandCtl = read('controllers', 'errandController.js')
const initSql = read('sql', 'init.sql')
const migrations = read('utils', 'migrations.js')

// ---------- P02 上传内容安全 + P14 sharp 缺失兜底 ----------
check('P02 上传按真实文件头校验类型（不再只信 MIME）', () => {
  assert.match(uploadCtl, /function sniffUpload\(/, '应有文件头嗅探函数')
  assert.match(uploadCtl, /function assertRealFile\(/, '应有 MIME 与文件头一致性校验')
  assert.match(uploadCtl, /assertRealFile\(req\.file, 'image'\)/, '图片上传要过真实类型校验')
  assert.match(uploadCtl, /assertRealFile\(req\.file, 'video'\)/, '视频上传要过真实类型校验')
  assert.match(uploadCtl, /file\.filename = path\.basename\(nextPath\)/, '落盘扩展名按真实类型改写')
})

check('P02 视频每日上传配额已生效', () => {
  assert.match(uploadCtl, /const VIDEO_DAILY_LIMIT = /, '应有每日配额常量')
  assert.match(uploadCtl, /exports\.videoDailyQuota = videoDailyQuota/, '应导出配额中间件')
  assert.match(
    read('routes', 'userRoutes.js'),
    /auth, uploadController\.videoDailyQuota, uploadController\.uploadVideoMiddleware/,
    '视频上传路由应挂配额中间件',
  )
})

check('P14 sharp 缺失/压不动时转异步检测而不是直接失败', () => {
  assert.match(uploadCtl, /async function compressForScan\(file\)/, '压缩函数保留')
  assert.match(uploadCtl, /let needsAsyncCheck = false/, 'uploadImage 应有异步兜底分支')
  assert.match(uploadCtl, /mediaCheck\.submit\(\{/, '超大图片提交异步检测')
  assert.match(uploadCtl, /请更换较小的图片/, '本地消费型上传（课表 OCR）仍给出明确报错')
})

check('P02/P14 异步检测服务、回调路由与违规下线齐备', () => {
  const media = read('services', 'mediaCheckService.js')
  assert.match(media, /media_check_async/, '使用微信异步检测接口')
  assert.match(media, /function verifySignature\(/, '回调需验签')
  assert.match(media, /wxa_media_check/, '只处理媒体检测事件')
  assert.match(media, /async function removeMedia\(/, '违规媒体要下线')
  assert.match(media, /function filterStoredImages\(/, '提供读取出口过滤')
  const app = read('app.js')
  assert.match(app, /app\.use\('\/api\/v1\/wechat', require\('\.\/routes\/wechatPushRoutes'\)\)/, '回调路由已挂载')
  // 回调必须注册在全局限流之前，否则微信批量回调会被判失败并持续重推
  assert.ok(
    app.indexOf('/api/v1/wechat') < app.indexOf("app.use(rateLimit({ max: 120 }))"),
    '媒体回调应注册在全局限流之前',
  )
  assert.match(app, /require\("\.\/services\/mediaCheckService"\)\.start\(\)/, '违规地址集合应随服务启动刷新')
  assert.match(read('config', 'cos.js'), /function deleteObject\(/, 'COS 需提供删除能力')
})

check('P02 已判违规的图片地址在读取出口被过滤', () => {
  assert.match(
    read('controllers', 'postController.js'),
    /mediaCheck\.filterStoredImages\(parseImages\(r\.images\)\)/,
    '帖子图片要过滤',
  )
  assert.match(
    read('controllers', 'commentController.js'),
    /images: mediaCheck\.filterStoredImages\(row\.images\)/,
    '评论图片要过滤',
  )
})

// ---------- P05 跑腿 active 状态口径 ----------
// 实现已从单常量 IN_PROGRESS_STATUSES 重构为「公开态 / 交接态」两集合（交接态仅当事人可见，
// 口径比原审计要求更严），SQL 同步参数化（占位符铁律），断言随之更新到新形态。
check('P05 接单大厅 active 含待确认/有异议', () => {
  assert.match(errandCtl, /const PUBLIC_HALL_STATUSES = \['pending', 'accepted'\]/, '公开态集合：待接单/已被接走所有人可见')
  assert.match(errandCtl, /const PRIVATE_STAGE_STATUSES = \['finishing', 'disputed'\]/, '交接态集合：待确认/有异议仅当事人可见')
  const statuses = (errandCtl.match(/const (?:PUBLIC_HALL_STATUSES|PRIVATE_STAGE_STATUSES) = \[([^\]]*)\]/g) || [])
    .flatMap((s) => (s.match(/\[([^\]]*)\]/)[1]).split(',').map((x) => x.trim().replace(/'/g, '')))
  assert.deepStrictEqual(statuses.sort(), ['accepted', 'disputed', 'finishing', 'pending'],
    '两集合并集必须恰好是审计口径四态（不许多也不许少）')
  assert.match(errandCtl, /status === 'active'[\s\S]{0,400}PUBLIC_HALL_STATUSES/, 'active 分支要按集合过滤')
  assert.match(errandCtl, /e\.status IN \('accepted', 'finishing', 'disputed', 'finished'\)/, '订单聊天列表同样覆盖两态')
})

// ---------- P09 消息文本内容安全 ----------
check('P09 文本消息走检测、媒体消息按类型跳过', () => {
  const cs = read('middleware', 'contentSecurity.js')
  assert.match(cs, /function messageTextSecurity\(/, '应导出消息专用安全中间件')
  assert.match(cs, /if \(msgType !== 'text'\) return next\(\)/, '非文本消息跳过文本检测')
  assert.match(cs, /module\.exports\.messageTextSecurity = messageTextSecurity/, '应导出')
  assert.match(read('routes', 'messageRoutes.js'), /'\/send', auth, messageTextSecurity/, '私信发送已接线')
  assert.match(read('routes', 'errandRoutes.js'), /messages', auth, messageTextSecurity/, '跑腿聊天发送已接线')
})

// ---------- P11 私信状态白名单 ----------
check('P11 消息状态只允许对应一方按序推进', () => {
  const msg = read('controllers', 'messageController.js')
  assert.match(msg, /const STATUS_TRANSITIONS = \{/, '应有状态白名单')
  assert.match(msg, /delivered: \{ role: 'receiver', from: \['sent'\] \}/, 'delivered 只由接收方从 sent 推进')
  assert.match(msg, /failed: \{ role: 'sender', from: \['sending', 'sent'\] \}/, 'failed 只由发送方推进')
  assert.ok(
    !/\(sender_id = \? OR receiver_id = \?\) AND status != 'recalled'/.test(msg),
    '不再允许任一方把消息改成任意状态',
  )
})

// ---------- P12 海报失败可见 ----------
check('P12 海报加载/绘制失败有错误态与重试入口', () => {
  const page = readRoot('pages', 'poster', 'index.js')
  assert.match(page, /loadError: ''/, 'data 应有 loadError')
  assert.match(page, /console\.warn\('\[poster\] 加载失败:'/, '详情请求要有 catch')
  assert.match(page, /fail\(message\) \{/, '应有统一失败出口')
  assert.match(page, /retry\(\) \{/, '应提供重试')
  assert.match(page, /console\.warn\('\[poster\] 绘制失败:'/, '绘制异常也收进错误态')
  assert.match(readRoot('pages', 'poster', 'index.wxml'), /bindtap="retry"/, 'WXML 有重试按钮')
  assert.match(readRoot('pages', 'poster', 'index.wxss'), /\.poster-retry-btn/, '错误态按钮有样式')
})

// ---------- P13 活动提醒占位时机 ----------
check('P13 先确认有报名人再写 remind_sent_at', () => {
  const svc = read('services', 'activityReminderService.js')
  const signupAt = svc.indexOf('SELECT user_id FROM activity_signup')
  const claimAt = svc.indexOf('UPDATE campus_activity SET remind_sent_at')
  assert.ok(signupAt > 0, '应查询报名名单')
  assert.ok(claimAt > signupAt, '报名查询必须先于占位更新，无人可提醒时不占位')
})

// ---------- P16 跑腿索引 / P18 init.sql 与迁移一致 ----------
check('P16 跑腿接单方与发布人维度索引', () => {
  assert.match(initSql, /KEY `idx_errand_acceptor` \(`acceptor_id`,`created_at`\)/, 'init.sql 应有 acceptor 索引')
  assert.match(initSql, /KEY `idx_errand_publisher` \(`publisher_id`,`created_at`\)/, 'init.sql 应有 publisher 索引')
  assert.match(migrations, /ensureIndex\('errand_order', 'idx_errand_acceptor'/, '线上库要补 acceptor 索引')
  assert.match(migrations, /ensureIndex\('errand_order', 'idx_errand_publisher'/, '线上库要补 publisher 索引')
})

check('P18 init.sql 补齐迁移独有列', () => {
  assert.match(initSql, /`wechat_id` varchar\(64\)/, 'repair_order.wechat_id 应写进 init.sql')
  assert.match(initSql, /`expected_time` varchar\(64\)/, 'repair_order.expected_time 应写进 init.sql')
  assert.match(initSql, /`remind_sent_at` datetime DEFAULT NULL/, 'campus_activity.remind_sent_at 应写进 init.sql')
})

// ---------- P19 投票明细表 ----------
check('P19 投票写明细表并由唯一键防重复', () => {
  assert.match(initSql, /CREATE TABLE IF NOT EXISTS `forum_poll_vote`/, 'init.sql 应有投票明细表')
  assert.match(initSql, /UNIQUE KEY `uk_poll_vote` \(`post_id`,`poll_index`,`user_id`\)/, '唯一键覆盖帖子+投票+用户')
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS forum_poll_vote/, '迁移应自愈建表')
  const post = read('controllers', 'postController.js')
  assert.match(post, /INSERT INTO forum_poll_vote/, '投票事务内写明细')
  assert.match(post, /e\.code === 'ER_DUP_ENTRY'\) return fail\(res, '你已经投过票了', 400\)/, '唯一键冲突给明确文案')
})

// ---------- P20 回复通知唯一性 ----------
check('P20 同一来源评论只留一条回复通知', () => {
  assert.match(initSql, /UNIQUE KEY `uk_notification_source_comment` \(`source_comment_id`\)/, 'init.sql 应为唯一键')
  assert.match(migrations, /uk_notification_source_comment/, '迁移要清理重复后建唯一键')
  assert.match(migrations, /HAVING COUNT\(\*\) > 1/, '建唯一键前先清理历史重复通知')
  const notif = read('services', 'notificationService.js')
  assert.match(notif, /error\.code === 'ER_DUP_ENTRY'\) return null/, '重复通知插入静默收敛')
})

// ---------- P21 注销后他人通知快照去标识化 ----------
check('P21 注销会抹除他人通知/回复里的身份快照', () => {
  const del = read('services', 'accountDeletionService.js')
  assert.match(
    del,
    /UPDATE system_notification SET actor_user_id = NULL, actor_nick = '已注销用户', actor_avatar = '' WHERE actor_user_id = \?/,
    '通知操作者快照要匿名化',
  )
  assert.match(del, /UPDATE feedback_comment SET reply_to_nick = '已注销用户'/, '意见墙被回复人昵称快照要匿名化')
})

// ---------- P22 计数器双写 + 定期对账 ----------
check('P22 明细真正变更才推进计数器', () => {
  const post = read('controllers', 'postController.js')
  assert.match(post, /INSERT IGNORE INTO forum_like/, '点赞插入用 INSERT IGNORE 挡并发')
  assert.match(post, /INSERT IGNORE INTO forum_favorite/, '收藏插入用 INSERT IGNORE 挡并发')
  assert.match(post, /INSERT IGNORE INTO forum_post_follow/, '蹲贴插入用 INSERT IGNORE 挡并发')
  assert.match(post, /removed\.affectedRows !== 0/, '删除明细后才扣计数')
  const comment = read('controllers', 'commentController.js')
  assert.match(comment, /INSERT IGNORE INTO forum_comment_like/, '评论点赞用 INSERT IGNORE')
  assert.match(comment, /if \(likedNow && comments\.length/, '并发重复点赞不再补发通知')
})

check('P22 计数器对账任务已启动', () => {
  const svc = read('services', 'counterReconcileService.js')
  assert.match(svc, /UPDATE forum_post p SET/, '按明细重算帖子五个计数器')
  assert.match(svc, /like_count = \(SELECT COUNT\(\*\) FROM forum_comment_like cl/, '评论点赞数同样对账')
  assert.match(svc, /updated_at >= NOW\(\) - INTERVAL \? HOUR/, '只对账近期有变更的帖子，不全表扫描')
  assert.match(read('app.js'), /require\("\.\/services\/counterReconcileService"\)\.start\(\)/, 'app 启动对账任务')
})

console.log(`审查修复回归通过 ${passed} 组断言。`)
