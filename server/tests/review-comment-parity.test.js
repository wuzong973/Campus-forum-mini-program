/**
 * 评价评论区「对齐帖子详情页」回归测试（静态断言 + vm 行为断言，无需真机/数据库）
 *
 * 背景（2026-10-07 用户需求）：
 *   「图二（评价页）的评论框换成图一（帖子详情页）的评论框，一比一复刻，右边的图标和功能也是」。
 *   评价页原实现是「白底圆角卡片 + 👍 emoji + 底部 时间/回复 两栏」，
 *   帖子详情页是「浅灰底 + 左侧色条 + 昵称与时间同行 + 右上角…菜单 + 正文右侧爱心」。
 *
 * 本测试锁定的口径：
 *   1. 视觉：评价条目改用 .comment-item（浅灰底 + 左侧 6rpx 色条），不再是 .comment-card；
 *   2. 图标：点赞用 SVG 双态爱心 .pa-heart（灰描边 → 实心红），不再用 👍 emoji；
 *   3. 功能：右上角「…」菜单 = 隐藏 / 举报 / 拉黑 /（管理员）删除，四项能力齐备；
 *   4. 后端：删除走 POST /review/comment/:id/delete，且路由必须绑到 reviewController.deleteComment。
 *
 * 注意（踩过的坑，务必保留）：
 *   · 断言字符串若同时出现在注释里，indexOf(全文) 就是空判据 ——
 *     所以「函数体内」的断言必须落在 functionBody() 切出的体内，不能查全文。
 *   · 位置断言不能拿 indexOf('</view>') 当容器收口，必须按标签名配对扫描。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const WXML = fs.readFileSync(path.join(ROOT, "pkg-feature", "pages", "review", "target.wxml"), "utf8");
const WXSS = fs.readFileSync(path.join(ROOT, "pkg-feature", "pages", "review", "target.wxss"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "pkg-feature", "pages", "review", "target.js"), "utf8");
const API = fs.readFileSync(path.join(ROOT, "utils", "api.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(ROOT, "server", "routes", "reviewRoutes.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(ROOT, "server", "controllers", "reviewController.js"), "utf8");

let count = 0;
function check(fn, msg) {
  try {
    fn();
    count += 1;
  } catch (err) {
    console.error("FAILED:", msg || err.message);
    throw err;
  }
}

/**
 * 从源码里切出某个方法的函数体。
 * 做法：定位 `name(` 后找到与之配平的右括号，再吃掉空白与 `async`，
 * 直至遇到紧随的 `{`，然后按花括号配平取到收口。
 * 不能用 indexOf('_loadXxx') 之类，会先命中调用行。
 */
