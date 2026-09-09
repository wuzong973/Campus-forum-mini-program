const request = require("./request");
const scheduleUtils = require("./schedule");
const avatar = require("./avatar");

function cacheSet(key, data) {
  try {
    wx.setStorageSync(key, { data, ts: Date.now() });
  } catch (e) {}
}

const SERVICE_CACHE_KEY = "service_list_cache";

// Presentation-only mapping. Names, links and availability still come from
// the service API; this keeps the existing local icon artwork for each item.
const SERVICE_ICON_MAP = {
  '代拿跑腿': '/assets/icons/svc-errand.png',
  '课程表': '/assets/icons/svc-schedule.png',
  '社区论坛': '/assets/icons/svc-community.png',
  '二手闲置': '/assets/icons/svc-idle.png',
  '南校订水': '/assets/icons/svc-water.png',
  '北校订水': '/assets/icons/svc-water.png',
  '订水系统': '/assets/icons/svc-water.png',
  '乘车码': '/assets/icons/svc-card.png',
  '校园卡': '/assets/icons/svc-campus-card.png',
  '宅印': '/assets/icons/svc-print.png',
  '速印': '/assets/icons/svc-speed-print.png',
  '广轻维修': '/assets/icons/repair-logo.jpg',
  '广轻义修': '/assets/icons/repair-logo.jpg',
  '电脑义修': '/assets/icons/repair-logo.jpg',
  '校历': '/assets/icons/svc-calendar.png',
  '自助购电': '/assets/icons/svc-power.png',
  '零食店': '/assets/icons/svc-snack.png',
  '杂货店': '/assets/icons/svc-store.png',
  '校园网': '/assets/icons/svc-network.png',
  '信息门户': '/assets/icons/school.png',
  '图书馆': '/assets/icons/svc-library.png',
  '选课系统': '/assets/icons/svc-edit.png',
  '成绩查询': '/assets/icons/svc-grade.png',
  '考试安排': '/assets/icons/svc-exam.png',
  '教务系统': '/assets/icons/svc-edu.png',
  '轻友指南': '/assets/icons/svc-guide.png',
  '校车时刻': '/assets/icons/svc-bus.png',
  '失物招领': '/assets/icons/svc-search.png',
  '校园地图': '/assets/icons/svc-map.png',
  '教务文档': '/assets/icons/svc-doc.png',
  '校园活动': '/assets/icons/svc-activity.png',
  '广轻群聊': '/assets/icons/svc-group.png',
  '社团&组织': '/assets/icons/svc-club.png',
  '校园评价': '/assets/icons/svc-review.png',
  '找驾校': '/assets/icons/svc-driving.png',
  '校园市场': '/assets/icons/svc-store.png',
  '返乡大巴': '/assets/icons/svc-bus-return.png',
  '特惠寄件': '/assets/icons/svc-express.png'
}

// 服务端下发的名称 → 端上展示名称（服务端库中仍为旧名，展示层统一改名）
const SERVICE_RENAME_MAP = {
  '食堂菜单': '轻友指南',
  '通知公告': '教务文档',
  '广轻维修': '广轻义修'
}

// 暂不开放跳转的服务：清空 link / miniAppId，点击时走「即将上线」提示
const SERVICE_NO_LINK = ['轻友指南', '教务文档']

// 跳转兜底配置：服务列表由服务端下发，但 link / miniAppId 之外的字段不会
// 存储（数据库重置后容易丢失跳转配置），此处按服务名兜底补齐。
// 服务端 link 非空时以服务端为准。
// 订水/购电走 nginx 托管的中转页（https://payun01.cn/services/，webview 白名单
// 域名），由中转页二次跳转到第三方 http 站点，规避真机 web-view 的 https 限制。
const SERVICE_FALLBACK_LINKS = {
  '订水系统': { link: 'https://payun01.cn/services/?service=water' },
  '自助购电': { link: 'https://payun01.cn/services/?service=power' },
  '零食店': { miniAppId: 'wx2cd0769ebeb0d213' },
  '杂货店': { miniAppId: 'wxbe48d181d8d5762e' },
  '乘车码': { miniAppId: 'wxe9f4a4df3ac90522' }
}

