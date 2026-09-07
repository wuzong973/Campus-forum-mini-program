const format = require("../../utils/format");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const api = require("../../utils/api");
const qr = require("../../utils/qr");
const anonymousIdentity = require("../../utils/anonymousIdentity");

Component({
  properties: {
    post: { type: Object, value: {} },
    showFooter: { type: Boolean, value: true },
    commentMode: { type: String, value: "detail" },
    allowPin: { type: Boolean, value: false },
    readonly: { type: Boolean, value: false },
    // 点击头像直接进入帖子详情（首页信息流使用），不影响其他页面的头像交互
    avatarToDetail: { type: Boolean, value: false },
  },
  data: {
    timeText: "",
    viewText: "0 浏览",
    authorName: "校园同学",
    certLabel: "",
    displayContent: "",
    isLongContent: false,
    previewImages: [],
    imageUrls: [],
    imageLayout: "none",
    canManageNote: false,
    showNoteEditor: false,
    noteDraft: "",
    noteLength: 0,
    noteInputFocus: false,
    noteKeyboardHeight: 0,
    savingNote: false,
    showSharePopup: false,
    anonPopup: null,
    authorPopup: null,
    // 点赞动效状态（纯视觉，不参与业务逻辑）
    likeAnim: "",
    likeHeartFly: false,
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
        imageUrls: this.toStringUrls(images),
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
        imageUrls: this.toStringUrls(post && post.images),
        imageLayout: this.getImageLayout(((post && post.images) || [])),
        canManageNote: this.canManagePostContent(),
      });
      this.processContent(post && post.content);
    },
    detached() {
      // 动效定时器清理，防止组件销毁后仍触发 setData
      ["_likeAnimTimer", "_likeHeartTimer"].forEach((key) => {
        if (this[key]) { clearTimeout(this[key]); this[key] = null; }
      });
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
      // 帖子媒体兼容两种形态：纯 URL 字符串（旧帖）与混合数组（视频项为 {type:'video', url}）
      return ((Array.isArray(images) ? images : []))
        .map((item) => {
          if (typeof item === "string" && item) return { url: item, isVideo: false, failed: false };
          if (item && typeof item === "object" && item.url && item.type === "video") return { url: item.url, isVideo: true, failed: false };
          return null;
        })
        .filter(Boolean)
        .slice(0, 3);
    },

    // 图片 URL 字符串列表（长按识别菜单的"预览大图"使用）
    toStringUrls(images) {
      return ((Array.isArray(images) ? images : []))
        .map((item) => (typeof item === "string" ? item : (item && item.url) || ""))
        .filter(Boolean);
    },

    // 长按图片：统一二维码识别菜单（识别 / 预览）
    onImageQrScan(e) {
      const { url, urls } = e.currentTarget.dataset;
      qr.recognize(url, urls);
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
      if (this.data.readonly) return;
      wx.navigateTo({
        url: "/pages/post-detail/index?id=" + this.data.post.id,
      });
    },

    openProfile() {
      const post = this.data.post || {};
      if (post.isAnonymous) {
        this.showAnonPopup({
          userId: post.userId,
          nick: this.data.authorName,
          avatar: post.avatarUrl,
          isOwner: true,
          allowAnonymousPm: post.allowAnonymousPm,
        });
        return;
      }
      if (this.showAuthorPopup(post)) return;
      wx.navigateTo({
        url: "/pages/profile/index?id=" + post.userId,
      });
    },

    // 普通帖点击头像：帖主允许匿名私信时弹出「个人主页/分身私信」选择，
    // 关闭了该设置或查看自己的帖子时保持直接进入主页
    showAuthorPopup(post) {
      if (!post || !post.userId) return false;
      if (post.allowAnonymousPm === false) return false;
      const userInfo = ((getApp().globalData || {}).userInfo) || wx.getStorageSync("userInfo") || {};
      if (Number(userInfo.id) === Number(post.userId)) return false;
      this.setData({
        authorPopup: {
          userId: post.userId,
          nick: post.nickName || this.data.authorName || "校园同学",
          avatar: post.avatarUrl || "/assets/icons/avatar.png",
          certLabel: post.certLabel || this.data.certLabel || "",
        },
      });
      return true;
    },

    onCloseAuthorPopup() {
      this.setData({ authorPopup: null });
    },

    onAuthorPopupProfile() {
      const popup = this.data.authorPopup;
      if (!popup || !popup.userId) return;
      this.setData({ authorPopup: null });
      wx.navigateTo({ url: "/pages/profile/index?id=" + popup.userId });
    },

    onAuthorPopupMessage() {
      const popup = this.data.authorPopup;
      if (!popup || !popup.userId) return;
      if (!auth.requireLogin("私信需要先登录")) return;
      wx.showModal({
        title: "分身私信",
        content: "开启对话后，你将以匿名身份与对方交流",
        confirmText: "确认",
        cancelText: "取消",
        success: (res) => {
          if (!res.confirm) return;
          this.setData({ authorPopup: null });
          // 发起方使用随机分身身份，服务端首次进入时存档，全程同一形象；
          // personaKey 以该分身头像为隔离键，不同分身各自对应独立聊天会话
          const persona = anonymousIdentity.generate();
          wx.navigateTo({
            url: "/pages/chat/index?peerId=" + popup.userId +
              "&nick=" + encodeURIComponent(popup.nick || "校园同学") +
              "&avatar=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
              "&anonymous=1" +
              "&personaKey=" + encodeURIComponent(persona.avatarUrl) +
              // 记录来源帖子：聊天页「回到帖子」在消息通知等入口也能返回本帖
              "&postId=" + this.data.post.id +
              "&anonSelfNick=" + encodeURIComponent(persona.nickName) +
              "&anonSelfAvatar=" + encodeURIComponent(persona.avatarUrl)
          });
        }
      });
    },

    showAnonPopup(options) {
      this.setData({
        anonPopup: {
          userId: options.userId,
          nick: options.nick || "校园同学",
          avatar: options.avatar || "/assets/icons/avatar.png",
          isOwner: !!options.isOwner,
          // 对方是否允许被匿名私信：仅当明确为 false 时拦截进入聊天页
          allowAnonymousPm: options.allowAnonymousPm,
        },
      });
    },

    onCloseAnonPopup() {
      this.setData({ anonPopup: null });
    },

    onAnonPopupMessage() {
      const popup = this.data.anonPopup;
      if (!popup || !popup.userId) return;
      if (popup.allowAnonymousPm === false) {
        this.setData({ anonPopup: null });
        wx.showToast({ title: "对方不允许匿名私信", icon: "none" });
        return;
      }
      wx.showModal({
        title: "匿名私信",
        content: "与匿名用户对话时，你也自动变为匿名用户",
        confirmText: "确认",
        cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ anonPopup: null });
        wx.navigateTo({
          // 与对方的某个分身对话：personaKey 用该分身头像作隔离键，
          // 对方其他分身（同一真实用户）的聊天记录不会出现在本会话
          url: "/pages/chat/index?peerId=" + popup.userId +
            "&nick=" + encodeURIComponent(popup.nick || "匿名用户") +
            "&avatar=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
            "&anonymous=1" +
            "&personaKey=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
            // 记录来源帖子：聊天页「回到帖子」在消息通知等入口也能返回本帖
            "&postId=" + this.data.post.id
        });
      }
      });
    },

    // ===== 点赞动效（纯视觉层，不改动业务状态与父组件数据流）=====
    playLikeAnim(stateKey) {
      this.setData({ likeAnim: stateKey });
      if (this._likeAnimTimer) clearTimeout(this._likeAnimTimer);
      this._likeAnimTimer = setTimeout(() => {
        this.setData({ likeAnim: "" });
        this._likeAnimTimer = null;
      }, stateKey === "anim-pop" ? 420 : 300);
    },

    flyLikeHeart() {
      if (this._likeHeartTimer) clearTimeout(this._likeHeartTimer);
      this.setData({ likeHeartFly: false });
      // 先卸载再在下一帧重建节点，保证连续点赞时上浮动画每次都能重新触发
      wx.nextTick(() => {
        this.setData({ likeHeartFly: true });
        this._likeHeartTimer = setTimeout(() => {
          this.setData({ likeHeartFly: false });
          this._likeHeartTimer = null;
        }, 900);
      });
    },

    onLike() {
      if (!auth.requireLogin("点赞需要先登录")) return;
      const post = Object.assign({}, this.data.post);
      post.isLiked = !post.isLiked;
      post.likeCount = Math.max(
        0,
        (Number(post.likeCount) || 0) + (post.isLiked ? 1 : -1),
      );
      this.setData({ post });
      this.triggerEvent("like", { post });
      this.playLikeAnim(post.isLiked ? "anim-pop" : "anim-unpop");
      if (post.isLiked) this.flyLikeHeart();
      request.post("/post/" + post.id + "/like", {}, true, { silent: true }).catch(() => {
        const reverted = Object.assign({}, this.data.post);
        reverted.isLiked = !reverted.isLiked;
        reverted.likeCount = Math.max(
          0,
          (Number(reverted.likeCount) || 0) + (reverted.isLiked ? 1 : -1),
        );
        this.setData({ post: reverted });
        this.triggerEvent("like", { post: reverted });
        this.playLikeAnim("anim-unpop");
        wx.showToast({ title: "操作失败，请重试", icon: "none" });
      });
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
        (Number(post.favoriteCount) || 0) + (post.isFavorited ? 1 : -1),
      );
      this.setData({ post });
      this.triggerEvent("favorite", { post });
      api.favoritePost(post.id).catch(() => {
        const reverted = Object.assign({}, this.data.post);
        reverted.isFavorited = !reverted.isFavorited;
        reverted.favoriteCount = Math.max(
          0,
          (Number(reverted.favoriteCount) || 0) + (reverted.isFavorited ? 1 : -1),
        );
        this.setData({ post: reverted });
        this.triggerEvent("favorite", { post: reverted });
        wx.showToast({ title: "操作失败，请重试", icon: "none" });
      });
    },

    onAvatarTap() {
      // 首页信息流：点击头像直接进入帖子详情页
      if (this.data.avatarToDetail) {
        wx.navigateTo({
          url: "/pages/post-detail/index?id=" + this.data.post.id,
        });
        return;
      }
      this.openProfile();
    },

    openActionMenu() {
      if (!auth.requireLogin('操作帖子需要先登录')) return;
      const userInfo = ((getApp().globalData || {}).userInfo) || wx.getStorageSync('userInfo') || {};
      const isAdmin = ['super_admin', 'content_admin'].indexOf(userInfo.role) > -1;
      const isAuthor = Number(userInfo.id) === Number((this.data.post || {}).userId);
      const itemList = isAdmin
        ? (isAuthor
          ? ['删除', '添加备注', '隐藏']
          : ['删除', '添加备注', '隐藏', '拉黑'])
        : isAuthor
          ? ['删除', '隐藏']
          : ['隐藏', '拉黑', '举报内容'];
      wx.showActionSheet({
        itemList,
        success: async (res) => {
          const selected = itemList[res.tapIndex];
          if (selected === '删除') {
            await this.deletePost();
          } else if (selected === "添加备注") {
            this.openNoteEditor();
          } else if (selected === '隐藏') {
            await this.hidePost();
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
        await api.deletePost(post.id);
        this.triggerEvent('remove', { postId: post.id });
        wx.showToast({ title: '帖子已删除', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: err.message || '删除失败', icon: 'none' });
      }
    },

    async markNotInterested() {
      const post = this.data.post || {};
      if (!await this.confirmAction('拉黑确认', '拉黑后将不再向你展示这条帖子，可在「我的→我删除的→隐藏」中恢复，确认拉黑吗？')) return;
      try {
        await api.markPostNotInterested(post.id, true);
        this.triggerEvent('close', { postId: post.id });
        wx.showToast({ title: '已拉黑', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: err.message || '设置失败', icon: 'none' });
      }
    },

    // 隐藏：仅隐藏这条帖子（不影响同分类其他帖子），可在「我的→我删除的→隐藏」中恢复
    async hidePost() {
      const post = this.data.post || {};
      if (!await this.confirmAction('隐藏帖子', '隐藏后这条帖子将不再对你展示，可在「我的→我删除的→隐藏」中恢复，确认隐藏吗？')) return;
      try {
        await api.markPostNotInterested(post.id, true);
        this.triggerEvent('close', { postId: post.id });
        wx.showToast({ title: '已隐藏', icon: 'success' });
      } catch (err) {
        wx.showToast({ title: err.message || '隐藏失败', icon: 'none' });
      }
    },

    async reportPost() {
      const post = this.data.post || {};
      if (!await this.confirmAction('举报内容', '确认提交举报吗？管理员将收到帖子编号、举报人和提交时间。')) return;
      try {
        await api.reportPost(post.id);
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
