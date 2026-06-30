const format = require("../../utils/format");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const api = require("../../utils/api");

Component({
  properties: {
    post: { type: Object, value: {} },
    showFooter: { type: Boolean, value: true },
    commentMode: { type: String, value: "detail" },
    allowPin: { type: Boolean, value: false },
  },
  data: {
    timeText: "",
    displayContent: "",
    isLongContent: false,
    previewImages: [],
    imageLayout: "none",
    topLikedComment: null,
  },
  observers: {
    "post.createdAt, post.content, post.images": function (
      createdAt,
      content,
      images,
    ) {
      this.setData({
        timeText: format.formatRelativeTime(createdAt),
        previewImages: (images || []).slice(0, 3),
        imageLayout: this.getImageLayout(images || []),
      });
      this.processContent(content);
    },
    "post.id": function (postId) {
      if (postId) {
        this.loadTopLikedComment(postId);
      }
    },
  },
  lifetimes: {
    attached() {
      const post = this.data.post;
      this.setData({
        timeText: format.formatRelativeTime(post && post.createdAt),
        previewImages: ((post && post.images) || []).slice(0, 3),
        imageLayout: this.getImageLayout(((post && post.images) || [])),
      });
      this.processContent(post && post.content);
      if (post && post.id) {
        api.setCurrentPostId(post.id);
        this.loadTopLikedComment(post.id);
      }
    },
  },
  methods: {
    getImageLayout(images) {
      const count = (images || []).length;
      if (!count) return "none";
      if (count === 1) return "single";
      if (count === 2) return "double";
      return "grid";
    },

    // 处理内容：超过一定长度截断并显示"全文"
    processContent(content) {
      if (!content) {
        this.setData({ displayContent: "", isLongContent: false });
        return;
      }
      const maxLen = 120;
      if (content.length > maxLen) {
        this.setData({
          displayContent: content.substring(0, maxLen),
          isLongContent: true,
        });
      } else {
        this.setData({
          displayContent: content,
          isLongContent: false,
        });
      }
    },

    // 格式化数字（1.5万、321.8万）
    formatCount(num) {
      if (!num && num !== 0) return "0";
      if (num >= 10000) {
        return (num / 10000).toFixed(1) + "万";
      }
      return String(num);
    },

    onTap() {
      wx.navigateTo({
        url: "/pages/post-detail/index?id=" + this.data.post.id,
      });
    },

    openProfile() {
      wx.navigateTo({
        url: "/pages/profile/index?id=" + this.data.post.userId,
      });
    },

    onLike() {
      if (!auth.requireLogin("点赞需要先登录")) return;
      const post = Object.assign({}, this.data.post);
      post.isLiked = !post.isLiked;
      post.likeCount = Math.max(
        0,
        (post.likeCount || 0) + (post.isLiked ? 1 : -1),
      );
      this.setData({ post });
      this.triggerEvent("like", { post });
      if (!request.USE_MOCK) {
        request
          .post("/post/" + post.id + "/like", {}, true, { silent: true })
          .catch(() => {});
      }
    },

    onComment() {
      if (this.data.commentMode === "sheet") {
        this.triggerEvent("comment", { post: this.data.post });
        return;
      }
      wx.navigateTo({
        url: "/pages/post-detail/index?id=" + this.data.post.id + "&comment=1",
      });
    },

    onMessageAuthor() {
      const post = this.data.post;
      if (!auth.requireLogin("私信需要先登录")) return;
      const currentUserId = ((getApp().globalData || {}).userInfo || {}).id;
      if (post.userId === currentUserId) {
        wx.showToast({ title: "这是你自己", icon: "none" });
        return;
      }
      wx.navigateTo({
        url: "/pages/profile/index?id=" + post.userId,
      });
    },

    onShare() {
      wx.navigateTo({ url: "/pages/share/index?postId=" + this.data.post.id });
    },

    onFavorite() {
      if (!auth.requireLogin("收藏需要先登录")) return;
      const post = Object.assign({}, this.data.post);
      post.isFavorited = !post.isFavorited;
      post.favoriteCount = Math.max(
        0,
        (post.favoriteCount || 0) + (post.isFavorited ? 1 : -1),
      );
      this.setData({ post });
      this.triggerEvent("favorite", { post });
      api.favoritePost(post.id).catch(() => {
        post.isFavorited = !post.isFavorited;
        post.favoriteCount = Math.max(
          0,
          (post.favoriteCount || 0) + (post.isFavorited ? 1 : -1),
        );
        this.setData({ post });
        this.triggerEvent("favorite", { post });
      });
    },

    onAvatarTap() {
      this.openProfile();
    },

    openActionMenu() {
      const canPin = this.data.allowPin;
      const itemList = canPin
        ? ["置顶帖子", "不感兴趣", "举报内容"]
        : ["不感兴趣", "举报内容"];
      wx.showActionSheet({
        itemList,
        success: (res) => {
          if (canPin && res.tapIndex === 0) {
            this.triggerEvent("pin", {
              postId: this.data.post.id,
              post: this.data.post,
            });
          } else if ((!canPin && res.tapIndex === 0) || (canPin && res.tapIndex === 1)) {
            this.triggerEvent("close", { postId: this.data.post.id });
          } else {
            wx.showToast({ title: "已收到反馈", icon: "success" });
          }
        },
      });
    },

    onClose() {
      return this.openActionMenu();
      wx.showActionSheet({
        itemList: ["不感兴趣", "举报内容"],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.triggerEvent("close", { postId: this.data.post.id });
          } else {
            wx.showToast({ title: "已收到反馈", icon: "success" });
          }
        },
      });
    },

    onViewFull() {
      wx.navigateTo({
        url: "/pages/post-detail/index?id=" + this.data.post.id,
      });
    },

    loadTopLikedComment(postId) {
      api.getTopLikedComment(postId).then((comment) => {
        if (comment) {
          this.setData({
            topLikedComment: {
              nickName: comment.nick_name || "用户",
              avatarUrl: comment.avatar_url || "",
              content: comment.content,
              likeCount: comment.like_count || 0,
            },
          });
        } else {
          this.setData({ topLikedComment: null });
        }
      }).catch(() => {
        this.setData({ topLikedComment: null });
      });
    },
  },
});
