# 项目长期记忆（gqg-campus）

> 只记「看代码看不出来、踩过坑」的规则。**`topics/*` 与本文一起注入，拆分不减少总量**；**控制总量只能靠删/合并**，高价值排前。

## 📂 分节文件
| 文件 | 内容 |
|---|---|
| `topics/jw-教务同步.md` | 课表周次、教务登录/OCR、业务码、SLB 故障、学期口径 |
| `topics/订阅消息.md` | stable_token、skipped/throttled/failed、授权弹窗触发点 |
| `topics/论坛热榜与评价.md` | 匿名判据/昵称池、分享海报、热榜刷新、review 两级树 |
| `topics/小程序端易错点.md` | `focus` 受控、图标统一层、vm 测试、样式 token、root-portal、抽屉/弹层 |

## 协作与需求解析
- **⚠ 「参照图 X」类需求，动手前必须先用一句话回述目标形态并让用户确认** —— 2026-10-06 需求 L 连错两轮：用户说「参照图二的抽屉卡片」，我做成「点卡片弹**详情抽屉**」（hero+正文+配图+底部按钮），实际要的是「点卡片弹**二维码弹窗**」（`contact-admin` 的 QR 层）。**「抽屉」在用户语境里可能指任何一种弹出的浮层。**
- **图片里的 UI 要素要逐项抄，不要归纳**；**先在仓库里找「图里那个东西是不是已有实现」**（图一那层其实就是 `components/contact-admin` 的 QR 弹层），能省一整轮返工。
- **⚠ 用户说「评论框 / 卡片 / 弹层」时，先按图里的细节特征在两三处候选里定位，别凭名字猜页面。** 项目里评论 UI 有三处：`pages/post-detail`（爱心 + 右上角「…」）、`pages/review/target`（👍 emoji + 底部「回复」）、`pages/index`（首页评论抽屉）。2026-10-07 靠「👍 emoji + 底部回复按钮」这个组合唯一定位到 `review/target`。**定位成本远低于改错页面的成本。**
- **用户前后口径冲突时以最新表述为准**，并显式标注歧义让用户复核。
- **用户报「改了但页面没变」时，先怀疑「没部署/没重传」，不要先改代码。** 2026-10-06 需求 M：用户说「点进去页面不像图一」，实测本地 `edit/index` 早已是独立整页 —— 根因是端上未重传。
- **⚠ 复刻交互组件时，必须逐一枚举「按身份分开的所有入口」，不能只抄显眼的那个。** 2026-10-07 踩坑：`post-detail` 里「自己的评论」有**两个入口** —— ①「…」菜单只给「隐藏」；②**正文下方单独一行 `.comment-actions`「编辑/删除」**。我只搬了 ①，用户实测报「我点自己的评论时怎么只有隐藏」。**通用：抄组件时先列一张「身份 × 入口」矩阵（本人/他人/管理员 × 各有哪些操作），逐格核对。**

