# 首页布局与 UI 交互（合并文档）

## 概述

本组文档覆盖「校园论坛小程序」首页的设计规范与一组交互问题的修复：UI 重设计交付的视觉令牌、服务图标与资源规范；首页 `position: fixed` 导航栏与滚动容器的布局铁律；导航栏滚动显隐状态机；帖子「作者」标签样式统一；首页宫格占位入口清理与「找驾校」内容页；评论面板键盘自动弹出问题；以及全局路由防重与 `webviewId` 报错。所有修复均以源码级 `vm` 沙箱回归测试护航，未移动或删除任何输入文档。

## 原始文档清单

| 原文件名 | 日期 | 一句话要点 |
| --- | --- | --- |
| UI_REDESIGN_DELIVERY.md | 2026-09（无明确日，按交付基线） | 统一主色/强调色/圆角/动效等视觉令牌，定义服务图标、轮播图与信息流资源规范 |
| 修复说明_2026-09-10_首页导航栏滚动显隐.md | 2026-09-10 | 修复首页导航栏滚动后整条消失且无法恢复，沉淀 fixed 元素布局铁律 |
| 修复说明_2026-09-11_作者标签样式统一.md | 2026-09-11 | 帖子详情页「作者」标识由 `<text>` 改 `<view>` 并对齐首页款式 |
| 修复说明_2026-09-12_首页占位入口与找驾校内容页.md | 2026-09-12 | 因微信审核驳回清理 6 个占位入口，新增「找驾校」真实内容页 |
| 修复说明_2026-09-15_首页评论面板自动弹键盘.md | 2026-09-15 | 评论面板打开不再自动弹键盘，并补齐键盘高度上移逻辑 |
| 修复说明_2026-09-11_路由防重_webviewId报错.md | 2026-09-11 | 全局路由加防重锁，消除 `routeDone with a webviewId xxx is not found` |

## 视觉令牌与设计规范

来源：UI 重设计交付。

### 现象 / 背景

首页信息流、服务图标系统、课表网格、轮播图与个人资料等模块需要一套统一的设计语言，避免各页面视觉不一致。

### 根因 / 设计基线

此前缺少集中定义的视觉令牌，颜色、圆角、动效散落在各页面，难以统一维护。

### 处理方案（视觉令牌）

- 主色：`#315CFF`
- 强调色：`#12B8A6`
- 暖色：`#FF8A3D`
- 背景色：`#F4F6FA`
- 卡片圆角：`18rpx`
- 动效：`160ms` 按下反馈，`240-320ms` 过渡动画

### 资源规范

- 轮播图：`assets/banners/banner-schedule.png`、`banner-community.png`、`banner-errand.png`，尺寸均 `750x400`，每张不超过 `10KB`。
- 服务图标：`assets/icons/svc-*.png`，`48x48`，透明 PNG。
- 信息流操作图标：`assets/icons/star.png`、`star-outline.png`、`more.png`。

### 实现说明

- 轮播图内容由 `utils/banner.js` 根据课表、帖子和服务上下文动态生成。
- 帖子卡片支持 1/2/3+ 图片布局以及乐观更新的点赞/收藏/关注状态。
- 发布支持图片/视频媒体选择、草稿持久化、加载状态、失败重试和首页信息流插入。

### 涉及文件

`assets/banners/*`、`assets/icons/*`、`utils/banner.js` 及首页/课表/个人资料页面。

### 验证

- 修改过的 JS 文件运行 `node --check`；`server` 中运行 `npm test`。
- 手动设备验证：微信开发者工具中检查 375px 手机、768px 平板和桌面模拟器宽度。

### 结论 / 已知限制

设计交付物以仓库资源、代码和文档形式落地（当时未暴露 Figma MCP 工具，无实时 Figma 文件）。OCR 准确率需在接入真实 OCR 引擎并运行已标注评估集后才能认证达到 95% 以上。

## fixed 导航与滚动容器布局（布局铁律）

> 本主题合并自 2026-09-10（导航栏滚动显隐）、2026-09-09（float-actions 下沉，由 09-10 文档转述）与 2026-09-15（评论面板 fixed 键盘）中关于 `position: fixed` 与滚动容器的重复踩坑，归并成一条完整铁律，不在各篇重复。

### 现象

首页多个原应「相对视口固定」的元素出现异常：自定义导航栏整条消失且不恢复（2026-09-10）；右下角浮动按钮整条沉到 tab 栏下（2026-09-09）；评论面板 `position: fixed; bottom: 0` 弹键盘后输入区被遮挡（2026-09-15）。

