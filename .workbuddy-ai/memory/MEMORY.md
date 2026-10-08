# 项目长期记忆（gqg-campus）

> 只记「看代码看不出来、踩过坑」的规则。**`topics/*` 与本文一起注入，拆分不减少总量**，控制总量只能靠删/合并。过程见 `.workbuddy-ai/memory/YYYY-MM-DD.md` 与 `docs/`。

## 📂 分节文件
| 文件 | 内容 |
|---|---|
| `topics/jw-教务同步.md` | 课表周次、教务登录/OCR、业务码、SLB 故障、学期口径 |
| `topics/订阅消息.md` | stable_token、skipped/throttled/failed、授权弹窗触发点 |
| `topics/论坛热榜与评价.md` | 匿名判据/昵称池、分享海报、热榜刷新 |
| `topics/小程序端易错点.md` | `focus` 受控、图标统一层、vm 测试、样式 token、root-portal、抽屉/弹层 |

## 文档体系（docs/）
- 6 篇按功能域合并的大文档 + 索引：`01_项目架构与工程规范` / `02_前端与UI交互` / `03_业务功能_社区与内容` / `04_业务功能_服务与交易` / `05_订阅消息系统` / `06_运维发布与质量保障`。
- **不再新建按日期命名的文档**。改动并入对应功能域那篇；**同一功能的说明必须写进该功能的章节**，修复记录作为子节排在「遗留问题」之前；跨域主题只在一处展开、其他位置指路并登记在该篇「阅读指引」。
- **删/重命名文档后必须 `grep -rn "docs/.*\.md"` 全仓扫代码与测试注释**（注释里的路径不报错、只静默失效；2026-10-07 扫出 14 处），扫完跑全量测试。

## 协作与需求解析
- **⚠「参照图 X」类需求，动手前先用一句话回述目标形态让用户确认。**
- **图片里的 UI 要素要逐项抄，不要归纳**；**先在仓库里找「图里那个东西是不是已有实现」**。
- **⚠ 用户说「评论框/卡片/弹层」时，按图里的细节特征在候选里定位，别凭名字猜页面**：评论 UI 三处 —— `pages/post-detail`（爱心 + 右上「…」）/ `pages/review/target`（👍 emoji + 底部「回复」）/ `pages/index`（首页评论抽屉）。
- **⚠ 复刻交互组件必须逐一枚举「按身份分开的所有入口」**：`post-detail` 里「自己的评论」有**两个入口**（①「…」只给「隐藏」；②正文下方 `.comment-actions`「编辑/删除」），只搬 ① → 用户实测报「点自己的评论只有隐藏」。**先列「身份 × 入口」矩阵逐格核对。**
- **用户前后口径冲突时以最新表述为准**，并显式标注歧义让用户复核。
- **⚠ 用户报「改了但页面没变」时，先怀疑「没部署/没重传」，不要先改代码。**

