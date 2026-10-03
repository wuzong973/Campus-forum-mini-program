# 项目长期记忆（gqg-campus）

> 只记「看代码看不出来、踩过坑」的规则；细节见 `docs/`。**注入有上限，超了从尾部截断**（曾整段截掉订阅消息节）。新增前先删旧。

## 部署与排障
- 生产 `https://payun01.cn`，接口前缀 `/api/v1`；pm2 cluster 2 实例，端口 3000。`BASE_URL` 硬编码在 `utils/request.js`。Nginx 静态根 `/www/wwwroot/payun01.cn`（宝塔），站点配置 `/www/server/panel/vhost/nginx/payun01.cn.conf`，改后 `nginx -t && nginx -s reload`。静态 H5 源 `web-static/`（`embed.html` 必须部署）。服务器 `root@193.112.187.95`（凭据见 `deploy.py`）。
- **改少量文件不要跑 `deploy*.py` 全量脚本**（固定清单 30~50 文件，线上与仓库有已知漂移）。定向单文件：漂移基线用 **`git show HEAD:<path>`**（不是工作区）→ 备份 `xxx.bak-<ts>` → 上传比 sha256 → `pm2 restart GQG-campus` → curl health 200。模板 `.workbuddy/tmp_deploy_{merge_window,jwt_30d}.py`。
- **小程序代码不随服务端部署上线**，必须用微信开发者工具重传。验证 `.env`：`cd /home/springboot/server && node -e "require('dotenv').config();console.log(process.env.X)"`（`/proc/<pid>/environ` 看不到）。
- **`/www/wwwlogs/payun01.cn.log` 已停更（停在 2026-08-16）**，真实日志是 **`logs/out.log`**（`方法 路径 状态码 耗时ms - IP`，**无时间戳**）。统计：`grep -o 'POST /api/v1/<路径> [0-9]*' out.log | sort | uniq -c | sort -rn`；反查身份用同 IP 的 `/api/v1/user/profile/<id>`。**`auth` 拒绝耗时 <1ms** → `401 0.6ms` = 没带 token 或验签失败，与业务无关。
- 生产库只读巡检：`python .workbuddy/tmp_db_probe.py <本地js>`（SSH 传 /tmp → 用应用自己的 node + `require('/home/springboot/server/config/pool')` → 自动清理）。**只跑 SELECT**；`pool.query` 返回 `[rows, fields]`，DATETIME 是 JS `Date`。**聚合 SQL 警惕 JOIN 重复累加**。
- 本地看视频取证：托管 venv 装 `imageio-ffmpeg`，用自带 ffmpeg 抽帧（`-vf fps=1`）再 Read；微信视频同目录有 `_thumb.jpg`。

## 测试
- **`npm test` 只跑 43 个文件，`server/tests/` 实际有 97 个 `*.test.js`**（`scripts.test` 用 `&&` 硬链）。**新增测试文件后必须手工补进 `scripts.test`**——`wechat-token-stable`/`subscribe-throttle`/`subscribe-trigger-points`/`hot-rank-deleted-post`/`route-guard`/`local-imports`/`campus-map-panorama` 这批守卫长期不在 `npm test` 里。全量口径：`ls tests/*.test.js` 逐个 `node` 跑。
- **`.spring-btn` 家族的 hover 类必须写 `transform: scale(0.96)`**，只写 `opacity` 过不了 `press-spring-shared.test.js`。
- `server/tests/richtext-{content,editor}.test.js` **未纳入 git**（`git show HEAD:` 取不到），别拿 git 做基线回溯。
- 跑测试时 stderr 里的 `[Subscribe] 40001/43101`、`sharp 不可用`、`WX_MESSAGE_TOKEN 未配置` 是测试桩故意打的，**不是失败**。

## 认证与登录态
- 唯一登录 `POST /user/phone-login {code, phoneCode}`（小程序专有凭证，浏览器拿不到）；`sys_user` 无密码字段（`jw_credential.password_enc` 是教务爬虫凭据）。JWT HS256 单密钥（`server/config/jwt.js`），载荷仅 `{userId}`，**`JWT_EXPIRES=30d`**，无 aud/iss。
- `auth` **每请求回查 `sys_user` 的 role + status**（禁用/降权即时生效），不得退化为仅验签；`status !== 1` 返回 **403**（不是 401）。
- **登录态已加固（2026-09-18）**：`utils/token.js` 解 JWT 载荷判 `exp`（60s 余量，不可解析则交服务端）；`auth.isLoggedIn()` = 有 token **且未过期**；`checkLoginExpiry()` 先判 exp 再判 90 天（reason `token-expired`/`inactive`）；`request.js` 401 分支：**带 token 仍 401** → 清 token + 断 WS + 弹一次「登录已失效」（5 分钟冷却 + 互斥，`silent` 也提示），**游客 401** → 不弹。护栏 `tests/schedule-empty-state-and-session.test.js`。
- 权限点 8 个：stats.view / content.manage / config.manage / item.manage / user.manage / role.assign / payment.manage / admin.manage。`ROLE_PERMISSIONS`：super_admin `*`；content_admin=content+config+stats；user_admin=user+stats；operator=item+config+stats+payment。

