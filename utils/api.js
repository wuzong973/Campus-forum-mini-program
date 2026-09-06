const request = require("./request");
const mock = require("./mock");
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
  '校园卡': '/assets/icons/svc-card.png',
  '宅印': '/assets/icons/svc-print.png',
  '广轻维修': '/assets/icons/repair-logo.jpg',
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
  '食堂菜单': '/assets/icons/svc-canteen.png',
  '校车时刻': '/assets/icons/svc-bus.png',
  '失物招领': '/assets/icons/svc-search.png',
  '校园地图': '/assets/icons/svc-map.png',
  '通知公告': '/assets/icons/svc-notice.png'
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

function withMock(apiCall, mockData) {
  // Keep the fixture argument for call-site compatibility, but never expose it.
  return apiCall();
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
      .map((item) =>
        typeof item === "string"
          ? item
          : item.type === "video"
            ? ""
            : item.url || item.path || "",
      )
      .filter(isPublicImage);
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

function mapMockPost(post) {
  return mapPost(post);
}

function buildMockProfile(userId) {
  const uid = Number(userId);
  const profile = mock.users.find((item) => item.id === uid) || mock.users[0];
  const userPosts = mock.posts
    .filter((item) => item.userId === profile.id)
    .map(mapMockPost);
  return Object.assign({}, profile, {
    postCount: userPosts.length,
    likeReceived: userPosts.reduce(
      (sum, item) => sum + (item.likeCount || 0),
      0,
    ),
    posts: userPosts,
  });
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

function getPostList(params) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 10;
  const category = params.category || "";
  return withMock(
    () =>
      request
        .get("/post/list", { page, pageSize, category }, true)
        .then((d) => {
          if (!d) return null;
          return {
            list: (d.list || []).map(mapPost),
            total: d.total,
            hasMore: d.hasMore,
          };
        }),
    () => {
      let list = mock.posts;
      if (category && category !== "最新") {
        list = mock.posts.filter((p) => normalizeForumCategory(p.category) === category);
      }
      const start = (page - 1) * pageSize;
      const slice = list.slice(start, start + pageSize);
      return {
        list: slice.map(mapMockPost),
        total: list.length,
        hasMore: start + pageSize < list.length,
      };
    },
  );
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

  return withMock(
    () => request.get("/post/hot-rank", { period, limit }, true).then((d) => ({
      list: (d && d.list ? d.list : []).map((row) => Object.assign(mapPost(row), parseHotMedia(row.images))),
    })),
    () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const ranges = {
        today: [new Date(start.getTime() - 24 * 60 * 60 * 1000), new Date(start.getTime() + 24 * 60 * 60 * 1000)],
        week: [new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000), null],
        month: [new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000), null],
        halfyear: [new Date(start.getTime() - 182 * 24 * 60 * 60 * 1000), null],
        year: [new Date(start.getTime() - 365 * 24 * 60 * 60 * 1000), null],
        history: [null, null],
      };
      const [rangeStart, rangeEnd] = ranges[period] || ranges.today;
      // 昨天 + 今天
      let ranked = mock.posts
          .filter((post) => {
            if (!rangeStart) return true;
            const createdAt = new Date(post.createdAt || post.created_at || 0);
            return createdAt >= rangeStart && (!rangeEnd || createdAt <= rangeEnd);
          })
          .sort((a, b) => Number(b.viewCount || b.view_count || 0) - Number(a.viewCount || a.view_count || 0))
      // 演示数据可能早于设备日期，仍提供一组可查看的榜单。
      if (!ranked.length) {
        ranked = mock.posts.slice().sort((a, b) => Number(b.viewCount || b.view_count || 0) - Number(a.viewCount || a.view_count || 0))
      }
      return { list: ranked.slice(0, limit).map((post) => Object.assign(mapMockPost(post), parseHotMedia(post.images))) };
    },
  );
}

function getPostDetail(id) {
  return withMock(
    () =>
      request
        .get("/post/" + id, {}, true)
        .then((d) => (d ? mapPost(d) : null)),
    () => {
      // 与服务端一致：每次打开详情浏览量 +1
      const post = mock.posts.find((p) => p.id === Number(id));
      if (post) post.viewCount = (Number(post.viewCount) || 0) + 1;
      return mapMockPost(post || mock.posts[0]);
    },
  );
}