### 根因（两条链）

**链路一：祖先元素的 `transform` 劫持 `position: fixed` 的包含块。**

- `app.wxss` 的 `.page-enter { animation: page-enter 0.28s var(--ease-standard) both; }` 使用 `animation-fill-mode: both`，动画结束后 `.page` 永久保留最后一帧 `transform: translateY(0)`。
- 只要元素存在非 `none` 的 `transform`，它就成为后代中 `position: fixed` 元素的包含块（containing block）。于是 `.custom-nav`、`.comment-sheet`、`post-card` 弹层、`.float-actions` 等退化为「相对 `.page` 定位」，并受 `.page { overflow: hidden }` 裁剪，不再是真正的「相对视口固定」。
- 2026-09-09 的 `.float-actions` 下沉，即是此坑首次被踩，当时修法是把按钮移到 `.page` 外层，并留下教训「fixed 元素不要放在带入场动画(transform)的容器内」。2026-09-10 的 `.custom-nav`、仍在 `.page` 内的 `.comment-sheet`、`post-card` 弹层、`.campus-picker` 是同一坑的漏网之鱼。

**链路二：页面本体可被拖动，整页偏移无法复位。**

- `.page` 为 `min-height: 100vh`，内部 = 导航占位（`statusBarHeight + navBarHeight` ≈ 170rpx）+ 一个 `height: 100vh` 的 `scroll-view`，总高度比视口高出一个导航栏，因此页面本体（document）自身可被拖动约一个导航栏的高度。
- 用户滑到 `scroll-view` 顶部继续下拉时，手势链式滚到页面本体，被「固定」在 `.page` 顶部的导航栏跟着上移、整条移出屏幕；向上滚动只回滚内层 `scroll-view`，页面本体偏移不自动复位，下拉刷新与搜索栏刷新都只重置内层状态，导航栏再也回不来。

### 处理方案（布局铁律）

1. **fixed 元素必须脱离任何可能带 `transform` 的祖先**：`.custom-nav`、`.float-actions` 等放到 `.page` 外层；删除 `.page-enter` 的 `animation-fill-mode: both`，让 `.page` 不再永久保留 `transform`、不再劫持 fixed 包含块（keyframes 终态与元素默认样式一致，视觉等价）。
2. **滚动容器高度精确计算，让页面本体零滚动**：`.page { height: 100vh }`（原 `min-height`）；`.scroll-container { height: calc(100vh - var(--nav-h, 0px)) }`，占位 + scroll-view 恰好等于 100vh，任何手势都无法把整页顶上去；保留 `height: 100vh` 兜底行。`.page` 内联注入 `--nav-h: {{statusBarHeight + navBarHeight}}px`。
3. **fixed 底部面板需自行处理键盘高度**：评论面板等 `position: fixed; bottom: 0` 元素，输入框应监听键盘高度并上移面板，否则即使不自动聚焦，用户手点输入时键盘仍会盖住输入区（详见「评论面板键盘行为」一节）。

### 涉及文件

`app.wxss`（`.page-enter` / `.page`）、`pages/index/index.wxml`（`.custom-nav` 移外层、注入 `--nav-h`）、`pages/index/index.wxss`（`.scroll-container` 高度）、`pages/index/index.js`、`custom-tab-bar/index.js`、各 fixed 弹层组件。

### 验证

- 2026-09-10：新增 `server/tests/index-nav-scroll.test.js`，5 组 20+ 断言全通过；回归 `chat-back-to-post.test.js`、`smoke.test.js` 通过。
- 2026-09-15：新增 `server/tests/index-comment-sheet-keyboard.test.js` 等。
- 删除 `.page-enter` 的 `both` 后，`.page` 不再创建层叠上下文，`.page` 内 `z-index: 1000+` 弹层现在正确盖住 `z-index: 90` 浮动按钮（属修正）；首页 z-index 复核：导航 100、评论面板 210/220、banner 指示器 2，层级关系不变。

### 结论

首页 fixed 元素的「相对视口固定」必须由「脱离 transform 祖先 + 滚动容器精确高度 + 页面本体零滚动」共同保证；底部 fixed 面板的键盘避让由页面自己实现。其余带 `page-enter` 的页面（club/group-chat/activity）其 fixed 元素早已按约定放 `.page` 外层，本次改动对它们只有正向收益。

## 导航栏滚动显隐