## 管理后台（pkg-admin）
- 单页 `pkg-admin/admin/index.{js,wxml,wxss}`，`activeTab` 切视图；接口封装 `pkg-admin/utils/admin.js`；入口 `pages/user/index.js`。10 个一级 Tab：overview/reports/posts/content/items/clubGroup/activities/userAdmin/review/logs。客户端 `TAB_PERMISSIONS`/`SUB_TABS` 只控制入口显隐，服务端才是真源。
- **正文标记渲染只走 `components/richtext-content`**（吃 `utils/richtext.js` 的 `parseBlocks`）。`**粗**`/`## 标题`/`{蓝|字}` 是**存储格式**，用户端解析后渲染，**`**` 只在编辑框可见——设计如此，不是 bug**。**凡展示 `detailContent`/`intro`/`notice`/`detail` 的地方都必须接 `richtext-content`**。**审核详情页曾漏 3 处（2026-10-01 修）**：`clubAuditDetail.intro`、`chatApplyDetail.intro`、`activityAuditDetail.detailContent`，护栏 `tests/richtext-editor.test.js` 第 10 条。**`auditNote`/`reviewNote` 是管理员手写纯文本，刻意不走组件**。
- **`club.intro`/`group_chat.intro` 有两条写入链**：后台 `richtext-editor`(1000) **与用户端申请页纯 `textarea`(500)**（`pages/club/apply.wxml:79`、`pages/group-chat/apply.wxml:79` → `club_apply.intro`/`group_chat_apply.intro`，审批后由 `groupChatController.js:292` 等原样搬进正式表）。改正文存储格式时这四个列 + 两个申请页必须一起改。易混：`group_chat` 的 **`intro`(群介绍) 与 `notice`(群公告) 是两个字段**，intro 在详情页是纯 `<text>`。
- **自定义页面（校园卡/学车指南/市场/校园圈学车）的「底部跳转按钮」**：`link`/`linkText` 存在 `system_content.body` 的 JSON 里；表单在 `pages/banner-detail`，**与横幅共用同一组输入框（不得再被 `!isCard` 挡住）**；用户端 4 页统一用 `components/page-link-button`（跳转复用 `richtext.openLink`，链接空则不渲染）。**`loadBanner` 必须读 `raw.link`** —— 曾硬编码 `link:''` 把值清空。
- 接口全在 `/api/v1/admin/*`，统一 `auth` + `requireAdmin(permission)`。**已实现但小程序端无界面**：`GET /admin/audit-logs`、`GET|PUT /admin/features`。`admin_audit_log` 含 `ip`（已设 `trust proxy`，需确认 Nginx 透传 `X-Forwarded-For`）。限流 `rateLimit({max:120})` 是内存态，cluster 下各实例独立。
- **时间字段必须用 `fmtDateTime()`**，不要 `String(x).replace('T',' ').slice(0,19)` —— API 返回 ISO **UTC**，直接切少 8 小时。护栏 `tests/subscribe-logs-endpoint.test.js` E 组。