## 部署与排障
- 生产 `https://payun01.cn`，前缀 `/api/v1`；pm2 cluster 2 实例，端口 3000。`BASE_URL` 硬编码在 `utils/request.js`。Nginx 静态根 `/www/wwwroot/payun01.cn`（宝塔），配置 `vhost/nginx/payun01.cn.conf`（改后 `nginx -t && nginx -s reload`）。静态 H5 源 `web-static/`（`embed.html` 必须部署）。服务器 `root@193.112.187.95`（凭据见 `deploy.py`）。
- **改少量文件不要跑 `deploy*.py` 全量脚本**（清单 30~50 文件，线上有漂移）。定向单文件：备份 `.bak-<ts>` → 上传 → `node --check` → 比 sha256 → `pm2 restart GQG-campus` → curl health 200。模板 `.workbuddy/tmp_deploy_*.py`。
- **⚠ 双向漂移都可能**：① 线上有「未回流仓库」的热修；② **本地也有「整块未部署」的功能**。**判据：本地是线上严格超集 → 可安全覆盖；否则逐文件核对。** 漂移判据必须**语义化**：naive 逐行 diff 会把「单行表达式重构成变量」当线上独有热修 → 去空白规范化 + 对已知重构豁免；当「线上==HEAD」失效时改**语义超集判据**（本地必须含「线上热修标记」+「本次改动标记」）。
- **⚠ 未部署的改动端上一定显示旧行为** —— 「改了代码但页面没变」**第一步永远是查「服务端是否已部署 / 小程序是否已重传」**。**最快判据：curl 线上接口看新字段在不在**。**小程序代码不随服务端部署上线**，必须用微信开发者工具重传。
- **真实日志是 `logs/out.log`**（`方法 路径 状态码 耗时ms - IP`，**无时间戳，靠行号排序**）；`/www/wwwlogs/*.log` 已停更。**`auth` 拒绝 <1ms** → `401 0.6ms` = 没带 token/验签失败。
- **⚠ 端上报 `404` 时，用「curl 三连对照」10 秒定性，别翻日志**：拿**新接口**与**同组已上线老接口**各 curl 一次 —— 新接口 `404` + 老接口 `401` = **路由没挂上（没部署）**；两个都 `404` = 路径前缀写错；两个都 `401` = 路由正常、仅缺 token。**`401 vs 404` 的差值就是「路由挂没挂上」的分界。** 2026-10-07 评价评论 delete/update 报 404 即此法定性为「服务端未部署」。
- 生产库巡检：只读 `tmp_db_probe.py`，授权写入才用 `tmp_db_apply.py`（SSH 传 /tmp → 用应用自己的 node + `require('/home/springboot/server/config/pool')`）。**/tmp 下第三方模块必须绝对路径**。`pool.query` 返回 `[rows, fields]`；**聚合 SQL 警惕 JOIN 重复累加**。`sys_user` 昵称列是 **`nick_name`**。**探针输出别 `head -N` 截断**。

## 测试
- **`server/tests/` 100+ 个 `*.test.js`，`npm test` 只跑注册过的**（`scripts.test` 字母序硬链）。**新增文件必须补进 `scripts.test`**。全量口径：`for f in tests/*.test.js; do node "$f" || echo FAIL $f; done`；**判全绿看退出码**。
- **「改了代码测试全绿」头号原因：测试只读函数体、不看路由挂的是谁**。**改控制器的护栏必须同时断言路由绑定**。
- **静态断言的高危写法（每条都踩过）**：① 取函数体别用 `indexOf('_loadXxx')`（会命中 `onLoad` 分发行）→ 扫描「参数括号收口后紧跟 `{`」；**名字带点（`exports.foo`）时判据要允许 `= async (` 形式**。② **位置断言（A 在 B 内/外）绝不能拿 `indexOf('</view>')` 当容器收口** → **按标签名配对扫描**（`depth` **初值 1**、只对同名标签配平、`depth===0` 才是收口）；**同类元素同名时（评论区顶部栏与评价条目都叫 `comment-head`）必须从正确起点找**。③ **⚠ 断言串若同时出现在注释里，`indexOf(全文)` 就是空判据** → **必须落在 `functionBody()` 切出的函数体内**。④ **⚠ 断言「某动作发生了」必须断言调用表达式本身**（`await X(`、`setStorageSync(k, v)`），**不能只断言标识符/文案出现过**（2026-10-07 一次抓出 4 处：菜单文案还在但分支体已 `return`、`blocked_user_ids` 在 `getStorageSync` 里也有、`writeAdminAudit` 在 `void 0 &&` 短路里仍有名字、`pa-heart` 只断言「存在一处」而另一处已被换掉）。⑤ 断言 URL/CSS 别用 `[^"']*`（`viewBox='…'` 含引号会静默截断）→ 配对引号锚定；⑥ 断言「字段在对象里」别用 `/x,\s*$/m`（末键无逗号）→ 切 `Object.assign({}, r, {`→`})`；⑦ 三元拼的类名源码里不存在 → 匹配拼装片段；⑧ 地址抽成模块级常量时函数体内只剩变量名 → 连常量定义一起断言。
- **⚠ 反向验证是唯一能发现空判据的手段**：2026-10-07 两批共 34 条改坏补丁，**抓出 8 处空判据**（第一批 18→4，第二批 16→4）—— **护栏写完全绿不等于护栏有效**。反向验证脚本模板见 `.workbuddy/tmp_*_rv.py`（用后即删）。构造改坏补丁时：仓库 `.wxml/.wxss` 是 **LF**；**「只删注释」不等于「改坏了结构」**；**只改文案/只改一处重复串的补丁是无效补丁，别把它算作「未捕获」**。
- **⚠ 「文案/键名还在」是最常见的假绿灯**：断言守卫时不能只断言**文案**（`/内容不能为空/`、`/wx\.showModal\(/`、`/editContent:/`、`/catchtap="onEditComment"/`），必须断言**完整表达式**（`/if\s*\(\s*!\s*content\s*\)\s*return\s+fail\(/`、`/if\s*\(\s*!res\.confirm\s*\)\s*return/`、`/editContent:\s*String\(\s*ds\.content/`、**逐块**切出容器再断言内部 handler）。
- 假池 harness（`review-module.test.js` C 段）：`fakePool.query` 按 `queue` 顺序出值。**`createNotification` 是 fire-and-forget**，会偷吃后续用例 queue → 用例前 `await` 排空几 tick。**`.spring-btn` 的 hover 类必须写 `transform: scale(0.96)`**。
- `tests/richtext-{content,editor}.test.js` **未纳入 git**。跑测试时 stderr 的 `[Subscribe] 40001/43101`、`sharp 不可用` 是测试桩故意打的，**不是失败**。

