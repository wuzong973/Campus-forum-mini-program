const pool = require("../config/pool");
const { success, fail } = require("../middleware/auth");
const { parseImages, clampPageSize, safeMessage } = require("../utils/helpers");

function mapPost(r, userId) {
  return {
    id: r.id,
    userId: r.user_id,
    nickName: r.nick_name,
    avatarUrl: r.avatar_url,
    title: r.title || "",
    category: r.category,
    content: r.content,
    images: parseImages(r.images),
    likeCount: r.like_count,
    commentCount: r.comment_count,
    favoriteCount: r.favorite_count,
    shareCount: r.share_count || 0,
    verified: !!r.is_verified,
    followerCount: r.follower_count || 0,
    postCount: r.post_count || 0,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    createdAt: r.created_at
  };
}

exports.list = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const pageSize = clampPageSize(req.query.pageSize);
  const category = req.query.category || "";
  const offset = (page - 1) * pageSize;
  const userId = req.userId || 0;
  try {
    let where = "WHERE p.status = 1";
    const params = [];
    if (category && category !== "全部帖子") {
      where += " AND p.category = ?";
      params.push(category);
    }
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM forum_post p ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.is_verified,
        IFNULL((SELECT COUNT(*) FROM user_follow uf WHERE uf.followee_id = p.user_id), 0) AS follower_count,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [userId, userId].concat(params, [pageSize, offset]),
    );
    const total = countRows[0].total;
    success(res, {
      list: rows.map((r) => mapPost(r, userId)),
      total,
      hasMore: offset + pageSize < total,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.detail = async (req, res) => {
  const userId = req.userId || 0;
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.is_verified,
        IFNULL((SELECT COUNT(*) FROM user_follow uf WHERE uf.followee_id = p.user_id), 0) AS follower_count,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id WHERE p.id = ? AND p.status = 1`,
      [userId, userId, req.params.id],
    );
    if (!rows.length) return fail(res, "帖子不存在", 404);
    success(res, mapPost(rows[0], userId));
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.create = async (req, res) => {
  const { title, category, content, images, videos } = req.body;
  if (!content || !content.trim()) return fail(res, "内容不能为空");
  try {
    const media = (images || []).concat((videos || []).map((url) => ({ type: "video", url })));
    const [result] = await pool.query(
      "INSERT INTO forum_post (user_id, title, category, content, images) VALUES (?, ?, ?, ?, ?)",
      [
        req.userId,
        (title || "").trim().slice(0, 128),
        category || "日常生活",
        content.trim(),
        JSON.stringify(media),
      ],
    );
    success(res, { id: result.insertId });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE forum_post SET status = 0 WHERE id = ? AND user_id = ?",
      [req.params.id, req.userId],
    );
    if (!result.affectedRows) return fail(res, "无权删除或帖子不存在", 403);
    success(res, null);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.like = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query(
      "SELECT id FROM forum_like WHERE post_id = ? AND user_id = ?",
      [req.params.id, req.userId],
    );
    if (exist.length) {
      await conn.query(
        "DELETE FROM forum_like WHERE post_id = ? AND user_id = ?",
        [req.params.id, req.userId],
      );
      await conn.query(
        "UPDATE forum_post SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?",
        [req.params.id],
      );
      await conn.commit();
      success(res, { liked: false });
    } else {
      await conn.query(
        "INSERT INTO forum_like (post_id, user_id) VALUES (?, ?)",
        [req.params.id, req.userId],
      );
      await conn.query(
        "UPDATE forum_post SET like_count = like_count + 1 WHERE id = ?",
        [req.params.id],
      );
      await conn.commit();
      success(res, { liked: true });
    }
  } catch (e) {
    await conn.rollback();
    fail(res, safeMessage(e), 500);
  } finally {
    conn.release();
  }
};

exports.favorite = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query(
      "SELECT id FROM forum_favorite WHERE post_id = ? AND user_id = ?",
      [req.params.id, req.userId],
    );
    if (exist.length) {
      await conn.query(
        "DELETE FROM forum_favorite WHERE post_id = ? AND user_id = ?",
        [req.params.id, req.userId],
      );
      await conn.query(
        "UPDATE forum_post SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?",
        [req.params.id],
      );
      await conn.commit();
      success(res, { favorited: false });
    } else {
      await conn.query(
        "INSERT INTO forum_favorite (post_id, user_id) VALUES (?, ?)",
        [req.params.id, req.userId],
      );
      await conn.query(
        "UPDATE forum_post SET favorite_count = favorite_count + 1 WHERE id = ?",
        [req.params.id],
      );
      await conn.commit();
      success(res, { favorited: true });
    }
  } catch (e) {
    await conn.rollback();
    fail(res, safeMessage(e), 500);
  } finally {
    conn.release();
  }
};

exports.hot = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.is_verified,
        IFNULL((SELECT COUNT(*) FROM user_follow uf WHERE uf.followee_id = p.user_id), 0) AS follower_count,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1 ORDER BY p.like_count DESC LIMIT 10`,
    );
    success(res, rows.map((item) => mapPost(item, req.userId || 0)));
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