来源：2026-09-10 修复说明（与上一节「布局铁律」同根，本节聚焦显隐状态机本身）。

### 现象

首页向下滚动后，顶部自定义导航栏（品牌胶囊「广轻校园圈」+ 浅蓝渐变底）整条消失；向上滚回顶部、下拉刷新、点击搜索栏刷新按钮后，导航栏都不再出现；副症状为整页内容上移约一个导航栏高度（banner 顶部被裁、状态栏被深蓝占满）。

### 根因

见「布局铁律」链路二：页面本体可被拖动，把伪固定的导航顶出屏幕且无法复位；叠加 `.page-enter` 残留 `transform` 使导航非真正 fixed（见布局铁律）。

### 处理方案

在布局铁律修好的基础上，把导航栏显隐做成显式状态机：

- `pages/index/index.js` 新增 `data.navVisible`；`onContentScroll` 按滚动方向驱动显隐；`onContentScrollToUpper` / `scrollContentToTop` / `onShow` / `onContentRefresh` / `onPullDownRefresh` / `onRefreshAction` 一律强制展开（任何「重新出现」入口都复位）。
- `.custom-nav` 增加 `transform/opacity` 过渡与 `.nav-hidden { transform: translateY(-100%); opacity: 0 }`。
- 显隐判定（`onContentScroll`）：

```js
const isAtTop = scrollTop < NAV_AT_TOP_OFFSET            // 8：已在顶部 → 必定展开
let navVisible = this.data.navVisible
if (isAtTop || delta <= -NAV_DIRECTION_THRESHOLD) navVisible = true        // 上滚 ≥6px → 展开
else if (delta >= NAV_DIRECTION_THRESHOLD && scrollTop > NAV_HIDE_MIN_OFFSET) navVisible = false  // 下滚 ≥6px 且离开顶部 30px → 收起
```

- 沿用 80ms 节流，只对变化的字段 `setData`；方向阈值 6px + 收起最小位移 30px，避免像素级抖动。

### 涉及文件

`pages/index/index.wxml`、`pages/index/index.wxss`（`.custom-nav` / `.nav-hidden`）、`pages/index/index.js`（状态机）、`app.wxss`（布局铁律部分）。

### 验证

`server/tests/index-nav-scroll.test.js` 覆盖 5 组共 20+ 断言全通过：向下收起→向上展开→再下滚收起→回顶保持展开；`bindscrolltoupper` 必展开；回顶部入口必展开；`onShow`/下拉刷新/搜索栏刷新必展开；80ms 节流内高频被忽略、低位移不抖动。回归 `chat-back-to-post.test.js`、`smoke.test.js` 均通过。

### 结论

导航栏显隐与布局铁律绑定解决：先保证导航真正 fixed 且页面零滚动，再用方向状态机驱动收起/展开，所有复位入口显式强制展开，杜绝「回不来」。

## 卡片标签样式统一（text 与 view 的区别）

来源：2026-09-11 修复说明。

### 现象

帖子详情页（评论区/回复列表）的「作者」标识，视觉与首页帖子卡片的「作者」标识不一致，要求按首页款式统一（文案「作者」不变，仅改样式）。

### 根因

差异在于承载元素与样式取值：详情页用 `<text>`（inline，`height` / `overflow` 对小程序 inline 元素不生效），无法固定高度与圆角；样式取值也与首页不同。差异对照（修改前）：

| 样式项 | 首页帖子卡片（目标款） | 详情页评论区（修改前） |
| --- | --- | --- |
| 承载元素 | `<view>`（.post-anonymous-label） | `<text>`（inline，height/overflow 不生效） |
| 高度 | 固定 34rpx | 无固定高度（随行高撑开） |
| 水平内边距 | 11rpx | 8rpx |
| 圆角 | 9rpx | 4rpx |
| 背景 | `#f34e72` 粉红实心 | `#fff4f4` 浅红底 |
| 文字颜色 | `#fff` 白 | `#e34b4b` 红 |
| 字号 / 字重 | 22rpx / 700 | 20rpx / 600 |
| 边框 | 无 | `1rpx solid #ffcaca` 描边 |

### 处理方案

- `pages/post-detail/index.wxss:115`：`.author-comment-label` 改为与首页 `.post-anonymous-label` 逐项对齐：`inline-flex` + 固定 `34rpx` 高 + `padding: 0 11rpx` + `border-radius: 9rpx` + `background: #f34e72` + `color: #fff` + `font-size: 22rpx` + `font-weight: 700`，并显式 `border: 0`。
- `pages/post-detail/index.wxml:99`、`:110`：主评论与回复列表的「作者」由 `<text>` 改为 `<view class="author-comment-label">作者</view>`。
- 文案「作者」与显示条件（`wx:if="{{item.isAuthor}}"` / `{{reply.isAuthor}}"`）均未改变。