## 跑腿订单（errand）★ 细节见 `2026-10-06.md`
- **状态机** `pending → accepted → finishing → finished`，另 `cancelled`/`disputed`。`finishing`（接单方已提交完成、待发单人确认）**对第三方不可见**；大厅可见性 = 「公开状态 OR (交接阶段 AND 当事人)」—— 少后半段则当事人历史 cancelled 会倒进大厅。
- **⚠ 取消两个入口（对称）**：`/errand/:id/cancel` = **发单人**取消，**必须绑 `errandController.cancel`**（`pending` 直取消；`accepted` **只能提交申请**落 `errand_cancel_request`，须接单方同意）。**曾错绑 `paymentController.cancelErrand`**（直接置 cancelled+退款、无校验无流水）——「接单后发单人照样能单方面取消」的根因。`/errand/:id/release` = **接单方**取消（30 分钟内自身原因可直取消并计 `self_cancel_count`）。审批统一走 `reviewCancelRequest`，审批人 = **申请的对方**（`isPublisherRequester` 判方向），**不能退化成「仅 publisher_id 可批」**。
- **⚠ 两条链共用 `action='cancel_requested'`**：服务端按方向写不同 `detail`。**端上文案表绝不能按 `action` 写死方向** —— 曾 `errand-detail` 的 `LOG_LABELS.cancel_requested` 写死「接单方申请取消接单」，导致发单人自己申请时显示成接单方。**正解：以服务端 `detail` 为唯一真源**。**通用：一个 action 被两个方向复用时，文案/判据都不能只看 action。**
- **冻结 = 完成率过低且必须可解除**（`FREEZE_MIN_RECORDS`/`FREEZE_RATE`，`accept` 时 403）：**必须设冷却期**（7 天）且管理员可手动 `unfreeze` —— **不设冷却期 = 数学上的永久封禁**。
- **⚠ 冻结名单状态必须三态**：`overThreshold`（统计超标）**只增不减**，拿它判「待解冻」会把已解冻账号**永久误显示成待解冻**。服务端 `listErrandRunners` 必须显式下发 `frozen`/`unfrozen`（`unfrozen = overThreshold && !frozen && !!frozenUntil`）。**通用：状态字段一旦有反向事件（人工放行、到期恢复），就不能用单向指标现算。**
- **⚠ 任何把订单置 `cancelled` 的路径都必须写 `errand_order_log` 并关闭遗留 pending 申请**（`reserveErrandRefund` 曾是「静默取消」源头）—— **排查为何取消先查流水；cancelled 无流水 = 走了未埋点退款路径**。
- **⚠ 隐私列必须用「显式列清单」防串位**：`private_info`（取件码，仅接单者见）/`private_images`（JSON，仅当事人见）vs `remark`（公开描述，**viewer 也下发**，否则详情退回 title）。大厅 `list` 用显式列清单 → 天然不含隐私列；`detail` 对 viewer 走 `SELECT e.*` 后**剔除** `private_*`（但公开 `images` 保留）。详情/审批下发**驼峰键** `requesterId`/`reasonSide`/`images`（必须数组）。

