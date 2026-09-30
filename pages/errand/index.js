const api = require("../../utils/api");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const { runPullDownRefresh } = require("../../utils/refresh");
const errandStatus = require("../../utils/errand-status");
const subscribe = require("../../utils/subscribe");

const STATUS_TEXT = {
  pending: "待接单",
  accepted: "进行中",
  finishing: "待确认",
  disputed: "有异议",
  done: "已完成",
  unpaid: "待支付",
  cancelled: "已取消",
  refunding: "退款中",
};

const TAB_EMPTY_TEXT = [
  "当前筛选下暂无可接订单",
  "还没有接过的订单",
  "还没有发布的订单",
  "暂无已完成的订单",
];

// 状态筛选标签（图一规范）：顺序/文案固定；activeStatus 为分组 key，'' 表示不筛选（显示全部）
const STATUS_CHIPS = [
  { key: "unpaid", label: "待支付" },
  { key: "pending", label: "待接单" },
  { key: "active", label: "待完成" },
  { key: "done", label: "已完成" },
  { key: "cancelled", label: "已取消" },
];

// 分组映射：订单状态 → 标签（待完成含进行中/待确认/有异议；已取消含退款中，避免订单在五个标签下消失）
const STATUS_GROUP = {
  unpaid: ["unpaid"],
  pending: ["pending"],
  active: ["accepted", "finishing", "disputed"],
  done: ["done"],
  cancelled: ["cancelled", "refunding"],
};

// 已读终态订单的本地存储 key：已完成/已取消订单被用户点开详情一次后，永久不再计入角标
// 注：不再做「超过 N 条就驱逐旧 id」的截断 —— 那会导致「已读订单在用户继续浏览更多订单后又被
// 视为未读、角标再次出现**，与需求里"永久隐藏"冲突。微信本地存储单 key 上限 10MB / 单值 1MB，
// 即便用户累计浏览上万条终态订单（每 id 10 字节左右 ≈ 10 万条 ≈ 1MB）也远未触顶，按需扩展。
const READ_FINAL_KEY_PREFIX = "errand_read_final_order_ids:";

