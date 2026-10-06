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
const WXML = fs.readFileSync(path.join(ROOT, "pages", "review", "target.wxml"), "utf8");
const WXSS = fs.readFileSync(path.join(ROOT, "pages", "review", "target.wxss"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "pages", "review", "target.js"), "utf8");
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
      return require(path.join(ROOT, "utils", "review.js"));
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
  vm.runInContext(JS, sandbox, { filename: "pages/review/target.js" });
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