## 认证与登录态
- 唯一登录 `POST /user/phone-login {code, phoneCode}`（小程序专有凭证）；`sys_user` 无密码字段。JWT HS256 单密钥，载荷仅 `{userId}`，**`JWT_EXPIRES=30d`**。`auth` **每请求回查 `sys_user` 的 role + status**（禁用/降权即时生效），不得退化为仅验签；`status !== 1` 返回 **403**（不是 401）。
- **登录态加固**：`utils/token.js` 解 JWT 判 `exp`（60s 余量）；`auth.isLoggedIn()` = 有 token **且未过期**；`request.js` 401：**带 token 仍 401** → 清 token + 断 WS + 弹一次「登录已失效」（5 分钟冷却 + 互斥），**游客 401** → 不弹。
- 权限点 8 个：stats.view / content.manage / config.manage / item.manage / user.manage / role.assign / payment.manage / admin.manage。`ROLE_PERMISSIONS`：super_admin `*`；content_admin=content+config+stats；user_admin=user+stats；operator=item+config+stats+payment。

## 评价评论（review）★ 2026-10-07 对齐帖子详情页
- **端上 `pages/review/target` 的评论区已一比一复刻 `pages/post-detail`**：`.comment-item`（灰底 `#f7f9fc` + `border-left:6rpx`）、`.comment-meta` 里昵称与时间同行、右上角 `.comment-more`「…」、`.comment-body` 内右侧 `.comment-icon.pa-heart` 双态爱心。**旧的 `.comment-card`/`.comment-foot`/`.comment-reply-btn`/`👍` 已全部移除**。`pa-heart` 的 SVG 定义在 `post-detail`/`pages/index`/`review/target` 各有一份（wxss 不跨页共享）。
- **「…」菜单四项**：隐藏（纯本机，不落库）/ 举报（`api.reportComment` → 通用 `/feedback/report`，与评论类型无关）/ 拉黑（`POST /message/block {peerId}`，按 userId 走，与评论类型无关）/ 删除（`POST /review/comment/:id/delete`，本次新增）。**隐藏/举报/拉黑三项后端原本就有，只有删除是新增。**
- **⚠ 删除权限刻意比论坛窄一档**：`post-detail` 的删除权 = 管理员 **或帖子作者**；**评价页不设「评分对象创建者」这一档**（评分对象是公共条目、没有作者角色）→ 服务端 `deleteComment` **只判 `content.manage` 管理员 + 评论作者本人**，只收紧不放宽。删顶层评价连带 `parent_id` 其下回复，管理员删除写 `admin_audit_log`。
- **`review_comment` 表有 `deleted`/`status` 两列**，删除统一走软删 `deleted = 1`（所有查询都带 `deleted = 0`）。删完必须 `refreshCommentCount` + `refreshHotComment` 收口。