### 涉及文件

`pages/post-detail/index.wxml`、`pages/post-detail/index.wxss`、`pages/index/index.wxss`（`.post-anonymous-label` 目标款）。

### 验证

新增 `server/tests/author-label-style.test.js`：逐项比对 `.author-comment-label` 与 `.post-anonymous-label` 的 background/color/font-size/font-weight/height/border-radius/padding-x/边框，并校验 wxml 用 `<view>`；`9 tests passed.`。回退为旧样式后测试 exit 1 报出 8 项差异（测试有效）。`local-imports.test.js` 通过（65 处引用校验）。

### 结论

全站三处「作者」标识（首页卡片 `.post-anonymous-label`、热榜 `.hot-rank-post-label`、详情页 `.author-comment-label`）视觉一致。其中首页热榜 `.hot-rank-post-label` 取值本就与卡片相同，未改动。

## 首页宫格与占位入口（找驾校内容页）

来源：2026-09-12 修复说明。

### 现象

微信审核驳回：首页「找驾校」仅弹「找驾校 即将上线」toast，属占位入口，违反《微信小程序平台运营规范常见拒绝情形 3.3》（运营内容不完整）。排查发现首页宫格 18 个入口中有 8 个无落地页，点击只弹「即将上线」。

### 根因

- 7 个入口（`校车时刻`、`轻友指南`、`校园市场`、`校园卡`、`速印`、`返乡大巴`、`特惠寄件`）无路由或被 `utils/api.js` 的 `SERVICE_NO_LINK` 清空 link；`找驾校` 无路由（审核员点名）。
- 另 `pkg-schedule/schedule-home/index.wxml` 的「教务文档」入口绑定 `onComingSoon`，同样弹「即将上线」。

### 处理方案

**1. 新增「找驾校」真实内容页 `pages/driving-school/*`**：端上静态信息页，无需登录；含头部说明+标签、免责提示条、7 步学车流程、报名材料清单、班型参考、考试科目与学时（C1 共 62 学时）、7 条 FAQ、6 条避坑提示+「复制提醒发给室友」、复用 `contact-admin` 组件。已在 `app.json` 的 `pages` 注册 `pages/driving-school/index`。

**2. 首页宫格清理**（`pages/index/index.js` → `buildHomeGrid`）：
- 保留/接入真实内容：`找驾校`→新页；`校园市场`→首页「二手闲置」分类；校园活动/群聊/社团等原有页面；课程表/教务等原有教务页；自助购电/订水/乘车码→服务端 H5/外部小程序跳转。
- 移除 `校车时刻`、`轻友指南`、`校园卡`、`速印`、`返乡大巴`、`特惠寄件`（无落地页，后续上线把名字加回 `row1`/`row2` 并在 `onServiceTap` 补路由即可恢复）。
- 填充逻辑由 `row1.forEach` 改为按 `Math.max(row1.length, row2.length)` 逐列填充，两行长度不一致不错位；清理后 10+8=18 项，9 列铺满。
- `onServiceTap` 兜底提示由「即将上线」改为「服务暂未开放」（防御服务端临时新增未知条目的死分支）。

**3. `pages/service-all/index.js`**：补「找驾校/校园市场/校园评价/图书馆/教务文档」落地方式，统一收敛 `SERVICE_ROUTES` 路由表；新增 `isServiceAvailable` 过滤，无落地目标的服务不下发视图（过滤校园卡、宅印、校园网、选课系统、轻友指南、校车时刻等）；保留 `FEATURE_GUARDS` 与 `requireFeatureAccess(guardName, { autoBack: false })`。

**4. `pkg-schedule/schedule-home/*`**：移除「教务文档」入口及其 `onComingSoon`，改为注释说明常用表格从「教务系统跳转网址」进入。

### 涉及文件

`pages/index/index.js`、`pages/driving-school/*`（4 文件）、`pages/service-all/index.js`、`pkg-schedule/schedule-home/*`、`utils/api.js`、`app.json`。

### 验证

