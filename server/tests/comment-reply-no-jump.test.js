/**
 * 帖子详情页评论顺序回归测试（无需真机/无需数据库）
 *
 * 历史bug1（2026-09-11）：回复子评论后父评论（主评论）异常跳到评论区顶部。
 *   根因：回复场景 pin = { rootId, replyId }，buildCommentThreads 无条件把根评论挪顶。
 * 历史bug2（2026-09-11 用户反馈截图）：回复后新回复被「置顶到回复列表顶部」，
 *   显示在被评论者（原评论）上方；子评论还按赞数排序，时间顺序被打乱。
 *
 * 最终交互约定（本测试锁定）：
 *   1. 子评论按时间先后正序排列（与赞数无关），新回复自然落在回复列表末尾 = 被评论者下方；
 *   2. 回复不重排任何已有评论（根评论保持原位，回复列表原有顺序不变）；
 *   3. 回复时自动展开所属评论的回复列表，确保末尾的新回复立即可见；
 *   4. 顶层新评论仍置顶到评论区顶部（列表「时间」排序语义，未被投诉，保持不变）。
 *
 * 用 vm 加载真实页面文件 pages/post-detail/index.js，注入桩依赖。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MINI_PROGRAM_ROOT = path.join(__dirname, "..", "..");
const PAGE_FILE = path.join(MINI_PROGRAM_ROOT, "pages", "post-detail", "index.js");
const source = fs.readFileSync(PAGE_FILE, "utf8");

let testCount = 0;
function check(fn, message) {
  try {
    fn();
    testCount++;
  } catch (err) {
    console.error("FAILED:", message || err.message);
    throw err;
  }
}

// ===== 桩 =====
const localStorage = {};
const wxStub = new Proxy(
  {
    getStorageSync: (key) => (key in localStorage ? localStorage[key] : ""),
    setStorageSync: (key, value) => { localStorage[key] = value; },
    removeStorageSync: (key) => { delete localStorage[key]; },
    showToast: () => undefined,
    showModal: (opts) => { if (typeof opts.success === "function") opts.success({ confirm: true }); },
    navigateTo: () => undefined,
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowHeight: 700 }),
  },
  { get: (target, prop) => (prop in target ? target[prop] : () => undefined) },
);

const apiStub = {
  parseImages: (v) => (Array.isArray(v) ? v : []),
  getCommentList: () => Promise.resolve({ list: [], total: 0 }),
};
// 服务端返回的真实评论 id 由用例注入
let serverCreatedCommentId = 999;
let lastPostedPayload = null;
const defaultPost = (url, payload) => { lastPostedPayload = payload; return Promise.resolve({ id: serverCreatedCommentId }); };
const requestStub = {
  get: () => Promise.resolve({}),
  post: defaultPost,
  BASE_URL: "http://localhost",
};
const authStub = { requireLogin: () => true };
const formatStub = {
  formatRelativeTime: () => "刚刚",
  stripMediaPlaceholder: (s) => s,
};
const refreshStub = { runPullDownRefresh: () => undefined };

let pageDefinition = null;
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
    if (s.indexOf("utils/api") > -1) return apiStub;
    if (s.indexOf("utils/request") > -1) return requestStub;
    if (s.indexOf("utils/auth") > -1) return authStub;
    if (s.indexOf("utils/format") > -1) return formatStub;
    if (s.indexOf("utils/refresh") > -1) return refreshStub;
    // 返回真实 avatar 模块（而不是空对象）：页面评论归一化会用到
    // avatar.normalizeLegacyAvatar，空桩会让它变成 undefined 而在用例里抛
    // 「not a function」——那并不是页面本身的缺陷。同时真实模块的导出名一旦被
    // 改名，这里会立刻失败，等于顺手锁住 utils/avatar.js 的导出契约。
    if (s.indexOf("utils/avatar") > -1) return require("../../utils/avatar");
    return {};
  },
  getApp: () => ({ globalData: { userInfo: { id: 1, nickName: "我", avatarUrl: "" }, token: "" } }),
  getCurrentPages: () => [],
  wx: wxStub,
};
sandbox.Page = (definition) => { pageDefinition = definition; };
vm.createContext(sandbox);

check(() => {
  vm.runInContext(source, sandbox, { filename: "pages/post-detail/index.js" });
  assert.ok(pageDefinition, "应调用 Page() 注册页面");
}, "页面加载");

// ===== 页面实例（不走 onLoad，直接注入评论数据） =====
function createPage(commentSort) {
  const page = Object.assign({}, pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.data.commentSort = commentSort || "hot";
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === "function") cb();
  };
  return page;
}

// 注入输入区状态后直接触发发送（乐观阶段是同步 setData，可在首个 await 前断言）
function startSend(page, overrides) {
  Object.assign(page.data, overrides);
  return page.onSendComment();
}

async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

// 评论数据：
//   根评论 A(id=1, 10 赞, 10:00) 下有三条子评论：
//     id=3（2 赞, 10:06）、id=4（0 赞, 10:07）、id=5（99 赞, 10:08）
//   根评论 B(id=2, 1 赞, 10:05)
// 时间正序下 A 的回复列表恒为 [3, 4, 5]（99 赞的 id=5 也不能插队到最前）
function seedComments(page) {
  const raw = [
    { id: 1, userId: 10, nickName: "甲", content: "主评论A", parentId: 0, likeCount: 10, createdAt: "2026-09-11 10:00:00" },
    { id: 2, userId: 20, nickName: "乙", content: "主评论B", parentId: 0, likeCount: 1, createdAt: "2026-09-11 10:05:00" },
    { id: 3, userId: 30, nickName: "丙", content: "子评论3", parentId: 1, likeCount: 2, createdAt: "2026-09-11 10:06:00" },
    { id: 4, userId: 40, nickName: "丁", content: "子评论4", parentId: 1, likeCount: 0, createdAt: "2026-09-11 10:07:00" },
    { id: 5, userId: 50, nickName: "戊", content: "子评论5", parentId: 1, likeCount: 99, createdAt: "2026-09-11 10:08:00" },
  ].map((c) => page.normalizeComment(c));
  page.setData({
    post: { id: 100, userId: 10, commentCount: 5 },
    currentUserId: 1,
    rawComments: raw,
    comments: page.buildCommentThreads(raw),
    commentTotal: 5,
    expandedReplyIds: {},
  });
}

// ===== 场景1：回复子评论 → 新回复显示在被评论者下方（回复列表末尾），父评论保持原位 =====
async function testReplyGoesBelowTarget() {
  const page = createPage("hot");
  seedComments(page);

  check(() => {
    assert.strictEqual(page.data.comments[0].id, 1, "初始 hot 排序：A(10赞) 应在首位");
    const replies = page.data.comments[0].replies;
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(replies.map((r) => r.id))),
      [3, 4, 5],
      "子评论应按时间先后排列（99 赞的 id=5 也不能插队到最前）",
    );
  }, "场景1-初始：子评论按时间正序排列");

  // 回复 A 的子评论 id=4（乐观阶段是同步 setData，可在首个 await 前断言）
  const sending = startSend(page, { commentText: "回复子评论4", replyTo: 4, replyToNick: "丁" });
  check(() => {
    const thread = page.data.comments[0];
    assert.strictEqual(thread.id, 1, "乐观阶段：父评论 A 保持在原有位置");
    assert.strictEqual(thread.replies[thread.replies.length - 1].id < 0, true, "乐观阶段：新回复（负数临时 id）排在回复列表末尾 = 被评论者下方");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(thread.replies.slice(0, 3).map((r) => r.id))),
      [3, 4, 5],
      "乐观阶段：原有回复顺序完全不变",
    );
    assert.strictEqual(page.data.expandedReplyIds["1"], true, "乐观阶段：所属评论的回复列表自动展开，末尾新回复立即可见");
  }, "场景1-乐观阶段：新回复在末尾且列表自动展开");

  await flush();
  await sending;

  check(() => {
    const comments = page.data.comments;
    assert.strictEqual(lastPostedPayload.parentId, 4, "场景1：请求应以子评论 id=4 作为 parentId");
    assert.strictEqual(comments[0].id, 1, "服务端确认后：父评论 A 仍保持在原有位置");
    assert.strictEqual(comments[1].id, 2, "服务端确认后：评论 B 位置不变，列表未被重排");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(comments[0].replies.map((r) => r.id))),
      [3, 4, 5, serverCreatedCommentId],
      "服务端确认后：新回复（真实 id）在回复列表末尾，位于被评论者 id=4 下方",
    );
    assert.strictEqual(comments[0].expanded, true, "服务端确认后：回复列表保持展开");
    assert.strictEqual(page.data.commentTotal, 6, "服务端确认后：评论总数 +1");
  }, "场景1-确认后：新回复在被评论者下方，原位次与顺序不变");

  // 回复非首位评论也不应引发任何根评论跳顶（锁定历史bug1）
  const page2 = createPage("hot");
  seedComments(page2);
  const sending2 = startSend(page2, { commentText: "回复B", replyTo: 2, replyToNick: "乙" });
  await flush();
  await sending2;
  check(() => {
    const comments = page2.data.comments;
    assert.strictEqual(comments[0].id, 1, "回复评论 B 后：A(10赞) 仍保持首位，B 不应抢到顶部");
    assert.strictEqual(comments[1].id, 2, "回复评论 B 后：B 仍在第二位");
    assert.strictEqual(comments[1].replies[0].id, serverCreatedCommentId, "回复评论 B 后：新回复进入 B 的回复列表末尾");
  }, "场景1-反向：回复非首位评论不引发根评论跳顶");
}

// ===== 场景2：顶层新评论仍按原设计置顶到评论区顶部 =====
async function testTopLevelCommentStillPinsToTop() {
  const page = createPage("hot");
  seedComments(page);
  const sending = startSend(page, { commentText: "全新顶层评论", replyTo: null, replyToNick: "" });
  await flush();
  await sending;
  check(() => {
    const comments = page.data.comments;
    assert.strictEqual(comments[0].id, serverCreatedCommentId, "顶层新评论应置顶到评论区顶部（原设计行为不变）");
    assert.strictEqual(comments[1].id, 1, "原首条评论顺延到第二位");
    assert.strictEqual(comments[0].parentId, 0, "新评论为顶层评论");
  }, "场景2：顶层新评论置顶行为保持不变");
}

// ===== 场景3：time 排序下回复子评论同样不重排根评论 =====
async function testReplyToChildUnderTimeSort() {
  const page = createPage("time");
  seedComments(page);
  check(() => {
    // time 排序：根评论按时间倒序 → B(10:05) 在前，A(10:00) 在后
    assert.strictEqual(page.data.comments[0].id, 2, "初始 time 排序：B 应在首位");
    assert.strictEqual(page.data.comments[1].id, 1, "初始 time 排序：A 应在第二位");
  }, "场景3-初始：time 排序顺序正确");

  const sending = startSend(page, { commentText: "回复A的子评论", replyTo: 3, replyToNick: "丙" });
  await flush();
  await sending;
  check(() => {
    const comments = page.data.comments;
    assert.strictEqual(comments[0].id, 2, "time 排序下回复 A 的子评论：B 仍在首位");
    assert.strictEqual(comments[1].id, 1, "time 排序下回复 A 的子评论：A 保持原位不跳顶");
    const replies = comments[1].replies;
    assert.strictEqual(replies[replies.length - 1].id, serverCreatedCommentId, "time 排序下新回复同样排在回复列表末尾");
    assert.strictEqual(page.data.expandedReplyIds["1"], true, "time 排序下回复列表同样自动展开");
  }, "场景3：time 排序下回复不重排根评论、新回复在末尾");
}

// ===== 场景4：服务端失败回退后列表恢复原状（不残留临时回复） =====
async function testRollbackRestoresOrder() {
  const page = createPage("hot");
  seedComments(page);
  requestStub.post = () => Promise.reject(new Error("网络错误"));
  const sending = startSend(page, { commentText: "会失败的回复", replyTo: 3, replyToNick: "丙" });
  await flush();
  await sending;
  requestStub.post = defaultPost;
  check(() => {
    const comments = page.data.comments;
    assert.strictEqual(comments.length, 2, "回退后根评论数量恢复为 2");
    assert.strictEqual(comments[0].id, 1, "回退后 A 保持首位");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(comments[0].replies.map((r) => r.id))),
      [3, 4, 5],
      "回退后 A 的回复列表恢复原状，不含临时回复",
    );
    assert.strictEqual(page.data.commentTotal, 5, "回退后评论总数恢复");
    assert.strictEqual(page.data.commentText, "会失败的回复", "回退后草稿恢复");
    assert.strictEqual(page.data.replyTo, 3, "回退后恢复回复目标");
  }, "场景4：失败回退后列表恢复原状");
}

// ===== 场景5：WXML 回归——评论文本保留 user-select（长文本提示 + 可复制） =====
function testCommentTextUserSelect() {
  const wxml = fs.readFileSync(
    path.join(MINI_PROGRAM_ROOT, "pages", "post-detail", "index.wxml"),
    "utf8",
  );
  const matches = wxml.match(/<text class="comment-text"[^>]*>/g) || [];
  assert.ok(matches.length >= 2, "评论文本节点应存在（主评论 + 回复）");
  matches.forEach((tag) => {
    assert.ok(/user-select/.test(tag), "comment-text 节点应带 user-select：" + tag);
  });
}

async function main() {
  await testReplyGoesBelowTarget();
  await testTopLevelCommentStillPinsToTop();
  await testReplyToChildUnderTimeSort();
  await testRollbackRestoresOrder();
  check(testCommentTextUserSelect, "场景5：comment-text 带 user-select");
  console.log(testCount + " tests passed.");
}

main().catch((err) => {
  console.error("Comment reply order tests failed:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