## 部署与排障
- 生产 `https://payun01.cn`，前缀 `/api/v1`；pm2 cluster 2 实例，端口 3000。`BASE_URL` 硬编码在 `utils/request.js`。Nginx 静态根 `/www/wwwroot/payun01.cn`（宝塔），配置 `vhost/nginx/payun01.cn.conf`（改后 `nginx -t && nginx -s reload`）。静态 H5 源 `web-static/`（`embed.html` 必须部署）。服务器 `root@193.112.187.95`（凭据见 `deploy.py`）。
- **改少量文件不要跑 `deploy*.py` 全量脚本**（清单 30~50 文件，线上有漂移）。定向单文件：备份 `.bak-<ts>` → 上传 → `node --check` → 比 sha256 → `pm2 restart GQG-campus` → curl health 200。模板 `.workbuddy/tmp_deploy_*.py`。
- **⚠ 双向漂移都可能**：① 线上有「未回流仓库」的热修；② **本地也有「整块未部署」的功能**。判据：本地是线上严格超集 → 可安全覆盖；否则逐文件核对。判据要**语义化**（naive 逐行 diff 会把「单行表达式重构成变量」当线上独有热修 → 去空白规范化 + 对已知重构豁免）。
- **⚠ 小程序代码不随服务端部署上线**，必须用微信开发者工具重传；**未部署的改动端上一定显示旧行为**。
- **⚠ 改了数据库结构的代码必须连带部署 `utils/migrations.js`** —— 否则新列永远不建、故障只在「用到新列的那条路径」暴露且被 `safeMessage` 吞成 500（2026-10-07 事故：只传 `reviewController.js` 漏传 `migrations.js` → `GET /review/target/:id` 带 token 500、不带 token 200）。`app.js` 的 `runMigrations()` 在 `app.listen()` **之前**执行、失败**无限重试不退出** → 站点一直 200（跑旧迁移）。**部署前必须逐文件 sha256 对照本地与线上。**
- **真实日志是 `logs/out.log`**（`方法 路径 状态码 耗时ms - IP`，**无时间戳，靠行号排序**），另有 `logs/err.log`。**`auth` 拒绝 <1ms** → `401 0.6ms` = 没带 token/验签失败。
- **⚠ 端上报 `404` 用「curl 三连对照」10 秒定性，别翻日志**：新接口 + 同组已上线老接口各 curl 一次 —— 新 `404` + 老 `401` = **路由没挂上（没部署）**；两个都 `404` = 路径前缀写错；两个都 `401` = 路由正常、仅缺 token。
- **⚠ `safeMessage` 把 `ER_*` 一律降级成「数据库操作失败」**，真实原因既不在响应里也可能不在日志里 → ① 关键写路径的 catch **必须** `console.error(原始 code + message)`（`errandController.create` 已补，护栏在 `sql-placeholder-param-count.test.js` C 段）；② 排查手段：**连生产库、在事务里复现那条 SQL 再 rollback**（`tmp_db_probe.py`），能拿到被吞掉的 `errno`/`sqlState`。
- 生产库巡检：只读 `tmp_db_probe.py`，授权写入才用 `tmp_db_apply.py`（SSH 传 /tmp → 用应用自己的 node + `require('/home/springboot/server/config/pool')`）。**/tmp 下第三方模块必须绝对路径**。`pool.query` 返回 `[rows, fields]`；**聚合 SQL 警惕 JOIN 重复累加**。`sys_user` 昵称列是 **`nick_name`**。**探针输出别 `head -N` 截断**。

