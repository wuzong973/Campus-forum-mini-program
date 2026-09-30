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
  '广轻维修': '广轻义修',
  // 服务端库中为「宅印」，端上统一叫「速印」，与首页宫格一致（同名才能命中同一套落地页）
  '宅印': '速印'
}

// 端上路由接管的服务：清空服务端下发的 link / miniAppId，改由 pages/index、pages/service-all 的
// onServiceTap 按服务名跳转到站内落地页（教务系统/校园卡/速印/校车时刻/轻友指南/教务文档 等），
// 不再有「即将上线」式空提示（审核规范要求）。
const SERVICE_NO_LINK = ['轻友指南', '教务文档']

// 这两个第三方服务依赖微信内置浏览器授权，且目标站不能稳定内嵌；
// 即使服务端误下发小程序 AppID，也统一改为复制 H5 链接引导。
const SERVICE_COPY_LINK_SERVICES = {
  '订水系统': true,
  '自助购电': true
}

// 跳转兜底配置：服务列表由服务端下发，但 link / miniAppId 之外的字段不会
// 存储（数据库重置后容易丢失跳转配置），此处按服务名兜底补齐。
// 服务端 link 非空时以服务端为准。
// 服务端 link 非空时以服务端为准。
// 订水/购电为第三方 http 站点，无法内嵌（https 的 H5 里 iframe 嵌 http 会被混合内容
// 策略拦截；订水 https 版还有 X-Frame-Options: DENY），也不再走 services 中转页二次
// 跳转（web-view 内页面导航到未配置域名同样被微信拦截，真机实测打不开）。
// 改为直填 http 链接：首页点击后复制链接并引导「发送到微信聊天后点开」——
// 两个系统均为微信网页授权体系（oauth 仅微信内有效），浏览器反而打不开。
const SERVICE_FALLBACK_LINKS = {
  '订水系统': { link: 'http://wx.dingbaoxiaoyuan.com/home' },
  '自助购电': { link: 'http://bd.bdfairy.cn' },
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
  // Heal avatars saved before the bundled files were renamed to plain ASCII
  // names; real devices could not render the old "/assets/avatar2/1%20(9).jpg".
  const avatarUrl = avatar.normalizeLegacyAvatar(String(r.avatarUrl || r.avatar_url || '').trim())
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
    // 蹲贴态（服务端下发；拼写兼容 snake_case 下发）
    isFollowed: !!(r.isFollowed || r.is_followed),
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

// 校园卡自定义页面（管理后台「物品」页维护，可多张）：
// 列表普通用户只拿到已发布条目；带 token 时管理员可读到下线草稿，未发布返回 null
function getCampusCardPages() {
  return request.get("/config/campus-card-pages", {}, true, { silent: true }).then((d) => (d && d.list) || []);
}

function getCampusCardPage(id) {
  return request.get("/config/campus-card-page/" + id, {}, true, { silent: true }).then((d) => d || null);
}

function createCampusCardPage(payload) {
  return request.post("/config/campus-card-page", payload, true);
}

function saveCampusCardPage(id, payload) {
  return request.put("/config/campus-card-page/" + id, payload, true);
}

// 学车指南自定义页（后台「物品」页维护，单张）：未发布返回 null，页面走空态
function getDrivingGuidePage() {
  return request.get("/config/driving-guide-page", {}, true, { silent: true }).then((d) => d || null);
}

function createDrivingGuidePage(payload) {
  return request.post("/config/driving-guide-page", payload, true);
}

function saveDrivingGuidePage(id, payload) {
  return request.put("/config/driving-guide-page/" + id, payload, true);
}

// 驾校运营位：列表页顶部横幅（背景图+文案+标签）与筛选标签池。
// 未配置返回 null，前台用 utils/driving-school.js 里的内置默认兜底，避免首屏空白。
function getDrivingPromo() {
  return request.get("/config/driving-promo", {}, true, { silent: true }).then((d) => d || null);
}

function saveDrivingPromo(payload) {
  return request.put("/config/driving-promo", payload, true);
}

function getDrivingServiceTags() {
  return request.get("/config/driving-service-tags", {}, true, { silent: true }).then((d) => d || null);
}

function saveDrivingServiceTags(payload) {
  return request.put("/config/driving-service-tags", payload, true);
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

// 找驾校：驾校列表（公开，仅启用条目，可按校区过滤）与详情
function getDrivingSchools(campus) {
  const query = campus ? { campus } : {};
  return request.get("/driving-school/list", query, false, { silent: true }).then((d) => (d && d.list) || []);
}

function getDrivingSchoolDetail(id) {
  return request.get("/driving-school/detail/" + id, {}, false, { silent: true }).then((d) => (d && d.school) || null);
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
        if (SERVICE_COPY_LINK_SERVICES[name]) {
          delete item.miniAppId
          if (!item.link) item.link = SERVICE_FALLBACK_LINKS[name] && SERVICE_FALLBACK_LINKS[name].link
        }
        if (!item.link && !item.miniAppId && SERVICE_FALLBACK_LINKS[name]) {
          const fallbackLink = SERVICE_FALLBACK_LINKS[name]
          if (fallbackLink.miniAppId) item.miniAppId = fallbackLink.miniAppId
          else item.link = fallbackLink.link
        }
        // 端上路由接管的服务：清空服务端下发的跳转配置，点击由 onServiceTap 走站内落地页
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

// 换一张验证码：复用服务端挑战内已保存的教务凭据重新抓图，
// 用户无需在未绑定态重新输入学号密码
function refreshScheduleCaptcha(challengeId) {
  return request.post("/schedule/sync/captcha/refresh", { challengeId }, true, {
    timeout: 60000,
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

function updateScheduleCourse(courseId, course) {
  return request.put(`/schedule/course/${courseId}`, course, true, {
    idempotencyKey: `schedule_course_update_${courseId}_${Date.now()}`,
  });
}

function deleteScheduleCourse(courseId) {
  return request.del(`/schedule/course/${courseId}`, {}, true);
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

function getCommentList(postId, sort = "hot", page = 1) {
  // needAuth=true：optionalAuth 路由依赖 token 计算每条评论的 is_liked（点赞态水合）
  return request.get("/comment/list", { postId, sort, page, pageSize: 50 }, true);
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

function getUserPosts(userId, page = 1) {
  // needAuth=true：服务端按「本人」放行自己的匿名帖；无 token 时仅不带凭据，匿名帖仍不可见（预期行为）
  return request
    .get("/user/profile/" + userId + "/posts", { page }, true)
    .then((d) => {
      const list = (d.list || []).map(mapPost);
      // 附加 hasMore 供需要加载更多的页面读取；数组本身仍可直接遍历
      list.hasMore = !!d.hasMore;
      return list;
    });
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

// 蹲贴：切换「蹲」状态，返回 { followed, followCount }
function followPost(postId) {
  return request.post("/post/" + postId + "/follow", {}, true);
}

// 蹲贴列表：type = 'mine'（我蹲过的帖子）/ 'theirs'（其他用户蹲过的我的帖子）
function getFollowedPosts(type, page, pageSize) {
  return request.get('/post/follow/list', {
    type: type || 'mine',
    page: page || 1,
    pageSize: pageSize || 50,
  }, true, { silent: true });
}

// 删除评论：作者可删自己的评论，管理员（content.manage）可删任意评论。
// 服务端会连带删除该评论的所有下级回复，并同步帖子评论计数。
function deleteComment(commentId) {
  return request.del('/comment/' + commentId, {}, true)
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

function getMyInteractionList(type, page = 1) {
  return request.get(
    "/user/interactions/" + type,
    { page, pageSize: 50 },
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
function getClubCategories(campus) {
  return request.get("/club/categories", campus ? { campus: campus } : {}, false);
}

// 提交社团申请（需登录，管理员审核通过后才在分类中展示）
function submitClubApply(data) {
  return request.post("/club/apply", data, true);
}

// 我的社团申请（审核进度与审核意见）
function getMyClubApplies() {
  return request.get("/club/mine", {}, true);
}

// 单个社团详情（公开）。silent：社团不存在/已下线时由详情页自行渲染空态，
// 避免「接口 toast + 页面空态」同一条信息提示两遍。
function getClubDetail(id) {
  return request.get("/club/detail/" + id, {}, false, { silent: true });
}

// ===== 广轻群聊 =====
function getGroupChatList(campus) {
  return request.get("/group-chat/list", campus ? { campus: campus } : {}, false);
}

function getGroupChatDetail(id) {
  return request.get("/group-chat/detail/" + id, {}, false);
}

function submitGroupChatApply(data) {
  return request.post("/group-chat/apply", data, true);
}

function getMyGroupChatApplies() {
  return request.get("/group-chat/mine", {}, true);
}

// 群聊类别（管理后台「群聊类别编辑」维护）
function getGroupChatCategories() {
  return request.get("/group-chat/categories", {}, false, { silent: true });
}

// ===== 校园活动 =====
// page：页码（从 1 开始）。后端按 page 真实分页并返回 hasMore，
// 缺省时不传 page 参数、行为与旧版一致（后端返回第 1 页）。
function getActivities(tab, campus, page) {
  const query = { tab: tab || "all" };
  if (campus) query.campus = campus;
  if (page && Number(page) > 1) query.page = Number(page);
  return request.get("/activity/list", query, tab === "mine", { silent: true });
}

function getActivityDetail(id) {
  return request.get("/activity/detail/" + id, {}, false);
}

function createActivity(data) {
  return request.post("/activity/create", data, true);
}

function signupActivity(id) {
  return request.post("/activity/signup/" + id, {}, true);
}

// ===== 校园评价（课程 / 食堂 / 商圈评分） =====
// query: { category, campus, floor, grade, level, parentId, keyword, sort, page }
function getReviewTargets(query) {
  return request.get("/review/targets", query || {}, false, { silent: true });
}

function getReviewTargetDetail(id) {
  return request.get("/review/target/" + id, {}, false, { silent: true });
}

function createReviewTarget(data) {
  return request.post("/review/target", data, true);
}

function getRandomReviewTarget(query) {
  return request.get("/review/random", query || {}, false, { silent: true });
}

function rateReviewTarget(id, score) {
  return request.post("/review/target/" + id + "/rate", { score }, true);
}

function likeReviewTarget(id) {
  return request.post("/review/target/" + id + "/like", {}, true);
}

// sort: time 时间 / likes 赞数
function getReviewComments(id, sort, page) {
  const query = { sort: sort || "time" };
  if (page && Number(page) > 1) query.page = Number(page);
  return request.get("/review/target/" + id + "/comments", query, false, { silent: true });
}

function addReviewComment(id, content) {
  return request.post("/review/target/" + id + "/comments", { content }, true);
}

function likeReviewComment(id) {
  return request.post("/review/comment/" + id + "/like", {}, true);
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
  submitClubApply,
  getMyClubApplies,
  getClubDetail,
  getGroupChatList,
  getGroupChatDetail,
  submitGroupChatApply,
  getMyGroupChatApplies,
  getGroupChatCategories,
  getActivities,
  getActivityDetail,
  createActivity,
  signupActivity,
  getReviewTargets,
  getReviewTargetDetail,
  createReviewTarget,
  getRandomReviewTarget,
  rateReviewTarget,
  likeReviewTarget,
  getReviewComments,
  addReviewComment,
  likeReviewComment,
  getErrandList,
  getErrandChats,
  getErrandChatMessages,
  sendErrandMessage,
  markErrandChatRead,
  getScheduleList,
  syncSchedule,
  submitScheduleCaptcha,
  refreshScheduleCaptcha,
  refreshJwData,
  getJwBindStatus,
  getExamList,
  getGradeList,
  updateScheduleCourse,

  deleteScheduleCourse,

  clearSchedule,

  replaceSchedule,
  getScheduleConfig,
  getCommentList,
  getHomeConfig,
  getCampusCardPages,
  getCampusCardPage,
  createCampusCardPage,
  saveCampusCardPage,
  getDrivingGuidePage,
  createDrivingGuidePage,
  saveDrivingGuidePage,
  getDrivingPromo,
  saveDrivingPromo,
  getDrivingServiceTags,
  saveDrivingServiceTags,
  getMessageBanner,
  saveMessageBanner,
  getPostBanner,
  savePostBanner,
  getDrivingSchools,
  getDrivingSchoolDetail,
  likeComment,
  getTopLikedComment,
  getUserProfile,
  getUserPosts,
  getMyDeletedPosts,
  getMyHiddenPosts,
  unhidePost,
  parseImages,
  favoritePost,
  followPost,
  getFollowedPosts,
  deleteComment,
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
