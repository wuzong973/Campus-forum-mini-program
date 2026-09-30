/**
 * 「作者」标签样式一致性测试（无需真机 / 无需数据库）
 *
 * 背景：项目里「作者」标识共三处 —— 首页帖子卡片（post-card 的 .post-anonymous-label）、
 *      首页热榜（index 的 .hot-rank-post-label，与卡片同值）、帖子详情页评论区
 *      （post-detail 的 .author-comment-label）。历史上评论区那款是「浅红底 #fff4f4 +
 *      红字 #e34b4b + 1rpx 描边 #ffcaca」的小号描边标签，与首页的粉红实心款不一致。
 *      现已统一为首页款，本测试锁死这一约束。
 *
 * 覆盖：
 *   1) 背景 / 文字色 / 字号 / 字重 / 高度 / 圆角 / 水平内边距 逐项与首页一致
 *   2) 不再有描边（边框必须为空）
 *   3) wxml 用 <view> 承载（<text> 为 inline，height/overflow 不生效，会退回旧布局）
 *   4) 反向验证：把历史旧样式喂给同一比较函数，必须判为「不一致」——否则本测试形同虚设
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CARD_WXSS = path.join(ROOT, "components", "post-card", "post-card.wxss");
const DETAIL_WXSS = path.join(ROOT, "pages", "post-detail", "index.wxss");
const DETAIL_WXML = path.join(ROOT, "pages", "post-detail", "index.wxml");

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

function parseDecls(body) {
  const out = {};
  body
    .split(";")
    .forEach((seg) => {
      const i = seg.indexOf(":");
      if (i === -1) return;
      const key = seg.slice(0, i).trim().toLowerCase();
      const val = seg.slice(i + 1).trim().replace(/\s+/g, " ");
      if (key) out[key] = val;
    });
  return out;
}

function extractRule(css, selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}",
  );
  const m = css.match(re);
  if (!m) throw new Error("未找到样式规则: " + selector);
  return parseDecls(m[1]);
}

const KEYS = ["background", "color", "font-size", "font-weight", "height", "border-radius"];
const isBorderless = (d) => !/\bsolid\b|\bdashed\b|\b\d+rpx\b/.test(d.border || "");
const hPadding = (d) => {
  const parts = (d.padding || "").split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[1] : parts[0] || "0";
};

/** 返回差异列表，空数组代表视觉一致 */
function visualDiff(target, current) {
  const diffs = [];
  KEYS.forEach((k) => {
    if ((target[k] || "") !== (current[k] || "")) {
      diffs.push(`${k}: 期望 ${target[k]} 实际 ${current[k]}`);
    }
  });
  if (!isBorderless(current)) diffs.push(`border: 期望无描边 实际 ${current.border}`);
  if (hPadding(target) !== hPadding(current)) {
    diffs.push(`padding-x: 期望 ${hPadding(target)} 实际 ${hPadding(current)}`);
  }
  return diffs;
}

const cardCss = fs.readFileSync(CARD_WXSS, "utf8");
const detailCss = fs.readFileSync(DETAIL_WXSS, "utf8");
const detailWxml = fs.readFileSync(DETAIL_WXML, "utf8");

// 首页目标样式：外框负责背景/圆角/高度，内层 .post-anonymous-main 负责水平内边距
const TARGET = Object.assign({}, extractRule(cardCss, ".post-anonymous-label"), {
  padding: extractRule(cardCss, ".post-anonymous-main").padding,
});
const CURRENT = extractRule(detailCss, ".author-comment-label");

// ===== 1. 逐项视觉属性一致 =====
check(() => {
  const diffs = visualDiff(TARGET, CURRENT);
  assert.deepStrictEqual(diffs, []);
}, "评论区「作者」标签应与首页帖子卡片完全一致");

// ===== 2. 关键取值固定（防止两边一起被改跑偏） =====
check(() => {
  assert.strictEqual(CURRENT.background.toLowerCase(), "#f34e72");
}, "「作者」标签背景应为首页同款粉红 #f34e72");

check(() => {
  assert.strictEqual(String(CURRENT.color).toLowerCase(), "#fff");
}, "「作者」标签文字应为白色");

check(() => {
  assert.strictEqual(CURRENT.height, "34rpx");
  assert.strictEqual(CURRENT["border-radius"], "9rpx");
}, "「作者」标签应为 34rpx 高、9rpx 圆角的实心胶囊");

check(() => {
  assert.strictEqual(CURRENT["font-size"], "22rpx");
  assert.strictEqual(CURRENT["font-weight"], "700");
}, "「作者」标签字号 22rpx、字重 700");

check(() => {
  assert.ok(isBorderless(CURRENT), "「作者」标签不应再有描边");
}, "「作者」标签不应再有 1rpx solid 描边");

// ===== 3. wxml 结构：必须用 view（text 是 inline，height/overflow 不生效） =====
check(() => {
  const matches = detailWxml.match(/<(\w+)\s+class="author-comment-label"/g) || [];
  assert.strictEqual(matches.length, 2, `评论区「作者」标签应出现 2 处（主评论 + 回复），实际 ${matches.length}`);
  matches.forEach((m) => {
    assert.ok(m.startsWith("<view"), `「作者」标签应使用 <view> 承载，实际 ${m}`);
  });
}, "两处「作者」标签（主评论 / 回复）都应使用 <view>");

check(() => {
  assert.ok(!/<text class="author-comment-label"/.test(detailWxml), "不应残留 <text> 版「作者」标签");
}, "不应残留 <text class=\"author-comment-label\">");

// ===== 4. 反向验证：历史旧样式必须被判为不一致 =====
check(() => {
  const legacy = parseDecls(
    "flex: 0 0 auto; padding: 1rpx 8rpx; border: 1rpx solid #ffcaca; border-radius: 4rpx; " +
      "background: #fff4f4; color: #e34b4b; font-size: 20rpx; font-weight: 600; line-height: 1.45;",
  );
  const diffs = visualDiff(TARGET, legacy);
  assert.ok(diffs.length >= 5, "旧版描边款式应至少命中 5 项差异，实际 " + diffs.length);
}, "反向验证：旧版浅红描边款必须判定为不一致");

console.log(`${testCount} tests passed.`);
