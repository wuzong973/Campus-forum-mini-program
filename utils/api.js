const request = require("./request");
const mock = require("./mock");
const scheduleUtils = require("./schedule");

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
    // Temporary wxfile/http://tmp URLs and the server's local upload path are
    // not downloadable by clients in the deployed environment.
    return /^https:\/\//i.test(url) && !/\/uploads\//i.test(url)
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

function mapPost(r) {
  const userId = r.userId || r.user_id;
  const avatarUrl = String(r.avatarUrl || r.avatar_url || '').trim()
  return {
    id: r.id,
    userId,
    nickName: String(r.nickName || r.nick_name || "校园同学"),
    avatarUrl: /^https:\/\//i.test(avatarUrl) && !/\/uploads\//i.test(avatarUrl) ? avatarUrl : "",
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
    shareCount: r.shareCount || r.share_count || 0,
    verified: !!(r.verified || r.isVerified || r.is_verified),
    certLabel: r.certLabel || r.cert_label || "",
    postCount: r.postCount || r.post_count || 0,
    isHot: !!r.isHot,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    reviewNote: r.reviewNote || r.review_note || "",
    contact: parseContact(r.contact),
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

function getPostList(params) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 10;
  const category = params.category || "";
  return withMock(
    () =>
      request
        .get("/post/list", { page, pageSize, category }, false)
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

function getHotPostRank(period = "today") {
  return withMock(
    () => request.get("/post/hot-rank", { period }, false).then((d) => ({
      list: (d && d.list ? d.list : []).map(mapPost),
    })),
    () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let rangeStart = start;
      let rangeEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      if (period === "yesterday") {
        rangeStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
        rangeEnd = new Date(rangeStart.getTime());
        rangeEnd.setHours(20, 0, 0, 0);
      }
      let ranked = mock.posts
          .filter((post) => {
            const createdAt = new Date(post.createdAt || post.created_at || 0);
            return createdAt >= rangeStart && createdAt <= rangeEnd;
          })
          .sort((a, b) => Number(b.viewCount || b.view_count || 0) - Number(a.viewCount || a.view_count || 0))
      // 演示数据可能早于设备日期，仍提供一组可查看的榜单。
      if (!ranked.length) {
        ranked = mock.posts.slice().sort((a, b) => Number(b.viewCount || b.view_count || 0) - Number(a.viewCount || a.view_count || 0))
      }
      return { list: ranked.slice(0, 10).map(mapMockPost) };
    },
  );
}

function getPostDetail(id) {
  return withMock(
    () =>
      request
        .get("/post/" + id, {}, false)
        .then((d) => (d ? mapPost(d) : null)),
    () =>
      mapMockPost(mock.posts.find((p) => p.id === Number(id)) || mock.posts[0]),
  );
}

function searchPosts(keyword, page = 1, pageSize = 50) {
  return withMock(
    () => request.get('/post/search', { keyword, page, pageSize }, false).then((d) => ({
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
        .get("/errand/list", params, false)
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

function favoritePost(postId) {
  return withMock(
    () => request.post("/post/" + postId + "/favorite", {}, true),
    () => ({ favorited: true }),
  );
}

function updatePostReviewNote(postId, reviewNote) {
  return request.post("/post/" + postId + "/review-note", { reviewNote }, true);
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

module.exports = {
  withMock,
  mapPost,
  getPostList,
  getHotPostRank,
  getPostDetail,
  searchPosts,
  getServiceList,
  getErrandList,
  getScheduleList,
  syncSchedule,
  submitScheduleCaptcha,
  clearSchedule,
  getScheduleConfig,
  getCommentList,
  likeComment,
  getTopLikedComment,
  setCurrentPostId,
  getUserProfile,
  getUserPosts,
  favoritePost,
  updatePostReviewNote,
  getMyInteractionStats,
  getMyInteractionList,
  createShare,
  getShareList,
  normalizePost: mapPost,
};
