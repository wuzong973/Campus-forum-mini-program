const api = require("../../utils/api");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const format = require("../../utils/format");
const hotRank = require("../../utils/hot-rank");
const wechat = require("../../utils/wechat");
const anonymousIdentity = require('../../utils/anonymousIdentity');
const { runPullDownRefresh } = require("../../utils/refresh");

const POST_VIEW_SYNC_KEY = 'post_view_sync';

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    post: null,
    detailImages: [],
    comments: [],
    rawComments: [],
    commentTotal: 0,
    expandedReplyIds: {},
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
    canManageNote: false,
    showNoteEditor: false,
    noteDraft: '',
    noteLength: 0,
    noteInputFocus: false,
    noteKeyboardHeight: 0,
    savingNote: false,
    contactExpanded: false,
    commentFocus: false,
    anonPopup: null,
    authorPopup: null,
    showEmojiPanel: false,
    commentAnonymous: false,
    commentImages: [],
    keyboardHeight: 0,
    pageHeight: 0,
    bottomBarHeight: 120,
    showSharePopup: false,
    hotPosts: [],
    hotRankGroups: [],
    hotLoading: false,
    pollSelections: [],
    pollChecked: [],
    submittingVote: false,
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
      commentAnonymous: !!((wx.getStorageSync('system_settings') || {}).commentAnonymous),
    });
    api.setCurrentPostId(id);
    this.loadPost(id);
    this.loadComments(id, this.data.commentSort);
    if (options.comment === "1") {
      setTimeout(() => this.setData({ commentFocus: true }), 450);
    }
  },

  onShow() {
    // 分享页返回后重新取一次详情，及时同步服务端转发数等计数。
    if (this._hasShownOnce && this.data.post && this.data.post.id) {
      this.loadPost(this.data.post.id)
    }
    this.loadHotPosts()
    this._hasShownOnce = true
  },

  loadHotPosts() {
    this.setData({ hotLoading: true })
    // 与首页完全一致：同一接口（getHotPostRank）+ 同一份构建逻辑（utils/hot-rank.js），
    // 保证两处每日热榜的数据、排序与展示文案统一
    api.getHotPostRank().then((res) => {
      const hotPosts = hotRank.buildHotPosts(res.list || [])
      this.setData({
        hotPosts,
        hotRankGroups: hotRank.groupHotPosts(hotPosts),
        hotLoading: false
      })
    }).catch(() => this.setData({ hotLoading: false }))
  },

  onTodayHotTap() {
    wx.navigateTo({ url: '/pages/hot-rank/index' })
  },

  canManagePostContent() {
    const app = getApp();
    const userInfo = (app.globalData || {}).userInfo || wx.getStorageSync('userInfo') || {};
    return ['super_admin', 'content_admin'].indexOf(userInfo.role) > -1;
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
        } else if (selected === '添加备注') {
          this.openNoteEditor();
        } else if (selected === '隐藏') {
          await this.hidePost();
        } else if (selected === '拉黑') {
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
      wx.showToast({ title: '帖子已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' });
    }
  },

  async markNotInterested() {
    const post = this.data.post || {};
    if (!await this.confirmAction('拉黑确认', '将永久隐藏此帖子及同分类内容，确认继续吗？')) return;
    try {
      if (!request.USE_MOCK) await api.markPostNotInterested(post.id);
      wx.showToast({ title: '已拉黑', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (err) {
      wx.showToast({ title: err.message || '设置失败', icon: 'none' });
    }
  },

  // 隐藏：仅隐藏这条帖子（不影响同分类其他帖子），可在「我的→我删除的→隐藏」中恢复
  async hidePost() {
    const post = this.data.post || {};
    if (!await this.confirmAction('隐藏帖子', '隐藏后这条帖子将不再对你展示，可在「我的→我删除的→隐藏」中恢复，确认隐藏吗？')) return;
    try {
      if (!request.USE_MOCK) await api.markPostNotInterested(post.id, true);
      wx.showToast({ title: '已隐藏', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (err) {
      wx.showToast({ title: err.message || '隐藏失败', icon: 'none' });
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

  async saveNote() {
    const reviewNote = (this.data.noteDraft || '').trim();
    if (!reviewNote) {
      wx.showToast({ title: '请填写备注', icon: 'none' });
      return;
    }
    if (this.data.savingNote || !this.data.post) return;
    if (!await this.confirmAction('保存备注', '备注会以醒目标注展示给所有用户，确认保存吗？')) return;
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
    return api.getPostDetail(id).then((post) => {
      if (post) {
        const followedPostIds = wx.getStorageSync("followed_post_ids") || [];
        post = this.normalizePostCounts(post);
        post.isFollowed = followedPostIds.some((item) => Number(item) === Number(post.id));
        post.followCount = post.followCount > 0 ? post.followCount : (post.isFollowed ? 1 : 0);
        const pollSelections = (post.components || []).map((item) => (item.type === 'poll' && Array.isArray(item.selectedOptionIndexes)) ? item.selectedOptionIndexes.slice() : []);
        this.setData({
          post,
          detailImages: this.toDetailImages(post.images),
          contactExpanded: false,
          pollSelections,
          pollChecked: this.buildPollChecked(post.components || [], pollSelections),
          timeText: format.formatRelativeTime(post.createdAt) || "刚刚",
          viewText: this.formatViewCount(post.viewCount || 0) + " 浏览",
        });
        // 记录最新浏览量，返回首页时由首页就地更新卡片，避免展示旧值
        wx.setStorageSync(POST_VIEW_SYNC_KEY, { id: post.id, viewCount: post.viewCount || 0 });
        this.refreshCommentThreads();
      } else {
        wx.showToast({ title: "帖子不存在", icon: "none" });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    });
  },

  normalizePostCounts(post) {
    const normalized = Object.assign({}, post);
    ['favoriteCount', 'followCount', 'shareCount', 'likeCount', 'commentCount'].forEach((key) => {
      normalized[key] = Math.max(0, Number(normalized[key]) || 0);
    });
    return normalized;
  },

  formatViewCount(count) {
    const value = Number(count) || 0
    return value >= 10000 ? (value / 10000).toFixed(1) + '万' : String(value)
  },

  toDetailImages(images) {
    return (Array.isArray(images) ? images : [])
      .filter((url) => typeof url === 'string' && url)
      .map((url) => ({ url, failed: false }))
  },

  // WXML 模板不支持方法调用（如 indexOf），选中态需在此预计算为布尔矩阵
  buildPollChecked(components, selections) {
    return (components || []).map((item, idx) => {
      if (item.type !== 'poll' || !Array.isArray(item.options)) return []
      const selected = selections[idx] || []
      return item.options.map((_, i) => selected.indexOf(i) > -1)
    })
  },

  onPollChoice(e) {
    const pollIndex = Number(e.currentTarget.dataset.pollIndex || 0)
    const poll = ((this.data.post || {}).components || [])[pollIndex] || {}
    // checkbox-group 返回数组，radio-group 返回单个字符串，统一归一化为数组
    const rawValue = e.detail.value
    const valueList = Array.isArray(rawValue) ? rawValue : (rawValue === undefined || rawValue === null || rawValue === '' ? [] : [rawValue])
    let selected = valueList.map(Number)
    if (poll.mode === 'single' && selected.length > 1) selected = selected.slice(-1)
    const pollSelections = this.data.pollSelections.slice()
    pollSelections[pollIndex] = selected
    this.setData({ pollSelections, pollChecked: this.buildPollChecked(this.data.post.components || [], pollSelections) })
  },

  onSubmitVote(e) {
    if (!auth.requireLogin('投票需要先登录') || this.data.submittingVote) return
    const pollIndex = Number((e && e.currentTarget && e.currentTarget.dataset.pollIndex) || 0)
    const indexes = this.data.pollSelections[pollIndex] || []
    if (!indexes.length) { wx.showToast({ title: '请选择投票选项', icon: 'none' }); return }
    const post = Object.assign({}, this.data.post)
    const applyComponents = (components) => {
      const pollSelections = (components || []).map((item) => (item.type === 'poll' && Array.isArray(item.selectedOptionIndexes)) ? item.selectedOptionIndexes.slice() : [])
      this.setData({
        post: Object.assign(post, { components }),
        pollSelections,
        pollChecked: this.buildPollChecked(components || [], pollSelections),
        // 投票成功后必须关闭按钮 loading，否则会无限转圈
        submittingVote: false
      })
    }
    this.setData({ submittingVote: true })
    if (request.USE_MOCK) {
      const components = (post.components || []).map((component) => Object.assign({}, component, { options: (component.options || []).map((option) => Object.assign({}, option)), voterIds: (component.voterIds || []).slice() }))
      const poll = components[pollIndex]
      if (!poll || poll.type !== 'poll') { this.setData({ submittingVote: false }); wx.showToast({ title: '投票不存在', icon: 'none' }); return }
      if (poll.selectedOptionIndexes && poll.selectedOptionIndexes.length) { this.setData({ submittingVote: false }); wx.showToast({ title: '你已经投过票了', icon: 'none' }); return }
      indexes.forEach((index) => { poll.options[index].votes = (poll.options[index].votes || 0) + 1 })
      poll.selectedOptionIndexes = indexes
      applyComponents(components); wx.showToast({ title: '投票成功', icon: 'success' }); return
    }
    api.votePost(post.id, indexes, pollIndex).then((result) => { applyComponents(result.components || []); wx.showToast({ title: '投票成功', icon: 'success' }) }).catch((err) => { this.setData({ submittingVote: false }); wx.showToast({ title: err.message || '投票失败', icon: 'none' }) })
  },

  onPreviewPostImage(e) {
    const current = e.currentTarget.dataset.url
    const urls = ((this.data.post || {}).images || []).filter((url) => typeof url === 'string' && url)
    if (current && urls.length) wx.previewImage({ current, urls })
  },

  onPostImageError(e) {
    const url = e.currentTarget.dataset.url
    const detailImages = this.data.detailImages.map((item) =>
      item.url === url ? Object.assign({}, item, { failed: true }) : item,
    )
    console.warn('[post-detail] image load failed', url, e.detail || {})
    this.setData({ detailImages })
  },

  onRetryPostImage(e) {
    const url = e.currentTarget.dataset.url
    const detailImages = this.data.detailImages.map((item) =>
      item.url === url ? Object.assign({}, item, { failed: false }) : item,
    )
    this.setData({ detailImages })
  },

  loadComments(postId, sort = this.data.commentSort) {
    return api.getCommentList(postId, sort).then((res) => {
      const list = (res.list || []).map((comment) => this.normalizeComment(comment));
      const hiddenCommentIds = (wx.getStorageSync('hidden_comment_ids') || []).map(Number);
      const blockedUserIds = (wx.getStorageSync('blocked_user_ids') || []).map(Number);
      const rawComments = this.filterVisibleComments(list, hiddenCommentIds, blockedUserIds);
      this.setData({
        rawComments,
        commentTotal: Math.max(0, (Number(res.total) || list.length) - (list.length - rawComments.length)),
        comments: this.buildCommentThreads(rawComments, sort),
      });
    });
  },

  normalizeComment(comment) {
    const createdAt = comment.created_at || comment.createdAt;
    let anonymous = comment.anonymousIdentity || comment.anonymous_identity;
    if (typeof anonymous === 'string') { try { anonymous = JSON.parse(anonymous) } catch (e) { anonymous = null } }
    const isAnonymous = !!(comment.is_anonymous || comment.isAnonymous || (anonymous && anonymous.nickName && anonymous.avatarUrl));
    const images = api.parseImages(comment.images);
    const rawAllowPm = comment.allow_anonymous_pm !== undefined ? comment.allow_anonymous_pm : comment.allowAnonymousPm;
    return {
      id: comment.id,
      userId: comment.user_id || comment.userId,
      nickName: isAnonymous ? anonymous.nickName : (comment.nick_name || comment.nickName || "用户"),
      avatarUrl: isAnonymous ? anonymous.avatarUrl : (comment.avatar_url || comment.avatarUrl || ""),
      isAnonymous,
      // 有图/视频时去掉「[图片]/[视频]」占位文字，直接展示媒体本身
      content: images.length ? format.stripMediaPlaceholder(comment.content) : String(comment.content || ""),
      images,
      // 匿名评论者（真实用户）是否允许被匿名私信：undefined 表示未知（不拦截），false 表示禁止
      allowAnonymousPm: rawAllowPm === undefined || rawAllowPm === null ? undefined : !!rawAllowPm,
      parentId: Number(comment.parent_id || comment.parentId || 0),
      parentNickName: comment.parent_nick_name || comment.parentNickName || "",
      timeText: format.formatRelativeTime(createdAt) || "刚刚",
      createdAt,
      likeCount: Number(comment.like_count || comment.likeCount || 0),
      isLiked: !!(comment.is_liked || comment.isLiked),
    };
  },

  buildCommentThreads(rawComments, sort = this.data.commentSort, expandedReplyIds = this.data.expandedReplyIds) {
    const commentsById = {};
    const authorId = Number((this.data.post || {}).userId || 0);
    const isAnonymousPost = !!((this.data.post || {}).isAnonymous);
    expandedReplyIds = expandedReplyIds || {};
    const threadsById = {};
    const roots = [];

    rawComments.forEach((comment) => {
      commentsById[comment.id] = Object.assign({}, comment, {
        isAuthor: !isAnonymousPost && !comment.isAnonymous && authorId > 0 && Number(comment.userId) === authorId,
      });
    });

    // 回复前缀规则：仅“回复回复”（嵌套回复）显示“回复 xxx:”，直接回复根评论不显示
    Object.keys(commentsById).forEach((id) => {
      const comment = commentsById[id];
      const parent = comment.parentId ? commentsById[comment.parentId] : null;
      comment.replyToNick = parent && parent.parentId ? parent.nickName : '';
    });

    const findRoot = (comment) => {
      let current = comment;
      const visited = {};
      while (current.parentId && commentsById[current.parentId] && !visited[current.id]) {
        visited[current.id] = true;
        current = commentsById[current.parentId];
      }
      return current;
    };

    Object.keys(commentsById).forEach((id) => {
      const comment = commentsById[id];
      const root = findRoot(comment);
      if (root.id === comment.id) {
        threadsById[comment.id] = Object.assign({}, comment, { replies: [] });
        roots.push(threadsById[comment.id]);
      }
    });

    Object.keys(commentsById).forEach((id) => {
      const comment = commentsById[id];
      const root = findRoot(comment);
      if (root.id !== comment.id && threadsById[root.id]) {
        threadsById[root.id].replies.push(comment);
      }
    });

    return this.sortComments(roots, sort).map((thread) => {
      const replies = thread.replies.slice().sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB || Number(a.id || 0) - Number(b.id || 0);
      });
      const expanded = !!expandedReplyIds[thread.id];
      return Object.assign({}, thread, {
        replies,
        recentReplies: replies.slice(-3),
        expanded,
        hasHiddenReplies: replies.length > 3,
        hiddenReplyCount: Math.max(0, replies.length - 3),
      });
    });
  },

  refreshCommentThreads(rawComments = this.data.rawComments) {
    this.setData({ comments: this.buildCommentThreads(rawComments) });
  },

  updateComment(commentId, updater) {
    const rawComments = this.data.rawComments.map((comment) => (
      Number(comment.id) === Number(commentId) ? updater(comment) : comment
    ));
    this.setData({
      rawComments,
      comments: this.buildCommentThreads(rawComments),
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
    if (!userId) return;
    if (e.currentTarget.dataset.anonymous) {
      const ds = e.currentTarget.dataset;
      this.showAnonPopup({
        userId,
        nick: ds.nick,
        avatar: ds.avatar,
        isOwner: ds.isowner,
        allowAnonymousPm: ds.allowpm,
      });
      return;
    }
    wx.navigateTo({ url: "/pages/profile/index?id=" + userId });
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
          url: "/pages/chat/index?peerId=" + popup.userId +
            "&nick=" + encodeURIComponent(popup.nick || "匿名用户") +
            "&avatar=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
            "&anonymous=1"
        });
      }
    });
  },

  onLikePost() {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isLiked = !post.isLiked;
    post.likeCount = Math.max(0, (Number(post.likeCount) || 0) + (post.isLiked ? 1 : -1));
    this.setData({ post });
    if (request.USE_MOCK) return;
    request.post("/post/" + post.id + "/like", {}, true, { silent: true }).catch(() => {
      post.isLiked = !post.isLiked;
      post.likeCount = Math.max(0, (Number(post.likeCount) || 0) + (post.isLiked ? 1 : -1));
      this.setData({ post });
    });
  },

  onFavoritePost() {
    if (!auth.requireLogin("收藏需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isFavorited = !post.isFavorited;
    post.favoriteCount = Math.max(0, (Number(post.favoriteCount) || 0) + (post.isFavorited ? 1 : -1));
    this.setData({ post });
    api.favoritePost(post.id).catch(() => {
      post.isFavorited = !post.isFavorited;
      post.favoriteCount = Math.max(0, (Number(post.favoriteCount) || 0) + (post.isFavorited ? 1 : -1));
      this.setData({ post });
    });
  },

  onFollowPost() {
    if (!auth.requireLogin("蹲帖需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isFollowed = !post.isFollowed;
    post.followCount = Math.max(0, (Number(post.followCount) || 0) + (post.isFollowed ? 1 : -1));
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

  onLikeComment(e) {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const commentId = e.currentTarget.dataset.id;
    this.updateComment(commentId, (comment) => {
      const liked = !comment.isLiked;
      return Object.assign({}, comment, {
        isLiked: liked,
        likeCount: Math.max(0, (comment.likeCount || 0) + (liked ? 1 : -1)),
      });
    });
    api.likeComment(commentId).catch(() => {
      // 回滚
      this.updateComment(commentId, (comment) => {
        const liked = !comment.isLiked;
        return Object.assign({}, comment, {
          isLiked: liked,
          likeCount: Math.max(0, (comment.likeCount || 0) + (liked ? 1 : -1)),
        });
      });
    });
  },

  // ===== 评论右上角「···」菜单：隐藏 / 举报 / 拉黑 =====

  onCommentMore(e) {
    const ds = e.currentTarget.dataset;
    const commentId = ds.id;
    const userId = Number(ds.userid) || 0;
    const nick = ds.nick || "该用户";
    // 自己的评论不提供举报/拉黑（已有编辑/删除入口）
    const itemList = Number(userId) === Number(this.data.currentUserId)
      ? ["隐藏"]
      : ["隐藏", "举报", "拉黑"];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const selected = itemList[res.tapIndex];
        if (selected === "隐藏") {
          this.hideComment(commentId);
        } else if (selected === "举报") {
          this.reportComment(commentId);
        } else if (selected === "拉黑") {
          this.blockCommentAuthor(userId, nick);
        }
      },
    });
  },

  // 计算要移除的评论 id 集合：seedIds 本身加上它们的所有下级回复，
  // 避免只删父评论后子回复在 buildCommentThreads 中被提升为根评论
  collectRemovableComments(list, seedIds) {
    const removed = {};
    (seedIds || []).forEach((id) => { removed[Number(id)] = true; });
    let changed = true;
    while (changed) {
      changed = false;
      (list || []).forEach((comment) => {
        const id = Number(comment.id);
        const parentId = Number(comment.parentId || 0);
        if (parentId && removed[parentId] && !removed[id]) {
          removed[id] = true;
          changed = true;
        }
      });
    }
    return removed;
  },

  // 过滤本地隐藏及已拉黑用户的评论（下级回复一并隐藏）
  filterVisibleComments(list, hiddenCommentIds, blockedUserIds) {
    const hidden = hiddenCommentIds || [];
    const blocked = blockedUserIds || [];
    if (!hidden.length && !blocked.length) return list;
    const seedIds = [];
    (list || []).forEach((comment) => {
      if (hidden.indexOf(Number(comment.id)) > -1 || blocked.indexOf(Number(comment.userId)) > -1) {
        seedIds.push(comment.id);
      }
    });
    if (!seedIds.length) return list;
    const removed = this.collectRemovableComments(list, seedIds);
    return (list || []).filter((comment) => !removed[Number(comment.id)]);
  },

  // 从当前列表移除指定评论并同步计数；persistHiddenId 传入时写入本地隐藏记录，刷新后仍生效
  applyCommentRemoval(removed, persistHiddenId) {
    const rawComments = this.data.rawComments.filter((comment) => !removed[Number(comment.id)]);
    const removedCount = this.data.rawComments.length - rawComments.length;
    if (persistHiddenId !== undefined && persistHiddenId !== null) {
      const hiddenIds = (wx.getStorageSync("hidden_comment_ids") || []).map(Number);
      if (hiddenIds.indexOf(Number(persistHiddenId)) === -1) {
        hiddenIds.push(Number(persistHiddenId));
        if (hiddenIds.length > 500) hiddenIds.splice(0, hiddenIds.length - 500);
        wx.setStorageSync("hidden_comment_ids", hiddenIds);
      }
    }
    const commentTotal = Math.max(0, (Number(this.data.commentTotal) || 0) - removedCount);
    const post = Object.assign({}, this.data.post, {
      commentCount: Math.max(0, (Number(this.data.post.commentCount) || 0) - removedCount),
    });
    this.setData({ rawComments, comments: this.buildCommentThreads(rawComments), commentTotal, post });
  },

  async hideComment(commentId) {
    if (!await this.confirmAction("隐藏评论", "隐藏后这条评论将不再展示，确认隐藏吗？")) return;
    this.applyCommentRemoval(this.collectRemovableComments(this.data.rawComments, [commentId]), commentId);
    wx.showToast({ title: "已隐藏该评论", icon: "success" });
  },

  async reportComment(commentId) {
    if (!auth.requireLogin("举报需要先登录")) return;
    if (!await this.confirmAction("举报评论", "确认提交举报吗？管理员将收到评论编号、举报人和提交时间。")) return;
    try {
      if (!request.USE_MOCK) await api.reportComment(commentId);
      wx.showToast({ title: "举报已提交", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "举报失败", icon: "none" });
    }
  },

  async blockCommentAuthor(userId, nick) {
    if (!auth.requireLogin("拉黑需要先登录")) return;
    if (!userId) return;
    if (!await this.confirmAction("拉黑用户", "将拉黑「" + nick + "」并隐藏其全部评论与私信，确认继续吗？")) return;
    try {
      if (!request.USE_MOCK) await request.post("/message/block", { peerId: Number(userId) }, true);
      const blockedIds = (wx.getStorageSync("blocked_user_ids") || []).map(Number);
      if (blockedIds.indexOf(Number(userId)) === -1) {
        blockedIds.push(Number(userId));
        wx.setStorageSync("blocked_user_ids", blockedIds);
      }
      const seedIds = this.data.rawComments
        .filter((comment) => Number(comment.userId) === Number(userId))
        .map((comment) => comment.id);
      this.applyCommentRemoval(this.collectRemovableComments(this.data.rawComments, seedIds));
      wx.showToast({ title: "已拉黑", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "设置失败", icon: "none" });
    }
  },

  onBack() {
    wx.navigateBack();
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  toggleCommentAnonymous() {
    const commentAnonymous = !this.data.commentAnonymous;
    this.setData({ commentAnonymous });
    wx.showToast({ title: commentAnonymous ? '本条评论将匿名发布' : '已切换为公开评论', icon: 'none' });
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

  async onSendComment() {
    if (!auth.requireLogin("评论需要先登录")) return;
    const text = this.data.commentText.trim();
    if (!text && !this.data.commentImages.length) return;
    const postId = this.data.post.id;
    const parentId = this.data.replyTo || 0;
    let images = this.data.commentImages.slice();
    const content = text || "[图片]";
    const anonymous = this.data.commentAnonymous ? anonymousIdentity.generate() : null;

    if (!request.USE_MOCK) wx.showLoading({ title: "发送中...", mask: true });
    try {
      if (!request.USE_MOCK && images.length) {
        const imageCount = images.length;
        images = await wechat.uploadImages(images);
        if (images.length !== imageCount || images.some((url) => !/^https?:\/\//i.test(url))) {
          throw new Error("图片上传失败");
        }
      }

      if (request.USE_MOCK) {
        const key = "mock_comments_" + postId;
        const stored = wx.getStorageSync(key) || [];
        const newComment = {
          id: Date.now(),
          user_id: this.data.currentUserId,
          nick_name: anonymous ? anonymous.nickName : ((getApp().globalData.userInfo || {}).nickName || "我"),
          avatar_url: anonymous ? anonymous.avatarUrl : ((getApp().globalData.userInfo || {}).avatarUrl || ""),
          anonymous_identity: anonymous,
          is_anonymous: !!anonymous,
          content,
          images,
          parent_id: parentId,
          created_at: new Date().toISOString(),
        };
        stored.push(newComment);
        wx.setStorageSync(key, stored);
        const post = Object.assign({}, this.data.post, {
          commentCount: (Number(this.data.post.commentCount) || 0) + 1,
        });
        const rawComments = this.data.rawComments.concat([this.normalizeComment(Object.assign({}, newComment, {
          parent_nick_name: this.data.replyToNick,
        }))]);
        this.setData({
          rawComments,
          comments: this.buildCommentThreads(rawComments),
          commentTotal: rawComments.length,
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

      await request.post("/comment", { postId, content, parentId, images, anonymousIdentity: anonymous }, true);
      const post = Object.assign({}, this.data.post, {
        commentCount: (Number(this.data.post.commentCount) || 0) + 1,
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
    } catch (err) {
      wx.showToast({ title: err.message || "评论失败", icon: "none" });
    } finally {
      if (!request.USE_MOCK) wx.hideLoading();
    }
  },

  onReplyComment(e) {
    if (!auth.requireLogin("回复需要先登录")) return;
    const id = e.currentTarget.dataset.id;
    const nick = e.currentTarget.dataset.nick;
    this.setData({
      replyTo: id,
      replyToNick: nick,
      commentFocus: true,
    });
  },

  toggleCommentReplies(e) {
    const id = e.currentTarget.dataset.id;
    const expandedReplyIds = Object.assign({}, this.data.expandedReplyIds, {
      [id]: !this.data.expandedReplyIds[id],
    });
    this.setData({
      expandedReplyIds,
      comments: this.buildCommentThreads(this.data.rawComments, this.data.commentSort, expandedReplyIds),
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
      this.updateComment(commentId, (comment) => Object.assign({}, comment, { content }));
      this.onCloseEditModal();
      wx.showToast({ title: "编辑成功", icon: "success" });
      return;
    }

    request
      .put("/comment/" + commentId, { content }, true)
      .then(() => {
        this.updateComment(commentId, (comment) => Object.assign({}, comment, { content }));
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
            const rawComments = this.data.rawComments.filter((comment) => Number(comment.id) !== Number(id));
            const post = Object.assign({}, this.data.post, {
              commentCount: Math.max(0, (Number(this.data.post.commentCount) || 0) - 1),
            });
            this.setData({ rawComments, comments: this.buildCommentThreads(rawComments), commentTotal: rawComments.length, post });
            wx.showToast({ title: "删除成功", icon: "success" });
            return;
          }
          request
            .delete("/comment/" + id, {}, true)
            .then(() => {
              const rawComments = this.data.rawComments.filter((comment) => Number(comment.id) !== Number(id));
              const post = Object.assign({}, this.data.post, {
                commentCount: Math.max(
                  0,
                  (Number(this.data.post.commentCount) || 0) - 1,
                ),
              });
              this.setData({ rawComments, comments: this.buildCommentThreads(rawComments), commentTotal: rawComments.length, post });
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
    post.likeCount = Math.max(0, (Number(post.likeCount) || 0) + (liked ? 1 : -1));
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
    const post = this.data.post || {};
    if (post.isAnonymous) {
      this.showAnonPopup({
        userId,
        nick: post.nickName,
        avatar: post.avatarUrl,
        isOwner: true,
        allowAnonymousPm: post.allowAnonymousPm,
      });
      return;
    }
    if (this.showAuthorPopup(post)) return;
    wx.navigateTo({ url: "/pages/profile/index?id=" + userId });
  },

  // 普通帖帖主头像：允许匿名私信时弹出「个人主页/分身私信」选择，
  // 关闭了该设置或查看自己的帖子时保持直接进入主页
  showAuthorPopup(post) {
    if (!post || !post.userId) return false;
    if (post.allowAnonymousPm === false) return false;
    const userInfo = ((getApp().globalData || {}).userInfo) || wx.getStorageSync('userInfo') || {};
    if (Number(userInfo.id) === Number(post.userId)) return false;
    this.setData({
      authorPopup: {
        userId: post.userId,
        nick: post.nickName || "校园同学",
        avatar: post.avatarUrl || "/assets/icons/avatar.png",
        certLabel: post.certLabel || "",
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
        // 发起方使用随机分身身份，服务端首次进入时存档，全程同一形象
        const persona = anonymousIdentity.generate();
        wx.navigateTo({
          url: "/pages/chat/index?peerId=" + popup.userId +
            "&nick=" + encodeURIComponent(popup.nick || "校园同学") +
            "&avatar=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
            "&anonymous=1" +
            "&anonSelfNick=" + encodeURIComponent(persona.nickName) +
            "&anonSelfAvatar=" + encodeURIComponent(persona.avatarUrl)
        });
      }
    });
  },

  onShareAppMessage() {
    const post = this.data.post;
    return {
      title: post ? (post.title || post.content || '校园帖子分享') : '校园帖子分享',
      path: '/pages/post-detail/index?id=' + (post ? post.id : ''),
    };
  },

  onPullDownRefresh() {
    const postId = (this.data.post || {}).id;
    if (!postId) {
      runPullDownRefresh(this);
      return;
    }
    runPullDownRefresh(this, [
      () => this.loadPost(postId),
      () => this.loadComments(postId),
      () => this.loadHotPosts(),
    ]);
  },
});
