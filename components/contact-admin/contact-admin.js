// 微信限制：小程序内长按只能识别小程序码，个人微信二维码须在 H5 网页里长按识别
const QR_PAGE_URL = 'https://payun01.cn/wechat-qr.html';

const request = require("../../utils/request");

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
  },

  data: {
    showMenu: false,
    showQr: false,
    qrImage: QR_FALLBACK,
    // 弹窗标题跟随后台「公告-公告文字」，未配置时留空（导航栏不再显示"添加管理员微信"）
    qrTitle: "",
  },

  methods: {
    openMenu() {
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
      this.setData({ showMenu: false, showQr: true });
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
      this.setData({ showQr: false });
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

    stopPropagation() {},

    onCustomerServiceContact(e) {
      this.setData({ showMenu: false });
      const result = (e.detail || {}).errMsg || '';
      if (result.indexOf('fail') !== -1) {
        wx.showToast({ title: '客服暂不可用，请稍后重试', icon: 'none' });
      }
    },
  },
});
