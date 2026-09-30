/**
 * 跑腿订单页状态角标测试（无需真机/无需数据库）
 * 用 vm 加载真实页面文件 pages/errand/index.js，注入假 wx / getApp / request / api / auth，
 * 覆盖五大场景：
 *   1) 待支付 → 已支付后，"待支付"角标立刻归零，"待接单"+1
 *   2) 待接单 → 已接单后，"待接单"角标立刻归零，"待完成"+1
 *   3) 待完成 → 已完成后，"待完成"-1，"已完成"+1
 *   4) 已完成订单点开详情一次 → "已完成"角标永久归零（持久化 + 内存 + 立即生效）
 *   5) 已取消订单点开详情一次 → "已取消"角标永久归零（持久化 + 内存 + 立即生效）
 *
 * 此外回归校验：
 *   - markFinalRead 多次点击幂等（不重复写存储，不脏数据）
 *   - _readFinalIds 超 500 上限后保留最新 500
 *   - statusKeyOf 优先采用 _localStatus 乐观态（与 computeCounts 一致）
 *   - 未知状态键不被计入任何分组
 *   - 退款中订单视为已取消终态
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MINI_PROGRAM_ROOT = path.join(__dirname, "..", "..");
const PAGE_FILE = path.join(MINI_PROGRAM_ROOT, "pages", "errand", "index.js");
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

// ===== 桩：本地存储 =====
const localStorage = {};
let paymentShouldSucceed = true;
let modalConfirmResult = true;
const wxStub = new Proxy(
  {
    getStorageSync: (key) => (key in localStorage ? localStorage[key] : ""),
    setStorageSync: (key, value) => {
      localStorage[key] = value;
    },
    removeStorageSync: (key) => {
      delete localStorage[key];
    },
    showToast: () => undefined,
    showModal: (opts) => {
      if (typeof opts.success === "function")
        opts.success({
          confirm: modalConfirmResult,
          cancel: !modalConfirmResult,
        });
    },
    navigateTo: () => undefined,
    navigateBack: () => undefined,
    switchTab: () => undefined,
    requestPayment: (opts) => {
      if (paymentShouldSucceed && typeof opts.success === "function")
        opts.success({ errMsg: "requestPayment:ok" });
    },
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  },
  { get: (target, prop) => (prop in target ? target[prop] : () => undefined) },
);

// ===== 桩：api / request =====
const apiStub = { getErrandList: () => Promise.resolve({ list: [] }) };
const requestStub = {
  get: () => Promise.resolve({ list: [] }),
  post: () => Promise.resolve({}),
  BASE_URL: "http://localhost",
};
const authStub = { requireRunnerReady: () => true, requireLogin: () => true };
const formatStub = { formatRelativeTime: () => "刚刚" };
const refreshStub = { runPullDownRefresh: () => undefined };

// ===== 沙箱 =====
let pageDefinition = null;
const sandbox = {
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  clearTimeout,
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
    return {};
  },
  getApp: () => ({ globalData: { userInfo: { id: 1 }, token: "" } }),
  getCurrentPages: () => [],
  getTabBar: () => null,
  wx: wxStub,
};
sandbox.Page = (definition) => {
  pageDefinition = definition;
};
vm.createContext(sandbox);

check(() => {
  vm.runInNewContext(source, sandbox, { filename: "pages/errand/index.js" });
  assert.ok(pageDefinition, "应调用 Page() 注册页面");
}, "页面加载");

// ===== 页面实例 =====
function createPage(opts) {
  opts = opts || {};
  const page = Object.assign({}, pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      this.data[k] = patch[k];
    });
    if (typeof cb === "function") cb();
  };
  if (opts.readIds) {
    // 已读 key 按用户隔离：页面用 READ_FINAL_KEY_PREFIX + userId，桩的登录用户 id 为 1
    localStorage["errand_read_final_order_ids:1"] = opts.readIds.slice();
  } else {
    delete localStorage["errand_read_final_order_ids:1"];
  }
  page.onLoad();
  return page;
}

function makeOrder(o) {
  o = o || {};
  return Object.assign({ id: 1, status: "pending", role: "publisher" }, o);
}

async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

// ===== 1) 待支付 → 已支付 =====
async function testScenario1() {
  const page = createPage();
  // 发单方视角：未支付的待接单订单归在 unpaid
  const order = {
    id: 100,
    status: "pending",
    role: "publisher",
    paymentStatus: "UNPAID",
  };
  page._mineCache = { published: [order], accepted: null };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.unpaid,
      1,
      "未支付订单应计入「待支付」",
    );
    assert.strictEqual(
      page.data.statusCounts.pending,
      0,
      "未支付前不应计入「待接单」",
    );
  }, "场景1-初始：未支付订单归在待支付");

  // 模拟支付成功：直接置乐观态 + 重算角标（等价于 onPay 内部那段即时刷新）
  page._localStatus["100"] = "pending";
  page.refreshBadgesNow();
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.unpaid,
      0,
      "场景1：支付成功后「待支付」角标必须立即归零",
    );
    assert.strictEqual(
      page.data.statusCounts.pending,
      1,
      "场景1：支付成功后订单落到「待接单」，角标应 +1",
    );
  }, "场景1-支付后：待支付角标立刻隐藏");

  // 也走真实 onPay 路径（弹窗 + requestPayment + 后续状态）确认链路完整
  const page2 = createPage();
  page2._mineCache = { published: [order], accepted: null };
  page2.setData({ activeListTab: 2 });
  page2.renderMine(["published"]);
  page2.onPay({
    currentTarget: {
      dataset: {
        order: { id: 100, statusClass: "unpaid", raw: order },
      },
    },
  });
  await flush();
  check(() => {
    assert.strictEqual(
      page2.data.statusCounts.unpaid,
      0,
      "场景1-onPay：支付成功后「待支付」角标必须立即归零",
    );
    assert.strictEqual(
      page2.data.statusCounts.pending,
      1,
      "场景1-onPay：支付成功后订单落到「待接单」，角标应 +1",
    );
  }, "场景1-onPay 链路：支付成功后角标立刻切换");
}

// ===== 2) 待接单 → 已接单 =====
async function testScenario2() {
  const page = createPage();
  // 接单方刚接到的单，乐观态为 accepted（反映刚接单成功的状态）
  const order = { id: 200, status: "pending", role: "acceptor" };
  page._mineCache = { published: null, accepted: [order] };
  page._localStatus["200"] = "accepted";
  page.setData({ activeListTab: 1 });
  page.renderMine(["accepted"]);
  // 初始状态：用户已点了接单，订单归在「待完成」
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.active,
      1,
      "接单后订单应计入「待完成」",
    );
    assert.strictEqual(
      page.data.statusCounts.pending,
      0,
      "接单后不应再计入「待接单」",
    );
  }, "场景2-接单后：待接单角标立刻隐藏");

  // 验证没有 _localStatus 兜底时，回到 pending
  const page2 = createPage();
  page2._mineCache = { published: null, accepted: [order] };
  page2.setData({ activeListTab: 1 });
  page2.renderMine(["accepted"]);
  check(() => {
    assert.strictEqual(
      page2.data.statusCounts.pending,
      1,
      "无乐观态时 pending 订单应计入「待接单」",
    );
    assert.strictEqual(
      page2.data.statusCounts.active,
      0,
      "无乐观态时不应计入「待完成」",
    );
  }, "场景2-接单前：待接单订单归在待接单");

  // 模拟 onAccept 内部那段即时刷新
  page2._localStatus["200"] = "accepted";
  page2.refreshBadgesNow();
  check(() => {
    assert.strictEqual(
      page2.data.statusCounts.pending,
      0,
      "场景2：接单后「待接单」角标必须立即归零",
    );
    assert.strictEqual(
      page2.data.statusCounts.active,
      1,
      "场景2：接单后订单落到「待完成」，角标应 +1",
    );
  }, "场景2-onRefresh：接单后角标立刻切换");
}

// ===== 3) 待完成 → 已完成 =====
async function testScenario3() {
  const page = createPage();
  // 发单方 / 接单方：订单进入「待完成」组（accepted/finishing/disputed 都归在这里）
  page._mineCache = {
    published: [{ id: 300, status: "accepted", role: "publisher" }],
    accepted: null,
  };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.active,
      1,
      "进行中订单应计入「待完成」",
    );
    assert.strictEqual(
      page.data.statusCounts.done,
      0,
      "确认完成前不应计入「已完成」",
    );
  }, "场景3-初始：进行中订单归在待完成");

  // 模拟发单人确认完成 → 服务端状态变更为 done（通过 _localStatus 兜底反映最新状态）
  page._localStatus["300"] = "done";
  page.refreshBadgesNow();
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.active,
      0,
      "场景3：状态变更为 done 后「待完成」角标必须归零",
    );
    assert.strictEqual(
      page.data.statusCounts.done,
      1,
      "场景3：「已完成」角标应 +1",
    );
  }, "场景3-onRefresh：完成后角标立刻切换");

  // 直接刷新 _mineCache 也能正确切换
  page._localStatus = {};
  page._mineCache.published = [{ id: 300, status: "done", role: "publisher" }];
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.active,
      0,
      "场景3-缓存：缓存同步后「待完成」角标必须归零",
    );
    assert.strictEqual(
      page.data.statusCounts.done,
      1,
      "场景3-缓存：「已完成」角标应 +1",
    );
  }, "场景3-缓存：刷新后角标正确");
}

// ===== 4) 已完成订单点开详情一次 → 永久归零 =====
async function testScenario4() {
  const page = createPage();
  page._mineCache = {
    published: [{ id: 400, status: "done", role: "publisher" }],
    accepted: null,
  };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.done,
      1,
      "场景4-初始：已完成订单未点开时角标为 1",
    );
  }, "场景4-初始：未读已完成订单计入已完成");

  page.markFinalRead({ id: 400, statusClass: "done", raw: { id: 400 } });
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.done,
      0,
      "场景4：点开详情后「已完成」角标必须立即归零",
    );
  }, "场景4-点开后：已完成角标立刻隐藏");

  check(() => {
    const stored = localStorage["errand_read_final_order_ids:1"] || [];
    assert.ok(
      stored.indexOf("400") > -1,
      "场景4：已读 id 应写入本地存储，重启仍生效",
    );
  }, "场景4-持久化：已读 id 已保存");

  page.markFinalRead({ id: 400, statusClass: "done", raw: { id: 400 } });
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.done,
      0,
      "场景4-幂等：重复点开仍应归零，不应出错",
    );
  }, "场景4-幂等：重复点击不脏数据");

  const page2 = createPage({ readIds: ["400"] });
  page2._mineCache = {
    published: [{ id: 400, status: "done", role: "publisher" }],
    accepted: null,
  };
  page2.setData({ activeListTab: 2 });
  page2.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page2.data.statusCounts.done,
      0,
      "场景4-重启：页面实例重建后已读订单仍不计入角标",
    );
  }, "场景4-重启：已读状态跨实例生效");
}

// ===== 5) 已取消订单点开详情一次 → 永久归零 =====
async function testScenario5() {
  const page = createPage();
  page._mineCache = {
    published: [{ id: 500, status: "cancelled", role: "publisher" }],
    accepted: null,
  };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.cancelled,
      1,
      "场景5-初始：已取消订单未点开时角标为 1",
    );
  }, "场景5-初始：未读已取消订单计入已取消");

  page.markFinalRead({ id: 500, statusClass: "cancelled", raw: { id: 500 } });
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.cancelled,
      0,
      "场景5：点开详情后「已取消」角标必须立即归零",
    );
  }, "场景5-点开后：已取消角标立刻隐藏");

  check(() => {
    const stored = localStorage["errand_read_final_order_ids:1"] || [];
    assert.ok(
      stored.indexOf("500") > -1,
      "场景5：已读 id 应写入本地存储",
    );
  }, "场景5-持久化：已读 id 已保存");
}

// ===== 6) 退款中订单视为已取消终态 =====
async function testRefundIsTerminal() {
  const page = createPage();
  page._mineCache = {
    published: [
      {
        id: 600,
        status: "cancelled",
        paymentStatus: "REFUNDING",
        role: "publisher",
      },
    ],
    accepted: null,
  };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.cancelled,
      1,
      "退款中订单应计入「已取消」组",
    );
  }, "退款中订单计入已取消组");

  page.markFinalRead({ id: 600, statusClass: "refunding", raw: { id: 600 } });
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.cancelled,
      0,
      "点开退款中订单后角标应隐藏",
    );
  }, "退款中订单点开后角标隐藏");
}

// ===== 7) _readFinalIds 不再做"超 500 条驱逐旧 id"的截断 =====
//     回归：旧实现会把最早点开详情的订单 id 丢弃，导致"永久隐藏"在用户浏览足够多的订单
//     后失效、对应角标再次出现 —— 与"永久隐藏"需求冲突。新实现不去截断，靠微信单 key 1MB
//     上限天然保护存储膨胀。
async function testNoEvictionOfReadIds() {
  const ids = [];
  for (let i = 1; i <= 800; i++) ids.push(String(i));
  const page = createPage({ readIds: ids });
  page._mineCache = { published: [], accepted: null };
  page.setData({ activeListTab: 2 });
  // 再标记一个新 id 触发持久化
  page.markFinalRead({ id: 999, statusClass: "done", raw: { id: 999 } });
  check(() => {
    const stored = localStorage["errand_read_final_order_ids:1"] || [];
    assert.strictEqual(
      stored.length,
      801,
      "不去截断：800 + 1 个新 id 全部保留，不应丢弃最早已读 id",
    );
    assert.strictEqual(
      stored[0],
      "1",
      "不去截断：最早标记的 id 1 应仍在存储中",
    );
    assert.strictEqual(
      stored[stored.length - 1],
      "999",
      "不去截断：新标记的 id 999 应在末尾",
    );
    assert.ok(
      stored.indexOf("500") > -1,
      "不去截断：中间的已读 id（如 500）也应保留",
    );
  }, "不去截断已读 id：用户浏览 800+ 已完成订单后角标仍永久隐藏");

  // 新增：验证最早已读订单仍不计角标（防止旧的"截断 500"逻辑死灰复燃）
  page._mineCache.published = [
    { id: 1, status: "done", role: "publisher" },
    { id: 999, status: "done", role: "publisher" },
  ];
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.done,
      0,
      "不去截断：最早已读的已完成订单仍不计入角标",
    );
  }, "不去截断：最早已读订单的「已完成」角标永久为 0");
}

// ===== 8) 未知状态键的订单不计入任何角标 =====
async function testUnknownStatusNotCounted() {
  const page = createPage();
  page._mineCache = {
    published: [{ id: 700, status: "weird_state" }],
    accepted: null,
  };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(page.data.statusCounts.unpaid, 0);
    assert.strictEqual(page.data.statusCounts.pending, 0);
    assert.strictEqual(page.data.statusCounts.active, 0);
    assert.strictEqual(page.data.statusCounts.done, 0);
    assert.strictEqual(page.data.statusCounts.cancelled, 0);
  }, "未知状态订单不计入任何角标");
}

// ===== 9) 防御性：状态键为已完成但用户已读时不计入 =====
async function testReadFinalIdEdgeCase() {
  const page = createPage({ readIds: ["800"] });
  page._mineCache = {
    published: [{ id: 800, status: "done", role: "publisher" }],
    accepted: null,
  };
  page.setData({ activeListTab: 2 });
  page.renderMine(["published"]);
  check(() => {
    assert.strictEqual(
      page.data.statusCounts.done,
      0,
      "存储中已标记为已读的已完成订单不应计入角标",
    );
  }, "从存储加载的已读已完成订单不计入");
}

async function main() {
  await testScenario1();
  await testScenario2();
  await testScenario3();
  await testScenario4();
  await testScenario5();
  await testRefundIsTerminal();
  await testNoEvictionOfReadIds();
  await testUnknownStatusNotCounted();
  await testReadFinalIdEdgeCase();
  console.log(testCount + " tests passed.");
}

main().catch((err) => {
  console.error("Errand status badge tests failed:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});