## 课表 / 教务同步（jw）
- **课表页只渲染「当前选中周」**（`pages/schedule/index.js` `applyCurrentWeekCourses`）。**2026-09-18 实测：192 个有课表用户只有 56 人（29%）在第 2 周有课**（大一军训 2 周、课程多从第 3 周起）。**判断「课表丢没丢」的权威依据是「编辑课表」页（同一 `/schedule/list`，顶部「共 N 门课程」），不是课表页空态。**
- **周次导航栏不得依赖 `courses.length`**（已修）：否则「本周没课」= 切不到有课的周 → 误判「课表没导入」。空态须区分「学期无课」与「本周无课」（`semesterCourseCount`/`firstCourseWeek`），本周无课自动跳到首个有课周（只跳一次，`resolveFirstActiveWeek()` 跳过单双周不匹配的周）。**顶部「第 N 周」可点开全周次总览**（`onWeekTextTap`）。
- **课表写操作都不得谎报成功**（已修）：`schedule-add.onSave()`、课表页与 `schedule-edit` 的「清空全部课表」必须等接口成功才提示。本地 `schedule_courses` 全仓库**只有写没有读**（死缓存），别写它；保存成功后把 `{startWeek,endWeek,weekType}` 放进 `app.globalData.scheduleJumpToWeek`。
- **业务码在 `data.code`**（`CAPTCHA_REQUIRED`/`CAPTCHA_INVALID`/`CAPTCHA_EXPIRED`/`JW_CREDENTIAL_INVALID`/`JW_NOT_BOUND`），`code` 是 HTTP 状态码。`utils/request.js` 已解析为 `err.bizCode` —— 判断业务分支**必须用 `err.bizCode`**。
- 登录：`xsMain.jsp` → `verifycode.servlet`(JPEG) → `POST /jsxsd/xk/LoginToXk`，body `userAccount/RANDOMCODE/encoded(=base64(账号)%%%base64(密码))/pwdstr1/pwdstr2`；失败原因在 `#showMsg`。验证码交接：`schedule-home` 经 `app.globalData.jwCaptchaHandoff` 交给 `schedule-login`。
- 容错：`JW_TIMEOUT_MS=10000`、`JW_MAX_RETRIES=1`、`JW_RETRY_BACKOFF_MS=500`；`isRetryableError` 覆盖 429/500/502/503/504 + 网络错误。OCR `JW_USE_OCR=1`，实测 18/20。诊断：`logs/{out,err}.log`、`login_debug/login_failed_*.{html,txt}`、`jw_credential`（AES-256-GCM，密钥 `JW_CRED_KEY||APP_SECRET||"gdipu-jw-credential-default-secret-key"`）。
- **学校侧故障**：教务前置阿里云 SLB（`via: SLB.75`）源站超时时间歇 504/502，与我们无关；服务端统一映射 502 +「教务系统暂时无法连接…」，临时故障不清除已绑定凭证。排查法：端状态码 → 自身服务端 → 到对方网络采样 → 换网络对比 → 看对方原始响应头/body。
- 官网同源反代 `location /jsxsd/` → `https://jw.gdipu.edu.cn/jsxsd/`（`proxy_ssl_server_name on`、Host/Referer 换回学校域名、`proxy_hide_header X-Frame-Options`、`proxy_redirect` 改回本站），入口 `payun01.cn/jsxsd/`；回滚 `payun01.cn.conf.bak-20260914-jsxsd`。
- 学期口径唯一来源 `utils/schedule.js`：`DEFAULT_SEMESTER_START="2026-09-07"`、`DEFAULT_TOTAL_WEEKS=20`、`computeAcademicWeek()`（周一锚定）。校历：第 2 周 = 9/14-18。

## 论坛帖子 / 热榜
- **匿名帖不隐藏校区**：`postController.mapPost()` 的 `campus` 与普通帖同口径 `r.campus || ""`；客户端统一 `post.campus || '未设置校区'`。
- **分享海报** `pages/poster/index.js`：canvas 2d 不能直接画网络图，头像/配图须 `wx.downloadFile` → `canvas.createImage()` → `drawImage`；内置头像 `/assets/avatar2/*.jpg` 须 `readFile` 转 base64。**对外图片域名只有 `https://payun01.cn`**（`/uploads/<uuid>.jpg|mp4` + 内置头像），微信 downloadFile 合法域名只填它；COS 已配但未使用。
- **发布校验** `pages/post-publish/index.js`：`onSubmit` 不得因 `canSubmit=false` 提前 return；未选分类提示「请选择分类」（护栏 `tests/post-display-and-publish.test.js`）。
- **热榜唯一数据源** `GET /post/hot-rank` → `postController.hotRank`；4 个展示位全走它；前端统一 `utils/hot-rank.js`。服务端已正确过滤（主/兜底查询都带 `p.status = 1`；删除路径均置 `status = 0`）——**排查热榜问题别先怀疑这里**，用 `admin_audit_log` 的 `post.delete` 与 `forum_post.status` 交叉自证。
- **刷新约定**：`navigateTo` 推入的页面常驻，从榜单进详情删除再返回**只触发 `onShow`**。每个热榜展示页必须在 `onShow` 重拉（`_loadedOnce` 跳首次）。已删帖本地广播 `markPostRemoved()`/`filterRemovedPosts()`（键 `hot_removed_post_ids`，TTL 10 分钟）。`/api` 全局 `Cache-Control: no-store`。

