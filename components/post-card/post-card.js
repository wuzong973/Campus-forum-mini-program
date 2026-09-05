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
    viewText: "0 浏览",
    authorName: "校园同学",
    certLabel: "",
    displayContent: "",
    isLongContent: false,
    previewImages: [],
    imageLayout: "none",
    canManageNote: false,
    showNoteEditor: false,
    noteDraft: "",
    noteLength: 0,
    noteInputFocus: false,
    noteKeyboardHeight: 0,
    savingNote: false,
    showSharePopup: false,
  },
  observers: {
    "post.createdAt, post.content, post.images, post.viewCount, post.nickName, post.certLabel": function (
      createdAt,
      content,
      images,
      viewCount,
      nickName,
      certLabel,
    ) {
      this.setData({
        timeText: format.formatRelativeTime(createdAt) || "刚刚",
        viewText: this.formatCount(viewCount || 0) + " 浏览",
        authorName: nickName || "校园同学",
        certLabel: certLabel || "",
        previewImages: this.toPreviewImages(images),
        imageLayout: this.getImageLayout(images || []),
      });
      this.processContent(content);
    },
  },
  lifetimes: {
    attached() {
      const post = this.data.post;
      this.setData({
        timeText: format.formatRelativeTime(post && post.createdAt) || "刚刚",
        viewText: this.formatCount((post && post.viewCount) || 0) + " 浏览",
        authorName: (post && post.nickName) || "校园同学",
        certLabel: (post && post.certLabel) || "",
        previewImages: this.toPreviewImages(post && post.images),
        imageLayout: this.getImageLayout(((post && post.images) || [])),
        canManageNote: this.canManagePostContent(),
      });
      this.processContent(post && post.content);
    },
  },
  methods: {
    canManagePostContent() {
      const app = getApp();
      const userInfo = (app.globalData || {}).userInfo || wx.getStorageSync("userInfo") || {};
      return ["super_admin", "content_admin"].indexOf(userInfo.role) > -1;
    },

    getImageLayout(images) {
      const count = (images || []).length;
      if (!count) return "none";
      if (count === 1) return "single";
      if (count === 2) return "double";
      return "grid";
    },

    toPreviewImages(images) {
      return (Array.isArray(images) ? images : [])
        .slice(0, 3)
        .filter((url) => typeof url === "string" && url)
        .map((url) => ({ url, failed: false }));
    },

    onPreviewImage(e) {
      const current = e.currentTarget.dataset.url;
      const urls = ((this.data.post || {}).images || []).filter((url) => typeof url === "string" && url);
      if (current && urls.length) wx.previewImage({ current, urls });
    },

    onImageError(e) {
      const url = e.currentTarget.dataset.url;
      const previewImages = this.data.previewImages.map((item) =>
        item.url === url ? Object.assign({}, item, { failed: true }) : item,
      );
      console.warn("[post-card] image load failed", url, e.detail || {});
      this.setData({ previewImages });
      this.triggerEvent("imageerror", { postId: (this.data.post || {}).id, url });
    },

    onRetryImage(e) {
      const url = e.currentTarget.dataset.url;
      const previewImages = this.data.previewImages.map((item) =>
        item.url === url ? Object.assign({}, item, { failed: false }) : item,
      );
      this.setData({ previewImages });
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
      if ((this.data.post || {}).isAnonymous) {
        wx.navigateTo({ url: '/pages/chat/index?peerId=' + this.data.post.userId + '&anonymous=1' });
        return;
      }
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

    onShare() {
      this.setData({ showSharePopup: true });
    },

    onCloseSharePopup() {
      this.setData({ showSharePopup: false });
    },

    onShareToFriend(e) {
      this.triggerEvent('shareToFriend', { postId: this.data.post.id });
      this.setData({ showSharePopup: false });
    },

    onSharePoster(e) {
      const postId = e.detail && e.detail.postId || this.data.post.id;
      wx.navigateTo({ url: "/pages/poster/index?postId=" + postId });
      this.setData({ showSharePopup: false });
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
      if (!auth.requireLogin('操作帖子需要先登录')) return;
      const userInfo = ((getApp().globalData || {}).userInfo) || wx.getStorageSync('userInfo') || {};
      const isAdmin = ['super_admin', 'content_admin'].indexOf(userInfo.role) > -1;
      const isAuthor = Number(userInfo.id) === Number((this.data.post || {}).userId);
      const itemList = isAdmin
        ? ['删除', '添加备注', '拉黑']
        : isAuthor
          ? ['删除']
          : ['拉黑', '举报内容'];
      wx.showActionSheet({
        itemList,
        success: async (res) => {
          const selected = itemList[res.tapIndex];
          if (selected === '删除') {
            await this.deletePost();
          } else if (selected === "添加备注") {
            this.openNoteEditor();
          } else if (selected === "拉黑") {
            await this.markNotInterested();
          } else {
            await this.reportPost();
          }
        },
      });
    },

    confirmAction(title, content) {
      return new Promise((resolve) => wx.showModal({
        title,
        content,
        confirmColor: '#e64340',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      }));
    },

    async deletePost() {
      const post = this.data.post || {};
      if (!await this.confirmAction('删除帖子', '删除后无法恢复，确认删除这条帖子吗？')) return;
      try {
        if (!request.USE_MOCK) await api.deletePost(post.id);
        this.triggerEvent('remove', { postId: post.id });
        wx.showToast({ title: '帖子已删除', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: err.message || '删除失败', icon: 'none' });
      }
    },

    async markNotInterested() {
      const post = this.data.post || {};
      if (!await this.confirmAction('拉黑确认', '将永久隐藏此帖子及同分类内容，确认继续吗？')) return;
      try {
        if (!request.USE_MOCK) await api.markPostNotInterested(post.id);
        this.triggerEvent('close', { postId: post.id });
        wx.showToast({ title: '已拉黑', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: err.message || '设置失败', icon: 'none' });
      }
    },

    async reportPost() {
      const post = this.data.post || {};
      if (!await this.confirmAction('举报内容', '确认提交举报吗？管理员将收到帖子编号、举报人和提交时间。')) return;
      try {
        if (!request.USE_MOCK) await api.reportPost(post.id);
        wx.showToast({ title: '举报已提交', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: err.message || '举报失败', icon: 'none' });
      }
    },

    onClose() {
      this.openActionMenu();
    },

    openNoteEditor() {
      const noteDraft = this.data.post.reviewNote || "";
      this.setData({
        showNoteEditor: true,
        noteDraft,
        noteLength: noteDraft.length,
        noteInputFocus: false,
        noteKeyboardHeight: 0,
      });
      // Focus after the panel is rendered so WeChat reliably opens the keyboard.
      setTimeout(() => {
        if (this.data.showNoteEditor) this.setData({ noteInputFocus: true });
      }, 120);
    },

    closeNoteEditor() {
      if (!this.data.savingNote) {
        this.setData({ showNoteEditor: false, noteInputFocus: false, noteKeyboardHeight: 0 });
      }
    },

    onNoteInput(e) {
      const noteDraft = e.detail.value || "";
      this.setData({ noteDraft, noteLength: noteDraft.length });
    },

    onNoteKeyboardChange(e) {
      this.setData({ noteKeyboardHeight: (e.detail || {}).height || 0 });
    },

    async saveNote() {
      const reviewNote = (this.data.noteDraft || "").trim();
      if (!reviewNote) {
        wx.showToast({ title: "请填写备注", icon: "none" });
        return;
      }
      if (this.data.savingNote) return;
      if (!await this.confirmAction('保存备注', '备注会以醒目标注展示给所有用户，确认保存吗？')) return;
      this.setData({ savingNote: true });
      const finish = () => {
        const post = Object.assign({}, this.data.post, { reviewNote });
        this.setData({
          post,
          showNoteEditor: false,
          noteInputFocus: false,
          noteKeyboardHeight: 0,
          savingNote: false,
        });
        this.triggerEvent("reviewnote", { postId: post.id, reviewNote });
        wx.showToast({ title: "备注已保存", icon: "success" });
      };
      if (request.USE_MOCK) {
        finish();
        return;
      }
      api.updatePostReviewNote(this.data.post.id, reviewNote).then(finish).catch(() => {
        this.setData({ savingNote: false });
      });
    },

    noop() {},

    onViewFull() {
      wx.navigateTo({
        url: "/pages/post-detail/index?id=" + this.data.post.id,
      });
    },

  },
});
