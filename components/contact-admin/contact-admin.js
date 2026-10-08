// 微信限制：小程序内长按只能识别小程序码，个人微信二维码须在 H5 网页里长按识别
const QR_PAGE_URL = 'https://payun01.cn/wechat-qr.html';

const request = require("../../utils/request");
const subscribe = require("../../utils/subscribe");

// 管理员微信二维码与标题：优先使用管理后台「公告-链接图片/公告文字」配置（/config/home），
// 未配置时回退到内置图片与默认标题。缓存仅用于打开弹窗时的即时展示，每次打开都会重新拉取。
const QR_FALLBACK = "/assets/avatar2/管理员微信.png";
let qrCache = { url: "", text: "", at: 0 };

Component({
  options: {
    multipleSlots: true,
  },

  properties: {
    // direct 为 true 时，点击触发区直接打开二维码弹窗（跳过联系菜单）
    direct: {
      type: Boolean,
      value: false,
    },
    // 局部覆盖：驾校详情页这类入口要弹自己机构的二维码，而不是全站管理员微信。
    // 传了 overrideImage 就不再拉取后台「公告」配置，否则会被全站默认值盖掉。
    overrideImage: {
      type: String,
      value: "",
    },
    overrideTitle: {
      type: String,
      value: "",
    },
  },

  data: {
    showMenu: false,
    showQr: false,
    qrImage: QR_FALLBACK,
    // 放大状态：在页面内放大同一张 <image>，不走 wx.previewImage
    qrExpanded: false,
    // 弹窗标题跟随后台「公告-公告文字」，未配置时留空（导航栏不再显示"添加管理员微信"）
    qrTitle: "",
  },

  // 兜底恢复：页面被切走（如用户点右上角胶囊）或组件销毁时，别把 tabBar 留在隐藏态
  pageLifetimes: {
    hide() {
      this.setTabBarHidden(false);
    },
  },

  lifetimes: {
    detached() {
      this.setTabBarHidden(false);
    },
  },

  methods: {
    openMenu() {
      // 新增触发点：小程序内**每一处「联系客服」**都复用本组件，因此在这里统一收口，
      // 点击时同步申请「审核结果通知」订阅授权（与骑手认证页提交认证共用 riderVerify 组）。
      // 为什么联系客服挂审核组：用户找客服的绝大多数场景就是问认证/审核进度，
      // 而审核结果正是 auditCert / audit / auditPass 三个模板负责触达的。
      if (typeof subscribe.requestTriggerByTap === "function") subscribe.requestTriggerByTap("riderVerify");
      if (this.data.direct) {
        this.openQr();
        return;
      }
      this.setData({ showMenu: true });
    },

    closeMenu() {
      this.setData({ showMenu: false });
    },

    openQr() {
      this.setData({ showMenu: false, showQr: true, qrExpanded: false });
      if (this.data.overrideImage) {
        // 本入口固定用机构自己的二维码：直接应用覆盖值，不再拉全站「公告」配置
        const patch = { qrImage: this.data.overrideImage };
        if (this.data.overrideTitle) patch.qrTitle = this.data.overrideTitle;
        this.setData(patch);
        return;
      }
      this.refreshQrImage();
    },

    // 打开弹窗即拉取后台最新配置；缓存仅用于拉取前的即时展示（防闪烁），不做有效期判断，
    // 否则管理员保存新图/新文字后，用户端在缓存期内仍会看到旧内容
    refreshQrImage() {
      request.get("/config/home", {}, false, { silent: true }).then((d) => {
        const notice = ((d || {}).notice) || {};
        const url = String(notice.tailImage || "");
        const text = String(notice.text || "").trim();
        const validUrl = !!url && /^https:\/\//i.test(url);
        if (!validUrl && !text) return;
        if (validUrl) qrCache.url = url;
        if (text) qrCache.text = text;
        qrCache.at = Date.now();
        this.applyQr(validUrl ? url : "", text);
      }).catch(() => { /* 拉取失败沿用当前展示 */ });
    },

    applyQr(url, text) {
      const patch = {};
      if (url && this.data.qrImage !== url) patch.qrImage = url;
      if (text && this.data.qrTitle !== text) patch.qrTitle = text;
      if (Object.keys(patch).length) this.setData(patch);
    },

    closeQr() {
      this.setData({ showQr: false, qrExpanded: false });
      this.setTabBarHidden(false);
    },

    // 点击 = 在同一张 <image> 上就地放大/缩小（放大后长按仍能出原生菜单）
    toggleQrZoom() {
      const next = !this.data.qrExpanded;
      this.setData({ qrExpanded: next });
      this.setTabBarHidden(next);
    },

    // 放大态要「真正全屏」，而自定义 tabBar 由框架渲染在页面内容之上、z-index 盖不住它
    // （见 custom-tab-bar/index.js 的 hidden 字段），只能临时整块隐藏。
    // ⚠ 每个 tab 页的自定义 tabBar 是**独立实例**，非 tab 页 getTabBar() 返回 undefined
    //    —— 必须判空；恢复点必须齐全（收起放大 / 关闭弹窗 / 页面 hide / 组件 detached），
    //    漏一个就是那个 tab 页的 tabBar 永久消失。
    setTabBarHidden(hidden) {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      const tabBar = cur && typeof cur.getTabBar === 'function' ? cur.getTabBar() : null;
      if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ hidden: !!hidden });
    },


    openQrPage() {
      this.setData({ showQr: false });
      // 把当前配置的二维码图片与公告文字通过 URL 参数传给 H5，保证与后台配置一致；标题留空时不再传
      const params = [];
      if (this.data.qrImage && /^https:\/\//i.test(this.data.qrImage)) params.push('qr=' + encodeURIComponent(this.data.qrImage));
      if (this.data.qrTitle) params.push('text=' + encodeURIComponent(this.data.qrTitle));
      const url = QR_PAGE_URL + (params.length ? '?' + params.join('&') : '');
      // 导航栏标题固定为「公告详情」，不跟随公告文字，避免标题过长被截断
      const title = '公告详情';
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(url) + (title ? '&title=' + encodeURIComponent(title) : ''),
      });
    },

    // 弹层内容区吞掉点击（catchtap），否则点弹层空白处会穿透到遮罩把整个弹窗关掉。
    // 放大态例外：此时弹层已铺满全屏，点任意处 = 退出放大，
    // 对齐微信原生图片查看器的「点一下退出」——放大态没有关闭按钮，这是唯一出口。
    stopPropagation() {
      if (this.data.qrExpanded) {
        this.setData({ qrExpanded: false });
        this.setTabBarHidden(false);
      }
    },

    onCustomerServiceContact(e) {
      this.setData({ showMenu: false });
      const result = (e.detail || {}).errMsg || '';
      if (result.indexOf('fail') !== -1) {
        wx.showToast({ title: '客服暂不可用，请稍后重试', icon: 'none' });
      }
    },
  },
});