## 订阅消息（services/subscribeService.js）
> 细节见 `docs/订阅消息_{配置与模板方案,功能实现与改造,排查报告与修复记录}.md`。
- **`skipped`/`throttled`/`failed` 完全不同**：`remain <= 0` → 写 `skipped` 并 return，**压根没调微信**；被微信拒（带 errcode）才写 `failed` —— **`failed` 与额度无关**；`throttled` 是**客户端本地弹窗节流**命中。**`failed` 三来源**：① 无 openid；② 微信 errcode；③ **异常不写日志**（末尾 `catch` 只 `console.error`）。
- **`access_token` 必须走 `cgi-bin/stable_token`，绝不能回 `cgi-bin/token`**：后者**每调一次就作废上次签发的 token**，而 cluster 2 实例、`cachedToken` 是**进程内变量** → A 刷新后 B 的立刻失效 → `40001 ... not latest`。`forceRefresh: true` **只允许在 40001/42001 自愈路径用**；`40001/42001/40014` 可自愈，必须换新 token 重发、不得记 failed。护栏 `tests/wechat-token-stable.test.js`。**`scripts/verify-wechat-config.js` 是地雷**（跑一次废掉线上 token），已改。
- **新增「授权弹窗触发点」的唯一姿势**：业务 tap 里调 `subscribe.requestTriggerByTap('<组>')`，**必须在 tap 同步调用链内**（放进 `onLoad`/`setTimeout`/`then` 会静默失败），且在前置校验之后、任何 `await` 之前。8 个组：`postPublish`/`errandPublish`/`withdraw`/`message`/`riderVerify`/`activityPublish`/`activitySignup`/`activityIndex`。**不要新建组或模板**。护栏 `tests/subscribe-trigger-points.test.js`。
- **弹窗节流层**（`utils/subscribe.js`）：同一触发组**未勾选「总是允许」**时一天最多弹 3 次（本地键 `subscribe_popup_throttle`，`day` 用**本地**时区、跨天惰性重置）。**必须本地存储**——`requestSubscribeMessage` 要在 tap 同步链内调用。闸门只在 `requestTriggerByTap`，**`requestEntryByTap` 不受节流**。**勾选「总是允许」→ 跳过节流但仍照常调用**（每次仍 +1 额度）。护栏 `tests/subscribe-throttle.test.js`。
- **额度按 `(user_id, tpl_type)` 逐人独立存**（每点一次「允许」= 1 条，`43101` 清零）。看板「剩余」是全体总量、「N 人有额度」(`availableUsers`) 才是真能收的人数。**2026-09-16 实测：`commentNew` 发出率仅 4.6%、20 个订阅过的用户里 14 人已归零。**
- **空值字段铁律**：`data` 里任何空值字段微信返回 `47003`（不可重试）。必须用 `clipOr(x,n,兜底)`；`date`/`time` 同样拒空。发送前调 `warnEmptyFields()`。字段名要调 `GET /wxaapi/newtmpl/gettemplate` 拉真实结构比对，**不要靠猜**。
- 其他：`/subscribe/quota` 返回 `{data:{quota:{模板:条数}}}`，客户端要取到 `.quota`（曾漏解 → 入口永不消失）；`SUBSCRIBE_MERGE_WINDOW_MS` 默认 `0`（改值须同步改 `tests/subscribe-slots.test.js` A3 与 `subscribe-delivery.test.js` B 组）；「开了开关却不弹窗」一律是微信侧行为（`wx.getSetting({withSubscriptions:true})` 的 `itemSettings[模板ID]` **键不存在 = 下次应弹窗**）。

## 小程序端易错点
- **`focus="{{x}}"` 是受控属性**，值变 `true` 就聚焦并拉起键盘。打开只读列表型面板（如首页评论面板）不要置 `true`。**`adjust-position="{{false}}"` 必须自己处理键盘高度**：fixed bottom 元素须绑 `bindkeyboardheightchange` 写 `style="bottom: {{h}}px"`（参照 `pages/post-detail/index.wxml:145`）。
- **两个评论入口语义不同**：首页 `commentMode="sheet"`（原地开面板），其余 `"detail"`（跳详情 + `&comment=1`，450ms 后聚焦）。`wx.setClipboardData` 成功后微信自弹「内容已复制」，**不要再 showToast**。
- **页面级 vm 测试**：跨 realm 的 `deepStrictEqual` 会因原型不同失败，改用 `.length` 或 JSON 归一化；测试末尾 `process.exit(0)`。
- 样式：设计 token 在 `app.wxss` 的 `page` 选择器（`--primary #315CFF`、`--bg #F4F6FA`、`--radius 18rpx`）。但 `pages/about` 等页面用自有一组近似硬编码色，**同页内改样式跟页面既有取值，别混 token**。

## 校园地图围栏
- 佛山 58 顶点 / 62.2 万㎡；广州新港 10 顶点 / 42.2 万㎡。护栏 `tests/campus-map-panorama.test.js` F/G 组；校验页 `docs/campus-boundary-verify.html`。

## 文档索引（docs/）
- **2026-09-16 起 docs/ 按主题合并为 14 篇，不再有按日期命名的文件**；新增文档要并入对应主题文档。入口 `docs/README_文档索引.md`。未合并：`项目踩坑铁律总表.md`、`campus-boundary-verify.html`。
- ⚠️ 索引称旧文件「移入 `docs/_原始归档/`」，但**该目录实际不存在**，旧文件是被删的 —— 回溯旧内容只能 `git checkout HEAD -- docs/`。