新增 `server/tests/home-entry-availability.test.js`（27 项源码级护栏）：宫格两行名单与登记表双向一致；已下线 6 个占位入口不再出现；13 个页面型入口能找到跳转目标、2 个分类型入口能找到 `applyCategoryByName`、3 个服务端跳转入口在 `SERVICE_FALLBACK_LINKS` 有兜底；「找驾校」4 文件齐备且已注册；三处页面不再出现「即将上线」toast。反向验证：把「校园卡」放回宫格测试立即失败。回归 `feature-access-guard.test.js` 26 项全通过。

### 结论

占位入口从源头消除，首页各入口均对应真实功能；「找驾校」为学车信息与报名指引页，平台不参与招生收费。提审建议在开发者工具「上传」后提交审核，备注可写上述说明，必要时录制「首页→各宫格入口」完整录屏。

## 评论面板键盘行为

来源：2026-09-15 修复说明（键盘避让的布局部分亦并入「布局铁律」）。

### 现象

首页帖子列表点评论图标（「评论 9」）打开评论面板时，键盘自动弹出并遮住评论列表；用户意图是读评论而非写评论。

### 根因

1. **语义写错**：打开面板的语义被写成「准备发评论」。`onPostComment()` 直接 `setData({ commentSheetFocus: true })`，`focus` 是微信 `<input>`/`<textarea>` 受控属性，绑值变 `true` 即聚焦拉起键盘；`commentMode === "sheet"` 且页面为首页（全仓仅首页用 `sheet`，其余页用默认 `detail` 跳详情页带 `&comment=1`）。
2. **键盘避让缺失**：评论面板 `position: fixed; bottom: 0`（`pages/index/index.wxss:688-692`），输入框设 `adjust-position="{{false}}"`（页面不自动上推），而 `pages/index/index.js` 此前全文件 `keyboardHeight` 零出现——即使去掉自动聚焦，手点输入时键盘仍盖住输入区。对照帖子详情页 `.bottom-bar` 用 `style="bottom: {{keyboardHeight}}px"` 并由 `onInputFocus`/`onInputBlur` 维护，是正确做法。

### 处理方案（纯客户端，2 文件，服务端零改动）

`pages/index/index.js`：
- `data` 新增 `commentSheetKeyboardHeight: 0`；
- `onPostComment()`：`commentSheetFocus: true` → **`false`**（打开不抢焦点），同时重置键盘偏移；
- `closeCommentSheet()`：增加 `commentSheetKeyboardHeight: 0` 复位；
- 新增 `onSheetKeyboardChange(e)`：按键盘高度更新偏移，写法同 `components/post-card` 的 `onNoteKeyboardChange`；容错改为 `((e && e.detail) || {})`（B2 组测试实际抓出 `(e.detail || {})` 在 `e` 为 `undefined` 时抛错）。

`pages/index/index.wxml`：
- `.comment-sheet`（第 243 行）增加 `style="bottom: {{commentSheetKeyboardHeight}}px;"`；
- 评论输入框（第 285-294 行）增加 `bindkeyboardheightchange="onSheetKeyboardChange"`。
- 保留 `focus="{{commentSheetFocus}}"` 绑定（仍是正确的焦点开关，只是打开时不再置 `true`）；发送成功后与打开表情面板的 `commentSheetFocus: false` 复位逻辑不变。

> 另一条路径（本次未改，供决策）：其余页用 `commentMode="detail"`，点评论跳详情页并因 `pages/post-detail/index.js:128-131` 的 `options.comment === "1"` 在 450ms 后自动聚焦——同样自动弹键盘。语义是「点评论=去详情页发评论」，可能为有意设计，本次未改；若统一为「先看评论」，删掉该 `setTimeout` 自动聚焦分支即可。

### 涉及文件

`pages/index/index.js`、`pages/index/index.wxml`。

### 验证

新增 `server/tests/index-comment-sheet-keyboard.test.js`（8 用例）：`onPostComment` 后 `commentSheetFocus === false`、无键盘偏移；原有初始化行为未被破坏；无 post 不打开面板；键盘弹出写入、收起归零、`e` 缺失不抛错、关闭时焦点与偏移双复位；WXML 三处接线在位；`onPostComment` 不得再出现 `commentSheetFocus: true` 且须显式置 `false`。75 个测试文件全部通过（含新增）。真机验证 5 步：开面板不弹键盘、点输入框键盘上移不遮挡、发送后复位、重开仍不弹、连续开关无残留。

### 结论 / 上线要求

修复后：点评论图标→只看评论不弹键盘；点输入框→键盘弹出且面板随之上移。本次为纯小程序端改动，**必须用微信开发者工具重新上传并发布新版本**，否则用户仍看到旧行为。