// 截止接单时间 → 卡片紧凑文案「M月D日 HH:mm」（服务端 DATETIME 经 JSON 序列化可能是
// UTC ISO 串或 'YYYY-MM-DD HH:mm:ss'，统一 new Date 解析后按本地时区格式化；不可解析返回 ''）
function formatDeadlineText(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getMonth() + 1 + "月" + d.getDate() + "日 " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// 公开描述清理：历史订单的描述常以快捷标签插入的「期望完成时间：」开头，与卡片独立的
// 期望时间字段重复。这里去掉该前缀（含空内容），清理后为空则回退标题。
function cleanDescText(text, fallback) {
  const cleaned = String(text || "")
    .replace(/^\s*(期望完成时间|期望时间)[:：]\s*/i, "")
    .trim();
  return cleaned || fallback;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 订单标签页：等待帮助→我接的单、我帮助的→已完成的
    listTabs: ["全部订单", "我接的单", "我发布的", "已完成的"],
    activeListTab: 0,
    showNoticeA: true,
    showNoticeB: true,
    notices: [],
    emptyText: TAB_EMPTY_TEXT[0],
    // 接单大厅筛选
    campusGroups: [
      { name: "广州校区", campuses: ["新港校区", "琶洲校区"] },
      { name: "佛山校区", campuses: ["南海南校区", "南海北校区"] },
    ],
    visibleCampusGroups: [],
    isAdmin: false,
    activeRegion: -1,
    subCampuses: [],
    activeSubCampus: "",
    orders: [],
    loading: false,
    loadingMore: false,
    hallHasMore: true,
    // 状态筛选标签（我接的单/我发布的）：默认不筛选显示全部
    statusChips: STATUS_CHIPS,
    activeStatus: "",
    statusCounts: { unpaid: 0, pending: 0, active: 0, done: 0, cancelled: 0 },
    // 顶部标签右上角未读小红点：与状态筛选数字角标同源（computeCounts），有未读订单即亮起
    tabDots: { accepted: false, published: false, done: false },
    loadError: "",
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
    });
    this._mineCache = { published: null, accepted: null };
    // 本地乐观状态：操作成功后到下一次权威数据刷新前，覆盖订单状态用于即时角标重算
    this._localStatus = {};
    // 已读终态订单集合：已完成/已取消订单点开详情一次后永久隐藏角标（持久化）
    const userId = ((app.globalData.userInfo || wx.getStorageSync("userInfo") || {}).id);
    // 已读状态按账号隔离，避免同一设备换号后互相隐藏角标。
    this._readFinalKey = READ_FINAL_KEY_PREFIX + (userId == null ? "anonymous" : String(userId));
    const storedReadIds = wx.getStorageSync(this._readFinalKey);
    this._readFinalIds = new Set(Array.isArray(storedReadIds) ? storedReadIds.map(String) : []);
    this.buildNotices();
    this.initCampusFilter();
    this.loadCurrentTab();
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setSelected(2);
    // 用户未手动改过筛选时，跟随个人设置校区自动填充（改了资料后回来即生效）
    if (!this._filterTouched) this.initCampusFilter();
    // onLoad 后也会触发 onShow，首次进入不重复发起请求，避免较慢的失败请求覆盖成功结果。
    if (!this._hasShown) {
      this._hasShown = true;
      return;
    }
    // 先使用详情/支付页刚写入的状态更新缓存和角标，再用服务端数据校准，不出现空白闪烁。
    if (this.applyPendingStatusChanges()) this.renderCachedTab();
    // 当前在接单大厅（tab 0）时 renderCachedTab 不会触发，红点需单独刷新
    this.refreshTabDots();
    this.loadCurrentTab(true);
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadCurrentTab());
  },

  onUnload() {
    // 支付成功后的延迟刷新定时器：页面已卸载时不再向其 setData
    if (this._payRefreshTimer) {
      clearTimeout(this._payRefreshTimer);
      this._payRefreshTimer = null;
    }
  },

  // ===== 标签页调度 =====
  onListTab(e) {
    const index = Number(e.currentTarget.dataset.index);
    // 新增触发点：「我接的单」(1) / 「我发布的」(2) / 「已完成的」(3) 三个标签页点击时
    // 同步申请「代拿/跑腿通知」订阅授权（与发布跑腿成功共用 errandPublish 触发组）。
    // 「全部订单」(0) 是浏览大厅、不涉及自己的订单，刻意不触发。
    if (index > 0 && typeof subscribe.requestTriggerByTap === "function") {
      subscribe.requestTriggerByTap("errandPublish");
    }
    if (index === this.data.activeListTab) return;
    // 切换主标签时重置状态筛选，两个标签的筛选互不影响
    this.setData({
      activeListTab: index,
      activeStatus: "",
      orders: [],
      emptyText: TAB_EMPTY_TEXT[index],
    });
    this.loadCurrentTab();
  },

  loadCurrentTab(forceRefresh) {
    const tab = this.data.activeListTab;
    if (tab === 0) return this.loadOrders();
    if (tab === 3) return this.loadMine(["published", "accepted"], "done", forceRefresh);
    if (tab === 1) return this.loadMine(["accepted"], "", forceRefresh);
    return this.loadMine(["published"], "", forceRefresh);
  },

  // ===== 全部订单（接单大厅） =====
  loadOrders(append) {
    if (append && (this._hallLoading || this._hallHasMore === false)) return;
    const campus = this.getRegionFilter();
    const page = append ? (this._hallPage || 1) + 1 : 1;
    const loadId = (this._orderLoadId || 0) + 1;
    this._orderLoadId = loadId;
    this._hallLoading = true;
    this.setData(append ? { loadingMore: true } : { loading: true, loadError: "" });
    api
      .getErrandList({ campus, status: "active", page, pageSize: 20 })
      .then((res) => {
        if (loadId !== this._orderLoadId) return;
        this._hallPage = page;
        this._hallHasMore = !!res.hasMore;
        const incoming = (res.list || []).map((o) => this.normalizeOrder(o));
        const orders = append ? this.data.orders.concat(incoming) : incoming;
        this.setData({ orders, loading: false, loadingMore: false, hallHasMore: this._hallHasMore });
      })
      .catch((error) => {
        if (loadId !== this._orderLoadId) return;
        // 追加失败保留已加载内容；只有首页加载失败才整页报错
        this.setData(
          append
            ? { loadingMore: false }
            : { loading: false, loadError: error && error.requiresLogin ? "login" : "retry" }
        );
      })
      .then(() => {
        this._hallLoading = false;
      });
  },

  onReachBottom() {
    // 仅接单大厅（tab 0）分页加载；「我的」标签为服务端全量缓存列表
    if (this.data.activeListTab === 0) this.loadOrders(true);
  },

  // ===== 我接的单 / 我发布的 / 已完成的 =====
  loadMine(sources, onlyStatus, forceRefresh) {
    const need = forceRefresh ? sources : sources.filter((key) => !this._mineCache[key]);
    // 缓存已齐时（如切回状态筛选）直接渲染，不发请求
    if (!need.length) return this.renderMine(sources, onlyStatus);
    const loadId = (this._mineLoadId || 0) + 1;
    this._mineLoadId = loadId;
    this.setData({ loading: true, loadError: "" });
    const loads = need.map((key) => {
      const url =
        key === "published" ? "/errand/my-published" : "/errand/my-accepted";
      return request
        .get(url, {}, true, { silent: true })
        .then((res) => ({ key, list: (res && res.list) || [] }));
    });
    Promise.all(loads)
      .then((results) => {
        if (loadId !== this._mineLoadId) return;
        results.forEach(({ key, list }) => {
          this._mineCache[key] = list;
        });
        // 权威数据已到位，之前操作产生的乐观状态覆盖作废，以服务端为准
        this._localStatus = {};
        this.renderMine(sources, onlyStatus);
      })
      .catch((error) => {
        if (loadId !== this._mineLoadId) return;
        // 已有数据继续可用，网络波动时不会闪成“加载失败”的空白页。
        this.setData({ loading: false, loadError: error && error.requiresLogin ? "login" : "retry" });
      });
  },

  // 渲染「我接的单/我发布的」列表：应用状态筛选 + 统计各标签角标数量
  renderMine(sources, onlyStatus) {
    const counts = this.computeCounts(sources);
    let all = [];
    sources.forEach((key) => {
      all = all.concat(this._mineCache[key] || []);
    });
    if (onlyStatus) all = all.filter((o) => this.statusKeyOf(o) === onlyStatus);
    const activeStatus = this.data.activeStatus;
    if (activeStatus && !onlyStatus) {
      const group = STATUS_GROUP[activeStatus] || [];
      all = all.filter((o) => group.indexOf(this.statusKeyOf(o)) > -1);
    }
    const chip = STATUS_CHIPS.find((c) => c.key === activeStatus);
    const emptyText = chip
      ? "暂无" + chip.label + "的订单"
      : TAB_EMPTY_TEXT[this.data.activeListTab];
    const orders = all.map((o) => this.normalizeOrder(o));
    this.setData({ orders, statusCounts: counts, emptyText, loading: false, loadError: "" });
    // 数字角标与顶部标签红点同源联动，渲染时一并刷新
    this.refreshTabDots();
  },

  // 统计各标签角标数量：不受当前筛选影响；已完成/已取消排除用户已读（点开过详情）的订单
  computeCounts(sources) {
    const counts = { unpaid: 0, pending: 0, active: 0, done: 0, cancelled: 0 };
    const readIds = this._readFinalIds;
    sources.forEach((key) => {
      (this._mineCache[key] || []).forEach((o) => {
        if (o.id == null) return;
        const group = this.statusGroupOf(this.statusKeyOf(o));
        if (!group) return;
        // 已读的终态订单（已完成/已取消）不再计入角标 → 数字立即消失且永久隐藏
        if (
          (group === "done" || group === "cancelled") &&
          readIds.has(String(o.id))
        )
          return;
        counts[group] += 1;
      });
    });
    return counts;
  },

  // 订单当前展示状态：优先本地乐观状态（支付/接单成功后的即时变化），否则按服务端数据判定
  statusKeyOf(o) {
    const local = this._localStatus[String(o.id)];
    if (local) return local;
    return this.effectiveStatus(o);
  },

  // 状态/已读变化后立即重算角标数字：不重拉网络、不刷新列表，数字即刻变化、无闪烁
  refreshBadgesNow() {
    // 红点跨标签（当前不在对应标签也能提示），先于数字角标的本标签限制刷新
    this.refreshTabDots();
    const tab = this.data.activeListTab;
    if (tab !== 1 && tab !== 2) return;
    const sources = tab === 1 ? ["accepted"] : ["published"];
    if (!this._mineCache || this._mineCache[sources[0]] == null) return;
    this.setData({ statusCounts: this.computeCounts(sources) });
  },

  // 顶部标签（我接的单/我发布的/已完成的）右上角未读小红点：
  // 与状态筛选数字角标同一数据源（_mineCache + _localStatus + _readFinalIds），
  // 数字角标因订单被读取而消失时红点同步熄灭，再次出现未读订单时重新亮起。
  // 缓存未加载（首次进入还没拉到我的订单）时全部熄灭，避免误报。
  refreshTabDots() {
    const cache = this._mineCache || {};
    const readIds = this._readFinalIds || new Set();
    const hasUnread = (key) =>
      !!cache[key] &&
      (cache[key] || []).some((o) => {
        if (o.id == null) return false;
        const group = this.statusGroupOf(this.statusKeyOf(o));
        if (!group) return false;
        // 与数字角标同一规则：已读的终态订单（已完成/已取消）不算未读
        if (
          (group === "done" || group === "cancelled") &&
          readIds.has(String(o.id))
        )
          return false;
        return true;
      });
    // 「已完成的」标签：任一来源存在未读的已完成订单即亮起
    const hasUnreadDone = (key) =>
      !!cache[key] &&
      (cache[key] || []).some((o) => {
        if (o.id == null) return false;
        return (
          this.statusGroupOf(this.statusKeyOf(o)) === "done" &&
          !readIds.has(String(o.id))
        );
      });
    this.setData({
      tabDots: {
        accepted: hasUnread("accepted"),
        published: hasUnread("published"),
        done: hasUnreadDone("published") || hasUnreadDone("accepted"),
      },
    });
  },

  applyPendingStatusChanges() {
    const updates = errandStatus.consume();
    const ids = Object.keys(updates);
    if (!ids.length) return false;
    ids.forEach((id) => { this._localStatus[id] = updates[id]; });
    return true;
  },

  renderCachedTab() {
    const tab = this.data.activeListTab;
    if (tab === 1 && this._mineCache.accepted) return this.renderMine(["accepted"]);
    if (tab === 2 && this._mineCache.published) return this.renderMine(["published"]);
    if (tab === 3 && this._mineCache.published && this._mineCache.accepted) return this.renderMine(["published", "accepted"], "done");
  },

  // 已完成/已取消订单：用户点击查看详情一次后永久隐藏角标（本地持久化，重启仍生效）
  markFinalRead(item) {
    const st = item.statusClass || this.statusKeyOf(item.raw || item);
    if (st !== "done" && st !== "cancelled" && st !== "refunding") return;
    const id = String(item.id || (item.raw && item.raw.id));
    if (!id || id === "undefined" || id === "null") return;
    if (this._readFinalIds.has(id)) return;
    this._readFinalIds.add(id);
    // 持久化：try/catch 兜底，避免 wx.setStorageSync 在某些环境（如开发者工具本地存储被禁用）
    // 静默抛错导致内存已更新、存储未更新 —— 下次冷启动角标再次出现，与"永久隐藏"冲突
    try {
      wx.setStorageSync(
        this._readFinalKey,
        Array.from(this._readFinalIds),
      );
    } catch (err) {
      // 存储失败不阻断流程：内存已更新，本次会话内角标仍能立刻隐藏
      console.warn("[errand] 持久化已读 id 失败，重启后可能再次显示角标", err);
    }
    // 立即隐藏对应角标（无需等下一次网络刷新）
    this.refreshBadgesNow();
  },

  statusGroupOf(statusKey) {
    for (const key of Object.keys(STATUS_GROUP)) {
      if (STATUS_GROUP[key].indexOf(statusKey) > -1) return key;
    }
    return "";
  },

  // 点击状态标签：选中筛选 / 再次点击取消筛选回到全部（直接用缓存渲染，切换流畅）
  onStatusChip(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const next = this.data.activeStatus === key ? "" : key;
    this.setData({ activeStatus: next });
    const tab = this.data.activeListTab;
    if (tab === 1) return this.renderMine(["accepted"]);
    if (tab === 2) return this.renderMine(["published"]);
  },

  getRegionFilter() {
    return this.data.activeSubCampus || "";
  },

  initCampusFilter() {
    const userInfo =
      getApp().globalData.userInfo || wx.getStorageSync("userInfo") || {};
    // 所有用户都可看到全部校区分组与「全部区域」；默认选中自己所在的校区分组
    const visibleCampusGroups = this.data.campusGroups;
    const userCampusGroup = visibleCampusGroups.find(
      (group) => group.campuses.indexOf(userInfo.campus) > -1,
    );
    const activeRegion = userCampusGroup
      ? visibleCampusGroups.indexOf(userCampusGroup)
      : -1;
    const group = activeRegion > -1 ? visibleCampusGroups[activeRegion] : null;
    this.setData({
      isAdmin: ["admin", "super_admin"].indexOf(userInfo.role) > -1,
      visibleCampusGroups,
      activeRegion,
      subCampuses: group ? group.campuses : [],
      activeSubCampus: group ? userInfo.campus : "",
    });
  },

  // 支付状态修正：发布者未支付的待接单记为待支付；取消退款中记为退款中
  effectiveStatus(o) {
    const paymentStatus = String(
      o.paymentStatus || o.payment_status || "SUCCESS",
    ).toUpperCase();
    const isPublisher = o.role === "publisher";
    if (
      isPublisher &&
      (o.status === "pending" || !o.status) &&
      !["SUCCESS", "REFUNDING", "REFUNDED"].includes(paymentStatus)
    )
      return "unpaid";
    if (o.status === "cancelled" && paymentStatus === "REFUNDING")
      return "refunding";
    if (o.status === "finished") return "done";
    return o.status || "pending";
  },

  normalizeOrder(o) {
    const format = require("../../utils/format");
    const statusKey = this.statusKeyOf(o);
    const tab = this.data.activeListTab;
    const expectText =
      o.appointmentTime ||
      o.appointment_time ||
      (o.pickupTimeType === "scheduled" && (o.pickupTime || o.pickup_time)
        ? o.pickupTime || o.pickup_time
        : "") || "越快越好";
    // 截止接单时间（发单人可选设置）：独立于期望时间展示，未设置不显示该行
    const deadlineText = formatDeadlineText(o.acceptDeadline || o.accept_deadline);
    // 性别限制标签分类：限男生/限女生/不限性别（发布时必选，用于订单卡片展示）
    const genderRaw = o.gender_requirement || o.genderRequirement || "";
    const genderClass =
      genderRaw === "限男生"
        ? "male"
        : genderRaw === "限女生"
          ? "female"
          : "any";
    // 角色判定：服务端 orderRole 返回 'publisher'/'acceptor'/'viewer'；
    // 服务端未返回时（旧版本接口/本地数据）按当前登录用户身份兜底推断，供卡片取消按钮显隐使用
    const myId = (getApp().globalData.userInfo || {}).id;
    const role =
      o.role ||
      (myId != null && String(o.publisher_id || o.publisherId) === String(myId)
        ? "publisher"
        : myId != null &&
            o.acceptor_id != null &&
            String(o.acceptor_id) === String(myId)
          ? "acceptor"
          : "");
    return {
      id: o.id,
      role: role,
      // 接单/发布时间透传：接单方"5 分钟内可取消"的判断依赖（服务端字段 accepted_at）
      createdAt: o.createdAt || o.created_at || "",
      acceptedAt: o.acceptedAt || o.accepted_at || "",
      status: STATUS_TEXT[statusKey] || "待接单",
      statusClass: statusKey,
      price: o.reward || o.totalAmount,
      // 图二版式：卡片正文展示公开描述（remark），无则回退标题；清理与期望时间字段重复的旧前缀
      descText: cleanDescText(
        o.remark || o.description || o.title || (o.type || "快递") + "代拿",
        (o.title || (o.type || "快递") + "代拿").trim(),
      ),
      campus: o.campus || "",
      genderText: genderRaw,
      genderClass: genderClass,
      // 发单人真实头像与昵称（服务端 JOIN sys_user 返回；账号注销等缺失时兜底）
      authorName: o.publisher_name || o.publisherName || "校园用户",
      avatarUrl:
        o.publisher_avatar || o.publisherAvatar || "/assets/icons/avatar.png",
      expectText: expectText,
      deadlineText: deadlineText,
      type: o.type,
      action: this.cardAction(statusKey, tab, o),
      publishTime:
        format.formatRelativeTime(o.createdAt || o.created_at) || "刚刚",
      raw: o,
    };
  },

  // 各标签下的主操作按钮
  cardAction(statusKey, tab, o) {
    // 全部订单（接单大厅）按图二版式：卡片不带操作按钮，点击进入详情接单
    if (tab === 0) return "";
    if (tab === 1) return statusKey === "accepted" ? "finish" : "";
    if (tab === 2) {
      if (statusKey === "unpaid") return "pay";
      if (statusKey === "pending") return "cancel";
      if (statusKey === "accepted") return "contact";
      // 接单方已提交完成，发单人需要进详情确认或提出异议
      if (statusKey === "finishing") return "confirm";
      return "";
    }
    return "";
  },

  goBack() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  // ===== 公告关闭 =====
  // 构建公告栏数据：受 showNoticeA/B 开关控制，用户关闭某条后不再显示
  buildNotices() {
    const notices = [];
    if (this.data.showNoticeA) {
      notices.push({
        key: "showNoticeA",
        cls: "notice-red",
        text: "跑腿交易请走平台支付，私下转账无法保障资金安全",
      });
    }
    if (this.data.showNoticeB) {
      notices.push({
        key: "showNoticeB",
        cls: "notice-yellow",
        text: "接单后请及时联系对方，完成订单记得确认，避免影响完成率",
      });
    }
    this.setData({ notices });
  },

  onCloseNotice(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ [key]: false });
    this.buildNotices();
  },

  // 公告栏"管理员"点击：唤起页面底部的管理员微信二维码弹窗（与首页公告栏交互一致）
  onNoticeAdminTap() {
    const comp = this.selectComponent("#adminQr");
    if (comp) comp.openQr();
  },

  // ===== 区域筛选 =====
  onRegionSelect(e) {
    this._filterTouched = true;
    const activeRegion = Number(e.currentTarget.dataset.index);
    const group = this.data.visibleCampusGroups[activeRegion];
    this.setData({
      activeRegion,
      subCampuses: group ? group.campuses : [],
      activeSubCampus: "",
      orders: [],
    });
  },

  onSubCampusSelect(e) {
    this._filterTouched = true;
    this.setData({ activeSubCampus: e.currentTarget.dataset.value });
    this.loadOrders();
  },

  onAllRegionSelect() {
    this._filterTouched = true;
    this.setData({ activeRegion: -1, subCampuses: [], activeSubCampus: "" });
    this.loadOrders();
  },

  // ===== 卡片操作 =====
  onAccept(e) {
    const order = e.currentTarget.dataset.order || {};
    const orderId = order.id || (order.raw && order.raw.id);
    if (!auth.requireRunnerReady()) return;
    wx.showModal({
      title: "确认接单",
      content: "确定接受此订单？",
      success: (res) => {
        if (!res.confirm) return;
        request.post("/errand/" + orderId + "/accept", {}, true).then(() => {
          wx.showToast({ title: "接单成功", icon: "success" });
          // 乐观更新：我接的单里的该订单立即变为「进行中」（待完成组），待接单角标同步减一
          if (orderId != null) this._localStatus[String(orderId)] = "accepted";
          this.refreshBadgesNow();
          this._mineCache = { published: null, accepted: null };
          this.loadCurrentTab();
        });
      },
    });
  },

  onPay(e) {
    const order = e.currentTarget.dataset.order || {};
    const orderId = order.id || (order.raw && order.raw.id);
    if (!orderId) return;
    request
      .post("/errand/" + orderId + "/pay", {}, true, {
        idempotencyKey: "errand_repay_" + orderId,
      })
      .then((payment) => {
        return new Promise((resolve, reject) =>
          wx.requestPayment({ ...payment, success: resolve, fail: reject }),
        );
      })
      .then(() => {
        wx.showToast({ title: "支付成功，正在确认", icon: "success" });
        // 乐观更新：支付成功后该订单不再计入「待支付」角标（变为待接单），数字立即减少、无延迟
        if (orderId != null) {
          this._localStatus[String(orderId)] = "pending";
          this.refreshBadgesNow();
        }
        this._mineCache = { published: null, accepted: null };
        this._payRefreshTimer = setTimeout(() => this.loadCurrentTab(), 1000);
      })
      .catch((error) => {
        const message = String(
          (error && (error.errMsg || error.message)) || "",
        );
        if (/cancel/.test(message))
          wx.showToast({ title: "已取消支付", icon: "none" });
      });
  },

  onFinish(e) {
    const order = e.currentTarget.dataset.order || {};
    const orderId = order.id || (order.raw && order.raw.id);
    if (!orderId) return;
    wx.navigateTo({ url: "/pages/errand-complete/index?id=" + orderId });
  },

  onCancelOrder(e) {
    const order = e.currentTarget.dataset.order || {};
    const orderId = order.id || (order.raw && order.raw.id);
    if (!orderId) return;
    wx.navigateTo({
      url: "/pages/errand-cancel/index?id=" + orderId + "&role=publisher",
    });
  },

  onContact(e) {
    const order = e.currentTarget.dataset.order || {};
    const raw = order.raw || {};
    const accepterId = Number(
      raw.accepterId ||
        raw.accepter_id ||
        raw.acceptorId ||
        raw.acceptor_id ||
        0,
    );
    if (!accepterId) {
      wx.showToast({ title: "对方暂未接单，暂无法联系", icon: "none" });
      return;
    }
    // 进入跑腿订单专属聊天（与私信聊天独立）
    wx.navigateTo({
      url: "/pages/errand-chat/index?orderId=" + (order.id || raw.id),
    });
  },

  onOpenDetail(e) {
    const item = e.currentTarget.dataset.order || {};
    const id = item.id || (item.raw && item.raw.id);
    if (!id) return;
    // 已完成/已取消订单：点开详情一次 → 永久隐藏对应角标（立即生效并持久化）
    this.markFinalRead(item);
    wx.navigateTo({ url: "/pages/errand-detail/index?id=" + id });
  },

  goPublish() {
    if (!auth.requireLogin("发布跑腿需要先登录")) return;
    // 新增触发点：顶部「发布需求」卡片与右下角「发布」浮动按钮共用本函数，
    // 在此同步申请「代拿/跑腿通知」订阅授权（与发布成功后的触发点同一个 errandPublish 组）。
    if (typeof subscribe.requestTriggerByTap === "function") subscribe.requestTriggerByTap("errandPublish");
    wx.navigateTo({ url: "/pages/errand-publish/index" });
  },

  goUserCenter() {
    if (!auth.requireLogin("查看订单需要先登录")) return;
    wx.navigateTo({ url: "/pages/errand-order/index" });
  },

  // ===== 右下角浮动导航 =====
  goMessages() {
    if (!auth.requireLogin("查看跑腿消息需要先登录")) return;
    // 新增触发点：右下角「消息」浮动按钮 → 申请「代拿/跑腿通知」订阅授权
    // （跑腿消息页收到的是订单相关通知，故挂在 errandPublish 组而非私信组）。
    if (typeof subscribe.requestTriggerByTap === "function") subscribe.requestTriggerByTap("errandPublish");
    wx.navigateTo({ url: "/pages/errand-message/index" });
  },

  goHome() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});