const FORUM_CATEGORY_MAP = {
  "推荐": "日常话题",
  "日常分享": "日常话题",
  "校园活动": "日常话题",
  "打听求助": "日常话题",
  "学习经验": "日常话题",
  "二手": "二手闲置",
  "旧书交易": "二手闲置",
  "吃瓜爆料": "树洞吐槽",
};

function normalizeForumCategory(category) {
  return FORUM_CATEGORY_MAP[category] || category || "日常话题";
}

function parseImages(images) {
  const isPublicImage = (value) => {
    const url = String(value || '').trim()
    // Uploads are persisted either in COS or under the server's public
    // HTTPS /uploads path. Only temporary local URLs must be discarded.
    return /^https:\/\//i.test(url)
  }
  if (!images) return [];
  if (Array.isArray(images)) {
    return images
      .map((item) => {
        if (typeof item === "string") return item;
        // 视频项保留为 {type:'video', url}，供帖子卡片视频瓦片与详情页播放器识别（丢失会导致视频帖不显示视频）
        if (item && item.type === "video") {
          const url = String(item.url || item.path || "").trim();
          return isPublicImage(url) ? { type: "video", url } : "";
        }
        return (item && (item.url || item.path)) || "";
      })
      .filter((item) => (typeof item === "string" ? isPublicImage(item) : isPublicImage(item.url)));
  }
  if (typeof images === "string") {
    if (isPublicImage(images)) return [String(images).trim()]
    try {
      return parseImages(JSON.parse(images));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function parseContact(contact) {
  if (!contact) return null;
  let value = contact;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (!value.name || !value.type || !value.value) return null;
  return { name: String(value.name), type: String(value.type), value: String(value.value) };
}

function parseComponents(components) {
  if (!components) return []
  if (Array.isArray(components)) return components
  try { return JSON.parse(components) } catch (e) { return [] }
}

function mapPost(r) {
  const userId = r.userId || r.user_id;
  const avatarUrl = String(r.avatarUrl || r.avatar_url || '').trim()
  return {
    id: r.id,
    userId,
    nickName: String(r.nickName || r.nick_name || "校园同学"),
    // Bundled defaults are stored as app-relative paths; remote uploads use HTTPS.
    avatarUrl: avatar.isStoredAvatar(avatarUrl) ? avatarUrl : "",
    campus: String(r.campus || r.campusName || r.campus_name || ""),
    title: r.title === undefined || r.title === null ? "" : String(r.title),
    gender: r.gender,
    category: normalizeForumCategory(String(r.category || '')),
    content: r.content === undefined || r.content === null ? "" : String(r.content),
    images: parseImages(r.images),
    viewCount: r.viewCount || r.view_count || 0,
    likeCount: r.likeCount || r.like_count || 0,
    commentCount: r.commentCount || r.comment_count || 0,
    favoriteCount: r.favoriteCount || r.favorite_count || 0,
    followCount: r.followCount || r.follow_count || 0,
    shareCount: r.shareCount || r.share_count || 0,
    verified: !!(r.verified || r.isVerified || r.is_verified),
    certLabel: r.certLabel || r.cert_label || "",
    allowAnonymousPm: r.allowAnonymousPm === undefined ? true : !!r.allowAnonymousPm,
    postCount: r.postCount || r.post_count || 0,
    isHot: !!r.isHot,
    pinned: !!r.pinned,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    reviewNote: r.reviewNote || r.review_note || "",
    isDeleted: !!(r.isDeleted || r.is_deleted),
    contact: parseContact(r.contact),
    components: parseComponents(r.components),
    isAnonymous: !!(r.isAnonymous || r.is_anonymous),
    createdAt: r.createdAt || r.created_at,
  };
}

// 首页展示配置（公开）：管理后台「配置」维护的轮播图与公告；无配置时返回空，首页回退本地默认
function getHomeConfig() {
  return request.get("/config/home", {}, false, { silent: true }).then((d) => ({
    banners: (d && d.banners) || [],
    notice: (d && d.notice) || null,
    // 发布页（发布帖子/发布跑腿）顶部自动轮播横幅
    publishBanners: (d && d.publishBanners) || [],
  }));
}

// 消息通知横幅（「我的」页「消息通知」卡片顶部）：公开读取；管理员保存后服务端广播 banner_update 实时刷新
function getMessageBanner() {
  return request.get("/config/message-banner", {}, false, { silent: true }).then((d) => d || null);
}

function saveMessageBanner(payload) {
  return request.put("/config/message-banner", payload, true);
}

// 帖子详情页「每日热榜」上方横幅：机制同消息通知横幅，内容相互独立
function getPostBanner() {
  return request.get("/config/post-banner", {}, false, { silent: true }).then((d) => d || null);
}

function savePostBanner(payload) {
  return request.put("/config/post-banner", payload, true);
}

function getPostList(params) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 10;
  const category = params.category || "";
  return request
    .get("/post/list", { page, pageSize, category }, true)
    .then((d) => {
      if (!d) return null;
      return {
        list: (d.list || []).map(mapPost),
        total: d.total,
        hasMore: d.hasMore,
      };
    });
}

function getHotPostRank(period = "today", limit = 15) {
  // 热榜：指定时间段内浏览量最高的帖子，携带图片/视频媒体信息
  // period: today / week / month / halfyear / year / history
  function parseHotMedia(images) {
    let arr = [];
    if (Array.isArray(images)) arr = images;
    else if (typeof images === "string") {
      try { arr = JSON.parse(images); } catch (e) { arr = images ? [images] : []; }
    }
    const media = (arr || [])
      .map((item) => (typeof item === "string"
        ? { type: "image", url: item }
        : { type: item.type === "video" ? "video" : "image", url: item.url || item.path || "" }))
      .filter((m) => /^https:\/\//i.test(m.url));
    return {
      hotImages: media.filter((m) => m.type === "image").map((m) => m.url).slice(0, 3),
      hasVideo: media.some((m) => m.type === "video"),
    };
  }

  return request.get("/post/hot-rank", { period, limit }, true).then((d) => ({
    list: (d && d.list ? d.list : []).map((row) => Object.assign(mapPost(row), parseHotMedia(row.images))),
  }));
}

// 发布横幅详情（发布页顶部横幅点击查看）：取 /config/home 中排序最前的启用发布横幅
function getPublishBanner(id) {
  return request.get("/config/home", {}, false, { silent: true }).then((d) => {
    const list = (d && d.publishBanners) || [];
    if (!list.length) return null;
    // 指定了公告 id 时精准匹配（发布页点击某条公告进详情）；未命中或未指定时回退第一条
    if (id !== undefined && id !== null && id !== "") {
      const hit = list.find((b) => String(b.id) === String(id));
      if (hit) return hit;
    }
    return list[0] || null;
  });
}

function getPostDetail(id) {
  return request
    .get("/post/" + id, {}, true)
    .then((d) => (d ? mapPost(d) : null));
}

function searchPosts(keyword, page = 1, pageSize = 50) {
  return request.get('/post/search', { keyword, page, pageSize }, true).then((d) => ({
    list: (d.list || []).map(mapPost), total: d.total, hasMore: d.hasMore
  }))
}

function getServiceList() {
  const normalizeServiceSections = (sections) => {
    const grouped = {}
    ;(sections || []).forEach((section) => {
      const title = section.title || section.name || ''
      if (!title) return
      if (!grouped[title]) grouped[title] = { id: section.id || title, title, items: [], itemNames: {} }
      ;(section.items || []).forEach((source) => {
        const item = Object.assign({}, source)
        const rawName = String(item.name || '').trim()
        const name = SERVICE_RENAME_MAP[rawName] || rawName
        item.name = name
        if (!rawName || grouped[title].itemNames[name]) return
        grouped[title].itemNames[name] = true
        const rawIconPath = String(item.iconPath || '')
        const rawIcon = String(item.icon || '')
        const iconPath = /^(https?:)?\/\//i.test(rawIconPath) || rawIconPath.indexOf('/') === 0
          ? rawIconPath
          : (rawIconPath.indexOf('assets/') === 0 ? '/' + rawIconPath : '')
        item.iconPath = iconPath || SERVICE_ICON_MAP[name] || ''
        item.icon = item.iconPath ? '' : (rawIcon || rawIconPath)
        item.badge = item.badge || ''
        if (!item.link && !item.miniAppId && SERVICE_FALLBACK_LINKS[name]) {
          const fallbackLink = SERVICE_FALLBACK_LINKS[name]
          if (fallbackLink.miniAppId) item.miniAppId = fallbackLink.miniAppId
          else item.link = fallbackLink.link
        }
        // 暂不开放跳转的服务：清空服务端下发的跳转配置，点击走「即将上线」提示
        if (SERVICE_NO_LINK.indexOf(name) > -1) {
          delete item.miniAppId
          item.link = ''
        }
        grouped[title].items.push(item)
      })
    })
    return Object.keys(grouped).map((key) => {
      const section = grouped[key]
      delete section.itemNames
      return section
    })
  }

  return request.get("/service/list", {}, false).then((d) => {
    const data = normalizeServiceSections(Array.isArray(d) ? d : []);
    cacheSet(SERVICE_CACHE_KEY, data);
    return data;
  });
}

function getErrandList(params) {
  return request
    .get("/errand/list", params, true)
    .then((d) => d || { list: [], total: 0, hasMore: false });
}

function getScheduleList(options = {}) {
  return request
    .get("/schedule/list", {}, true, { silent: !!options.silent })
    .then((d) =>
      (d || []).map((item, index) =>
        scheduleUtils.normalizeCourse(item, index),
      ),
    );
}

function syncSchedule(username, password) {
  return request.post("/schedule/sync", { username, password }, true, {
    showLoading: "加载中，可能需要一到两分钟时间，请耐心等候哦~~",
    timeout: 120000,
  });
}

function submitScheduleCaptcha(challengeId, code) {
  return request.post("/schedule/sync/captcha", { challengeId, code }, true, {
    showLoading: "加载中，可能需要一到两分钟时间，请耐心等候哦~~",
    timeout: 120000,
  });
}

// 教务账号绑定状态（服务端是否已保存加密凭证，用于免密自动同步）
function getJwBindStatus() {
  return request
    .get("/schedule/bind", {}, true, { silent: true })
    .then((d) => d || { bound: false, username: "" })
    .catch(() => ({ bound: false, username: "" }));
}

// 免密刷新：使用已绑定的教务账号自动同步课表 + 考试安排 + 成绩
function refreshJwData() {
  return request.post("/schedule/refresh", {}, true, {
    showLoading: "正在同步课表、考试与成绩…",
    timeout: 120000,
  });
}

// 最近一次同步的考试安排（服务端缓存，不访问教务系统）
function getExamList() {
  return request.get("/schedule/exams", {}, true, { silent: true });
}

// 最近一次同步的成绩（服务端缓存，不访问教务系统）
function getGradeList() {
  return request.get("/schedule/grades", {}, true, { silent: true });
}

function clearSchedule() {
  return request.post("/schedule/clear", {}, true);
}

function replaceSchedule(courses) {
  return request.post('/schedule/replace', { courses }, true, {
    retryable: true,
    idempotencyKey: `schedule_replace_${Date.now()}`,
  });
}

function getScheduleConfig() {
  return request.get("/schedule/config", {}, true);
}

function getCommentList(postId, sort = "hot") {
  return request.get("/comment/list", { postId, sort, page: 1, pageSize: 50 }, false);
}

function likeComment(commentId) {
  return request.post("/comment/" + commentId + "/like", {}, true);
}

function getTopLikedComment(postId) {
  return request.get("/comment/top-liked", { postId }, false);
}

function getUserProfile(userId) {
  return request.get("/user/profile/" + userId, {}, false);
}

function getUserPosts(userId) {
  return request
    .get("/user/profile/" + userId + "/posts", {}, false)
    .then((d) => (d.list || []).map(mapPost));
}

function getMyDeletedPosts() {
  return request
    .get('/user/my-deleted-posts', {}, true, { silent: true })
    .then((d) => (d.list || []).map(mapPost))
}

function getMyHiddenPosts() {
  return request.get('/post/hidden', {}, true, { silent: true }).then((d) => d.list || [])
}

function unhidePost(postId) {
  return request.del('/post/hidden/' + postId, {}, true)
}

function favoritePost(postId) {
  return request.post("/post/" + postId + "/favorite", {}, true);
}

function votePost(postId, optionIndexes, pollIndex) {
  return request.post('/post/' + postId + '/vote', { optionIndexes, pollIndex }, true)
}

function updatePostReviewNote(postId, reviewNote) {
  return request.post("/post/" + postId + "/review-note", { reviewNote }, true);
}

function deletePost(postId) {
  return request.del('/post/' + postId, {}, true);
}

function markPostNotInterested(postId, postOnly) {
  // postOnly: 仅隐藏该帖子（scope=post），否则连同同分类内容一起隐藏（拉黑）
  return request.post('/post/' + postId + '/not-interested', postOnly ? { scope: 'post' } : {}, true);
}

function reportPost(postId) {
  return request.post('/feedback/report', {
    targetType: 'post',
    targetId: Number(postId),
    reason: '用户举报：内容可能违反社区规则',
  }, true);
}

function reportComment(commentId) {
  return request.post('/feedback/report', {
    targetType: 'comment',
    targetId: Number(commentId),
    reason: '用户举报：评论可能违反社区规则',
  }, true);
}

function reportUser(userId) {
  return request.post('/feedback/report', {
    targetType: 'user',
    targetId: Number(userId),
    reason: '用户举报：该用户可能违反社区规则',
  }, true);
}

function getMyInteractionStats() {
  return request.get("/user/interactions/stats", {}, true);
}

function getMyInteractionList(type) {
  return request.get(
    "/user/interactions/" + type,
    { page: 1, pageSize: 50 },
    true,
  );
}

function createShare(postId, content, parentShareId) {
  return request.post("/share", { postId, content, parentShareId }, true);
}

function getShareList(postId) {
  return request.get("/share/" + postId, { page: 1, pageSize: 20 }, false);
}

function getBlacklist() {
  return request.get("/message/blacklist", {}, true);
}

function unblockUser(peerId) {
  return request.post("/message/unblock", { peerId }, true);
}

function blockUser(peerId) {
  return request.post("/message/block", { peerId: Number(peerId) }, true);
}

function bindPhone(phoneCode) {
  return request.post("/user/phone", { phoneCode }, true);
}

// ===== 跑腿订单专属聊天（与私信独立，双方真实身份） =====

// 我的跑腿聊天会话列表（已接单/已完成的订单）
function getErrandChats() {
  return request.get("/errand/chats", {}, true, { silent: true }).then((d) => d || { list: [] });
}

// 某订单的聊天记录（含对方身份与订单概要）
function getErrandChatMessages(orderId, page = 1, pageSize = 30) {
  return request.get("/errand/" + orderId + "/messages", { page, pageSize }, true);
}

// 发送跑腿聊天消息
function sendErrandMessage(orderId, content, msgType = "text") {
  return request.post("/errand/" + orderId + "/messages", { content, msgType }, true);
}

// 标记某订单聊天已读
function markErrandChatRead(orderId) {
  return request.post("/errand/chats/" + orderId + "/read", {}, true, { silent: true }).catch(() => {});
}

// ===== 社团&组织 =====
function getClubCategories() {
  return request.get("/club/categories", {}, false);
}

// ===== 广轻群聊 =====
function getGroupChatList() {
  return request.get("/group-chat/list", {}, false);
}

function submitGroupChatApply(data) {
  return request.post("/group-chat/apply", data, true);
}

function getMyGroupChatApplies() {
  return request.get("/group-chat/mine", {}, true);
}

module.exports = {
  SERVICE_ICON_MAP,
  getBlacklist,
  unblockUser,
  blockUser,
  bindPhone,
  mapPost,
  getPostList,
  getHotPostRank,
  getPublishBanner,
  getPostDetail,
  searchPosts,
  getServiceList,
  getClubCategories,
  getGroupChatList,
  submitGroupChatApply,
  getMyGroupChatApplies,
  getErrandList,
  getErrandChats,
  getErrandChatMessages,
  sendErrandMessage,
  markErrandChatRead,
  getScheduleList,
  syncSchedule,
  submitScheduleCaptcha,
  refreshJwData,
  getJwBindStatus,
  getExamList,
  getGradeList,
  clearSchedule,
  replaceSchedule,
  getScheduleConfig,
  getCommentList,
  getHomeConfig,
  getMessageBanner,
  saveMessageBanner,
  getPostBanner,
  savePostBanner,
  likeComment,
  getTopLikedComment,
  getUserProfile,
  getUserPosts,
  getMyDeletedPosts,
  getMyHiddenPosts,
  unhidePost,
  parseImages,
  favoritePost,
  votePost,
  updatePostReviewNote,
  deletePost,
  markPostNotInterested,
  reportPost,
  reportComment,
  reportUser,
  getMyInteractionStats,
  getMyInteractionList,
  createShare,
  getShareList,
  normalizePost: mapPost,
};
