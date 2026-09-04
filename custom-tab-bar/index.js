const auth = require("../utils/auth");

Component({
  data: {
    selected: 0,
    color: "#969799",
    selectedColor: "#4A7AFF",
    list: [
      { pagePath: "/pages/index/index", text: "首页", iconPath: "/assets/tabbar/home.png", selectedIconPath: "/assets/tabbar/home-active.png" },
      { pagePath: "/pages/schedule/index", text: "课程表", iconPath: "/assets/tabbar/schedule.png", selectedIconPath: "/assets/tabbar/schedule-active.png" },
      { pagePath: "/pages/errand/index", text: "代拿跑腿", iconPath: "/assets/tabbar/errand.png", selectedIconPath: "/assets/tabbar/errand-active.png" },
      { pagePath: "/pages/user/index", text: "我的", iconPath: "/assets/tabbar/user.png", selectedIconPath: "/assets/tabbar/user-active.png" }
    ]
  },
  methods: {
    setSelected(selected) {
      this.setData({ selected });
    },
    onChange(e) {
      const item = this.data.list[e.currentTarget.dataset.index];
      if (item) wx.switchTab({ url: item.pagePath });
    },
    onPublish() {
      if (!auth.requirePublishReady()) return;
      wx.navigateTo({ url: "/pages/post-publish/index" });
    }
  }
});