function functionBody(src, name) {
  // 名字里可能带点（exports.deleteComment）或 $，所以不转义、直接用 indexOf 定位，
  // 再校验其后紧跟的是 ( 或 = async ( —— 避免命中调用点。
  let at = -1;
  let from = 0;
  for (;;) {
    const idx = src.indexOf(name, from);
    if (idx === -1) break;
    const after = src.slice(idx + name.length);
    const before = idx > 0 ? src[idx - 1] : "\n";
    const isDef = /[\s,{;:(]/.test(before)
      && (/^\s*\(/.test(after) || /^\s*=\s*(async\s*)?\(/.test(after));
    if (isDef) { at = idx; break; }
    from = idx + name.length;
  }
  assert.ok(at > -1, "未找到方法定义：" + name);
  const open = src.indexOf("(", at + name.length);
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // 参数括号收口后可能还有空白 / 注释 / =>，取紧随的第一个 {
  const brace = src.indexOf("{", i);
  assert.ok(brace > -1, name + " 未找到函数体起始花括号");
  let bd = 0;
  let j = brace;
  for (; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === "{") bd += 1;
    else if (ch === "}") {
      bd -= 1;
      if (bd === 0) break;
    }
  }
  return src.slice(brace, j + 1);
}

/**
 * 按标签名配对扫描，切出「某个 class 的元素的完整内容」。
 * 不能用正则 `[\s\S]*?</view>` —— 那会命中内层元素的收口，得到的是残缺片段，
 * 断言就变成「检查一个被截断的字符串」，判据静默失效。
 * 做法：定位 `<view class="cls">`，从 depth=1 起只对同名 <view>/</view> 配平，
 * depth 回到 0 才是真正的收口。
 * fromIndex 用于跳过同名但语义不同的元素（如评论区顶部栏也叫 comment-head）。
 */
function elementByClass(src, cls, fromIndex) {
  const openRe = new RegExp('<view class="' + cls + '[^"]*"[^>]*>', "g");
  openRe.lastIndex = fromIndex || 0;
  const m = openRe.exec(src);
  assert.ok(m, "未找到 <view class=\"" + cls + "\">");
  let depth = 1;
  const tagRe = /<(\/?)view\b[^>]*>/g;
  tagRe.lastIndex = m.index + m[0].length;
  let hit;
  while ((hit = tagRe.exec(src))) {
    depth += hit[1] === "/" ? -1 : 1;
    if (depth === 0) {
      return src.slice(m.index + m[0].length, hit.index);
    }
  }
  assert.fail("未找到 " + cls + " 的收口标签");
}

/** 评价条目里那个 comment-head（不是评论区顶部栏）：以 comment-item 为起点向后找 */
function commentItemHead() {
  const itemStart = WXML.indexOf('<view\n        wx:for="{{comments}}"') > -1
    ? WXML.indexOf('<view\n        wx:for="{{comments}}"')
    : WXML.indexOf('class="comment-item');
  assert.ok(itemStart > -1, "未找到评价条目起点");
  return elementByClass(WXML, "comment-head", itemStart);
}

// ============================================================
// A. 视觉：条目容器与图标换成帖子详情页那一套
// ============================================================
check(() => {
  assert.ok(/class="comment-item[^"]*"/.test(WXML), "评价条目应使用 .comment-item（帖子详情页同款）");
  assert.ok(!/class="comment-card/.test(WXML), "不应再保留旧的 .comment-card 白底卡片");
  assert.ok(
    /\.comment-item\s*\{[^}]*background:\s*#f7f9fc/.test(WXSS),
    ".comment-item 应为浅灰底 #f7f9fc（与帖子详情页一致）",
  );
  assert.ok(
    /\.comment-item\s*\{[^}]*border-left:\s*6rpx\s+solid/.test(WXSS),
    ".comment-item 应有 6rpx 左侧色条（与帖子详情页一致）",
  );
}, "A1：条目容器改为帖子详情页同款（浅灰底 + 左色条）");

check(() => {
  // 点赞图标：SVG 双态爱心，不再是 emoji。
  // 注意：必须断言「所有点赞位都是 pa-heart」，只断言「存在一处 pa-heart」是空判据 ——
  // 只要有一个位保留 pa-heart，其余全换成 emoji 也能骗过。
  const bodies = WXML.split('<view class="comment-body">').slice(1);
  assert.ok(bodies.length >= 2, "应存在至少两处 .comment-body（顶层评价 + 回复）");
  bodies.forEach((seg, idx) => {
    let depth = 1;
    const tagRe = /<(\/?)view\b[^>]*>/g;
    let hit;
    let end = seg.length;
    while ((hit = tagRe.exec(seg))) {
      depth += hit[1] === "/" ? -1 : 1;
      if (depth === 0) { end = hit.index; break; }
    }
    const inner = seg.slice(0, end);
    assert.ok(
      /class="comment-like[^"]*"[\s\S]*?class="pa-icon pa-heart/.test(inner),
      "第 " + (idx + 1) + " 处点赞位必须使用 .pa-icon.pa-heart",
    );
  });
  // 全文件不应再有任何 👍 作为点赞图标
  assert.ok(!/👍/.test(WXML), "点赞图标不应再出现 👍 emoji");
  // 两态都要有：灰描边 + 实心红
  assert.ok(/\.pa-heart\s*\{[^}]*background-image/.test(WXSS), "缺少 .pa-heart 未选中态（灰描边）");
  assert.ok(/\.pa-heart\.on\s*\{[^}]*e55b69/.test(WXSS), "缺少 .pa-heart.on 选中态（实心红 #e55b69）");
}, "A2：点赞图标改为双态爱心");

check(() => {
  // 昵称与时间同行：「…」按钮在同一 head 行内
  const head = commentItemHead();
  assert.ok(/comment-nick/.test(head), "comment-head 内应有昵称");
  assert.ok(/comment-time/.test(head), "comment-head 内应有时间（昵称与时间同行）");
  assert.ok(/comment-more/.test(head), "comment-head 内应有「…」按钮");
  // 反向：昵称与时间必须同在一个 .comment-meta 里（而不是分布在两行）
  const meta = elementByClass(head, "comment-meta");
  assert.ok(/comment-nick/.test(meta) && /comment-time/.test(meta), "昵称与时间应同在 .comment-meta 里");
}, "A3：昵称 / 时间 / 「…」同一行");

check(() => {
  // 爱心位于正文行（comment-body）内，而非底部 comment-foot
  assert.ok(!/class="comment-foot"/.test(WXML), "不应再保留底部 comment-foot 两栏（时间/回复）");
  const bodies = WXML.split('<view class="comment-body">').slice(1);
  assert.ok(bodies.length >= 2, "应存在至少两处 .comment-body（顶层评价 + 回复）");
  bodies.forEach((seg, idx) => {
    // 从正文行开头扫到自己收口
    let depth = 1;
    const tagRe = /<(\/?)view\b[^>]*>/g;
    let hit;
    let end = seg.length;
    while ((hit = tagRe.exec(seg))) {
      depth += hit[1] === "/" ? -1 : 1;
      if (depth === 0) { end = hit.index; break; }
    }
    const inner = seg.slice(0, end);
    assert.ok(/comment-like/.test(inner), "第 " + (idx + 1) + " 处正文行内应有点赞爱心");
  });
}, "A4：爱心在正文行右侧，底部两栏已移除");

// ============================================================
// B. 功能：右上角「…」菜单四项齐全（含函数体断言，避免命中注释）
// ============================================================
check(() => {
  const body = functionBody(JS, "onCommentMore");
  assert.ok(/showActionSheet/.test(body), "onCommentMore 应弹出操作菜单");
  // 四项都必须「菜单文案 + 对应的真实 handler 调用」同时成立。
  // 只断言文案存在是空判据：把分支体改成 return 而保留文案，护栏照样全绿。
  assert.ok(/['"]隐藏['"][\s\S]*?this\.hideComment\(/.test(body), "「隐藏」应调 hideComment");
  assert.ok(/['"]举报['"][\s\S]*?this\.reportComment\(/.test(body), "「举报」应调 reportComment");
  assert.ok(/['"]拉黑['"][\s\S]*?this\.blockCommentAuthor\(/.test(body), "「拉黑」应调 blockCommentAuthor");
  assert.ok(/['"]删除['"][\s\S]*?this\.deleteCommentAsModerator\(/.test(body), "「删除」应调 deleteCommentAsModerator");
  assert.ok(/canManageComments\(\)/.test(body), "删除项应受管理员权限控制");
}, "B1：onCommentMore 具备四项能力");

check(() => {
  // 四个 handler 各自存在且落到正确的调用上
  const hide = functionBody(JS, "hideComment");
  assert.ok(/applyCommentRemoval/.test(hide), "hideComment 应走本地移除");
  assert.ok(!/request\.post|api\./.test(hide), "hideComment 不应发请求（纯本机隐藏）");

  const report = functionBody(JS, "reportComment");
  assert.ok(/api\.reportComment\(/.test(report), "reportComment 应调用 api.reportComment");

  const block = functionBody(JS, "blockCommentAuthor");
  assert.ok(/\/message\/block/.test(block), "blockCommentAuthor 应调用 /message/block");
  // 必须真的写本机名单：只断言 'blocked_user_ids' 出现是空判据（getStorageSync 里也有）
  assert.ok(
    /setStorageSync\(\s*['"]blocked_user_ids['"]\s*,\s*blockedIds\s*\)/.test(block),
    "blockCommentAuthor 应把拉黑名单写入本机",
  );

  const del = functionBody(JS, "deleteCommentAsModerator");
  assert.ok(/api\.deleteReviewComment\(/.test(del), "删除应调用 api.deleteReviewComment");
  assert.ok(/applyCommentRemoval/.test(del), "删除后应本地摘除（避免留下孤儿）");
}, "B2：四个 handler 分别落到正确实现");

check(() => {
  // 自己的评价不给举报/拉黑/删除（与帖子详情页同款收口）
  const body = functionBody(JS, "onCommentMore");
  assert.ok(/isOwner/.test(body), "onCommentMore 应判断是否本人");
  assert.ok(/isOwner\s*\?\s*\[['"]隐藏['"]\]/.test(body), "本人只应看到「隐藏」");
}, "B3：本人评价不提供举报/拉黑/删除");

check(() => {
  // 权限口径：管理员 + 评论作者本人可删；不引入「条目创建者」档位
  const ctrl = functionBody(CONTROLLER, "exports.deleteComment");
  assert.ok(/content\.manage/.test(ctrl), "服务端删除应按 content.manage 判管理员");
  assert.ok(/isOwner/.test(ctrl), "服务端删除应识别评论作者本人");
  assert.ok(!/target.*creator|target_user_id/i.test(ctrl), "不应引入「评分对象创建者可删他人评论」这一档");
  assert.ok(/设置 deleted = 1|deleted = 1/.test(ctrl), "删除应为软删（deleted = 1）");
  assert.ok(/parent_id = \?/.test(ctrl), "删顶层评价应连带其下回复");
  // 审计必须是真调用：`void 0 && await writeAdminAudit(...)` 之类仍含该名字，属空判据
  assert.ok(/await\s+writeAdminAudit\(/.test(ctrl), "管理员删除应真实调用 writeAdminAudit");
}, "B4：服务端删除权限口径与审计");

// ============================================================
// C. 后端路由绑定（并防止「实现对了但路由挂的不是它」）
// ============================================================
check(() => {
  assert.ok(
    /router\.post\(\s*['"]\/comment\/:id\/delete['"]\s*,\s*auth\s*,\s*reviewController\.deleteComment\s*\)/.test(ROUTES),
    "POST /comment/:id/delete 必须绑到 reviewController.deleteComment 且带 auth",
  );
  assert.ok(
    /exports\.deleteComment\s*=/.test(CONTROLLER),
    "reviewController 必须导出 deleteComment",
  );
}, "C1：删除路由绑定正确");

check(() => {
  const body = functionBody(API, "deleteReviewComment");
  assert.ok(/\/review\/comment\//.test(body), "api.deleteReviewComment 应打到 /review/comment/ 前缀");
  assert.ok(/\/delete/.test(body), "api.deleteReviewComment 应打到 /delete 后缀");
  assert.ok(/^\s*deleteReviewComment,/m.test(API), "api.js 必须导出 deleteReviewComment");
}, "C2：端上 api 封装正确");

// ============================================================
// C'. 自己的评价：「编辑 / 删除」入口必须存在（2026-10-07 用户实测反馈修复）
//   用户原话：「我点自己的评论时怎么只有隐藏」。
//   根因：帖子详情页里自己的评论不是藏在「…」菜单里，而是正文下方多出一行
//   「编辑 / 删除」（.comment-actions）。上一轮只搬了「…」菜单，漏了这一行，
//   导致自己的评价既不能编辑也不能删除，只剩一个「隐藏」。
// ============================================================
check(() => {
  // 主评价 + 回复各需一处 .comment-actions，且都受「本人」控制。
  // ⚠ 不能用「全文里存在 catchtap="onEditComment"」当判据：该串两处都有，改坏一处仍能骗过。
  // 必须落在具体的 .comment-actions 块内断言。
  const actions = WXML.match(/<view class="comment-actions"[\s\S]*?<\/view>/g) || [];
  assert.ok(actions.length >= 2, "主评价与回复应各有 .comment-actions（编辑/删除）入口，实际 " + actions.length + " 处");
  actions.forEach((block, idx) => {
    assert.ok(/catchtap="onEditComment"/.test(block), "第 " + (idx + 1) + " 处 comment-actions 的「编辑」应绑 onEditComment");
    assert.ok(/catchtap="onDeleteComment"/.test(block), "第 " + (idx + 1) + " 处 comment-actions 的「删除」应绑 onDeleteComment");
  });
  assert.ok(
    /class="comment-actions" wx:if="\{\{item\.userId === currentUserId\}\}"/.test(WXML),
    "主评价的「编辑/删除」应仅在本人时出现（item.userId === currentUserId）",
  );
  assert.ok(
    /class="comment-actions" wx:if="\{\{reply\.userId === currentUserId\}\}"/.test(WXML),
    "回复的「编辑/删除」应仅在本人时出现（reply.userId === currentUserId）",
  );
  // 样式必须定义，否则入口不可见
  assert.ok(/\.comment-actions\s*\{/.test(WXSS), "缺少 .comment-actions 样式");
}, "C'1：自己的评价有「编辑 / 删除」入口");

check(() => {
  // 编辑弹窗结构必须齐备（照帖子详情页）
  assert.ok(/wx:if="\{\{showEditModal\}\}"/.test(WXML), "应有编辑弹窗（showEditModal 控制）");
  assert.ok(/class="modal-mask"/.test(WXML) && /class="edit-modal"/.test(WXML), "应有 modal-mask + edit-modal 两层");
  assert.ok(
    /<textarea class="modal-textarea" value="\{\{editContent\}\}" bindinput="onEditContentInput"/.test(WXML),
    "编辑弹窗的 textarea 应绑定 editContent / onEditContentInput",
  );
  assert.ok(/\.edit-modal\s*\{/.test(WXSS) && /\.modal-textarea\s*\{/.test(WXSS), "缺少编辑弹窗样式");
}, "C'2：编辑评价弹窗结构与样式齐备");

check(() => {
  // onEditComment 打开弹窗并带上目标 id 与原文（不带原文会编辑成空白）。
  // ⚠ 只断言 /editContent:/ 是空判据 —— 把值改成 '' 也含该键名。必须断言值真的取自 ds.content。
  const edit = functionBody(JS, "onEditComment");
  assert.ok(/showEditModal:\s*true/.test(edit), "onEditComment 应打开弹窗");
  assert.ok(/editCommentId:\s*id/.test(edit), "onEditComment 应记录目标评价 id");
  assert.ok(
    /editContent:\s*String\(\s*ds\.content\s*\|\|\s*['"]['"]\s*\)/.test(edit),
    "onEditComment 应把原内容（ds.content）填进输入框，否则弹窗打开是空白",
  );

  // onConfirmEdit 必须真的调 api 并回写（只断言函数名存在是空判据）
  const confirm = functionBody(JS, "onConfirmEdit");
  assert.ok(/await\s|\.then\(/.test(confirm), "onConfirmEdit 应等待接口返回");
  assert.ok(/api\.updateReviewComment\(/.test(confirm), "onConfirmEdit 必须调用 api.updateReviewComment");
  assert.ok(/onCloseEditModal\(\)/.test(confirm), "编辑成功应关闭弹窗");

  // onDeleteComment 必须真的调删除接口 + 二次确认（并真读 confirm）+ 本地摘除。
  // ⚠ 只断言 /wx\.showModal\(/ 是空判据：把 title 改掉、success 改成不读 confirm 都能骗过。
  const del = functionBody(JS, "onDeleteComment");
  assert.ok(/wx\.showModal\(\{/.test(del), "删除前应有二次确认弹窗");
  assert.ok(/if\s*\(\s*!res\.confirm\s*\)\s*return/.test(del), "二次确认必须真的读 res.confirm（否则取消也照删）");
  assert.ok(/api\.deleteReviewComment\(/.test(del), "onDeleteComment 必须调用 api.deleteReviewComment");
  assert.ok(/applyCommentRemoval\(/.test(del), "删除后应本地摘除（避免留下孤儿）");
}, "C'3：编辑 / 删除的 handler 真的落到接口调用");

check(() => {
  // 后端：编辑接口（仅作者本人）+ 路由绑定。
  // ⚠ 只断言 /内容不能为空/ 是空判据 —— 把 if 条件改成恒假仍含该文案。要断言「这是个真守卫」。
  const upd = functionBody(CONTROLLER, "exports.updateComment");
  assert.ok(/UPDATE\s+review_comment\s+SET\s+content/.test(upd), "服务端编辑应 UPDATE review_comment.content");
  assert.ok(
    /if\s*\(\s*!\s*content\s*\)\s*return\s+fail\(/.test(upd),
    "服务端编辑应真实校验内容非空（if (!content) return fail(...)）",
  );
  assert.ok(
    /if\s*\(\s*content\.length\s*>\s*1000\s*\)\s*return\s+fail\(/.test(upd),
    "服务端编辑应校验字数上限",
  );
  assert.ok(
    /if\s*\(\s*Number\(comment\.user_id\)\s*!==\s*Number\(req\.userId\)\s*\)\s*return\s+fail\(/.test(upd),
    "服务端编辑只允许作者本人（真实判定，不是恒假分支）",
  );
  assert.ok(
    /router\.post\(\s*['"]\/comment\/:id\/update['"]\s*,\s*auth\s*,\s*reviewController\.updateComment\s*\)/.test(ROUTES),
    "POST /comment/:id/update 必须绑到 reviewController.updateComment 且带 auth",
  );
  assert.ok(/exports\.updateComment\s*=/.test(CONTROLLER), "reviewController 必须导出 updateComment");

  const api = functionBody(API, "updateReviewComment");
  assert.ok(/\/review\/comment\//.test(api) && /\/update/.test(api), "api.updateReviewComment 应打到 /review/comment/:id/update");
  assert.ok(/^\s*updateReviewComment,/m.test(API), "api.js 必须导出 updateReviewComment");
}, "C'4：编辑评价的后端接口与路由绑定");

check(() => {
  // onShow 必须刷新 currentUserId：从其他页面返回时登录态可能变化，
  // 不刷新会导致「自己的评价不显示编辑/删除」或「别人的评价误显示」。
  const show = functionBody(JS, "onShow");
  assert.ok(/currentUserId/.test(show), "onShow 应刷新 currentUserId");
  // onCommentMore 的 isOwner 判据必须与 wxml 同口径（都用 currentUserId）
  const more = functionBody(JS, "onCommentMore");
  assert.ok(/currentUserId/.test(more), "onCommentMore 的 isOwner 判据应与 wxml 同用 currentUserId");
}, "C'5：登录态刷新与 isOwner 判据同口径");

// ============================================================
// C''. 类名唯一性：顶部栏不得与「条目头」共用 .comment-head
//
//   2026-10-07 线上问题：评价页的「评论区顶部栏」与「单条评价的头部」都用了
//   .comment-head。两条规则特异性相同，顶部栏那条独有的 margin-top:30rpx /
//   padding-bottom / border-bottom 没有被后者覆盖 → 每条评价的昵称行被整体下推，
//   而头像是 align-items:flex-start 顶对齐 → 表现为「头像与昵称不对齐」。
//
//   帖子详情页用 .comments-header 命名顶部栏，评价页应与之一致。
// ============================================================
check(() => {
  // 顶部栏必须叫 .comments-header
  assert.ok(
    /class="comments-header"/.test(WXML),
    "评论区顶部栏应使用 .comments-header（与帖子详情页一致），不能与条目头共用 .comment-head",
  );
  assert.ok(/\.comments-header\s*\{/.test(WXSS), "缺少 .comments-header 样式定义");

  // .comment-head 只能出现在条目内部：首次出现必须在第一个 .comment-item 之后
  const firstItem = WXML.indexOf('class="comment-item');
  const firstHead = WXML.indexOf('class="comment-head"');
  assert.ok(firstItem > -1, "应存在 .comment-item");
  assert.ok(
    firstHead > firstItem,
    ".comment-head 首次出现必须在 .comment-item 之后 —— 即它只能是「单条评价的头部」，不能是列表顶部栏",
  );

  // 切出 .comment-head 的规则块，断言其中不含顶部栏属性
  function cssBlock(src, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?:^|\\n)\\s*" + esc + "\\s*\\{");
    const m = re.exec(src);
    if (!m) return null;
    const start = src.indexOf("{", m.index);
    let depth = 0;
    let i = start;
    for (; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") { depth -= 1; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
  }

  const headBlock = cssBlock(WXSS, ".comment-head");
  assert.ok(headBlock, "应存在 .comment-head 规则块");
  assert.ok(
    !/margin-top/.test(headBlock),
    ".comment-head 不得含 margin-top —— 它会把昵称行顶下去、造成头像与昵称错位",
  );
  assert.ok(
    !/border-bottom/.test(headBlock),
    ".comment-head 不得含 border-bottom —— 那是顶部栏的分隔线属性",
  );

  // 顶部栏的规则块必须真的带上这些属性（防「改了名也删了样式」）
  const headerBlock = cssBlock(WXSS, ".comments-header");
  assert.ok(/margin-top/.test(headerBlock), ".comments-header 应保留 margin-top（顶部栏与上方内容的间距）");
  assert.ok(/border-bottom/.test(headerBlock), ".comments-header 应保留 border-bottom 分隔线");
}, "C''：顶部栏与条目头的类名不得冲突（头像/昵称错位回归护栏）");

// ============================================================
// C'''. 回复的 tap 必须用 catchtap —— 防事件冒泡覆盖回复目标
//
//   2026-10-07 线上问题：点「子评论」去回复，底部提示却显示「回复 父评论作者」。
//
//   根因：.reply-list 嵌在 .comment-content-wrap（父级 reply-trigger）**内部**，
//   而两处都用 bindtap（会冒泡）→ 先触发子评论自己的 handler（正确），
//   紧接着冒泡到父级又触发一次，用父评论的 data-id / data-nick **覆盖**了子评论的结果。
//
//   帖子详情页两处都用 catchtap（阻止冒泡），评价页必须一致。
// ============================================================
check(() => {
  // 1) 父级回复触发器必须 catchtap
  assert.ok(
    /class="comment-content-wrap comment-reply-trigger"\s+catchtap="onReplyComment"/.test(WXML),
    '评论正文的回复触发器必须写 catchtap="onReplyComment"（写 bindtap 会冒泡到条目）',
  );

  // 2) 子评论条目必须 catchtap，且传自己的 id / 昵称
  const ri = WXML.indexOf('class="reply-item"');
  assert.ok(ri > -1, "应存在 .reply-item");
  const replyTag = WXML.slice(ri, WXML.indexOf(">", ri) + 1);
  assert.ok(
    /catchtap="onReplyComment"/.test(replyTag),
    '子评论条目必须写 catchtap="onReplyComment" —— 写 bindtap 会被父级的 handler 覆盖，导致「回复子评论却显示父评论」',
  );
  assert.ok(/data-id="\{\{reply\.id\}\}"/.test(replyTag), "子评论必须传自己的 id（reply.id）");
  assert.ok(/data-nick="\{\{reply\.nickName\}\}"/.test(replyTag), "子评论必须传自己的昵称（reply.nickName）");

  // 3) 反向：全文件不得出现 bindtap="onReplyComment"
  assert.ok(
    !/bindtap="onReplyComment"/.test(WXML),
    '不得出现 bindtap="onReplyComment"（任何一处写 bindtap 都会冒泡覆盖回复目标）',
  );
}, "C'''：回复的 tap 必须用 catchtap，防冒泡覆盖回复目标");

// ============================================================
// E. 回复态提示条：评价页 ↔ 帖子详情页必须一致
//
//   需求（2026-10-07）：把评价页输入框上方的蓝色「回复 XXX ✕」提示条，
//   同样加到帖子详情页的输入框上方。两页的 DOM 结构与样式必须一致。
// ============================================================
const PD_WXML = fs.readFileSync(path.join(ROOT, "pages", "post-detail", "index.wxml"), "utf8");
const PD_WXSS = fs.readFileSync(path.join(ROOT, "pages", "post-detail", "index.wxss"), "utf8");
const PD_JS = fs.readFileSync(path.join(ROOT, "pages", "post-detail", "index.js"), "utf8");

check(() => {
  // 1) 帖子详情页必须有提示条结构，且取消按钮绑到 onCancelReply
  assert.ok(
    /class="reply-hint"\s+wx:if="\{\{replyTo\}\}"/.test(PD_WXML),
    '帖子详情页底栏应有 <view class="reply-hint" wx:if="{{replyTo}}">',
  );
  assert.ok(
    /class="reply-hint-text">回复 \{\{replyToNick\}\}/.test(PD_WXML),
    "提示条文案应为「回复 {{replyToNick}}」",
  );
  assert.ok(
    /class="reply-hint-cancel"\s+catchtap="onCancelReply"/.test(PD_WXML),
    '取消按钮应写 catchtap="onCancelReply"（写 bindtap 会冒泡触发外层）',
  );

  // 2) 输入框必须被 .input-wrap 包住，且该容器 position: relative
  //    （否则绝对定位的提示条会以 .bottom-bar 为参照，横向对不齐输入框）
  assert.ok(/class="input-wrap"/.test(PD_WXML), "输入框应被 .input-wrap 包裹，为提示条提供定位参照");
  assert.ok(
    /\.input-wrap\s*\{[^}]*position:\s*relative/.test(PD_WXSS),
    ".input-wrap 必须 position: relative",
  );

  // 3) js 必须有 onCancelReply，且真的清空 replyTo / replyToNick
  const cancel = functionBody(PD_JS, "onCancelReply");
  assert.ok(/replyTo:\s*null/.test(cancel), "onCancelReply 应把 replyTo 置 null");
  assert.ok(/replyToNick:\s*""/.test(cancel), "onCancelReply 应清空 replyToNick");

  // 4) 两页样式必须逐项一致（防「加了结构忘了同步样式」）
  function cssProps(src, sel) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp("(?:^|\\n)\\s*" + esc + "\\s*\\{([^}]*)\\}").exec(src);
    if (!m) return null;
    return m[1].split(";").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean).sort();
  }
  [".reply-hint", ".reply-hint-text", ".reply-hint-cancel"].forEach((sel) => {
    const a = cssProps(WXSS, sel);
    const b = cssProps(PD_WXSS, sel);
    assert.ok(a, sel + " 在评价页应存在");
    assert.ok(b, sel + " 在帖子详情页应存在");
    assert.deepStrictEqual(b, a, sel + " 在评价页与帖子详情页的样式必须完全一致");
  });
}, "E：回复态提示条两页一致（评价页 ↔ 帖子详情页）");

// ============================================================
// F. 头像卡片 components/avatar-sheet：两页共用同一组件
//
//   2026-10-07 线上问题：评价详情页点头像**没反应**（帖子详情页会弹「个人主页 / 分身私信」卡片）。
//   根因：复刻评论区时头像只抄了 data-path / binderror，漏了 catchtap 与整套 data-*，
//   且评价页上根本没有用户卡片。
//
//   修复方式不是再复制一份，而是把卡片抽成共享组件、两页都用它 ——
//   从根上消除「两页各维护一份、改一边忘一边」的漂移（同一批复刻已出过 4 次这类问题）。
// ============================================================
const AS_JS = fs.readFileSync(path.join(ROOT, "components", "avatar-sheet", "index.js"), "utf8");
const AS_WXML = fs.readFileSync(path.join(ROOT, "components", "avatar-sheet", "index.wxml"), "utf8");
const AS_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, "components", "avatar-sheet", "index.json"), "utf8"));
const PD_WXML_F = fs.readFileSync(path.join(ROOT, "pages", "post-detail", "index.wxml"), "utf8");
const PD_JS_F = fs.readFileSync(path.join(ROOT, "pages", "post-detail", "index.js"), "utf8");
const PD_JSON_F = JSON.parse(fs.readFileSync(path.join(ROOT, "pages", "post-detail", "index.json"), "utf8"));
const RT_JSON_F = JSON.parse(fs.readFileSync(path.join(ROOT, "pkg-feature", "pages", "review", "target.json"), "utf8"));

check(() => {
  assert.strictEqual(AS_JSON.component, true, "avatar-sheet 必须是自定义组件");

  // 1) 两页都必须「注册 + 挂载 + 用 selectComponent 打开」，缺一不可
  const pages = [
    { name: "帖子详情页", json: PD_JSON_F, wxml: PD_WXML_F, js: PD_JS_F },
    { name: "评价详情页", json: RT_JSON_F, wxml: WXML, js: JS }
  ];
  pages.forEach((p) => {
    assert.ok(
      p.json.usingComponents && p.json.usingComponents["avatar-sheet"],
      p.name + " 应在 index.json 注册 avatar-sheet 组件"
    );
    assert.ok(
      /<avatar-sheet\s+id="avatarSheet"\s*\/>/.test(p.wxml),
      p.name + " 应在 wxml 挂载 <avatar-sheet id=\"avatarSheet\" />"
    );
    assert.ok(
      /selectComponent\(['"]#avatarSheet['"]\)/.test(p.js),
      p.name + " 应通过 selectComponent('#avatarSheet') 打开卡片"
    );
  });

  // 2) 组件必须提供完整能力（缺任一项卡片都会退化）
  ["open", "close", "isSelfUser", "profileUrl", "onProfile", "onMessage", "onClose"].forEach((fn) => {
    assert.ok(new RegExp("\\b" + fn + "\\s*\\(").test(AS_JS), "avatar-sheet 应实现 " + fn + "()");
  });
  // 两种形态：匿名（分身）只给「私信」；普通用户给「个人主页」+「分身私信/私信」
  assert.ok(/mode === 'anon'/.test(AS_WXML), "组件应按 mode 区分「私信」与「个人主页」两种形态");
  assert.ok(/allowAnonymousPm === false/.test(AS_JS), "组件应处理「对方不允许分身私信」分支");
  assert.ok(/showModal\(/.test(AS_JS), "分身私信应二次确认");
}, "F：头像卡片为共享组件，评价页与帖子详情页共用同一份实现");

check(() => {
  // 3) 评价页两处头像（顶层评价 / 回复）都必须带 catchtap + 完整 data-*
  const avatars = WXML.match(/class="(?:comment|reply)-avatar"[\s\S]*?\/>/g) || [];
  assert.strictEqual(avatars.length, 2, "评价页应有 2 处头像（评论 + 回复），实际 " + avatars.length);
  avatars.forEach((tag) => {
    assert.ok(/catchtap="onCommentAvatarTap"/.test(tag), "头像必须绑 catchtap=\"onCommentAvatarTap\"（漏了就是「点了没反应」）");
    ["data-userid", "data-anonymous", "data-nick", "data-avatar", "data-allowpm"].forEach((attr) => {
      assert.ok(new RegExp(attr + "=").test(tag), "头像必须带 " + attr + "（否则卡片拿不到数据）");
    });
  });
  // 4) 回复循环必须定义 replyIndex —— 否则 data-path 里是 undefined，头像加载失败时无法回填
  assert.ok(/wx:for-index="replyIndex"/.test(WXML), "回复循环必须定义 wx:for-index=\"replyIndex\"");
  // 5) 服务端必须下发 allowAnonymousPm，否则端上永远按「允许」显示，与服务端拦截不一致
  assert.ok(
    /u\.allow_anonymous_pm/.test(CONTROLLER) && /allowAnonymousPm:/.test(CONTROLLER),
    "评价评论接口必须下发 allowAnonymousPm（与 postController 同口径）"
  );
}, "F2：评价页头像绑定完整（catchtap + data-* + replyIndex + allowAnonymousPm）");

// ============================================================
// G. 评论展示逻辑：新评论先置顶、刷新后归位（与帖子详情页同款）
//
//   2026-10-07：评价页的 buildCommentTree **完全不排序** —— 本地 concat 插入的新评价
//   落在列表最底部。帖子详情页有 sortComments + pin 机制：提交后临时置顶，
//   刷新/翻页/切排序都走真实排序。本组锁住这套语义。
//
//   ⚠ 客户端排序必须对齐「各自服务端」的 ORDER BY：
//     帖子详情页服务端 likes 次级键是 created_at ASC，评价页是 id DESC，两者不同，
//     所以这里不能照搬 post-detail 的 sortComments，否则刷新后位置会再跳一次。
// ============================================================
check(() => {
  // 1) 顶层排序 + 临时置顶两个助手必须存在
  assert.ok(/function sortCommentRoots\(roots, sort\)/.test(JS), "应有 sortCommentRoots（顶层排序）");
  assert.ok(/function moveToTopById\(list, id\)/.test(JS), "应有 moveToTopById（临时置顶）");

  const tree = functionBody(JS, "buildCommentTree");
  assert.ok(
    /sortCommentRoots\(roots, sort\)/.test(tree),
    "buildCommentTree 必须对顶层排序 —— 不排序则新评论落在最底部"
  );
  assert.ok(
    /if \(pin && pin\.rootId\) sortedRoots = moveToTopById\(/.test(tree),
    "buildCommentTree 必须支持 pin（把刚提交那条临时置顶）"
  );
  assert.ok(
    /Number\(a\.id \|\| 0\) - Number\(b\.id \|\| 0\)/.test(tree),
    "回复必须按 id 正序 —— 新回复落在所属评价的回复列表末尾"
  );
  // 上溯必须是「循环」而不是只往上一层：服务端存的是真实父级，链可以更深，
  // 只往上一层会让更深的回复掉成顶层（渲染错位）。
  assert.ok(
    /const rootOf = \(node\) => \{[\s\S]*?while \(current && current\.parentId && byId\[current\.parentId\]/.test(tree),
    "buildCommentTree 必须**循环**上溯到顶层 —— 只往上一层会让「回复的回复的回复」掉成顶层"
  );

  // 2) 客户端排序口径必须与服务端 ORDER BY 一致（likes 次级键 = id DESC）
  assert.ok(
    /\(b\.likeCount \|\| 0\) - \(a\.likeCount \|\| 0\) \|\| Number\(b\.id \|\| 0\) - Number\(a\.id \|\| 0\)/.test(JS),
    "likes 排序的次级键必须与服务端一致（id DESC），否则「刷新后回到属于它的位置」会再跳一次"
  );
  assert.ok(
    /sort === 'likes' \? 'c\.like_count DESC, c\.id DESC'/.test(CONTROLLER),
    "服务端 likes 排序口径应为 `like_count DESC, id DESC`（与端上保持一致）"
  );

  // 3) onSend：顶层评价传 pin（置顶）；回复子评论传 afterId 锚点（临时插到被回复那条正下方）；
  //    回复顶层评价不 pin（按 id 正序落到回复列表末尾）。sort/pin 一起传下去。
  const send = functionBody(JS, "onSend");
  assert.ok(
    /if \(!parentId\) pin = \{ rootId: Number\(comment\.id\) \}/.test(send),
    "onSend 顶层评价必须传 pin.rootId（置顶到评论区顶部）"
  );
  assert.ok(
    /else if \(parentIsReply\) pin = \{ afterId: Number\(parentId\), replyId: Number\(comment\.id\) \}/.test(send),
    "onSend 回复子评论必须传 afterId 锚点（临时插到被回复那条正下方）"
  );
  assert.ok(
    !/const pin = parentId \? null :/.test(send),
    "回复顶层评价不得置顶所属评价（旧实现整条 pin 已废弃）"
  );
  assert.ok(
    /buildCommentTree\(flat, expandedReplyIds, this\.data\.commentSort, pin\)/.test(send),
    "onSend 必须把 sort 与 pin 一起传给 buildCommentTree"
  );
  // 4) 回复提交后自动展开所属评价的回复列表，新回复立即可见
  assert.ok(/findCommentRootId\(parentId\)/.test(send), "回复提交后应自动展开所属评价的回复列表");
  // 5) 其余重建点（加载 / 本地摘除）都不传 pin —— 保证刷新/翻页走真实排序
  const rebuilds = JS.match(/buildCommentTree\(flat, this\.data\.expandedReplyIds, this\.data\.commentSort\)/g) || [];
  assert.strictEqual(rebuilds.length, 2, "加载与本地摘除两处重建都不应传 pin（实际 " + rebuilds.length + " 处）");
}, "G：评论展示逻辑与帖子详情页一致（提交置顶 → 刷新归位）");

// ============================================================
// H. 评论昵称右侧不显示「分身」徽标（2026-10-07 产品决定）
//
//   分身身份已由昵称 + 头像体现，再挂一个「分身」徽标属冗余。
//   ⚠ 底部输入栏的「分身」开关是**另一个东西**（决定发布时是否用分身身份），不要误删。
// ============================================================
check(() => {
  assert.ok(
    !/comment-cert--anon/.test(WXML),
    "评论/回复昵称右侧不应再有「分身」徽标（comment-cert--anon）"
  );
  assert.ok(
    !/comment-cert--anon/.test(WXSS),
    "「分身」徽标的样式应一并删除（否则留下死样式）"
  );
  // 认证标签（certLabel，如「官方」）必须保留
  const certCount = (WXML.match(/class="comment-cert"/g) || []).length;
  assert.strictEqual(certCount, 2, "评论与回复的认证标签（certLabel）都应保留，实际 " + certCount + " 处");
  // 去掉前一个条件分支后，后一个不能变成孤儿
  assert.ok(!/wx:elif/.test(WXML), "不得残留孤儿条件分支（wx:elif 缺前置条件）");
  // 底部输入栏的「分身」开关必须还在
  assert.ok(/onToggleAnonymous/.test(WXML), "底部输入栏的「分身」开关不应被误删");
  assert.ok(/>分身</.test(WXML), "底部输入栏的「分身」文字应保留");
}, "H：评论昵称右侧不显示「分身」徽标（保留认证标签与底部分身开关）");

// ============================================================
// D. vm 行为断言：applyCommentRemoval 真的摘除且维护计数
// ============================================================
let pageDefinition = null;
const wxCalls = [];
const wxStub = new Proxy(
  {
    getStorageSync: () => "",
    setStorageSync: () => undefined,
    showToast: (o) => { wxCalls.push(["toast", o && o.title]); },
    showModal: (o) => { if (o && typeof o.success === "function") o.success({ confirm: true }); },
    showActionSheet: (o) => { if (o && typeof o.success === "function") o.success({ tapIndex: 0 }); },
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowHeight: 700 }),
  },
  { get: (t, p) => (p in t ? t[p] : () => undefined) },
);

const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
  setImmediate,
  Promise,
  JSON,
  Date,
  Math,
  require: (name) => {
    const s = String(name);
    if (s.indexOf("utils/api") > -1) {
      return {
        getReviewComments: () => Promise.resolve({ list: [], total: 0 }),
        deleteReviewComment: () => Promise.resolve({ affected: 2, commentCount: 0 }),
        reportComment: () => Promise.resolve({}),
      };
    }
    if (s.indexOf("utils/request") > -1) return { get: () => Promise.resolve({}), post: () => Promise.resolve({}) };
    if (s.indexOf("utils/auth") > -1) return { requireLogin: () => true };
    if (s.indexOf("utils/anonymousIdentity") > -1) return {};
    if (s.indexOf("utils/wechat") > -1) return {};
    if (s.indexOf("utils/review") > -1) {
      // review 模块已随分包迁移到 pkg-feature/utils/review.js（主包不再收编分包专用 JS）
      return require(path.join(ROOT, "pkg-feature", "utils", "review.js"));
    }
    return {};
  },
  getApp: () => ({ globalData: { userInfo: { id: 1, nickName: "我", role: "user" }, token: "" } }),
  getCurrentPages: () => [],
  wx: wxStub,
};
sandbox.Page = (def) => { pageDefinition = def; };
vm.createContext(sandbox);

check(() => {
  vm.runInContext(JS, sandbox, { filename: "pkg-feature/pages/review/target.js" });
  assert.ok(pageDefinition, "应调用 Page() 注册页面");
}, "D0：页面可加载");

function createPage() {
  const page = Object.assign({}, pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === "function") cb();
  };
  // buildCommentTree 是模块级函数（不挂在 Page 上），测试里按同一口径重建，
  // 只关心「顶层 + 其下 replies」这一层结构，够 applyCommentRemoval 使用。
  page.buildCommentTree = function (flat) {
    const nodes = (flat || []).map((c) => Object.assign({}, c, { replies: [] }));
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });
    const roots = [];
    nodes.forEach((n) => {
      const parent = n.parentId ? byId[n.parentId] : null;
      if (parent) parent.replies.push(n);
      else roots.push(n);
    });
    return roots;
  };
  return page;
}

check(() => {
  const page = createPage();
  const flat = [
    { id: 1, parentId: 0, likeCount: 0 },
    { id: 2, parentId: 1, likeCount: 0 },
    { id: 3, parentId: 1, likeCount: 0 },
    { id: 4, parentId: 0, likeCount: 0 },
  ];
  page.data.commentFlat = flat.slice();
  page.data.comments = page.buildCommentTree(flat);
  page.data.commentCount = 4;

  page.applyCommentRemoval(page.collectRemovableComments(flat, [1]), 1);

  const ids = page.data.commentFlat.map((c) => Number(c.id)).sort();
  assert.deepStrictEqual(ids, [4], "删顶层评价 1 应连带摘掉其回复 2、3，仅剩 4");
  assert.strictEqual(page.data.comments.length, 1, "树应同步只剩 1 条顶层");
  assert.strictEqual(page.data.commentCount, 1, "计数应同步减 3");
}, "D1：删顶层评价连带摘除其回复并同步计数");

check(() => {
  const page = createPage();
  const flat = [
    { id: 1, parentId: 0, likeCount: 0 },
    { id: 2, parentId: 1, likeCount: 0 },
  ];
  page.data.commentFlat = flat.slice();
  page.data.comments = page.buildCommentTree(flat);
  page.data.commentCount = 2;

  page.applyCommentRemoval(page.collectRemovableComments(flat, [2]), 2);

  const ids = page.data.commentFlat.map((c) => Number(c.id)).sort();
  assert.deepStrictEqual(ids, [1], "删回复 2 只应摘掉自身，父评价 1 保留");
  assert.strictEqual(page.data.commentCount, 1, "计数应减 1");
}, "D2：删回复只摘除自身");

check(() => {
  const page = createPage();
  page.data.replyTo = 5;
  page.data.replyToNick = "某人";
  const flat = [{ id: 5, parentId: 0, likeCount: 0 }];
  page.data.commentFlat = flat.slice();
  page.data.comments = page.buildCommentTree(flat);
  page.data.commentCount = 1;

  page.applyCommentRemoval([5], 5);
  assert.strictEqual(page.data.replyTo, 0, "被删的是当前回复目标时应退回顶层评价态");
}, "D3：被删项是回复目标时清空回复态");

check(() => {
  const page = createPage();
  page.data.commentFlat = [{ id: 9, parentId: 0, likeCount: 0 }];
  page.data.commentCount = 1;
  // 非管理员 + 评论作者是别人 → 菜单不应含「删除」
  let menu = null;
  sandbox.wx.showActionSheet = (o) => { menu = o.itemList; };
  page.onCommentMore({ currentTarget: { dataset: { id: 9, userid: 42, nick: "他人" } } });
  assert.ok(menu && menu.indexOf("删除") === -1, "普通用户对他人评价不应看到「删除」");
  assert.ok(menu.indexOf("举报") > -1 && menu.indexOf("拉黑") > -1, "普通用户应看到举报与拉黑");
}, "D4：普通用户菜单不含「删除」");

check(() => {
  const page = createPage();
  page.data.commentFlat = [{ id: 9, parentId: 0, likeCount: 0 }];
  page.data.commentCount = 1;
  let menu = null;
  sandbox.wx.showActionSheet = (o) => { menu = o.itemList; };
  // 管理员（super_admin）
  sandbox.getApp = () => ({ globalData: { userInfo: { id: 1, role: "super_admin" } } });
  page.onCommentMore({ currentTarget: { dataset: { id: 9, userid: 42, nick: "他人" } } });
  assert.ok(menu && menu.indexOf("删除") > -1, "管理员对他人评价应看到「删除」");
  sandbox.getApp = () => ({ globalData: { userInfo: { id: 1, role: "user" } } });
}, "D5：管理员菜单含「删除」");

console.log(count + " tests passed.");