## 测试
- `server/tests/` 110 个 `*.test.js`，**`npm test` 只跑注册过的**（`scripts.test` 硬链）→ **新增文件必须补进 `scripts.test`**（当前已 110/110 全接入，插入时保持字母序）。全量口径 `for f in tests/*.test.js; do node "$f" || echo FAIL $f; done`，**判全绿看退出码**。stderr 的 `[Subscribe] 40001/43101`、`sharp 不可用` 是测试桩故意打的，**不是失败**。多数文件不自报用例数 → 新增测试统一打印用例数。
- **⚠ 护栏别断言「字面量/标识符出现过」——那是绑死实现，重构必误报。** 实例（2026-10-08）：`push-group-detail` 断言源码含 `link.indexOf('/pages/') === 0`、`richtext-editor` 断言含 `SERVICE_PAGE_LINK_RE`，一重构就红。**改成断言行为**：调用表达式（`PAGE_LINK_RE.test(link)`）、**语句顺序**（`openPath` 必须在 `isWebUrl` 分支之前）、返回值。反过来，**改对代码后旧护栏报红时，先判断它锁的是行为还是实现**——后者顺手升级，别绕过。
- **⚠「改了代码测试全绿」头号原因：测试只读函数体、不看路由挂的是谁。改控制器的护栏必须同时断言路由绑定。**
- **⚠ 静态扫描类护栏头号盲区：只认 `"`/`'`，漏掉模板字符串（反引号）。** `errandController` 建单 INSERT 用反引号被整条跳过 → 护栏形同虚设、线上「发布跑腿」100% 失败。**任何扫源码的工具先确认覆盖模板字符串**（只有含 `${}` 插值的动态 SQL 才该跳过）。
- **⚠ SQL 需两条独立判据**：① `?` 个数 == 参数数组长度；② **INSERT 列清单个数 == 每行 VALUES 值个数**（只查 ① 会漏「删列忘删参数」→ `ER_WRONG_VALUE_COUNT_ON_ROW`）。都在 `sql-placeholder-param-count.test.js`。
- **⚠「接线完整性」护栏 `tests/miniprogram-wiring.test.js`**：锁三类静默失效 —— **A** 事件绑定 ↔ JS 方法存在性（75 页 / 1392 处绑定）/ **B** 自定义组件注册完整性（59 处）/ **C** 跳转目标可达性（205 处）/ **D** 判据非空自证（扫描量须达量级，否则报错）。共同特征：**不报错、只表现为「点了没反应」**。**写这类源码扫描器的三个硬要求**：① 词法剥离**必须识别正则字面量**（否则 `/["']/` 把后续源码整段吞掉，误报 0→189）；② 取方法名**必须容忍 `async` 前缀**；③ 内置组件白名单要含 `checkbox-group`/`radio-group`/`label`/`form`。另有：路由挂载 `const X = require('./routes/Y')` 与 `app.use('/api/v1/z', X)` **分处不同行，必须分开解析**（否则 260 条路由全解析成 0）；两端路径归一化都要剥掉 `/api/v1`；检查「wxml 引用但 js 未声明」**必须先把 `{{}}` 里的字符串字面量抹掉**（否则 `{{x ? 'chip active' : ''}}` 的类名被当字段，56 页误报→3 页）。
- **⚠ 静态断言的高危写法（每条都踩过）**：① 取函数体别用 `indexOf('_loadXxx')`（会命中 `onLoad` 分发行）→ 扫「参数括号收口后紧跟 `{`」，名字带点要允许 `= async (` 形式；② **位置断言不能拿 `indexOf('</view>')` 当容器收口** → **按标签名配对扫描**（`depth` 初值 1、只对同名标签配平、`depth===0` 才收口），同类元素同名时（顶部栏与条目都叫 `comment-head`）必须从正确起点找；③ **断言串同时出现在注释里时 `indexOf(全文)` 就是空判据** → 必须落在 `functionBody()` 切出的函数体内；④ **断言「某动作发生了」必须断言调用表达式本身**（`await X(`、`setStorageSync(k, v)`），不能只断言标识符/文案出现过；⑤ 断言 URL/CSS 别用 `[^"']*`（`viewBox='…'` 含引号会静默截断）→ 配对引号锚定；⑥ 断言「字段在对象里」别用 `/x,\s*$/m`（末键无逗号）→ 切 `Object.assign({}, r, {`→`})`；⑦ 三元拼的类名源码里不存在 → 匹配拼装片段；⑧ 地址抽成模块级常量时函数体内只剩变量名 → 连常量定义一起断言。⑨ **标签判据要锚定边界**：`/<richtext-editor/` 会命中 `<richtext-editor-x` → 用 `/<richtext-editor[\s/>]/`。
- **⚠「文案/键名还在」是最常见的假绿灯**：必须断言**完整表达式**（`/if\s*\(\s*!\s*content\s*\)\s*return\s+fail\(/`、`/editContent:\s*String\(\s*ds\.content/`、**逐块**切出容器再断言内部 handler）。断言「调用了某 API」不能只 `indexOf('wx.foo(')`（挂到 `null && wx.foo(...)` 或注释掉，**子串仍在、断言照样通过**）→ 断言**语句级调用**（逐行 `/^\s*wx\.foo\(\{/`）。**「不得出现 X」的断言要先剥掉注释**（注释里往往解释「为什么不用 X」）。
- **⚠ 反向验证是唯一能发现空判据的手段**：三批共 53 条改坏补丁，**抓出 9 处空判据** —— **护栏写完全绿不等于护栏有效**。模板 `.workbuddy/tmp_*_rv.py`（用后即删）。构造补丁：仓库 `.wxml/.wxss` 是 **LF**；「只删注释」不等于「改坏结构」；只改文案/只改一处重复串的补丁是**无效补丁**，别算「未捕获」。**⚠ 补丁串必须按目标文件换行符适配 —— 同仓混用：`components/contact-admin/*` 是 CRLF、`pages/push-groups/*` 是 LF**；不适配则 `count` 恒为 0、补丁被静默跳过，输出看着像「全捕获」其实根本没测（2026-10-08 一次 16 条补丁里 3 条被跳过）。**补丁匹配数 ≠ 1 必须报警，不能静默 continue。**
- **⚠ 怀疑「测试全绿是不是空跑」时，用 `assert` 计数器 preload 实测执行次数**（`node --require counter.js`，退出时写 stderr）—— 能抓出「断言在永不进入的分支里」与「helper 从未被调用」。`assert.fail('不该发生')` 类守卫执行数天然少，属健康。
- 假池 harness（`review-module.test.js` C 段）：`fakePool.query` 按 `queue` 顺序出值。**`createNotification` 是 fire-and-forget**，会偷吃后续用例 queue → 用例前 `await` 排空几 tick。**`.spring-btn` 的 hover 类必须写 `transform: scale(0.96)`**。
- **死代码静态分析必先修 6 个误报源**（wxss `@import` **裸相对路径** / **中文文件名** / `const {a}=alias` / `require('X')` **整体传递** / **测试文件也是消费者** / `_jsQR = require()` **赋值式**惰性加载）；**已知误报不可删**：`app.wxss`、`styles/iconfont.wxss`、`project.private.config.json`、`server/ecosystem.config.js`、`assets/avatar1|2/*`、`utils/jsqr.js`、`server/config/db.js`、`broadcast-bot/runtime/**`。**静态分析结果必须逐项人工核实。**
- **零测试覆盖的服务端模块（9 个）**：`services/errandExpiryService.js`（**331 行，最高风险 —— 到期自动取消/自动确认/退款，涉资金**）、`utils/clubSeed.js`、`services/wechatService.js`、`controllers/{share,wxacode,broadcast}Controller.js`、`services/subscribeRetryService.js`、`middleware/{errorHandler,logger}.js`。

