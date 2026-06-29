const wechat = require("../../utils/wechat");
const auth = require("../../utils/auth");

Page({
  data: { loading: false },

  // 登录成功后的统一处理：建立 WebSocket + 同步未读数
  _postLogin() {
    try {
      getApp().onLogin && getApp().onLogin();
    } catch (e) {}
  },

  onGetPhoneNumber(e) {
    const hasCode = !!(e.detail && e.detail.code);
    const isFail =
      e.detail && e.detail.errMsg && e.detail.errMsg.indexOf("fail") !== -1;

    // 模拟器中 getPhoneNumber 无法获取真实 code，走 mock 登录
    if (!hasCode && isFail) {
      this.setData({ loading: true });
      wechat
        .phoneLogin("")
        .then((user) => {
          auth.saveUser(user);
          this._postLogin();
          wx.showToast({ title: "登录成功（模拟）", icon: "success" });
          const pages = getCurrentPages();
          if (pages.length > 1) {
            setTimeout(() => wx.navigateBack(), 1200);
          } else {
            setTimeout(() => wx.switchTab({ url: "/pages/user/index" }), 1200);
          }
        })
        .catch((err) => {
          const msg = (err && err.message) || "登录失败，请重试";
          wx.showToast({ title: msg, icon: "none" });
        })
        .then(() => {
          this.setData({ loading: false });
        });
      return;
    }

    // 用户明确拒绝授权
    if (isFail) {
      wx.showToast({ title: "您已取消手机号授权", icon: "none" });
      return;
    }

    // 必须有 code 才能继续
    if (!hasCode) {
      wx.showToast({ title: "获取手机号失败，请重试", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    wechat
      .phoneLogin(e.detail.code)
      .then((user) => {
        auth.saveUser(user);
        this._postLogin();
        wx.showToast({ title: "登录成功", icon: "success" });
        const pages = getCurrentPages();
        if (pages.length > 1) {
          setTimeout(() => wx.navigateBack(), 1200);
        } else {
          setTimeout(() => wx.switchTab({ url: "/pages/user/index" }), 1200);
        }
      })
      .catch((err) => {
        const msg = (err && err.message) || "登录失败，请重试";
        wx.showToast({ title: msg, icon: "none" });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  },
});
