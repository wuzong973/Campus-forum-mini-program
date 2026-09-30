/**
 * 路由防重护栏回归测试（无需真机/无需数据库）
 *
 * bug 现象（2026-09-11 截图）：控制台红色报错
 *   SystemError (appServiceSDKScriptError) "[Page Route 错误](system error)]
 *   routeDone with a webviewId 266 is not found"
 * 触发方式：短时间内重复触发路由（快速双击跳转、点击已选中的 tab 再走一次 switchTab），
 * 框架在上一条路由转场中处理重复路由，完成回调找不到目标 webview。
 *
 * 修复：
 *   1. app.js installRouteGuards()：对 navigateTo/redirectTo/reLaunch/switchTab 加
 *      「进行中」锁，重复调用静默忽略；fail 立即放行（保留失败回退链）；
 *      success 后 350ms 冷却覆盖转场动画窗口。
 *   2. custom-tab-bar onChange：点击当前已选中的 tab 直接 return，不再重复 switchTab。
 *
 * 用 vm 加载真实 app.js 与 custom-tab-bar/index.js，注入桩依赖。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MINI_PROGRAM_ROOT = path.join(__dirname, "..", "..");
const APP_FILE = path.join(MINI_PROGRAM_ROOT, "app.js");
const TABBAR_FILE = path.join(MINI_PROGRAM_ROOT, "custom-tab-bar", "index.js");

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ===== 加载 app.js，返回 { appOptions, wxStub }（每次独立沙箱，路由桩由用例注入） =====
function loadApp(routeSpies) {
  const source = fs.readFileSync(APP_FILE, "utf8");
  let appOptions = null;
  const wxStub = new Proxy(
    Object.assign(
      {
        getStorageSync: () => "",
        setStorageSync: () => undefined,
        showModal: (opts) => { if (typeof opts.success === "function") opts.success({ confirm: false }); },
        getWindowInfo: () => ({ statusBarHeight: 20, screenWidth: 375, pixelRatio: 2 }),
        getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32 }),
      },
      routeSpies,
    ),
    { get: (t, prop) => (prop in t ? t[prop] : () => undefined) },
  );
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    require: (name) => {
      const s = String(name);
      if (s.indexOf("messageStore") > -1) {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
          syncUnreadCount: () => undefined,
          onMessage: () => () => undefined,
          getUnreadTotal: () => 0,
          setUnreadTotal: () => undefined,
        };
      }
      if (s.indexOf("login-expiry") > -1) {
        return { checkLoginExpiry: () => false, recordActiveTime: () => undefined };
      }
      if (s.indexOf("syncQueue") > -1) {
        return {
          flushProfile: () => Promise.resolve(),
          flushScheduleConfig: () => Promise.resolve(),
          queueScheduleConfig: () => undefined,
        };
      }
      if (s.indexOf("share") > -1) return { onShareAppMessage: () => ({}) };
      if (s.indexOf("avatar") > -1) {
        return {
          getDefaultProfile: () => ({ nickName: "", avatarUrl: "" }),
          isStoredAvatar: () => true,
          isDefaultName: () => true,
        };
      }
      if (s.indexOf("version-update") > -1) {
        return { ensureManager: () => undefined };
      }
      if (s.indexOf("request") > -1) return { get: () => Promise.resolve(null) };
      return {};
    },
    wx: wxStub,
  };
  sandbox.App = (options) => { appOptions = options; };
  sandbox.Page = () => undefined;
  vm.runInNewContext(source, sandbox, { filename: "app.js" });
  assert.ok(appOptions, "应调用 App() 注册小程序");
  return { appOptions, wxStub };
}

// ===== 场景1：路由进行中重复调用被吞掉；success 后冷却期结束放行后续路由 =====
async function testDuplicateRouteSuppressed() {
  let navigateCalls = [];
  const { appOptions, wxStub } = loadApp({
    navigateTo: (opts) => { navigateCalls.push(opts); },
  });
  const app = Object.assign({}, appOptions);
  app.onLaunch();

  check(() => {
    ["navigateTo", "redirectTo", "reLaunch", "switchTab"].forEach((name) => {
      assert.ok(wxStub[name] && wxStub[name].__routeGuarded, name + " 应已装防重护栏");
    });
  }, "场景1-安装：四类路由 API 均被加固");

  // 第一次跳转（框架尚未回调 success/fail = 路由进行中）
  const firstSuccess = [];
  wxStub.navigateTo({ url: "/pages/post-detail/index?id=1", success: () => firstSuccess.push(1) });
  // 转场期间用户再次触发（快速双击/事件冒泡）
  wxStub.navigateTo({ url: "/pages/post-detail/index?id=1" });
  wxStub.navigateTo({ url: "/pages/post-detail/index?id=1" });
  check(() => {
    assert.strictEqual(navigateCalls.length, 1, "路由进行中的重复调用应被静默吞掉，只放行第一次");
  }, "场景1-进行中：重复路由被吞掉");

  // 模拟框架回调 success → 350ms 冷却后放行下一条路由
  navigateCalls[0].success({ errMsg: "navigateTo:ok" });
  check(() => {
    assert.strictEqual(firstSuccess.length, 1, "原 success 回调应被透传调用");
  }, "场景1-success：原回调透传");

  await sleep(400);
  wxStub.navigateTo({ url: "/pages/hot-rank/index" });
  check(() => {
    assert.strictEqual(navigateCalls.length, 2, "冷却期结束后后续路由应正常放行");
  }, "场景1-冷却后：后续路由正常放行");
}

// ===== 场景2：fail 立即放行，保留「navigateTo 失败回退 switchTab」链式跳转 =====
async function testFailReleasesImmediately() {
  let switchCalls = [];
  const failCb = [];
  const { appOptions, wxStub } = loadApp({
    navigateTo: (opts) => { opts.fail({ errMsg: "navigateTo:fail can not navigate to a tab page" }); },
    switchTab: (opts) => { switchCalls.push(opts); },
  });
  const app = Object.assign({}, appOptions);
  app.onLaunch();

  // 首页公告链接的回退链：navigateTo 失败后立刻 switchTab，必须能通过护栏
  wxStub.navigateTo({ url: "/pages/errand/index", fail: (res) => { failCb.push(res); } });
  wxStub.switchTab({ url: "/pages/errand/index" });
  check(() => {
    assert.strictEqual(failCb.length, 1, "原 fail 回调应被透传调用");
    assert.strictEqual(switchCalls.length, 1, "fail 立即放行：失败回退链上的 switchTab 不应被误吞");
  }, "场景2：fail 立即放行，失败回退链不受影响");
}

// ===== 场景3：custom-tab-bar 点击已选中 tab 不再重复 switchTab =====
async function testTabBarSameTabNoop() {
  const source = fs.readFileSync(TABBAR_FILE, "utf8");
  let compDef = null;
  let switchCalls = [];
  const appGlobal = { globalData: {} };
  const wxStub = {
    switchTab: (opts) => { switchCalls.push(opts); },
    navigateTo: () => undefined,
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    Promise,
    require: (name) => {
      const s = String(name);
      if (s.indexOf("auth") > -1) return { requirePublishReady: () => true };
      if (s.indexOf("messageStore") > -1) {
        return { onMessage: () => () => undefined, getUnreadTotal: () => 0 };
      }
      return {};
    },
    wx: wxStub,
    getApp: () => appGlobal,
    Component: (def) => { compDef = def; },
  };
  vm.runInNewContext(source, sandbox, { filename: "custom-tab-bar/index.js" });
  assert.ok(compDef, "应调用 Component() 注册自定义 tabBar");

  const bar = Object.assign({}, compDef, compDef.methods, { data: JSON.parse(JSON.stringify(compDef.data)) });
  bar.setData = function (patch) { Object.assign(this.data, patch); };

  // 当前选中首页(0)：再点首页应直接 return
  bar.setData({ selected: 0 });
  bar.onChange({ currentTarget: { dataset: { index: 0 } } });
  check(() => {
    assert.strictEqual(switchCalls.length, 0, "点击已选中的 tab 不应再触发 switchTab（重复路由报错来源）");
  }, "场景3-同页：点击已选中 tab 被忽略");

  // 点其他 tab 正常跳转
  bar.onChange({ currentTarget: { dataset: { index: 2 } } });
  check(() => {
    assert.strictEqual(switchCalls.length, 1, "点击其他 tab 应正常 switchTab");
    assert.strictEqual(switchCalls[0].url, "/pages/errand/index", "目标路径正确");
  }, "场景3-切页：点击其他 tab 正常跳转");

  // 点课程表 tab 设置自动展开标记（既有逻辑回归）
  bar.setData({ selected: 0 });
  switchCalls = [];
  bar.onChange({ currentTarget: { dataset: { index: 1 } } });
  check(() => {
    assert.strictEqual(switchCalls.length, 1, "课程表 tab 应正常 switchTab");
    assert.strictEqual(appGlobal.globalData.scheduleDrawerAutoOpen, true, "课程表自动展开标记应被设置");
  }, "场景3-回归：课程表自动展开逻辑保持");
}

async function main() {
  await testDuplicateRouteSuppressed();
  await testFailReleasesImmediately();
  await testTabBarSameTabNoop();
  console.log(testCount + " tests passed.");
}

main().catch((err) => {
  console.error("Route guard tests failed:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