function searchPosts(keyword, page = 1, pageSize = 50) {
  return withMock(
    () => request.get('/post/search', { keyword, page, pageSize }, true).then((d) => ({
      list: (d.list || []).map(mapPost), total: d.total, hasMore: d.hasMore
    })),
    () => {
      const value = String(keyword || '').toLowerCase()
      const list = mock.posts.filter((post) => [post.title, post.content, post.category].some((field) => String(field || '').toLowerCase().includes(value))).map(mapMockPost)
      return { list, total: list.length, hasMore: false }
    }
  )
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
        const name = String(item.name || '').trim()
        if (!name || grouped[title].itemNames[name]) return
        grouped[title].itemNames[name] = true
        const rawIconPath = String(item.iconPath || '')
        const rawIcon = String(item.icon || '')
        const iconPath = /^(https?:)?\/\//i.test(rawIconPath) || rawIconPath.indexOf('/') === 0
          ? rawIconPath
          : (rawIconPath.indexOf('assets/') === 0 ? '/' + rawIconPath : '')
        item.iconPath = iconPath || SERVICE_ICON_MAP[name] || ''
        item.icon = item.iconPath ? '' : (rawIcon || rawIconPath)
        item.badge = item.badge || ''
        grouped[title].items.push(item)
      })
    })
    return Object.keys(grouped).map((key) => {
      const section = grouped[key]
      delete section.itemNames
      return section
    })
  }

  return withMock(
    () =>
      request.get("/service/list", {}, false).then((d) => {
        const data = normalizeServiceSections(Array.isArray(d) ? d : []);
        cacheSet(SERVICE_CACHE_KEY, data);
        return data;
      }),
    () => [],
  );
}

function getErrandList(params) {
  return withMock(
    () =>
      request
        .get("/errand/list", params, true)
        .then((d) => d || { list: [], total: 0, hasMore: false }),
    () => {
      let list = mock.errandOrders;
      if (params.type) list = list.filter((o) => o.type === params.type);
      if (params.campus) {
        const campusGroups = {
          '广州校区': ['广州校区', '新港校区', '琶洲校区'],
          '佛山校区': ['佛山校区', '南海南校区', '南海北校区']
        };
        const campuses = campusGroups[params.campus] || [params.campus];
        list = list.filter((o) => campuses.indexOf(o.campus) > -1);
      }
      return { list, total: list.length, hasMore: false };
    },
  );
}