> 附（无关改动，需留意）：`server/controllers/messageController.js` 有未提交改动（+37/-11）「匿名私信订阅提醒」修复，新增 `resolveSenderNick()` 让匿名方通知用分身昵称且不回落真实昵称，已线上生效但未提交 git，建议尽快提交以免丢失。

## 路由防重与 webviewId 报错

来源：2026-09-11 修复说明。

### 现象

控制台红色报错：`SystemError (appServiceSDKScriptError) "[Page Route 错误](system error)] routeDone with a webviewId 266 is not found"`。

### 根因

这是页面路由层错误：一条路由完成回调执行时找不到目标 webview，典型触发是短时间内重复触发路由（上一条转场未结束又来一条，框架回收/复用 webview 对不上号）。项目侧两个诱因：
- `custom-tab-bar/index.js` 的 `onChange`：点击当前已选中 tab 仍走 `wx.switchTab`，对当前页重复路由（经典触发源），且整页无意义重载。
- 全项目路由调用（卡片双击、事件冒泡双触发、转场期间连点）均无防重保护，重复 `navigateTo` 直达框架。

另：控制台同现的 `Lazy code loading is enabled` 与基础库 3.16.2 在开发者工具上有同类框架噪音（栈全在 `WAServiceMainContext.js` 内部），真机不出现；清零项目侧诱因后残余偶发可忽略。

### 处理方案

| 位置 | 修复 |
| --- | --- |
| `app.js` 新增 `installRouteGuards()`（onLaunch 首位调用） | 对 `navigateTo / redirectTo / reLaunch / switchTab` 统一加「进行中」锁：一条路由未结束前重复调用**静默忽略**（表现与原生一致「点了没反应」）；`success` 回调后 350ms 冷却覆盖转场动画窗口；**`fail` 立即放行**，保留「navigateTo 失败回退 switchTab」（首页公告链接跳 tab 页）链式跳转 |
| `custom-tab-bar/index.js` 的 `onChange` | 点击当前已选中 tab 直接 `return`，不再重复 `switchTab` |

### 涉及文件

`app.js`、`custom-tab-bar/index.js`（全局生效）。

### 验证

新增 `server/tests/route-guard.test.js`（8 项，vm 加载真实 app.js 与 custom-tab-bar）：四类路由 API 均被加固（`__routeGuarded` 标记）；进行中重复调用被吞、只放行第一条、原 `success` 透传、350ms 冷却后放行；`fail` 立即放行（链式回退不被误吞）；tabBar 点击已选中 tab 不再 `switchTab`、点其他 tab 正常、课程表 tab 自动展开标记保持。结果 `8 tests passed.`；回退两处修复后 exit 1（测试有效）；`node --check` 与 `local-imports.test.js` 通过。

### 结论 / 部署

涉及 `app.js` + `custom-tab-bar/index.js` 全局生效，请用 `deploy_full.py` 全量部署。若开发者工具仍偶发同款报错但栈里无项目文件，属工具/基础库噪音，真机调试确认不影响功能。

## 遗留问题与后续建议

1. **评论面板另一条路径未统一**：其余页（搜索结果/我的帖子/个人主页）用 `commentMode="detail"`，点评论跳详情页并在 450ms 后自动聚焦弹键盘，与首页「先看评论」语义不一致。若需统一，删掉 `pages/post-detail/index.js:128-131` 的 `setTimeout` 自动聚焦分支即可，建议产品确认是否故意。
2. **messageController.js 未提交改动**：匿名私信订阅提醒修复（新增 `resolveSenderNick()`）已线上生效但未提交 git，存在丢失风险，建议尽快提交。
3. **UI 重设计交付的 OCR 准确率**：需在接入真实 OCR 引擎并运行已标注课表图片评估集后，才能认证达到 95% 以上。
4. **Figma 实时文件缺失**：当次交付未暴露 Figma MCP 工具，设计交付物为仓库资源+代码+文档形式，后续如需实时 Figma 协作需补接。
5. **布局铁律需固化到规范**：fixed 元素脱离 transform 祖先 + 滚动容器精确高度 + 底部面板自处理键盘高度，建议写入团队组件开发规范，避免后续页面再次踩坑。
6. **占位入口治理持续化**：`isServiceAvailable` 与 `SERVICE_ROUTES` 已从源头拦截占位入口，新增服务需同步维护登记表与路由表，否则 `home-entry-availability.test.js` 会失败。
