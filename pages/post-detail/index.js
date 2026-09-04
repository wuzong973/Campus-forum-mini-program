const api = require("../../utils/api");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const format = require("../../utils/format");

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    post: null,
    comments: [],
    commentSort: "hot",
    commentText: "",
    timeText: "",
    viewText: "0 浏览",
    currentUserId: 0,
    replyTo: null,
    replyToNick: "",
    showEditModal: false,
    editContent: "",
    editCommentId: 0,
    topLikedComment: null,
    canManageNote: false,
    showNoteEditor: false,
    noteDraft: '',
    noteLength: 0,
    noteInputFocus: false,
    noteKeyboardHeight: 0,
    savingNote: false,
    contactExpanded: true,
    commentFocus: false,
    showEmojiPanel: false,
    commentImages: [],
    keyboardHeight: 0,
    pageHeight: 0,
    bottomBarHeight: 120,
    showSharePopup: false,
    emojis: [
      "😀",
      "😂",
      "😍",
      "🥰",
      "😎",
      "😭",
      "👍",
      "👏",
      "🙏",
      "🔥",
      "❤️",
      "🎉",
      "🤔",
      "😋",
      "😴",
      "💪",
      "🌟",
      "📚",
      "🏃",
      "☕",
    ],
  },

  onLoad(options) {
    const id = options.id;
    const app = getApp();
    const sysInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    const bottomBarHeight = 120;
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      currentUserId: (app.globalData.userInfo || {}).id || 0,
      canManageNote: this.canManagePostContent(),
      pageHeight: sysInfo.windowHeight - bottomBarHeight / 2,
      bottomBarHeight,
    });
    api.setCurrentPostId(id);
    this.loadPost(id);
    this.loadComments(id, this.data.commentSort);
    this.loadTopLikedComment(id);
    if (options.comment === "1") {
      setTimeout(() => this.setData({ commentFocus: true }), 450);
    }
  },

  canManagePostContent() {
    const app = getApp();
    const userInfo = (app.globalData || {}).userInfo || wx.getStorageSync('userInfo') || {};
    return ['super_admin', 'content_admin'].indexOf(userInfo.role) > -1;
  },

  openActionMenu() {
    const canManageNote = this.canManagePostContent();
    if (canManageNote !== this.data.canManageNote) this.setData({ canManageNote });
    const itemList = [];
    if (canManageNote) itemList.push('添加备注');
    itemList.push('不感兴趣', '举报内容');
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const selected = itemList[res.tapIndex];
        if (selected === '添加备注') {
          this.openNoteEditor();
        } else if (selected === '不感兴趣') {
          wx.navigateBack();
        } else {
          const submit = () => request.post('/feedback/report', {
            targetType: 'post',
            targetId: Number((this.data.post || {}).id),
            reason: '用户举报：内容可能违反社区规则'
          }, true, { silent: true })
          if (request.USE_MOCK) wx.showToast({ title: '已收到反馈', icon: 'success' })
          else submit().then(() => wx.showToast({ title: '举报已提交', icon: 'success' })).catch((err) => wx.showToast({ title: err.message || '举报失败', icon: 'none' }))
        }
      },
    });
  },

  openNoteEditor() {
    const noteDraft = (this.data.post || {}).reviewNote || '';
    this.setData({
      showNoteEditor: true,
      noteDraft,
      noteLength: noteDraft.length,
      noteInputFocus: false,
      noteKeyboardHeight: 0,
    });
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
    const noteDraft = e.detail.value || '';
    this.setData({ noteDraft, noteLength: noteDraft.length });
  },

  onNoteKeyboardChange(e) {
    this.setData({ noteKeyboardHeight: (e.detail || {}).height || 0 });
  },

  saveNote() {
    const reviewNote = (this.data.noteDraft || '').trim();
    if (!reviewNote) {
      wx.showToast({ title: '请填写备注', icon: 'none' });
      return;
    }
    if (this.data.savingNote || !this.data.post) return;
    if (request.USE_MOCK) {
      this.setData({
        post: Object.assign({}, this.data.post, { reviewNote }),
        showNoteEditor: false,
        noteInputFocus: false,
        noteKeyboardHeight: 0,
      });
      wx.showToast({ title: '备注已保存', icon: 'success' });
      return;
    }
    this.setData({ savingNote: true });
    api.updatePostReviewNote(this.data.post.id, reviewNote).then(() => {
      this.setData({
        post: Object.assign({}, this.data.post, { reviewNote }),
        showNoteEditor: false,
        noteInputFocus: false,
        noteKeyboardHeight: 0,
        savingNote: false,
      });
      wx.showToast({ title: '备注已保存', icon: 'success' });
    }).catch(() => this.setData({ savingNote: false }));
  },

  noop() {},

  loadPost(id) {
    api.getPostDetail(id).then((post) => {
      if (post) {
        const followedPostIds = wx.getStorageSync("followed_post_ids") || [];
        post.isFollowed = followedPostIds.indexOf(post.id) > -1;
        this.setData({
          post,
          contactExpanded: true,
          timeText: format.formatRelativeTime(post.createdAt) || "刚刚",
          viewText: this.formatViewCount(post.viewCount || 0) + " 浏览",
        });
      } else {
        wx.showToast({ title: "帖子不存在", icon: "none" });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    });
  },

  formatViewCount(count) {
    const value = Number(count) || 0
    return value >= 10000 ? (value / 10000).toFixed(1) + '万' : String(value)
  },

  loadComments(postId, sort = this.data.commentSort) {
    api.getCommentList(postId, sort).then((res) => {
      const list = (res.list || []).map((c) => ({
        id: c.id,
        userId: c.user_id || c.userId,
        nickName: c.nick_name || c.nickName || "用户",
        avatarUrl: c.avatar_url || c.avatarUrl || "",
        content: c.content,
        images: c.images || [],
        parentNickName: c.parent_nick_name || "",
        timeText: format.formatRelativeTime(c.created_at || c.createdAt) || "刚刚",
        createdAt: c.created_at || c.createdAt,
        likeCount: c.like_count || 0,
        isLiked: !!c.is_liked,
      }));
      this.setData({ comments: this.sortComments(list, sort) });
    });
  },

  sortComments(comments, sort) {
    return comments.slice().sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime() || 0;
      const timeB = new Date(b.createdAt || 0).getTime() || 0;
      if (sort === "time") {
        return timeB - timeA || Number(b.id || 0) - Number(a.id || 0);
      }
      return (b.likeCount || 0) - (a.likeCount || 0) || timeA - timeB;
    });
  },

  onCommentSort(e) {
    const sort = e.currentTarget.dataset.sort;
    if (!sort || sort === this.data.commentSort) return;
    this.setData({ commentSort: sort });
    this.loadComments(this.data.post.id, sort);
  },

  onCommentAvatarTap(e) {
    const userId = e.currentTarget.dataset.userid;
    if (userId) wx.navigateTo({ url: "/pages/profile/index?id=" + userId });
  },

  onLikePost() {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isLiked = !post.isLiked;
    post.likeCount = Math.max(0, (post.likeCount || 0) + (post.isLiked ? 1 : -1));
    this.setData({ post });
    if (request.USE_MOCK) return;
    request.post("/post/" + post.id + "/like", {}, true, { silent: true }).catch(() => {
      post.isLiked = !post.isLiked;
      post.likeCount = Math.max(0, (post.likeCount || 0) + (post.isLiked ? 1 : -1));
      this.setData({ post });
    });
  },

  onFavoritePost() {
    if (!auth.requireLogin("收藏需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isFavorited = !post.isFavorited;
    this.setData({ post });
    api.favoritePost(post.id).catch(() => {
      post.isFavorited = !post.isFavorited;
      this.setData({ post });
    });
  },

  onFollowPost() {
    if (!auth.requireLogin("蹲帖需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isFollowed = !post.isFollowed;
    const followedPostIds = wx.getStorageSync("followed_post_ids") || [];
    const index = followedPostIds.indexOf(post.id);
    if (post.isFollowed && index === -1) followedPostIds.push(post.id);
    if (!post.isFollowed && index > -1) followedPostIds.splice(index, 1);
    wx.setStorageSync("followed_post_ids", followedPostIds);
    this.setData({ post });
    wx.showToast({ title: post.isFollowed ? "已蹲帖" : "已取消蹲帖", icon: "none" });
  },

  onSharePost() {
    this.setData({ showSharePopup: true });
  },

  onCloseSharePopup() {
    this.setData({ showSharePopup: false });
  },

  onShareToFriend(e) {
    const postId = e.detail && e.detail.postId || this.data.post.id;
    wx.navigateTo({ url: "/pages/poster/index?postId=" + postId });
  },

  onSharePoster(e) {
    const postId = e.detail && e.detail.postId || this.data.post.id;
    wx.navigateTo({ url: "/pages/poster/index?postId=" + postId });
  },

  onFocusComment() {
    this.setData({ commentFocus: true, showEmojiPanel: false });
  },

  toggleContactInfo() {
    this.setData({ contactExpanded: !this.data.contactExpanded });
  },

  onCopyContact() {
    const contact = (this.data.post || {}).contact;
    if (!contact || !contact.value) return;
    wx.setClipboardData({ data: contact.value });
  },

  loadTopLikedComment(postId) {
    api
      .getTopLikedComment(postId)
      .then((comment) => {
        if (comment) {
          this.setData({
            topLikedComment: {
              id: comment.id,
              userId: comment.user_id,
              nickName: comment.nick_name || "用户",
              avatarUrl: comment.avatar_url || "",
              content: comment.content,
              likeCount: comment.like_count || 0,
            },
          });
        } else {
          this.setData({ topLikedComment: null });
        }
      })
      .catch(() => {
        this.setData({ topLikedComment: null });
      });
  },

  onLikeComment(e) {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const commentId = e.currentTarget.dataset.id;
    const comments = this.data.comments.map((c) => {
      if (c.id === commentId) {
        const liked = !c.isLiked;
        return Object.assign({}, c, {
          isLiked: liked,
          likeCount: Math.max(0, (c.likeCount || 0) + (liked ? 1 : -1)),
        });
      }
      return c;
    });
    this.setData({ comments });
    api.likeComment(commentId).catch(() => {
      // 回滚
      const rollback = this.data.comments.map((c) => {
        if (c.id === commentId) {
          const liked = !c.isLiked;
          return Object.assign({}, c, {
            isLiked: liked,
            likeCount: Math.max(0, (c.likeCount || 0) + (liked ? 1 : -1)),
          });
        }
        return c;
      });
      this.setData({ comments: rollback });
    });
    // 刷新热门评论
    this.loadTopLikedComment(this.data.post.id);
  },

  onBack() {
    wx.navigateBack();
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  onInputFocus(e) {
    this.setData({
      commentFocus: true,
      showEmojiPanel: false,
      keyboardHeight: (e.detail && e.detail.height) || 0,
    });
  },

  onInputBlur() {
    this.setData({ commentFocus: false, keyboardHeight: 0 });
  },

  onSendComment() {
    if (!auth.requireLogin("评论需要先登录")) return;
    const text = this.data.commentText.trim();
    if (!text && !this.data.commentImages.length) return;
    const postId = this.data.post.id;
    const parentId = this.data.replyTo || 0;
    const images = this.data.commentImages.slice();
    const content = text || "[图片]";

    if (request.USE_MOCK) {
      const key = "mock_comments_" + postId;
      const stored = wx.getStorageSync(key) || [];
      const newComment = {
        id: Date.now(),
        user_id: this.data.currentUserId,
        nick_name: (getApp().globalData.userInfo || {}).nickName || "我",
        avatar_url: (getApp().globalData.userInfo || {}).avatarUrl || "",
        content,
        images,
        parent_id: parentId,
        created_at: new Date().toISOString(),
      };
      stored.push(newComment);
      wx.setStorageSync(key, stored);
      const post = Object.assign({}, this.data.post, {
        commentCount: (this.data.post.commentCount || 0) + 1,
      });
      this.setData({
        comments: this.sortComments(this.data.comments.concat([
          {
            id: newComment.id,
            userId: newComment.user_id,
            nickName: newComment.nick_name,
            avatarUrl: newComment.avatar_url,
            content: newComment.content,
            images: newComment.images,
            parentNickName: this.data.replyToNick,
            timeText: format.formatDateTime(newComment.created_at),
            createdAt: newComment.created_at,
          },
        ]), this.data.commentSort),
        commentText: "",
        commentImages: [],
        showEmojiPanel: false,
        replyTo: null,
        replyToNick: "",
        post,
      });
      wx.showToast({ title: "评论成功", icon: "success" });
      return;
    }

    request
      .post("/comment", { postId, content, parentId, images }, true)
      .then(() => {
        const post = Object.assign({}, this.data.post, {
          commentCount: (this.data.post.commentCount || 0) + 1,
        });
        this.setData({
          commentText: "",
          commentImages: [],
          showEmojiPanel: false,
          replyTo: null,
          replyToNick: "",
          post,
        });
        this.loadComments(postId);
        wx.showToast({ title: "评论成功", icon: "success" });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || "评论失败", icon: "none" });
      });
  },

  onReplyComment(e) {
    const id = e.currentTarget.dataset.id;
    const nick = e.currentTarget.dataset.nick;
    this.setData({
      replyTo: id,
      replyToNick: nick,
      commentFocus: true,
    });
  },

  toggleEmojiPanel() {
    if (!auth.requireLogin("评论需要先登录")) return;
    this.setData({
      showEmojiPanel: !this.data.showEmojiPanel,
      commentFocus: false,
      keyboardHeight: 0,
    });
  },

  onEmojiTap(e) {
    const emoji = e.currentTarget.dataset.emoji || "";
    this.setData({
      commentText: this.data.commentText + emoji,
    });
  },

  onChooseCommentImage() {
    if (!auth.requireLogin("评论需要先登录")) return;
    wx.chooseMedia({
      count: Math.max(1, 3 - this.data.commentImages.length),
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const paths = (res.tempFiles || [])
          .map((item) => item.tempFilePath)
          .filter(Boolean);
        this.setData({
          commentImages: this.data.commentImages.concat(paths).slice(0, 3),
          showEmojiPanel: false,
        });
      },
    });
  },

  onRemoveCommentImage(e) {
    const index = e.currentTarget.dataset.index;
    const commentImages = this.data.commentImages.slice();
    commentImages.splice(index, 1);
    this.setData({ commentImages });
  },

  onEditComment(e) {
    const id = e.currentTarget.dataset.id;
    const content = e.currentTarget.dataset.content;
    this.setData({
      showEditModal: true,
      editCommentId: id,
      editContent: content,
    });
  },

  onEditContentInput(e) {
    this.setData({ editContent: e.detail.value });
  },

  onCloseEditModal() {
    this.setData({
      showEditModal: false,
      editCommentId: 0,
      editContent: "",
    });
  },

  onConfirmEdit() {
    const content = this.data.editContent.trim();
    if (!content) {
      wx.showToast({ title: "内容不能为空", icon: "none" });
      return;
    }
    const commentId = this.data.editCommentId;

    if (request.USE_MOCK) {
      const comments = this.data.comments.map((c) => {
        if (c.id === commentId) {
          return Object.assign({}, c, { content });
        }
        return c;
      });
      this.setData({ comments });
      this.onCloseEditModal();
      wx.showToast({ title: "编辑成功", icon: "success" });
      return;
    }

    request
      .put("/comment/" + commentId, { content }, true)
      .then(() => {
        const comments = this.data.comments.map((c) => {
          if (c.id === commentId) {
            return Object.assign({}, c, { content });
          }
          return c;
        });
        this.setData({ comments });
        this.onCloseEditModal();
        wx.showToast({ title: "编辑成功", icon: "success" });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || "编辑失败", icon: "none" });
      });
  },

  onDeleteComment(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "确认删除",
      content: "确定要删除这条评论吗？",
      success: (res) => {
        if (res.confirm) {
          if (request.USE_MOCK) {
            const comments = this.data.comments.filter((c) => c.id !== id);
            const post = Object.assign({}, this.data.post, {
              commentCount: Math.max(0, (this.data.post.commentCount || 0) - 1),
            });
            this.setData({ comments, post });
            wx.showToast({ title: "删除成功", icon: "success" });
            return;
          }
          request
            .delete("/comment/" + id, {}, true)
            .then(() => {
              const comments = this.data.comments.filter((c) => c.id !== id);
              const post = Object.assign({}, this.data.post, {
                commentCount: Math.max(
                  0,
                  (this.data.post.commentCount || 0) - 1,
                ),
              });
              this.setData({ comments, post });
              wx.showToast({ title: "删除成功", icon: "success" });
            })
            .catch((err) => {
              wx.showToast({ title: err.message || "删除失败", icon: "none" });
            });
        }
      },
    });
  },

  onLike() {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    const liked = !post.isLiked;
    post.isLiked = liked;
    post.likeCount = (post.likeCount || 0) + (liked ? 1 : -1);
    this.setData({ post });
    if (!request.USE_MOCK) {
      request.post("/post/" + post.id + "/like", {}, true).catch(() => {});
    }
  },

  onShare() {
    wx.navigateTo({ url: "/pages/share/index?postId=" + this.data.post.id });
  },

  onAvatarTap(e) {
    const userId = e.currentTarget.dataset.userid;
    if (!userId) return;
    wx.navigateTo({ url: "/pages/profile/index?id=" + userId });
  },

  onShareAppMessage() {
    const post = this.data.post;
    return {
      title: post ? (post.title || post.content || '校园帖子分享') : '校园帖子分享',
      path: '/pages/post-detail/index?id=' + (post ? post.id : ''),
    };
  },
});
