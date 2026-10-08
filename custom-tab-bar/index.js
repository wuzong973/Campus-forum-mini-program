const auth = require("../utils/auth");
const messageStore = require("../utils/messageStore");

Component({
  data: {
    selected: 0,
    color: "#969799",
    selectedColor: "#4A7AFF",
    unreadCount: 0,
    // 全屏浮层（如二维码放大态）需要临时隐藏 tabBar：自定义 tabBar 由框架渲染在页面内容
    // 之上（官方推荐用 cover-view 以保证层级，本项目是普通 view，同样在页面之上），
    // position:fixed 的遮罩 z-index 再高也盖不住它 —— 只能整块不渲染。
    // ⚠ 默认 false；由浮层通过 getTabBar().setData({ hidden }) 控制，
    //   且**必须保证恢复**（漏一个恢复点 = 该 tab 页的 tabBar 消失）。
    hidden: false,
    list: [
      { pagePath: "/pages/index/index", text: "首页", iconPath: "/assets/tabbar/home.png", selectedIconPath: "/assets/tabbar/home-active.png" },
      { pagePath: "/pages/schedule/index", text: "课程表", iconPath: "/assets/tabbar/schedule.png", selectedIconPath: "/assets/tabbar/schedule-active.png" },
      { pagePath: "/pages/errand/index", text: "代拿跑腿", iconPath: "/assets/tabbar/errand.png", selectedIconPath: "/assets/tabbar/errand-active.png" },
      { pagePath: "/pages/user/index", text: "我的", iconPath: "/assets/tabbar/user.png", selectedIconPath: "/assets/tabbar/user-active.png", badge: "unread" }
    ]
  },
  lifetimes: {
    attached() {
      // 实时未读数：WebSocket 新消息 / 已读同步都会触发 messageStore 回调
      this._unsubscribe = messageStore.onMessage(() => {
        this.setData({ unreadCount: messageStore.getUnreadTotal() });
      });
      this.setData({ unreadCount: messageStore.getUnreadTotal() });
    },
    detached() {
      if (this._unsubscribe) this._unsubscribe();
    }
  },
  methods: {
    setSelected(selected) {
      this.setData({ selected });
    },
    // messageStore / 页面通过当前页 tabBar 实例同步未读数
    setUnreadCount(count) {
      const total = Number(count) || 0;
      this.setData({ unreadCount: total > 0 ? total : 0 });
    },
    onChange(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item) return;
      // 点击当前已选中的 tab 不再重复 switchTab：
      // 对当前页重复路由会引发框架报错 "routeDone with a webviewId xxx is not found"
      // （Page route 错误 system error），且整页无意义重载
      if (this.data.selected === index) return;
      // 课程表页 onShow 读取该标记：点击 tab 进入时自动展开左侧功能栏
      if (item.pagePath === '/pages/schedule/index') {
        const app = getApp();
        if (app && app.globalData) app.globalData.scheduleDrawerAutoOpen = true;
      }
      wx.switchTab({ url: item.pagePath });
    },
    onPublish() {
      if (!auth.requirePublishReady()) return;
      wx.navigateTo({ url: "/pages/post-publish/index" });
    }
  }
});
