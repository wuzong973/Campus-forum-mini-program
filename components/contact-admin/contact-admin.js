Component({
  options: {
    multipleSlots: true,
  },

  data: {
    showMenu: false,
    showQr: false,
  },

  methods: {
    openMenu() {
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