function getScheduleList(options = {}) {
  return withMock(
    () =>
      request
        .get("/schedule/list", {}, true, { silent: !!options.silent })
        .then((d) =>
          (d || []).map((item, index) =>
            scheduleUtils.normalizeCourse(item, index),
          ),
        ),
    () =>
      (wx.getStorageSync("schedule_courses") || []).map((item, index) =>
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

function clearSchedule() {
  return request.post("/schedule/clear", {}, true);
}

function getScheduleConfig() {
  return withMock(
    () => request.get("/schedule/config", {}, true),
    () => {
      const app = getApp();
      return app.globalData.scheduleConfig;
    },
  );
}

// Mock 评论数据（按点赞数降序，用于测试）
const MOCK_COMMENTS = [
  {
    id: 1,
    user_id: 1,
    nick_name: "校园用户",
    content: "这件球衣真的很好看，求链接！",
    created_at: "2026-06-25T10:00:00",
    like_count: 28,
    is_liked: 0,
  },
  {
    id: 2,
    user_id: 2,
    nick_name: "校友",
    content: "同感+1",
    created_at: "2026-06-26T14:30:00",
    like_count: 15,
    is_liked: 0,
  },
  {
    id: 3,
    user_id: 3,
    nick_name: "校园用户",
    content: "拍照技术不错，求带！",
    created_at: "2026-06-27T09:15:00",
    like_count: 8,
    is_liked: 0,
  },
  {
    id: 4,
    user_id: 4,
    nick_name: "路人甲",
    content: "蓝白配色yyds",
    created_at: "2026-06-28T16:00:00",
    like_count: 3,
    is_liked: 0,
  },
  {
    id: 5,
    user_id: 5,
    nick_name: "校园用户",
    content: "1",
    created_at: "2026-06-29T08:00:00",
    like_count: 1,
    is_liked: 0,
  },
];

function getMockComments(postId) {
  const key = "mock_comments_" + postId;
  let comments = wx.getStorageSync(key);
  if (!comments || !comments.length) {
    // 首次加载，写入默认虚拟评论
    comments = MOCK_COMMENTS.map((c) => Object.assign({}, c));
    wx.setStorageSync(key, comments);
  }
  return comments.slice();
}

function getMockLikedComments(postId) {
  return wx.getStorageSync("mock_liked_comments_" + postId) || [];
}

function getCommentList(postId, sort = "hot") {
  return withMock(
    () =>
      request.get("/comment/list", { postId, sort, page: 1, pageSize: 50 }, false),
    () => {
      const comments = getMockComments(postId);
      if (sort === "time") {
        comments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
      } else {
        comments.sort((a, b) => b.like_count - a.like_count || new Date(a.created_at) - new Date(b.created_at));
      }
      const likedIds = getMockLikedComments(postId);
      const list = comments.map((c) => ({
        id: c.id,
        user_id: c.user_id,
        nick_name: c.nick_name,
        avatar_url: c.avatar_url || "",
        content: c.content,
        images: c.images || [],
        created_at: c.created_at,
        like_count: c.like_count,
        is_liked: likedIds.indexOf(c.id) > -1 ? 1 : 0,
      }));
      return { list, total: list.length, hasMore: false };
    },
  );
}

function likeComment(commentId) {
  return withMock(
    () => request.post("/comment/" + commentId + "/like", {}, true),
    () => {
      const postId = getCurrentPostId();
      if (!postId) return { liked: false };
      const likedIds = getMockLikedComments(postId);
      const idx = likedIds.indexOf(commentId);
      let liked;
      if (idx > -1) {
        likedIds.splice(idx, 1);
        liked = false;
      } else {
        likedIds.push(commentId);
        liked = true;
      }
      wx.setStorageSync("mock_liked_comments_" + postId, likedIds);
      // 更新评论点赞数
      const key = "mock_comments_" + postId;
      const comments = wx.getStorageSync(key) || [];
      const comment = comments.find((c) => c.id === commentId);
      if (comment) {
        comment.like_count = Math.max(0, comment.like_count + (liked ? 1 : -1));
        wx.setStorageSync(key, comments);
      }
      return { liked };
    },
  );
}

function getTopLikedComment(postId) {
  return withMock(
    () => request.get("/comment/top-liked", { postId }, false),
    () => {
      const comments = getMockComments(postId);
      if (comments.length && comments[0].like_count > 0) {
        return {
          id: comments[0].id,
          user_id: comments[0].user_id,
          nick_name: comments[0].nick_name,
          avatar_url: comments[0].avatar_url || "",
          content: comments[0].content,
          images: comments[0].images || [],
          like_count: comments[0].like_count,
        };
      }
      return null;
    },
  );
}

// 记录当前帖子ID，用于 mock 点赞时更新对应评论
let _currentPostId = 0;
function setCurrentPostId(id) {
  _currentPostId = id;
}
function getCurrentPostId() {
  return _currentPostId;
}

function getUserProfile(userId) {
  return withMock(
    () => request.get("/user/profile/" + userId, {}, false),
    () => buildMockProfile(userId),
  );
}

function getUserPosts(userId) {
  return withMock(
    () =>
      request
        .get("/user/profile/" + userId + "/posts", {}, false)
        .then((d) => (d.list || []).map(mapPost)),
    () => buildMockProfile(userId).posts,
  );
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
  return withMock(
    () => request.post("/post/" + postId + "/favorite", {}, true),
    () => ({ favorited: true }),
  );
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
  return withMock(
    () => request.get("/user/interactions/stats", {}, true),
    () => {
      const posts = mock.posts || [];
      const comments = wx.getStorageSync("my_comment_records") || [];
      return {
        liked:
          posts.filter((item) => item.isLiked).length ||
          posts.filter((item) => (item.likeCount || 0) > 0).slice(0, 3).length,
        shared: wx.getStorageSync("my_share_records")
          ? (wx.getStorageSync("my_share_records") || []).length
          : posts.filter((item) => (item.shareCount || 0) > 0).slice(0, 2)
              .length,
        commented:
          comments.length ||
          posts.filter((item) => (item.commentCount || 0) > 0).slice(0, 4)
            .length,
        favorited:
          posts.filter((item) => item.isFavorited).length ||
          posts.filter((item) => (item.favoriteCount || 0) > 0).slice(0, 3)
            .length,
      };
    },
  );
}

function getMyInteractionList(type) {
  return withMock(
    () =>
      request.get(
        "/user/interactions/" + type,
        { page: 1, pageSize: 50 },
        true,
      ),
    () => {
      const posts = mock.posts || [];
      const countMap = {
        liked: "likeCount",
        shared: "shareCount",
        commented: "commentCount",
        favorited: "favoriteCount",
      };
      const flagMap = {
        liked: "isLiked",
        favorited: "isFavorited",
      };
      const countKey = countMap[type];
      const flagKey = flagMap[type];
      const list = posts.filter((item) => {
        if (flagKey && item[flagKey]) return true;
        return countKey ? (item[countKey] || 0) > 0 : false;
      });
      return { list, total: list.length };
    },
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
  return withMock(
    () => request.get("/errand/chats", {}, true, { silent: true }).then((d) => d || { list: [] }),
    () => ({ list: [] }),
  );
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

module.exports = {
  getBlacklist,
  unblockUser,
  blockUser,
  bindPhone,
  withMock,
  mapPost,
  getPostList,
  getHotPostRank,
  getPostDetail,
  searchPosts,
  getServiceList,
  getErrandList,
  getErrandChats,
  getErrandChatMessages,
  sendErrandMessage,
  markErrandChatRead,
  getScheduleList,
  syncSchedule,
  submitScheduleCaptcha,
  clearSchedule,
  getScheduleConfig,
  getCommentList,
  getHomeConfig,
  likeComment,
  getTopLikedComment,
  setCurrentPostId,
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