## 跑腿订单（errand）★ 细节见 `2026-10-06.md`
- **状态机** `pending → accepted → finishing → finished`，另 `cancelled`/`disputed`。`finishing`（接单方已提交完成、待发单人确认）**对第三方不可见**；大厅可见性 = 「公开状态 OR (交接阶段 AND 当事人)」—— 少后半段则当事人历史 cancelled 会倒进大厅。
- **⚠ 取消两个入口（对称）**：`/errand/:id/cancel` = **发单人**取消，**必须绑 `errandController.cancel`**（`pending` 直取消；`accepted` **只能提交申请**落 `errand_cancel_request`，须接单方同意）。**曾错绑 `paymentController.cancelErrand`**（直接置 cancelled+退款、无校验无流水）→「接单后发单人照样能单方面取消」的根因。`/errand/:id/release` = **接单方**取消（30 分钟内自身原因可直取消并计 `self_cancel_count`）。审批统一走 `reviewCancelRequest`，审批人 = **申请的对方**（`isPublisherRequester` 判方向），**不能退化成「仅 publisher_id 可批」**。
- **⚠ 两条链共用 `action='cancel_requested'`**：服务端按方向写不同 `detail`。**端上文案表绝不能按 `action` 写死方向，以服务端 `detail` 为唯一真源。**（通用：一个 action 被两个方向复用时，文案/判据都不能只看 action。）
- **冻结 = 完成率过低且必须可解除**（`FREEZE_MIN_RECORDS`/`FREEZE_RATE`，`accept` 时 403）：**必须设冷却期**（7 天）且管理员可手动 `unfreeze` —— **不设冷却期 = 数学上的永久封禁**。**⚠ 状态必须三态**：`overThreshold` 只增不减，拿它判「待解冻」会把已解冻账号**永久误显示成待解冻**；服务端 `listErrandRunners` 必须显式下发 `frozen`/`unfrozen`。（通用：状态字段一旦有反向事件，就不能用单向指标现算。）
- **⚠ 任何把订单置 `cancelled` 的路径都必须写 `errand_order_log` 并关闭遗留 pending 申请**（`reserveErrandRefund` 曾是「静默取消」源头）—— **排查为何取消先查流水；cancelled 无流水 = 走了未埋点退款路径**。
- **⚠ 隐私列必须用「显式列清单」防串位**：`private_info`（取件码，仅接单者见）/`private_images`（JSON，仅当事人见）vs `remark`（公开描述，**viewer 也下发**）。大厅 `list` 用显式列清单；`detail` 对 viewer 走 `SELECT e.*` 后**剔除** `private_*`（公开 `images` 保留）。详情/审批下发**驼峰键** `requesterId`/`reasonSide`/`images`（必须数组）。
- **⚠ 建单 INSERT 的列/值必须配平**（2026-10-07 线上 100% 失败）：`errand_order` 23 列 → VALUES 必须 **22 个 `?` + 字面量 `'UNPAID'`**。**改这个 INSERT 后必须跑 `sql-placeholder-param-count.test.js`。**
- **`create` 前置链**：`auth → contentSecurity → idempotency → create`。`contentSecurity` 调微信 `msg_sec_check`（**网络请求 ~1s**）→ 建单耗时约 1s 属正常。`idempotency` 是**内存 Map**（不落库），cluster 下各实例独立。

