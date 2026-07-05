const request = require("./request");
const mock = require("./mock");
const scheduleUtils = require("./schedule");

// 通用本地缓存：减少首屏请求，缓存命中时先返回再静默刷新
function cacheGet(key, ttl) {
  try {
    const v = wx.getStorageSync(key);
    if (v && v.ts && Date.now() - v.ts < ttl) return v.data;
  } catch (e) {}
  return null;
}

function cacheSet(key, data) {
  try {
    wx.setStorageSync(key, { data, ts: Date.now() });
  } catch (e) {}
}

const SERVICE_CACHE_KEY = "service_list_cache";
const SERVICE_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

function withMock(apiCall, mockData) {
  if (request.USE_MOCK) {
    return Promise.resolve(
      typeof mockData === "function" ? mockData() : mockData,
    );
  }
  return apiCall()
    .then((data) => {
      if (data !== null && data !== undefined) return data;
      return typeof mockData === "function" ? mockData() : mockData;
    })
    .catch(() => (typeof mockData === "function" ? mockData() : mockData));
}

function parseImages(images) {
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
      .filter(Boolean);
  }
  if (typeof images === "string") {
    try {
      return parseImages(JSON.parse(images));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function mapPost(r) {
  return {
    id: r.id,
    userId: r.userId || r.user_id,
    nickName: r.nickName || r.nick_name,
    avatarUrl: r.avatarUrl || r.avatar_url || "",
    title: r.title || "",
    gender: r.gender,
    category: r.category,
    content: r.content,
    images: parseImages(r.images),
    viewCount: r.viewCount || r.view_count || 0,
    likeCount: r.likeCount || r.like_count || 0,
    commentCount: r.commentCount || r.comment_count || 0,
    favoriteCount: r.favoriteCount || r.favorite_count || 0,
    shareCount: r.shareCount || r.share_count || 0,
    verified: !!(r.verified || r.isVerified || r.is_verified),
    postCount: r.postCount || r.post_count || 0,
    isHot: !!r.isHot,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
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
      if (category && category !== "全部帖子") {
        list = mock.posts.filter((p) => p.category === category);
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

function getServiceList() {
  return withMock(
    () =>
      request.get("/service/list", {}, false).then((d) => {
        const data = d || mock.allServiceSections;
        cacheSet(SERVICE_CACHE_KEY, data);
        return data;
      }),
    () => {
      const cached = cacheGet(SERVICE_CACHE_KEY, SERVICE_CACHE_TTL);
      return cached || mock.allServiceSections;
    },
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
      if (params.campus) list = list.filter((o) => o.campus === params.campus);
      return { list, total: list.length, hasMore: false };
    },
  );
}

function getScheduleList() {
  return withMock(
    () =>
      request
        .get("/schedule/list", {}, true)
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
    nick_name: "校园用户",
    content: "这件球衣真的很好看，求链接！",
    created_at: "2026-06-25T10:00:00",
    like_count: 28,
    is_liked: 0,
  },
  {
    id: 2,
    nick_name: "校友",
    content: "同感+1",
    created_at: "2026-06-26T14:30:00",
    like_count: 15,
    is_liked: 0,
  },
  {
    id: 3,
    nick_name: "校园用户",
    content: "拍照技术不错，求带！",
    created_at: "2026-06-27T09:15:00",
    like_count: 8,
    is_liked: 0,
  },
  {
    id: 4,
    nick_name: "路人甲",
    content: "蓝白配色yyds",
    created_at: "2026-06-28T16:00:00",
    like_count: 3,
    is_liked: 0,
  },
  {
    id: 5,
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
  // 按点赞数降序排列
  comments.sort((a, b) => b.like_count - a.like_count);
  return comments;
}

function getMockLikedComments(postId) {
  return wx.getStorageSync("mock_liked_comments_" + postId) || [];
}

function getCommentList(postId) {
  return withMock(
    () =>
      request.get("/comment/list", { postId, page: 1, pageSize: 50 }, false),
    () => {
      const comments = getMockComments(postId);
      const likedIds = getMockLikedComments(postId);
      const list = comments.map((c) => ({
        id: c.id,
        nick_name: c.nick_name,
        content: c.content,
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
          nick_name: comments[0].nick_name,
          avatar_url: "",
          content: comments[0].content,
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
  getPostDetail,
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
  getMyInteractionStats,
  getMyInteractionList,
  createShare,
  getShareList,
};
