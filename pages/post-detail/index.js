const api = require("../../utils/api");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const format = require("../../utils/format");
const hotRank = require("../../utils/hot-rank");
const wechat = require("../../utils/wechat");
const image = require("../../utils/image");
const avatar = require("../../utils/avatar");
const anonymousIdentity = require('../../utils/anonymousIdentity');
const qr = require("../../utils/qr");
const messageStore = require("../../utils/messageStore");
const { runPullDownRefresh } = require("../../utils/refresh");
const subscribe = require("../../utils/subscribe");

const POST_VIEW_SYNC_KEY = 'post_view_sync';
const POST_STATE_SYNC_KEY = 'post_state_sync';

// 评论媒体按扩展名区分图片/视频（服务端 images 字段统一存 URL 数组）
const COMMENT_VIDEO_RE = /\.(mp4|m4v|mov|3gp|mkv|flv|avi|wmv|webm)(\?|#|$)/i;
function isVideoUrl(url) {
  return COMMENT_VIDEO_RE.test(String(url || ""));
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    post: null,
    detailImages: [],
    comments: [],
    // 评论锚点：scroll-into-view 目标（comment-<id> / reply-<id>）
    commentAnchor: '',
    rawComments: [],
    // 操作按钮动效状态（纯视觉，不参与业务逻辑）：'' | 'anim-pop' | 'anim-unpop'
    likeAnim: "",
    favoriteAnim: "",
    followAnim: "",
    // 蹲贴请求进行中标记：避免连点造成同一帖子的请求交叉，出现最终状态与服务端不一致
    followSaving: false,
    likeHeartFly: false,
    commentTotal: 0,
    commentHasMore: false,
    commentsLoadingMore: false,
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
    submittingComment: false,
    avatarSheet: null,
    showEmojiPanel: false,
    commentAnonymous: false,
    // 待发送的评论媒体：[{ type: 'image' | 'video', path }]
    commentMedia: [],
    keyboardHeight: 0,
    pageHeight: 0,
    bottomBarHeight: 120,
    showSharePopup: false,
    hotPosts: [],
    hotRankGroups: [],
    hotLoading: false,
    // 「显示每日热榜」用户偏好：关闭时隐藏热榜预览卡
    dailyHotVisible: true,
    // 「每日热榜」上方横幅（与消息通知横幅相互独立，详情页内管理员可编辑）
    postBanner: { text: '', icon: '', images: [] },
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
    // 小程序码扫码进入时没有 id 参数，帖子 id 藏在 scene 里（服务端生成码时写入 id=<postId>）
    let id = options.id;
    if (!id && options.scene) {
      const scene = decodeURIComponent(options.scene);
      const matched = String(scene).match(/(?:^|&)id=(\d+)/);
      if (matched) id = matched[1];
    }
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
    // 「评论默认开启分身」设置开关已移除：评论默认公开，可在输入区手动切换匿名
    this.loadPost(id);
    this.loadComments(id, this.data.commentSort).catch(() => wx.showToast({ title: '评论加载失败，请重试', icon: 'none' }));
    // 管理员保存横幅后服务端 WS 广播，停留在本页时立即刷新
    this.unsubscribeBanner = messageStore.onMessage((payload) => {
      if (payload && payload.type === "banner_update") this.loadPostBanner();
    });
    if (options.comment === "1") {
      this._commentFocusTimer = setTimeout(() => {
        this._commentFocusTimer = null;
        this.setData({ commentFocus: true });
      }, 450);
    }
    // 评论锚点：消息详情/服务通知跳入时携带 commentId，评论加载后直接定位到该条评论/回复
    this._pendingCommentAnchor = Number(options.commentId) || 0;
  },

  // 收起评论输入框键盘：
  // input 的 focus 绑定在 commentFocus 上，若该值残留为 true，任何 setData 重渲染都会让输入框重新聚焦并拉起键盘。
  // 点击「匿名/公开」、评论图片/视频等非输入区域时必须先显式置 false，避免键盘被误拉起
  blurCommentInput() {
    if (this._commentFocusTimer) {
      clearTimeout(this._commentFocusTimer);
      this._commentFocusTimer = null;
    }
    if (this.data.commentFocus || this.data.keyboardHeight) {
      this.setData({ commentFocus: false, keyboardHeight: 0 });
    }
  },

  onUnload() {
    if (this.unsubscribeBanner) this.unsubscribeBanner();
    if (this._commentFocusTimer) clearTimeout(this._commentFocusTimer);
    // 动效定时器清理
    ["_likeAnimTimer", "_favoriteAnimTimer", "_followAnimTimer", "_likeHeartTimer"].forEach((key) => {
      if (this[key]) { clearTimeout(this[key]); this[key] = null; }
    });
  },

  onShow() {
    // 分享页返回后重新取一次详情，及时同步服务端转发数等计数。
    if (this._hasShownOnce && this.data.post && this.data.post.id) {
      this.loadPost(this.data.post.id)
    }
    // 每次可见时同步「显示每日热榜」用户偏好（设置页修改后返回立即生效）
    const dailyHotVisible = hotRank.isDailyHotVisible()
    if (dailyHotVisible !== this.data.dailyHotVisible) this.setData({ dailyHotVisible })
    this.loadHotPosts()
    this.loadPostBanner()
    this._hasShownOnce = true
  },

  // 「每日热榜」上方横幅：公开读取，点击进入详情页（scope=post 指向独立配置）
  loadPostBanner() {
    api.getPostBanner().then((banner) => {
      const data = banner || { text: '', icon: '', images: [] }
      data.bannerStyle = (data.bgColor ? 'background:' + data.bgColor + ';' : '') + (data.textColor ? '--banner-fg:' + data.textColor + ';' : '')
      this.setData({ postBanner: data })
    }).catch(() => {})
  },

  goPostBannerDetail() {
    if (!this.data.postBanner || !this.data.postBanner.text) return
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=post' })
  },

  loadHotPosts() {
    this.setData({ hotLoading: true })
    // 与首页完全一致：同一接口（getHotPostRank）+ 同一份构建逻辑（utils/hot-rank.js），
    // 保证两处每日热榜的数据、排序与展示文案统一
    // （buildHotPosts 内部已统一过滤「本地标记为已删除」的帖子）
    api.getHotPostRank().then((res) => {
      const hotPosts = hotRank.buildHotPosts(res.list || [])
      this.setData({
        hotPosts,
        hotRankGroups: hotRank.groupHotPosts(hotPosts),
        hotLoading: false
      })
    }).catch(() => {
      // 拉取失败时不能原样保留旧列表：其中可能含刚被删除的帖子
      const kept = hotRank.filterRemovedPosts(this.data.hotPosts)
      this.setData({
        hotPosts: kept,
        hotRankGroups: hotRank.groupHotPosts(kept),
        hotLoading: false
      })
    })
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
      await api.deletePost(post.id);
      // 广播删除结果：返回后各热榜/列表页据此就地剔除本条目
      hotRank.markPostRemoved(post.id);
      wx.showToast({ title: '帖子已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' });
    }
  },

  async markNotInterested() {
    const post = this.data.post || {};
    if (!await this.confirmAction('拉黑确认', '拉黑后将不再向你展示这条帖子，可在「我的→我删除的→隐藏」中恢复，确认拉黑吗？')) return;
    try {
      await api.markPostNotInterested(post.id, true);
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
      await api.markPostNotInterested(post.id, true);
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
      await api.reportPost(post.id);
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
        // 蹲贴态以服务端 forum_post_follow 为准（详情接口已下发 isFollowed/followCount）。
        // 本地缓存只在接口未下发该字段时兜底，并在此回写纠正，避免两处状态长期不一致。
        const hasServerFollow = post.isFollowed !== undefined && post.isFollowed !== null;
        post.isFollowed = hasServerFollow
          ? !!post.isFollowed
          : followedPostIds.some((item) => Number(item) === Number(post.id));
        post.followCount = Number(post.followCount) || 0;
        this.syncLocalFollowCache(post.id, post.isFollowed);
        // 投票选项预计算票数占比（进度条样式），WXML 模板无法调用方法
        post = this.withPollPercent(post);
        const pollSelections = (post.components || []).map((item) => (item.type === 'poll' && Array.isArray(item.selectedOptionIndexes)) ? item.selectedOptionIndexes.slice() : []);
        this.setData({
          post,
          detailImages: this.toDetailImages(post.images),
          // 帖子图片 URL 列表：长按识别菜单里"预览大图"使用
          postImageUrls: (post.images || []).map((item) => (typeof item === 'string' ? item : (item && item.url) || '')).filter(Boolean),
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
        this.handlePostMissing(id);
      }
    }).catch(() => {
      // 接口失败（含帖子已被删除返回 404）：必须在此兜底，
      // 否则返回的 rejected Promise 无人接管，会以「未捕获异常」打红到 Console，
      // 同时页面停留在空白骨架，用户看不到任何反馈
      this.handlePostMissing(id);
    });
  },

  // 帖子不存在或已被删除：给出提示并退出本页，避免停留在空白页面
  handlePostMissing(postId) {
    if (this._postMissingHandled) return;
    this._postMissingHandled = true;
    // 广播「该帖已不存在」：返回时各热榜/列表页据此就地剔除，
    // 避免已删除的帖子在「删除成功 → 下一次拉取热榜」的窗口期内继续留在榜单上
    if (postId) hotRank.markPostRemoved(postId);
    wx.showToast({ title: "帖子不存在或已被删除", icon: "none" });
    setTimeout(() => wx.navigateBack({
      fail: () => wx.switchTab({ url: "/pages/index/index" })
    }), 1500);
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
    // 帖子媒体兼容两种形态：旧帖子为纯 URL 字符串数组；视频帖为混合数组（视频项为 {type:'video', url}）
    return (Array.isArray(images) ? images : [])
      .map((item) => {
        if (typeof item === 'string' && item) return { type: 'image', url: item, failed: false }
        if (item && typeof item === 'object' && item.url && item.type === 'video') return { type: 'video', url: item.url, failed: false }
        return null
      })
      .filter(Boolean)
  },

  // 长按图片：统一二维码识别菜单（识别 / 预览），帖子图与评论区图共用
  onImageQrScan(e) {
    const { url, urls } = e.currentTarget.dataset
    qr.recognize(url, urls)
  },

  // WXML 模板不支持方法调用（如 indexOf），选中态需在此预计算为布尔矩阵
  buildPollChecked(components, selections) {
    return (components || []).map((item, idx) => {
      if (item.type !== 'poll' || !Array.isArray(item.options)) return []
      const selected = selections[idx] || []
      return item.options.map((_, i) => selected.indexOf(i) > -1)
    })
  },

  // 为投票组件的每个选项预计算票数占比（0-100，按总票数归一化），进度条渲染用
  withPollPercent(post) {
    if (!post || !Array.isArray(post.components)) return post
    const components = post.components.map((item) => {
      if (item.type !== 'poll' || !Array.isArray(item.options)) return item
      const total = item.options.reduce((sum, option) => sum + (Number(option.votes) || 0), 0)
      const options = item.options.map((option) => Object.assign({}, option, {
        _pct: total ? Math.round((Number(option.votes) || 0) / total * 100) : 0,
      }))
      return Object.assign({}, item, { options })
    })
    return Object.assign({}, post, { components })
  },

  // 点按选项条选择/取消（单选替换、多选切换），与旧 checkbox/radio 交互等价
  onPollOptionTap(e) {
    const pollIndex = Number(e.currentTarget.dataset.pollIndex || 0)
    const optionIndex = Number(e.currentTarget.dataset.optionIndex || 0)
    const poll = ((this.data.post || {}).components || [])[pollIndex] || {}
    if (poll.selectedOptionIndexes && poll.selectedOptionIndexes.length) return
    const pollSelections = this.data.pollSelections.slice()
    const current = pollSelections[pollIndex] || []
    let selected
    if (poll.mode === 'multiple') {
      selected = current.indexOf(optionIndex) > -1
        ? current.filter((i) => i !== optionIndex)
        : current.concat(optionIndex).sort((a, b) => a - b)
    } else {
      selected = current.indexOf(optionIndex) > -1 ? [] : [optionIndex]
    }
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
      const withPercent = this.withPollPercent({ components }).components
      const pollSelections = (withPercent || []).map((item) => (item.type === 'poll' && Array.isArray(item.selectedOptionIndexes)) ? item.selectedOptionIndexes.slice() : [])
      this.setData({
        post: Object.assign(post, { components: withPercent }),
        pollSelections,
        pollChecked: this.buildPollChecked(withPercent || [], pollSelections),
        // 投票成功后必须关闭按钮 loading，否则会无限转圈
        submittingVote: false
      })
    }
    this.setData({ submittingVote: true })
    api.votePost(post.id, indexes, pollIndex).then((result) => { applyComponents(result.components || []); wx.showToast({ title: '投票成功', icon: 'success' }) }).catch((err) => { this.setData({ submittingVote: false }); wx.showToast({ title: err.message || '投票失败', icon: 'none' }) })
  },

  onPreviewPostImage(e) {
    this.blurCommentInput();
    const current = e.currentTarget.dataset.url
    const urls = ((this.data.post || {}).images || []).filter((url) => typeof url === 'string' && url)
    if (current && urls.length) wx.previewImage({ current, urls })
  },

  // 评论/回复图片点击放大预览（data-urls 传该条评论的全部图片）
  // 预览前先收起键盘：原生预览层会吞掉 input 的 blur 事件，导致 commentFocus 残留 true，
  // 关闭预览后输入框会被重新聚焦并拉起键盘
  onPreviewCommentImage(e) {
    this.blurCommentInput();
    const current = e.currentTarget.dataset.url
    const urls = (e.currentTarget.dataset.urls || []).filter((url) => typeof url === "string" && url);
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  // 点击评论区的视频：仅收起键盘，不干预视频控件本身的播放交互
  onCommentVideoTap() {
    this.blurCommentInput();
  },

  onPostImageError(e) {
    const url = e.currentTarget.dataset.url
    const detailImages = this.data.detailImages.map((item) =>
      item.url === url ? Object.assign({}, item, { failed: true }) : item,
    )
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
    this._commentPage = 1
    this._hiddenCommentCount = 0
    return api.getCommentList(postId, sort, 1).then((res) => {
      const list = (res.list || []).map((comment) => this.normalizeComment(comment));
      const hiddenCommentIds = (wx.getStorageSync('hidden_comment_ids') || []).map(Number);
      const blockedUserIds = (wx.getStorageSync('blocked_user_ids') || []).map(Number);
      const rawComments = this.filterVisibleComments(list, hiddenCommentIds, blockedUserIds);
      this._hiddenCommentCount = list.length - rawComments.length;
      this.setData({
        rawComments,
        commentHasMore: !!res.hasMore,
        commentTotal: Math.max(0, (Number(res.total) || list.length) - this._hiddenCommentCount),
        comments: this.buildCommentThreads(rawComments, sort),
      });
      this.applyPendingCommentAnchor(rawComments);
    });
  },

  // 评论锚点定位：目标 id 是根评论 → scroll-into-view 到该评论；
  // 是回复 → 自动展开所属线程的回复列表后定位到该回复（只定位一次，找不到且还有下一页时保留待定）
  applyPendingCommentAnchor(rawComments) {
    if (!this._pendingCommentAnchor) return
    const anchor = this.resolveCommentAnchor(rawComments || [], this._pendingCommentAnchor)
    if (anchor) {
      this._pendingCommentAnchor = 0
      this.setData({ commentAnchor: anchor })
    }
  },

  resolveCommentAnchor(rawComments, targetId) {
    const id = Number(targetId)
    if (!id) return ''
    const byId = {}
    ;(rawComments || []).forEach((c) => { byId[Number(c.id)] = c })
    const target = byId[id]
    if (!target) return ''
    if (!target.parentId) return 'comment-' + id
    // 回复：向上追溯到根评论，展开该线程的回复列表保证目标可见
    let current = target
    const visited = {}
    while (current.parentId && byId[Number(current.parentId)] && !visited[Number(current.id)]) {
      visited[Number(current.id)] = true
      current = byId[Number(current.parentId)]
    }
    const rootId = Number(current.id)
    const expandedReplyIds = Object.assign({}, this.data.expandedReplyIds)
    expandedReplyIds[rootId] = true
    this.setData({ expandedReplyIds })
    this.refreshCommentThreads()
    return 'reply-' + id
  },

  // 上滑加载下一页评论（scroll-view scrolltolower 触发）
  loadMoreComments() {
    if (!this.data.commentHasMore || this._commentsLoadingMore || !this.data.post) return
    this._commentsLoadingMore = true
    this.setData({ commentsLoadingMore: true })
    api.getCommentList(this.data.post.id, this.data.commentSort, (this._commentPage || 1) + 1).then((res) => {
      this._commentPage = (this._commentPage || 1) + 1
      const list = (res.list || []).map((comment) => this.normalizeComment(comment));
      const hiddenCommentIds = (wx.getStorageSync('hidden_comment_ids') || []).map(Number);
      const blockedUserIds = (wx.getStorageSync('blocked_user_ids') || []).map(Number);
      const incoming = this.filterVisibleComments(list, hiddenCommentIds, blockedUserIds);
      this._hiddenCommentCount += list.length - incoming.length;
      const rawComments = this.data.rawComments.concat(incoming);
      this.setData({
        rawComments,
        commentHasMore: !!res.hasMore,
        commentTotal: Math.max(0, (Number(res.total) || rawComments.length) - this._hiddenCommentCount),
        comments: this.buildCommentThreads(rawComments, this.data.commentSort),
      });
      this.applyPendingCommentAnchor(rawComments);
    }).catch(() => {
      wx.showToast({ title: '评论加载失败，请重试', icon: 'none' })
    }).then(() => {
      this._commentsLoadingMore = false
      this.setData({ commentsLoadingMore: false })
    })
  },

  normalizeComment(comment) {
    const createdAt = comment.created_at || comment.createdAt;
    let anonymous = comment.anonymousIdentity || comment.anonymous_identity;
    if (typeof anonymous === 'string') { try { anonymous = JSON.parse(anonymous) } catch (e) { anonymous = null } }
    const isAnonymous = !!(comment.is_anonymous || comment.isAnonymous || (anonymous && anonymous.nickName && anonymous.avatarUrl));
    const media = api.parseImages(comment.images);
    const images = media.filter((url) => !isVideoUrl(url));
    const videos = media.filter(isVideoUrl);
    const rawAllowPm = comment.allow_anonymous_pm !== undefined ? comment.allow_anonymous_pm : comment.allowAnonymousPm;
    // 头像归一化：历史数据里存在 `/assets/avatar2/1 (39).jpg` 这类旧路径，
    // 文件已重命名为 avatar_39.jpg，旧路径真机无法渲染（表现为灰色空圆）。
    // 帖子流经 api.mapPost 已修正，评论区此前漏掉，这里补上最后一道防线。
    const rawAvatar = isAnonymous ? anonymous.avatarUrl : (comment.avatar_url || comment.avatarUrl || "");
    return {
      id: comment.id,
      userId: comment.user_id || comment.userId,
      nickName: isAnonymous ? anonymous.nickName : (comment.nick_name || comment.nickName || "用户"),
      avatarUrl: avatar.normalizeLegacyAvatar(rawAvatar) || "/assets/icons/avatar.png",
      isAnonymous,
      // 有图/视频时去掉「[图片]/[视频]」占位文字，直接展示媒体本身
      content: media.length ? format.stripMediaPlaceholder(comment.content) : String(comment.content || ""),
      images,
      videos,
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

  // 把指定 id 的条目移到数组首位（乐观更新置顶用，找不到或已在首位则原样返回）
  moveToTopById(list, id) {
    const index = list.findIndex((item) => Number(item.id) === Number(id));
    if (index <= 0) return list;
    const copy = list.slice();
    const item = copy.splice(index, 1)[0];
    copy.unshift(item);
    return copy;
  },

  // 沿父评论链向上找根评论 id（回复可能是嵌套回复，置顶回复列表时需要根 id）
  findCommentRootId(id) {
    const byId = {};
    this.data.rawComments.forEach((comment) => { byId[comment.id] = comment; });
    let current = byId[id];
    const visited = {};
    while (current && current.parentId && byId[current.parentId] && !visited[current.id]) {
      visited[current.id] = true;
      current = byId[current.parentId];
    }
    return current ? current.id : id;
  },

  buildCommentThreads(rawComments, sort = this.data.commentSort, expandedReplyIds = this.data.expandedReplyIds, pin = null) {
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

    // pin: 顶层新评论乐观插入后置顶到评论区顶部；回复不传 pin——
    // 回复按时间正序排在所属评论的回复列表末尾（被评论者下方），不重排任何已有评论。
    // 仅在插入后的那次重建生效；后续刷新/排序走服务端真实排序
    let sortedRoots = this.sortComments(roots, sort);
    if (pin && pin.rootId) sortedRoots = this.moveToTopById(sortedRoots, pin.rootId);

    return sortedRoots.map((thread) => {
      // 子评论按时间先后展示（同刻按 id 兜底），新回复自然落在最下方 = 被评论者之下；
      // 收起态展示最早的 3 条，展开后按会话顺序完整阅读
      const replies = thread.replies.slice().sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB || Number(a.id || 0) - Number(b.id || 0);
      });
      const expanded = !!expandedReplyIds[thread.id];
      return Object.assign({}, thread, {
        replies,
        recentReplies: replies.slice(0, 3),
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
    this.loadComments(this.data.post.id, sort).catch(() => wx.showToast({ title: '评论加载失败，请重试', icon: 'none' }));
  },

  onCommentAvatarTap(e) {
    const userId = e.currentTarget.dataset.userid;
    if (!userId) return;
    const ds = e.currentTarget.dataset;
    if (ds.anonymous) {
      this.showAvatarSheet({
        userId,
        nick: ds.nick,
        avatar: ds.avatar,
        isOwner: ds.isowner,
        mode: 'anon',
        allowAnonymousPm: ds.allowpm,
      });
      return;
    }
    // 普通用户评论头像：弹出「个人主页 / 私信」功能菜单，功能入口迁移至弹窗内
    if (this.isSelfUser(userId)) {
      wx.navigateTo({ url: this.profileUrl(userId) });
      return;
    }
    this.showAvatarSheet({
      userId,
      nick: ds.nick,
      avatar: ds.avatar,
      mode: 'normal',
      allowAnonymousPm: ds.allowpm,
    });
  },

  // ---------- 头像功能菜单（统一弹窗） ----------
  // mode: 'anon' 匿名（分身）用户，仅展示「私信」；
  //       'normal' 普通用户，展示「个人主页」+「分身私信/私信」
  showAvatarSheet(options) {
    const mode = options.mode || 'normal';
    const allowed = options.allowAnonymousPm !== false;
    const ownerWording = options.isOwner ? '帖主' : '对方';
    this.setData({
      avatarSheet: {
        userId: options.userId,
        nick: options.nick || "校园同学",
        avatar: options.avatar || "/assets/icons/avatar.png",
        certLabel: options.certLabel || "",
        isOwner: !!options.isOwner,
        mode,
        allowAnonymousPm: options.allowAnonymousPm,
        actionLabel: allowed ? "分身私信" : "私信",
        tip: mode === 'anon'
          ? "这是一位分身用户"
          : (allowed
            ? ownerWording + "允许分身私信，进入主页可以进行普通私信"
            : ownerWording + "不允许分身私信"),
      },
    });
  },

  onCloseAvatarSheet() {
    this.setData({ avatarSheet: null });
  },

  isSelfUser(userId) {
    const userInfo = ((getApp().globalData || {}).userInfo) || wx.getStorageSync('userInfo') || {};
    return Number(userInfo.id) === Number(userId);
  },

  // 跳转用户个人主页：携带来源帖子 id，
  // 个人主页再进入私信时原样透传给聊天页，保证「帖子详情→个人主页→聊天」也能「回到帖子」
  profileUrl(userId) {
    const postId = (this.data.post || {}).id || 0;
    return "/pages/profile/index?id=" + userId + (postId ? "&postId=" + postId : "");
  },

  onAvatarSheetProfile() {
    const popup = this.data.avatarSheet;
    if (!popup || !popup.userId) return;
    this.setData({ avatarSheet: null });
    wx.navigateTo({ url: this.profileUrl(popup.userId) });
  },

  onAvatarSheetMessage() {
    const popup = this.data.avatarSheet;
    if (!popup || !popup.userId) return;
    if (!auth.requireLogin("私信需要先登录")) return;

    // 匿名（分身）用户私信：对方明确关闭时拦截
    if (popup.mode === 'anon' && popup.allowAnonymousPm === false) {
      this.setData({ avatarSheet: null });
      wx.showToast({ title: "对方不允许分身私信", icon: "none" });
      return;
    }
    // 普通用户且对方关闭了分身私信 → 走普通私信渠道
    if (popup.mode === 'normal' && popup.allowAnonymousPm === false) {
      this.setData({ avatarSheet: null });
      wx.navigateTo({
        url: "/pages/chat/index?peerId=" + popup.userId +
          "&nick=" + encodeURIComponent(popup.nick || "校园同学") +
          "&avatar=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
          // 显式声明普通私信渠道，避免曾被匿名私信过的会话被强制切回匿名视图
          "&anonymous=0" +
          // 记录来源帖子，聊天页「回到帖子」在消息通知入口也能返回本帖
          "&postId=" + (this.data.post && this.data.post.id || "")
      });
      return;
    }
    // 匿名（分身）私信
    wx.showModal({
      title: "分身私信",
      content: popup.mode === 'anon' ? "与分身用户对话时，你也自动变为分身用户" : "开启对话后，你将以分身身份与对方交流",
      confirmText: "确认",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ avatarSheet: null });
        let extra = "&anonymous=1";
        if (popup.mode !== 'anon') {
          // 发起方使用随机分身身份，服务端首次进入时存档，全程同一形象；
          // personaKey 以该分身头像为隔离键，不同分身各自对应独立聊天会话
          const persona = anonymousIdentity.generate();
          extra += "&personaKey=" + encodeURIComponent(persona.avatarUrl) +
            "&anonSelfNick=" + encodeURIComponent(persona.nickName) +
            "&anonSelfAvatar=" + encodeURIComponent(persona.avatarUrl);
        } else {
          // 与对方的某个分身对话：personaKey 用该分身头像作隔离键，
          // 对方其他分身（同一真实用户）的聊天记录不会出现在本会话
          extra += "&personaKey=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png");
        }
        wx.navigateTo({
          url: "/pages/chat/index?peerId=" + popup.userId +
            "&nick=" + encodeURIComponent(popup.nick || (popup.mode === 'anon' ? "分身用户" : "校园同学")) +
            "&avatar=" + encodeURIComponent(popup.avatar || "/assets/icons/avatar.png") +
            extra +
            // 记录来源帖子，聊天页「回到帖子」在消息通知入口也能返回本帖
            "&postId=" + (this.data.post && this.data.post.id || "")
        });
      }
    });
  },

  // ===== 操作按钮动效（纯视觉层，不改动任何业务状态与存储）=====
  playActionAnim(animKey, stateKey) {
    const patch = {};
    patch[animKey] = stateKey;
    this.setData(patch);
    const timerKey = "_" + animKey + "Timer";
    if (this[timerKey]) clearTimeout(this[timerKey]);
    this[timerKey] = setTimeout(() => {
      const clear = {};
      clear[animKey] = "";
      this.setData(clear);
      this[timerKey] = null;
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

  onLikePost() {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isLiked = !post.isLiked;
    post.likeCount = Math.max(0, (Number(post.likeCount) || 0) + (post.isLiked ? 1 : -1));
    this.setData({ post });
    this.playActionAnim("likeAnim", post.isLiked ? "anim-pop" : "anim-unpop");
    if (post.isLiked) this.flyLikeHeart();
    request.post("/post/" + post.id + "/like", {}, true, { silent: true })
      .then((res) => {
        const data = (res && res.data) || res || {};
        const isLiked = data.isLiked !== undefined ? data.isLiked : post.isLiked;
        const likeCount = data.likeCount !== undefined ? Number(data.likeCount) : post.likeCount;
        wx.setStorageSync(POST_STATE_SYNC_KEY, {
          id: post.id,
          isLiked,
          likeCount,
          isFavorited: post.isFavorited,
          favoriteCount: post.favoriteCount,
        });
      })
      .catch(() => {
        post.isLiked = !post.isLiked;
        post.likeCount = Math.max(0, (Number(post.likeCount) || 0) + (post.isLiked ? 1 : -1));
        this.setData({ post });
        this.playActionAnim("likeAnim", "anim-unpop");
      });
  },

  onFavoritePost() {
    if (!auth.requireLogin("收藏需要先登录")) return;
    const post = Object.assign({}, this.data.post);
    post.isFavorited = !post.isFavorited;
    post.favoriteCount = Math.max(0, (Number(post.favoriteCount) || 0) + (post.isFavorited ? 1 : -1));
    this.setData({ post });
    this.playActionAnim("favoriteAnim", post.isFavorited ? "anim-pop" : "anim-unpop");
    api.favoritePost(post.id)
      .then((res) => {
        const data = (res && res.data) || res || {};
        const isFavorited = data.isFavorited !== undefined ? data.isFavorited : post.isFavorited;
        const favoriteCount = data.favoriteCount !== undefined ? Number(data.favoriteCount) : post.favoriteCount;
        wx.setStorageSync(POST_STATE_SYNC_KEY, {
          id: post.id,
          isLiked: post.isLiked,
          likeCount: post.likeCount,
          isFavorited,
          favoriteCount,
        });
      })
      .catch(() => {
        post.isFavorited = !post.isFavorited;
        post.favoriteCount = Math.max(0, (Number(post.favoriteCount) || 0) + (post.isFavorited ? 1 : -1));
        this.setData({ post });
        this.playActionAnim("favoriteAnim", "anim-unpop");
      });
  },

  onFollowPost() {
    if (!auth.requireLogin("蹲帖需要先登录")) return;
    if (this.data.followSaving) return;
    const post = Object.assign({}, this.data.post);
    post.isFollowed = !post.isFollowed;
    post.followCount = Math.max(0, (Number(post.followCount) || 0) + (post.isFollowed ? 1 : -1));
    this.setData({ post, followSaving: true });
    this.playActionAnim("followAnim", post.isFollowed ? "anim-pop" : "anim-unpop");
    this.syncLocalFollowCache(post.id, post.isFollowed);
    api.followPost(post.id)
      .then((data) => {
        // 服务端返回真实落库结果与计数，以此为最终状态（避免并发下乐观值与库内不一致）
        const res = data || {};
        const isFollowed = res.followed !== undefined ? !!res.followed : post.isFollowed;
        const followCount = res.followCount !== undefined ? Number(res.followCount) : post.followCount;
        this.setData({ post: Object.assign({}, this.data.post, { isFollowed, followCount }), followSaving: false });
        this.syncLocalFollowCache(post.id, isFollowed);
        wx.showToast({ title: isFollowed ? "已蹲帖" : "已取消蹲帖", icon: "none" });
      })
      .catch(() => {
        // 失败回滚乐观更新，避免界面与服务端状态不一致
        const rollback = Object.assign({}, this.data.post);
        rollback.isFollowed = !rollback.isFollowed;
        rollback.followCount = Math.max(0, (Number(rollback.followCount) || 0) + (rollback.isFollowed ? 1 : -1));
        this.setData({ post: rollback, followSaving: false });
        this.syncLocalFollowCache(rollback.id, rollback.isFollowed);
        wx.showToast({ title: "操作失败，请稍后重试", icon: "none" });
      });
  },

  // 本地蹲贴 id 缓存：仅作接口未下发/离线时的兜底，与服务端 forum_post_follow 保持一致
  syncLocalFollowCache(postId, followed) {
    try {
      const list = wx.getStorageSync("followed_post_ids") || [];
      const id = Number(postId);
      const index = list.findIndex((item) => Number(item) === id);
      if (followed && index === -1) list.push(id);
      if (!followed && index > -1) list.splice(index, 1);
      wx.setStorageSync("followed_post_ids", list);
    } catch (e) {}
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

  // 点赞就地更新：仅通过数据路径修改该评论的点赞数字段，
  // 不调用 buildCommentThreads 重建线程，列表顺序保持不变，
  // 避免点赞后（尤其按赞数排序时）列表顺序跳动影响浏览；
  // 重新排序只发生在下拉刷新 / 切换排序（loadComments 按服务端规则整体重建）。
  // recentReplies 是收起态展示的独立副本，同一下标需同步更新。
  patchCommentLike(commentId, transform) {
    const comments = this.data.comments;
    for (let i = 0; i < comments.length; i++) {
      const root = comments[i];
      const patch = {};
      const collect = (prefix, comment) => {
        const next = transform(comment);
        patch[prefix + ".isLiked"] = next.isLiked;
        patch[prefix + ".likeCount"] = next.likeCount;
      };
      if (Number(root.id) === Number(commentId)) {
        collect("comments[" + i + "]", root);
      } else {
        const replies = root.replies || [];
        let found = -1;
        for (let j = 0; j < replies.length; j++) {
          if (Number(replies[j].id) === Number(commentId)) { found = j; break; }
        }
        if (found < 0) continue;
        collect("comments[" + i + "].replies[" + found + "]", replies[found]);
        const recent = root.recentReplies || [];
        if (found < recent.length && Number(recent[found].id) === Number(commentId)) {
          collect("comments[" + i + "].recentReplies[" + found + "]", recent[found]);
        }
      }
      // rawComments 不直接绑定渲染，仅作为线程重建的数据源，一并同步
      patch.rawComments = this.data.rawComments.map((c) => (
        Number(c.id) === Number(commentId) ? transform(c) : c
      ));
      this.setData(patch);
      return true;
    }
    return false;
  },

  onLikeComment(e) {
    if (!auth.requireLogin("点赞需要先登录")) return;
    const commentId = e.currentTarget.dataset.id;
    // transform 读当前状态取反：调用两次即恢复原值，成功/回滚共用同一逻辑
    const toggle = (comment) => {
      const liked = !comment.isLiked;
      return Object.assign({}, comment, {
        isLiked: liked,
        likeCount: Math.max(0, (comment.likeCount || 0) + (liked ? 1 : -1)),
      });
    };
    if (!this.patchCommentLike(commentId, toggle)) return;
    api.likeComment(commentId).catch(() => {
      // 服务端失败：再次取反即回滚
      this.patchCommentLike(commentId, toggle);
    });
  },

  // ===== 评论右上角「···」菜单：隐藏 / 举报 / 拉黑；有管理权时额外有「删除」 =====

  onCommentMore(e) {
    const ds = e.currentTarget.dataset;
    const commentId = ds.id;
    const userId = Number(ds.userid) || 0;
    const nick = ds.nick || "该用户";
    // 自己的评论不提供举报/拉黑（评论区下方已有编辑/删除入口）
    const isOwner = Number(userId) === Number(this.data.currentUserId);
    const base = isOwner ? ["隐藏"] : ["隐藏", "举报", "拉黑"];
    // 「删除」针对的是「他人的评论」：管理员可删任意帖子下的，帖子作者可删自己评论区里的
    const itemList = this.canDeleteOtherComment(isOwner) ? ["删除"].concat(base) : base;
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const selected = itemList[res.tapIndex];
        if (selected === "删除") {
          this.deleteCommentAsModerator(commentId);
        } else if (selected === "隐藏") {
          this.hideComment(commentId);
        } else if (selected === "举报") {
          this.reportComment(commentId);
        } else if (selected === "拉黑") {
          this.blockCommentAuthor(userId, nick);
        }
      },
    });
  },

  // 是否有权删除「他人的评论」：
  //   · 管理员（content.manage）—— 任意帖子下的任意评论；
  //   · 帖子作者 —— 自己评论区里的任意评论（含他人发的）。
  // 自己的评论不在菜单里给删除：评论区下方本就有编辑/删除入口，两个入口语义重叠会让人困惑。
  canDeleteOtherComment(isOwner) {
    if (isOwner) return false;
    if (this.canManagePostContent()) return true;
    const postAuthorId = Number((this.data.post || {}).userId) || 0;
    return !!postAuthorId && postAuthorId === Number(this.data.currentUserId);
  },

  // 删除他人的评论（管理员 / 帖子作者）。与「隐藏」的区别：隐藏只影响本机展示，
  // 删除是落库，所有用户都看不到 —— 确认文案必须写明影响范围。
  async deleteCommentAsModerator(commentId) {
    const target = this.data.rawComments.find((item) => Number(item.id) === Number(commentId));
    if (!target) return;
    const isOwner = Number(target.userId) === Number(this.data.currentUserId);
    if (!this.canDeleteOtherComment(isOwner)) return;
    const removed = this.collectRemovableComments(this.data.rawComments, [commentId]);
    const replyCount = Math.max(0, Object.keys(removed).length - 1);
    const tip = replyCount > 0
      ? "删除后该评论及其 " + replyCount + " 条回复将对所有用户不再展示，确认删除吗？"
      : "删除后该评论将对所有用户不再展示，确认删除吗？";
    if (!await this.confirmAction("删除评论", tip)) return;
    try {
      await api.deleteComment(commentId);
      this.applyCommentRemoval(removed);
      wx.showToast({ title: "已删除该评论", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "删除失败", icon: "none" });
    }
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
      await api.reportComment(commentId);
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
      await request.post("/message/block", { peerId: Number(userId) }, true);
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
    // 切换匿名/公开前先收起键盘，防止重渲染时输入框被重新聚焦拉起键盘
    this.blurCommentInput();
    const commentAnonymous = !this.data.commentAnonymous;
    this.setData({ commentAnonymous });
  },

  // ===== 评论区匿名身份一致性 =====
  // 同一帖子（评论区）内复用同一个分身身份：本地按帖子缓存，服务端还会按存档兜底，
  // 保证同一用户在同一评论区的所有匿名评论头像与昵称稳定不变
  loadCommentPersonaMap() {
    try { return wx.getStorageSync("anon_comment_personas") || {} } catch (e) { return {} }
  },

  getOrCreateCommentPersona(postId) {
    const map = this.loadCommentPersonaMap();
    const existing = map[postId];
    if (existing && existing.nickName && existing.avatarUrl) return existing;
    const persona = anonymousIdentity.generate();
    map[postId] = persona;
    try { wx.setStorageSync("anon_comment_personas", map) } catch (e) {}
    return persona;
  },

  saveCommentPersona(postId, persona) {
    if (!persona || !persona.nickName || !persona.avatarUrl) return;
    const map = this.loadCommentPersonaMap();
    map[postId] = persona;
    try { wx.setStorageSync("anon_comment_personas", map) } catch (e) {}
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
    // 防重复提交：上一条评论还在上传/落库时忽略再次点击
    if (this.data.submittingComment) return;
    const text = this.data.commentText.trim();
    const media = this.data.commentMedia.slice();
    if (!text && !media.length) return;
    // 新增触发点：提交评论时同步申请「评论通知」订阅授权（与「发帖成功」共用 postPublish 触发组）。
    // 位置刻意放在各项校验之后、任何 await 之前 —— 既不会对空评论弹窗，
    // 又保证仍在 tap 的同步调用链内（微信硬性要求）。
    if (typeof subscribe.requestTriggerByTap === "function") subscribe.requestTriggerByTap("postPublish");
    const postId = this.data.post.id;
    const parentId = this.data.replyTo || 0;
    const savedReplyTo = this.data.replyTo;
    const savedReplyToNick = this.data.replyToNick;
    const hasVideo = media.some((m) => m.type === "video");
    const content = text || (hasVideo ? "[视频]" : "[图片]");
    // 匿名身份：优先复用本评论区已用的分身身份，没有才生成新的
    const anonymous = this.data.commentAnonymous ? this.getOrCreateCommentPersona(postId) : null;
    const userInfo = (getApp().globalData.userInfo || {}) || {};
    const nowIso = new Date().toISOString();
    // 负数临时 id：与服务端自增 id 天然不冲突，替换/回退时按它定位
    const tempId = -Date.now();

    // ===== 乐观更新：先上屏，再等服务端 =====
    // 顶层评论插入后置顶展示；回复按时间正序排在所属评论回复列表末尾（被评论者下方）
    const optimisticComment = this.normalizeComment({
      id: tempId,
      user_id: this.data.currentUserId,
      nick_name: anonymous ? anonymous.nickName : (userInfo.nickName || "我"),
      avatar_url: anonymous ? anonymous.avatarUrl : (userInfo.avatarUrl || ""),
      anonymous_identity: anonymous,
      is_anonymous: !!anonymous,
      content,
      images: media.map((m) => m.path),
      parent_id: parentId,
      parent_nick_name: savedReplyToNick,
      created_at: nowIso,
    });
    const rawWithOptimistic = this.data.rawComments.concat([optimisticComment]);
    // 回复时自动展开所属评论的回复列表：新回复按时间排在末尾，展开后立即可见；
    // 乐观阶段就按最终规则定位（回复不置顶、顶层评论置顶），与服务端确认后一致，避免二次跳动
    const replyRootId = parentId ? this.findCommentRootId(parentId) : null;
    const optimisticExpanded = Object.assign({}, this.data.expandedReplyIds);
    if (replyRootId) optimisticExpanded[replyRootId] = true;
    this.setData({
      rawComments: rawWithOptimistic,
      comments: this.buildCommentThreads(rawWithOptimistic, this.data.commentSort, optimisticExpanded, parentId ? null : { rootId: tempId }),
      expandedReplyIds: optimisticExpanded,
      commentTotal: (Number(this.data.commentTotal) || 0) + 1,
      submittingComment: true,
      // 输入区立即复位（失败回退时恢复草稿）
      commentText: "",
      commentMedia: [],
      showEmojiPanel: false,
      replyTo: null,
      replyToNick: "",
    });

    // 失败回退：移除乐观记录、恢复草稿与计数
    const rollback = () => {
      const rawComments = this.data.rawComments.filter((c) => Number(c.id) !== tempId);
      this.setData({
        rawComments,
        comments: this.buildCommentThreads(rawComments),
        commentTotal: Math.max(0, (Number(this.data.commentTotal) || 0) - 1),
        commentText: text,
        commentMedia: media,
        replyTo: savedReplyTo,
        replyToNick: savedReplyToNick,
        submittingComment: false,
      });
    };

    // 用服务端返回的真实 id 替换临时评论；回复按时间正序保持在回复列表末尾（被评论者下方），
    // 不置顶、不重排已有评论；仅顶层新评论置顶到评论区顶部
    const applySuccess = (finalComment) => {
      let rawComments = this.data.rawComments.slice();
      const index = rawComments.findIndex((c) => Number(c.id) === tempId);
      if (index > -1) rawComments[index] = finalComment;
      else rawComments = rawComments.concat([finalComment]); // 极端时序：期间列表被整体刷新过，直接补插，避免丢失
      const pin = parentId ? null : { rootId: finalComment.id };
      this.setData({
        rawComments,
        comments: this.buildCommentThreads(rawComments, this.data.commentSort, this.data.expandedReplyIds, pin),
      });
    };

    try {
      // 图片走图片上传通道，视频走视频上传通道，按原顺序合并为 URL 数组
      let images = media.map((m) => m.path);
      if (media.length) {
        images = await Promise.all(
          media.map((m) =>
            m.type === "video"
              ? wechat.uploadVideo(m.path)
              : wechat.uploadImages([m.path]).then((arr) => arr[0]),
          ),
        );
        if (images.some((url) => !/^https?:\/\//i.test(url))) {
          throw new Error("媒体上传失败");
        }
      }

      // 服务端返回真实评论 id，用它替换乐观记录；刷新时列表整体重建，天然不会重复
      const created = await request.post("/comment", { postId, content, parentId, images, anonymousIdentity: anonymous }, true);
      // 服务端按评论区存档复用分身身份：返回的身份与本地缓存不一致时（如换设备），以服务端为准
      const effective = (created && created.anonymousIdentity) || anonymous;
      if (effective && anonymous && (effective.nickName !== anonymous.nickName || effective.avatarUrl !== anonymous.avatarUrl)) {
        this.saveCommentPersona(postId, effective);
      }
      const finalComment = this.normalizeComment({
        id: (created && created.id) || tempId,
        user_id: this.data.currentUserId,
        nick_name: effective ? effective.nickName : (userInfo.nickName || "我"),
        avatar_url: effective ? effective.avatarUrl : (userInfo.avatarUrl || ""),
        anonymous_identity: effective,
        is_anonymous: !!effective,
        content,
        images,
        parent_id: parentId,
        parent_nick_name: savedReplyToNick,
        created_at: nowIso,
      });
      applySuccess(finalComment);
      const post = Object.assign({}, this.data.post, {
        commentCount: (Number(this.data.post.commentCount) || 0) + 1,
      });
      this.setData({ post, submittingComment: false });
      wx.showToast({ title: "评论成功", icon: "success" });
    } catch (err) {
      rollback();
      wx.showToast({ title: err.message || "评论失败", icon: "none" });
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
    const comments = this.data.comments;
    const index = comments.findIndex((c) => Number(c.id) === Number(id));
    if (index < 0) return;
    const expanded = !comments[index].expanded;
    // 只定点更新目标评论的 expanded 一个字段：
    // 旧实现每次都 buildCommentThreads 全量重建 comments 数组（所有对象引用变化），
    // 渲染层对整表替换 + 嵌套列表切换的 diff 易发生节点复用错位，
    // 导致点某条评论的"收起"却收起了列表最前面的评论；路径化更新从根源消除该问题
    this.setData({
      ["comments[" + index + "].expanded"]: expanded,
      ["expandedReplyIds." + id]: expanded,
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

  // 评论可附图也可附视频（共 3 个位置），视频走视频上传通道
  onChooseCommentMedia() {
    if (!auth.requireLogin("评论需要先登录")) return;
    wx.chooseMedia({
      count: Math.max(1, 3 - this.data.commentMedia.length),
      mediaType: ["image", "video"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      maxDuration: 60,
      success: (res) => {
        // maxDuration 只限制拍摄，相册长视频需按 duration 二次校验；
        // 图/视频混选时只过滤超限视频，图片保留
        const { valid, overLong } = image.splitOverlongVideos(res.tempFiles || []);
        if (overLong) {
          wx.showToast({ title: "视频不能超过1分钟，已自动过滤", icon: "none" });
        }
        const items = valid
          .map((file) => ({
            type: file.fileType === "video" ? "video" : "image",
            path: file.tempFilePath,
          }))
          .filter((m) => m.path);
        if (!items.length) return;
        this.setData({
          commentMedia: this.data.commentMedia.concat(items).slice(0, 3),
          showEmojiPanel: false,
        });
      },
    });
  },

  onRemoveCommentMedia(e) {
    const index = e.currentTarget.dataset.index;
    const commentMedia = this.data.commentMedia.slice();
    commentMedia.splice(index, 1);
    this.setData({ commentMedia });
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
    // 服务端删除会连带删掉下级回复，本地也要一并移除，否则会残留「已被删除的回复」
    const removed = this.collectRemovableComments(this.data.rawComments, [id]);
    const replyCount = Math.max(0, Object.keys(removed).length - 1);
    wx.showModal({
      title: "确认删除",
      content: replyCount > 0
        ? "确定要删除这条评论吗？其下的 " + replyCount + " 条回复会一并删除。"
        : "确定要删除这条评论吗？",
      success: (res) => {
        if (!res.confirm) return;
        api.deleteComment(id)
          .then(() => {
            this.applyCommentRemoval(removed);
            wx.showToast({ title: "删除成功", icon: "success" });
          })
          .catch((err) => {
            wx.showToast({ title: err.message || "删除失败", icon: "none" });
          });
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
    request.post("/post/" + post.id + "/like", {}, true).catch(() => {});
  },

  onShare() {
    wx.navigateTo({ url: "/pages/share/index?postId=" + this.data.post.id });
  },

  onAvatarTap(e) {
    const userId = e.currentTarget.dataset.userid;
    if (!userId) return;
    const post = this.data.post || {};
    if (post.isAnonymous) {
      this.showAvatarSheet({
        userId,
        nick: post.nickName,
        avatar: post.avatarUrl,
        isOwner: true,
        mode: 'anon',
        allowAnonymousPm: post.allowAnonymousPm,
      });
      return;
    }
    // 查看自己的帖子时保持直接进入主页
    if (this.isSelfUser(userId)) {
      wx.navigateTo({ url: this.profileUrl(userId) });
      return;
    }
    // 普通帖帖主头像：弹出「个人主页 / 分身私信(或私信)」功能菜单
    this.showAvatarSheet({
      userId,
      nick: post.nickName,
      avatar: post.avatarUrl,
      certLabel: post.certLabel,
      isOwner: true,
      mode: 'normal',
      allowAnonymousPm: post.allowAnonymousPm,
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
      () => this.loadComments(postId).catch(() => {}),
      () => this.loadHotPosts(),
    ]);
  },
});