## 认证与登录态
- 唯一登录 `POST /user/phone-login {code, phoneCode}`；`sys_user` 无密码字段。JWT HS256 单密钥，载荷仅 `{userId}`，**`JWT_EXPIRES=30d`**。`auth` **每请求回查 `sys_user` 的 role + status**（禁用/降权即时生效），不得退化为仅验签；`status !== 1` 返回 **403**（不是 401）。
- **登录态加固**：`utils/token.js` 解 JWT 判 `exp`（60s 余量）；`auth.isLoggedIn()` = 有 token **且未过期**；`request.js` 401：**带 token 仍 401** → 清 token + 断 WS + 弹一次「登录已失效」（5 分钟冷却 + 互斥），**游客 401 不弹**。
- 权限点 8 个：stats.view / content.manage / config.manage / item.manage / user.manage / role.assign / payment.manage / admin.manage。`ROLE_PERMISSIONS`：super_admin `*`；content_admin=content+config+stats；user_admin=user+stats；operator=item+config+stats+payment。

## 评价评论（review）★ 与 `pages/post-detail` 严格对齐
- **⚠ 头像卡片是共享组件 `components/avatar-sheet/`**（两页共用，不要再各写一份）：`selectComponent('#avatarSheet').open({ userId, nick, avatar, isOwner, mode, certLabel, allowAnonymousPm, fromPostId })`（`mode:'anon'` 只给「私信」，`'normal'` 给「个人主页」+「分身私信/私信」）。**2026-10-07 评价页复刻整块漏掉 → 「点头像没反应」（同批复刻第 4 个漂移问题）**。**通用：同一组件在 N 个页面出现时必须抽成自定义组件。** 护栏 `review-comment-parity.test.js` F/F2。
- **⚠ 评论头像必须带 `catchtap="onCommentAvatarTap"` + `data-userid/anonymous/nick/avatar/isowner/allowpm`**，缺任一项都表现为「点了没反应」或「卡片拿不到数据」。`allow_anonymous_pm` 是 **`sys_user` 的列**（服务端在 `messageController` 强制校验），评论接口必须 JOIN 并下发（`postController` 口径：缺省 `true`）。
- **⚠ 多维度评分（食堂/商圈）**：统一四维 `taste`(口味/商圈叫「品质」) 40% · `env` 20% · `service` 20% · `value`(性价比/商圈叫「价格」) 20%。**课程评分不启用**。定义在 `utils/review.js` 的 `REVIEW_DIMENSIONS`（展示口径）+ `reviewController.js` 的 `DIMENSIONS`（校验计算口径）**两份镜像，改一处必须同步另一处**。存储 `review_rating.dims`(JSON) + `review_target.dim_sums`/`dim_count`。**综合分口径不变** → `rating_sum`/`rating_count`/`ratingAvg`、列表排序、后台统计全部沿用。旧数据 `dims` 为 NULL → 仍计入综合分、不计入维度均分。
- **⚠ `migrations.js` 的 `ensureColumnType()` 只能做「DATETIME→VARCHAR」**（硬编码判 varchar）→ 其它类型转换必须用通用版 **`ensureColumnTypeIn(table, col, def, doneTypes)`**。
- **`review_comment` 有 `deleted`/`status` 两列**，软删 `deleted = 1`（查询都带 `deleted = 0`）。删完必须 `refreshCommentCount` + `refreshHotComment` 收口。
- **端上 `pages/review/target` 评论区已一比一复刻 `pages/post-detail`**：`.comment-item`（灰底 `#f7f9fc` + `border-left:6rpx`）、`.comment-meta` 昵称与时间同行、右上角 `.comment-more`「…」、`.comment-body` 内右侧 `.pa-heart` 双态爱心。**旧 `.comment-card`/`.comment-foot`/`.comment-reply-btn`/`👍` 已全删**。`pa-heart` 的 SVG 三处各一份（wxss 不跨页共享）。
- **「…」菜单四项**：隐藏（纯本机，不落库）/ 举报（`api.reportComment` → 通用 `/feedback/report`）/ 拉黑（`POST /message/block {peerId}`）/ 删除（`POST /review/comment/:id/delete`）。**前三项后端原本就有，只有删除是新增。**
- **自己的评价另有 `.comment-actions`「编辑/删除」一行**（不藏进「…」）：编辑 `POST /review/comment/:id/update`（**仅作者本人**，管理员也不给「改他人内容」）；删除走 `/delete`。两处入口都受 `wx:if="{{item.userId === currentUserId}}"` 控制，**`onShow` 必须刷新 `currentUserId`**。
- **⚠ 评论展示：`buildCommentTree(flat, expandedIds, sort, pin)`** —— `pin` 只在「刚提交顶层评价」那次重建生效（临时置顶），**刷新/翻页/切排序都不传 pin** → 回到真实排序位置；**回复不传 pin**，恒按 id 正序落在所属评价的回复末尾；回复提交后要用 `findCommentRootId()` **自动展开**所属评价。**⚠ 客户端排序是「服务端 ORDER BY 的镜像」，两边口径不同时不能互抄**：post-detail 服务端是 `like_count DESC, created_at ASC`，评价页是 `like_count DESC, id DESC` —— 照搬会导致「刷新后归位」时因 tie-break 不同再跳一次。护栏 G 组。
- **⚠ 评论昵称右侧不显示「分身」徽标**（2026-10-07 产品决定，`comment-cert--anon` 已删）；**但认证标签 `comment-cert` 与底部输入栏的「分身」开关（`onToggleAnonymous`）必须保留**。护栏 H 组。**通用：删 `wx:if`/`wx:elif`/`wx:else` 链里的首个或中间分支时，后续分支会变成孤儿（WXML 不报错、只是不渲染）→ 必须把下一个提升为独立条件。**
- **⚠ 评价回复的 `parent_id` 存「实际被回复的那条」，不得压平成顶层** —— 早期实现把「回复的回复」压平，**永久丢掉「回复的是谁」**（2026-10-07 线上；`commentController` 一直是存真实父级的正确基准）。**连带三处必须同步**：① `comments` 接口沿父链**循环**上溯求「所属顶层」（旧代码假定 parent_id 恒为顶层 → 整条漏掉）；② `deleteComment` 必须**逐层 BFS 收集后代**（`WHERE parent_id = ?` 只删一层会留孤儿）；③ 端上 `buildCommentTree` 上溯也必须**循环**。**历史数据无法回溯**（旧回复不显示前缀属预期）。护栏 `review-module.test.js` B2b/C2 + G 组。
- **⚠ 通用原则：存储要保真，展示可归并。**「只显示两级」是**端上的渲染决策**，不该让服务端压平 `parent_id` —— 一旦压平信息就再也补不回来。
- **⚠ 删除权限刻意比论坛窄一档**：`post-detail` 删除权 = 管理员 **或帖子作者**；**评价页不设「评分对象创建者」这一档**（评分对象是公共条目、没有作者角色）→ 服务端 `deleteComment` **只判 `content.manage` 管理员 + 评论作者本人**。删顶层评价连带其下**全部后代**（逐层 BFS），管理员删除写 `admin_audit_log`。
- **⚠ 评论区顶部栏必须叫 `.comments-header`，不能叫 `.comment-head`** —— 后者是「单条评论头部」（昵称+时间+「…」）。两者**特异性相同**，同名会让顶部栏独有的 `margin-top: 30rpx` **泄漏到每条评论的昵称行** → 「**头像与昵称不对齐**」（2026-10-07 线上）。护栏 C'' 组。
- **⚠ 嵌套可点区域：内层必须 `catchtap`** —— `.reply-list` 嵌在 `.comment-content-wrap.comment-reply-trigger` **内部**，两处都 `bindtap` 会**冒泡**：先触发子评论 handler，紧接着父级又触发一次并用**父评论的 `data-id`/`data-nick` 覆盖** → 「**回复子评论却显示父评论**」（2026-10-07 线上）。护栏 C''' 组（含「全文件不得出现 `bindtap="onReplyComment"`」的反向断言）。

## 管理后台（pkg-admin）
- **⚠ 编辑操作一律走独立整页 `pkg-admin/admin/edit/index`**。URL 契约 `?scope=<kind>&id=&type=&action=&categoryId=`，单页按 `scope` 渲染 **11 种表单 + 3 种审核 = 14 个 scope**（2026-10-08 实测 `_load*Form` 共 14 个；旧记忆的「13 种表单」是旧抽屉时代的 `form.kind` 数，已过时 —— campusCard/market/drivingGuide/promoLanding 四个改走 `pkg-feature/pages/banner-detail`）。**旧抽屉已全删，`admin/index.wxml` 的 `form.kind` 残留必须为 0**。保存成功写 `app.globalData.adminEditDone` → 后台 `onShow` 读后清理并 `loadCurrent()`。**两端共用常量在 `admin-edit-meta.js`**；**样式全 scope 共用**。护栏 `admin-edit-page-smoke.test.js`（入口 scope ↔ `_load*Form` 双向一一对应 + banner-detail 覆盖 4 个自定义页面 scope）。
- 列表页 `admin/index.*` 用 `activeTab` 切 10 个 Tab；`admin.js` 全打 `/api/v1/admin/*`，统一 `auth` + `requireAdmin(permission)`。客户端 `TAB_PERMISSIONS` **只控入口显隐，服务端才是真源**。**时间字段必须用 `fmtDateTime()`** —— API 返回 ISO **UTC**，直接 `slice` 会少 8 小时。
- **`pushGroup` 配色的 `<picker>` 是刻意的**：`PUSH_GROUP_THEME_OPTIONS = ['橙色','绿色','蓝色','紫色','青色']` 是 **5 套预设色系** → **不能换成 `color-field`（任意取色器），会破坏语义**。
- **正文标记渲染只走 `components/richtext-content`**（吃 `utils/richtext.js` 的 `parseBlocks`）。`**粗**`/`## 标题`/`{蓝|字}` 是**存储格式**，**`**` 只在编辑框可见——设计如此**。**展示 `detailContent`/`intro`/`notice`/`detail` 都必须接 `richtext-content`**；**`auditNote`/`reviewNote` 是管理员手写纯文本，刻意不走组件**。**`edit/index.wxml` 必须恰好接 5 个 `richtext-editor`**。**`club.intro`/`group_chat.intro` 两条写入链**：后台 `richtext-editor`(1000) **与用户端申请页纯 `textarea`(500)** —— 改存储格式时这 4 列 + 2 申请页一起改。**`group_chat.intro`(群介绍) 与 `notice`(群公告) 是两个字段**。
- **自定义页面「底部跳转按钮」** `link`/`linkText` 存 `system_content.body` JSON；表单在 `pages/banner-detail`，**与横幅共用同一组输入框（不得被 `!isCard` 挡住）**；用户端统一 `components/page-link-button`。**`loadBanner` 必须读 `raw.link`**（曾硬编码清空）。**「信息推送群」卡片** `iconPath` 同存 body JSON（仅 https、≤255 字）—— 该表单是**扁平 `form.iconPath`/`form.images`（其余挂 `form.meta.*`，唯一例外）**，图片处理函数按 scope 分支，否则写错路径静默丢失。**用户端 `pages/push-groups` 只显示卡片，点卡片弹二维码弹窗（对齐 `contact-admin` 的 QR 层），二维码取 `images[0]`，主按钮走 `web-static/wechat-qr.html`。**
- **⚠ 二维码「点击放大」现行口径（2026-10-08 复核，勿改回 `wx.previewImage`）**：`show-menu-by-longpress="{{true}}"` + `bindtap="toggleQrZoom"`（**页面内就地放大同一张 `<image>`**，`mode` 在 `widthFix`/`aspectFit` 间切）。**为什么不用 previewImage**：它是微信自带查看器，页面的 `show-menu-by-longpress` 注入不进去 → 用户实测「放大后长按没菜单」；且 previewImage 里长按对**个人好友码根本识别不出**。**开了原生长按菜单就不得再绑 `bindlongpress`**（两条长按互抢）。护栏 `push-group-detail.test.js` ④/④b **明确断言 JS 里不得出现 `previewImage`**。放大态 = 深色满屏查看器：`head` 用 `wx:if="{{!qrExpanded}}"` 隐藏、`background:#000`、`width:100vw`；**高度两行回退**（`100vh` 兜底 + `calc(100vh + 104rpx + env(safe-area-inset-bottom))` 撑出 tabbar —— fixed 包含块是「页面视口」**不含自定义 tabbar**），底部用等量 padding 抵消；**图片必须 `catchtap`**（`bindtap` 会冒泡到弹层 `stopPropagation`，刚放大就被收起）；放大态 `stopPropagation()` 收起（无关闭按钮，「点任意处」是唯一出口）。**⚠ 别用 `width:auto`（实测收缩成窄条）、别用 `height:auto`（塌成只剩 padding）。⚠ 光撑高度不够：自定义 tabBar 由框架渲染在页面之上、`z-index` 盖不住** → 放大态必须 `getTabBar().setData({ hidden: true })` **整块隐藏**（`custom-tab-bar` 的 data 要有 `hidden` 且 wxml 绑 `wx:if="{{!hidden}}"`；**每个 tab 页实例独立**、非 tab 页 `getTabBar()` 返回 undefined 要判空；**恢复点必须齐全**，漏一个 = 那个 tab 页的 tabBar 永久消失）。**⚠ `.is-full` 必须同时「覆盖基类 `max-width: 560rpx` → `none`」并「保留 `margin` 里的 `auto`（写 `0 auto`）」** —— 只写 `margin: 0` 会贴左；不覆盖 `max-width` 宽度被卡 ~400px（实测偏左 63px @538px）。**`pages/push-groups` 与 `components/contact-admin`（12 页在用）两处同款、改一处必须同步另一处**。详见 `docs/02_前端与UI交互.md` 第十四节。
- **⚠ `wx.showModal` 的 `content` 在「多行 + `editable:true`」同时开启时会被裁断**，`editable` 输入框也是单行 → **凡需完整多行正文或长输入，一律用自定义弹窗**（`.confirm-mask`/`.confirm-card`，正文 `white-space:pre-wrap` + `word-break:break-word`，输入用 `textarea`）。
- **改后台编辑功能必跑 6 个静态护栏**（audit-fixes / driving-school-module / group-chat-admin-form / push-group-detail / push-group-icon / richtext-editor）。**修法：表单/handler 断言指向 `edit/index.{wxml,js}` / `admin-edit-meta.js`，列表页断言保留**。
- **⚠ 静态扫描只能证明「代码长得对」，证明不了「跑得起来」。** `node --check` 查不出「引用了未定义的变量」；字符串断言对「重构时漏删引用」完全无感（2026-10-08 真机白屏 `patch is not defined`，29 条静态护栏全绿）。**页面/组件的关键方法（加载、保存、事件回写）用 `vm` 沙箱加载真实文件做行为冒烟**，模板 `server/tests/admin-edit-page-smoke.test.js`。**重构删代码后必须跑一次行为冒烟。**
- **⚠ 一条纠错规则太宽会吃掉另一条合法输入。** `normalizePagePath` 的「去掉站点域名」最初无条件生效，把运营有意配的**本站外链** `https://payun01.cn/page.html`（走 webview）改成 `/page.html` → 校验再拦下 → 「合法外链却保存不了」。**多规则交互出的 bug 静态断言抓不到，必须真的喂值跑。**
