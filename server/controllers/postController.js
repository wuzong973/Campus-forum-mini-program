const pool = require("../config/pool");
const { success, fail } = require("../middleware/auth");
const { parseImages, clampPageSize, safeMessage } = require("../utils/helpers");
const { createNotification } = require('../services/notificationService');
const { writeAdminAudit } = require('../utils/adminAudit');

const FORUM_CATEGORY_MAP = {
  '推荐': '日常话题',
  '日常分享': '日常话题',
  '校园活动': '日常话题',
  '打听求助': '日常话题',
  '学习经验': '日常话题',
  '二手': '二手闲置',
  '旧书交易': '二手闲置',
  '吃瓜爆料': '树洞吐槽'
};

function normalizeForumCategory(category) {
  return FORUM_CATEGORY_MAP[category] || category || '日常话题';
}

function categoryValues(category) {
  const target = String(category || '').trim();
  if (!target || target === '最新') return [];
  const legacy = Object.keys(FORUM_CATEGORY_MAP).filter((key) => FORUM_CATEGORY_MAP[key] === target);
  return [target].concat(legacy);
}

function parseContact(contact) {
  if (!contact) return null;
  let value = contact;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (!value.name || !value.type || !value.value) return null;
  return { name: String(value.name), type: String(value.type), value: String(value.value) };
}

function mapPost(r, userId, includeContact = false) {
  const post = {
    id: r.id,
    userId: r.user_id,
    nickName: r.nick_name || '校园同学',
    avatarUrl: r.avatar_url,
    campus: r.campus || "",
    title: r.title || "",
    category: normalizeForumCategory(r.category),
    content: r.content,
    images: parseImages(r.images),
    likeCount: r.like_count,
    commentCount: r.comment_count,
    favoriteCount: r.favorite_count,
    shareCount: r.share_count || 0,
    viewCount: r.view_count || 0,
    verified: !!r.is_verified,
    certLabel: r.cert_label || '',
    postCount: r.post_count || 0,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    reviewNote: r.review_note || '',
    createdAt: r.created_at,
  };
  if (includeContact) post.contact = parseContact(r.contact);
  return post;
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
    const categoryFilter = categoryValues(category);
    if (categoryFilter.length) {
      where += ` AND p.category IN (${categoryFilter.map(() => '?').join(', ')})`;
      params.push(...categoryFilter);
    }
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM forum_post p ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
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
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id WHERE p.id = ? AND p.status = 1`,
      [userId, userId, req.params.id],
    );
    if (!rows.length) return fail(res, "帖子不存在", 404);
    if (userId && Number(rows[0].user_id) !== Number(userId)) {
      const [record] = await pool.query(
        'INSERT IGNORE INTO post_view (post_id, user_id) VALUES (?, ?)',
        [rows[0].id, userId],
      );
      if (record.affectedRows) {
        await pool.query('UPDATE forum_post SET view_count = view_count + 1 WHERE id = ?', [rows[0].id]);
        rows[0].view_count += 1;
      }
    }
    success(res, mapPost(rows[0], userId, true));
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.search = async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = clampPageSize(req.query.pageSize);
  const offset = (page - 1) * pageSize;
  const userId = req.userId || 0;
  if (!keyword) return fail(res, '请输入搜索关键词');
  try {
    const like = `%${keyword}%`;
    const where = 'WHERE p.status = 1 AND (p.title LIKE ? OR p.content LIKE ? OR p.category LIKE ?)';
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM forum_post p ${where}`, [like, like, like]);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id ${where}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [userId, userId, like, like, like, pageSize, offset],
    );
    success(res, { list: rows.map((row) => mapPost(row, userId)), total: count.total, hasMore: offset + pageSize < count.total });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.create = async (req, res) => {
  const { title, category, content, images, videos, contact } = req.body;
  if (typeof title === 'string' && title.trim().length > 128) return fail(res, '标题不能超过128个字符');
  if (typeof content === 'string' && content.trim().length > 2500) return fail(res, '内容不能超过2500个字符');
  if (videos !== undefined && (!Array.isArray(videos) || videos.some((url) => typeof url !== 'string' || !/^https:\/\//.test(url)))) return fail(res, '视频必须先上传并完成安全审核');
  if (!content || !content.trim()) return fail(res, "内容不能为空");
  const normalizedContact = parseContact(contact);
  if (contact && !normalizedContact) return fail(res, '联系方式格式不正确');
  if (normalizedContact && !['手机号码', '微信账号', 'QQ账号'].includes(normalizedContact.type)) return fail(res, '不支持的联系方式类型');
  try {
    const media = (images || []).concat(
      (videos || []).map((url) => ({ type: "video", url })),
    );
    const [result] = await pool.query(
      "INSERT INTO forum_post (user_id, title, category, content, images, contact) VALUES (?, ?, ?, ?, ?, ?)",
      [
        req.userId,
        (title || "").trim().slice(0, 128),
        category || "日常生活",
        content.trim(),
        JSON.stringify(media),
        normalizedContact ? JSON.stringify(normalizedContact) : null,
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

exports.updateReviewNote = async (req, res) => {
  const postId = Number(req.params.id);
  const reviewNote = String((req.body || {}).reviewNote || '').trim();
  if (!Number.isInteger(postId) || postId <= 0) return fail(res, '帖子不存在', 404);
  if (!reviewNote || reviewNote.length > 255) return fail(res, '备注需在 1 到 255 个字符之间');
  try {
    const [result] = await pool.query(
      'UPDATE forum_post SET review_note = ? WHERE id = ?',
      [reviewNote, postId],
    );
    if (!result.affectedRows) return fail(res, '帖子不存在', 404);
    try {
      await writeAdminAudit(req, 'post.review_note', 'post', postId, { reviewNote });
    } catch (auditError) {
      console.error('[admin-audit]', auditError.message);
    }
    success(res, { reviewNote });
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
      const [posts] = await pool.query('SELECT user_id, title FROM forum_post WHERE id = ?', [req.params.id]);
      if (posts.length && Number(posts[0].user_id) !== Number(req.userId)) {
        createNotification({ userId: posts[0].user_id, type: 'like', title: '你的帖子收到了点赞', content: posts[0].title || '帖子被点赞', relatedId: req.params.id }).catch(() => {});
      }
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
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1 ORDER BY p.like_count DESC LIMIT 10`,
    );
    success(
      res,
      rows.map((item) => mapPost(item, req.userId || 0)),
    );
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.hotRank = async (req, res) => {
  const period = req.query.period === 'yesterday' ? 'yesterday' : 'today';
  const timeFilter = period === 'yesterday'
    ? "p.created_at >= CURDATE() - INTERVAL 1 DAY AND p.created_at <= CURDATE() - INTERVAL 1 DAY + INTERVAL 20 HOUR"
    : "p.created_at >= CURDATE() AND p.created_at < CURDATE() + INTERVAL 1 DAY";
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1 AND ${timeFilter}
       ORDER BY p.view_count DESC, p.created_at DESC LIMIT 10`,
    );
    success(res, { list: rows.map((item) => mapPost(item, req.userId || 0)), period });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
