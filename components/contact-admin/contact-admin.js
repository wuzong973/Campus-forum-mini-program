// 微信限制：小程序内长按只能识别小程序码，个人微信二维码须在 H5 网页里长按识别
const QR_PAGE_URL = 'https://payun01.cn/wechat-qr.html';

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
    },

    closeQr() {
      this.setData({ showQr: false });
    },

    openQrPage() {
      this.setData({ showQr: false });
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(QR_PAGE_URL) + '&title=添加管理员微信',
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