## 管理后台（pkg-admin）
- **⚠ 编辑操作一律走独立整页 `pkg-admin/admin/edit/index`**（2026-10-06 从抽屉迁出）。URL 契约 `?scope=<kind>&id=&type=&action=&categoryId=`，单页按 `scope` 渲染 13 种表单 + 3 种审核。**旧抽屉已全删，`admin/index.wxml` 里 `form.kind` 残留必须为 0**。保存成功写 `app.globalData.adminEditDone` → 后台 `onShow` 读后清理并 `loadCurrent()`。**两端共用常量在 `admin-edit-meta.js`（改口径只改这里）**。**样式全 scope 共用**（`.form-item`/`.form-label`/`.upload-row`/`.img-grid`/`.color-field`/`.action-bar`）。
- **`pushGroup` 配色的 `<picker>` 是刻意的**：`PUSH_GROUP_THEME_OPTIONS = ['橙色','绿色','蓝色','紫色','青色']` 是 **5 套预设色系**，不是任意取色 → **不能换成 `color-field`（任意取色器），会破坏语义**。
- 列表页 `pkg-admin/admin/index.{js,wxml,wxss}`，`activeTab` 切视图（10 个 Tab）；接口封装 `admin.js`，全在 `/api/v1/admin/*`，统一 `auth` + `requireAdmin(permission)`。客户端 `TAB_PERMISSIONS` 只控入口显隐，**服务端才是真源**。**端上无界面**：`/admin/audit-logs`、`/admin/features`。`admin_audit_log` 含 `ip`（已设 `trust proxy`）；限流内存态，cluster 下各实例独立。**时间字段必须用 `fmtDateTime()`** —— API 返回 ISO **UTC**，直接 `slice` 会少 8 小时。
- **正文标记渲染只走 `components/richtext-content`**（吃 `utils/richtext.js` 的 `parseBlocks`）。`**粗**`/`## 标题`/`{蓝|字}` 是**存储格式**，**`**` 只在编辑框可见——设计如此**。**展示 `detailContent`/`intro`/`notice`/`detail` 都必须接 `richtext-content`**；**`auditNote`/`reviewNote` 是管理员手写纯文本，刻意不走组件**。**`edit/index.wxml` 必须恰好接 5 个 `richtext-editor`**。**`club.intro`/`group_chat.intro` 两条写入链**：后台 `richtext-editor`(1000) **与用户端申请页纯 `textarea`(500)** —— 改存储格式时这 4 列 + 2 申请页一起改。**`group_chat.intro`(群介绍) 与 `notice`(群公告) 是两个字段**。
- **自定义页面「底部跳转按钮」** `link`/`linkText` 存 `system_content.body` JSON；表单在 `pages/banner-detail`，**与横幅共用同一组输入框（不得被 `!isCard` 挡住）**；用户端统一 `components/page-link-button`。**`loadBanner` 必须读 `raw.link`**（曾硬编码清空）。**「信息推送群」卡片** `iconPath` 同存 body JSON（仅 https、≤255 字）—— 该表单是**扁平 `form.iconPath`/`form.images`（其余挂 `form.meta.*`，唯一例外）**，图片处理函数按 scope 分支，否则写错路径静默丢失。**用户端 `pages/push-groups`（2026-10-06 定稿）：只显示卡片，点卡片弹二维码弹窗（样式对齐 `components/contact-admin` 的 QR 层），二维码取卡片 `images[0]`，主按钮「点击此处即可跳转」走 webview → `web-static/wechat-qr.html?qr=&text=`（个人微信二维码只能进 H5 长按识别）；`push-group-detail` 整页已删。**
- **⚠ `wx.showModal` 的 `content` 在「多行 + `editable:true`」同时开启时会被裁断**，`editable` 输入框也是单行 —— **凡需完整多行正文或长输入，一律用自定义弹窗**（`.confirm-mask`/`.confirm-card`，正文 `white-space:pre-wrap` + `word-break:break-word`，输入用 `textarea`）。
- **改后台编辑功能必跑 6 个静态护栏**（audit-fixes / driving-school-module / group-chat-admin-form / push-group-detail / push-group-icon / richtext-editor）—— 按源码字符串断言，迁表单时会指向已删的旧抽屉。**修法：表单/handler 断言指向 `edit/index.{wxml,js}` / `admin-edit-meta.js`，列表页断言保留**。
