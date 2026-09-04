const pool = require("../config/pool");
const { success, fail, hasPermission } = require("../middleware/auth");
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

function hiddenPostFilter(userId) {
  if (!userId) return { clause: '', params: [] };
  return {
    clause: ` AND NOT EXISTS (
      SELECT 1 FROM post_hidden_preference hp
      WHERE hp.user_id = ? AND (hp.post_id = p.id OR hp.category = p.category)
    )`,
    params: [userId],
  };
}

function canManagePost(req) {
  return !!(req.user && hasPermission(req.user.role, 'content.manage'));
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

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function parseAnonymousIdentity(identity) {
  const value = parseJson(identity, null);
  if (!value || !value.nickName || !value.avatarUrl) return null;
  const avatarUrl = String(value.avatarUrl).trim();
  // Anonymous artwork is bundled in the mini program and must not be an arbitrary remote URL.
  if (!avatarUrl.startsWith('/avatar1/')) return null;
  return { nickName: String(value.nickName).trim().slice(0, 32), avatarUrl };
}

function parseComponents(components) {
  const value = parseJson(components, []);
  return Array.isArray(value) ? value : [];
}

function normalizeComponents(components) {
  const input = parseComponents(components);
  const normalized = [];
  const poll = input.find((item) => item && item.type === 'poll');
  if (poll) {
    const options = (Array.isArray(poll.options) ? poll.options : []).map((item) => ({ text: String((item || {}).text || '').trim().slice(0, 80), votes: Number((item || {}).votes) || 0 })).filter((item) => item.text);
    if (!String(poll.question || '').trim() || options.length < 2 || options.length > 8 || !['single', 'multiple'].includes(poll.mode)) throw new Error('投票组件格式不正确');
    normalized.push({ type: 'poll', question: String(poll.question).trim().slice(0, 80), mode: poll.mode, options, voterIds: [] });
  }
  const gathering = input.find((item) => item && item.type === 'gathering');
  if (gathering) {
    const required = ['activityType', 'date', 'time', 'location'];
    if (required.some((key) => !String(gathering[key] || '').trim())) throw new Error('组局组件信息不完整');
    normalized.push({ type: 'gathering', activityType: String(gathering.activityType).trim().slice(0, 32), date: String(gathering.date).slice(0, 16), time: String(gathering.time).slice(0, 8), location: String(gathering.location).trim().slice(0, 128), limit: Math.max(2, Math.min(999, Number(gathering.limit) || 2)), contact: gathering.contactPublic ? String(gathering.contact || '').trim().slice(0, 64) : '', contactPublic: !!gathering.contactPublic, description: String(gathering.description || '').trim().slice(0, 240), participants: [] });
  }
  if (input.length !== normalized.length) throw new Error('不支持的帖子组件');
  return normalized;
}

function presentComponents(components, userId) {
  return parseComponents(components).map((component) => {
    if (component.type === 'poll') {
      const voterIds = Array.isArray(component.voterIds) ? component.voterIds : [];
      const selected = voterIds.find((record) => Number(record.userId) === Number(userId));
      return Object.assign({}, component, { selectedOptionIndexes: selected ? selected.optionIndexes : [], voterIds: undefined });
    }
    return component;
  });
}

function mapPost(r, userId, includeContact = false) {
  const anonymousIdentity = parseAnonymousIdentity(r.anonymous_identity);
  const post = {
    id: r.id,
    userId: r.user_id,
    nickName: anonymousIdentity ? anonymousIdentity.nickName : (r.nick_name || '校园同学'),
    avatarUrl: anonymousIdentity ? anonymousIdentity.avatarUrl : r.avatar_url,
    campus: anonymousIdentity ? '' : (r.campus || ""),
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
    components: presentComponents(r.components, userId),
    isAnonymous: !!anonymousIdentity,
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
    const hidden = hiddenPostFilter(userId);
    where += hidden.clause;
    params.push(...hidden.params);
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
    const hidden = hiddenPostFilter(userId);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id WHERE p.id = ? AND p.status = 1${hidden.clause}`,
      [userId, userId, req.params.id].concat(hidden.params),
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
    const hidden = hiddenPostFilter(userId);
    const where = 'WHERE p.status = 1 AND (p.title LIKE ? OR p.content LIKE ? OR p.category LIKE ?)' + hidden.clause;
    const queryParams = [like, like, like].concat(hidden.params);
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM forum_post p ${where}`, queryParams);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id ${where}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [userId, userId].concat(queryParams, [pageSize, offset]),
    );
    success(res, { list: rows.map((row) => mapPost(row, userId)), total: count.total, hasMore: offset + pageSize < count.total });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.create = async (req, res) => {
  const { title, category, content, images, videos, contact, anonymousIdentity, components } = req.body;
  if (typeof title === 'string' && title.trim().length > 128) return fail(res, '标题不能超过128个字符');
  if (typeof content === 'string' && content.trim().length > 2500) return fail(res, '内容不能超过2500个字符');
  if (videos !== undefined && (!Array.isArray(videos) || videos.some((url) => typeof url !== 'string' || !/^https:\/\//.test(url)))) return fail(res, '视频必须先上传并完成安全审核');
  if (!content || !content.trim()) return fail(res, "内容不能为空");
  const normalizedContact = parseContact(contact);
  if (contact && !normalizedContact) return fail(res, '联系方式格式不正确');
  if (normalizedContact && !['手机号码', '微信账号', 'QQ账号'].includes(normalizedContact.type)) return fail(res, '不支持的联系方式类型');
  try {
    const normalizedAnonymousIdentity = parseAnonymousIdentity(anonymousIdentity);
    if (anonymousIdentity && !normalizedAnonymousIdentity) return fail(res, '匿名身份格式不正确');
    const normalizedComponents = normalizeComponents(components);
    const media = (images || []).concat(
      (videos || []).map((url) => ({ type: "video", url })),
    );
    const [result] = await pool.query(
      "INSERT INTO forum_post (user_id, title, category, content, images, contact, anonymous_identity, components) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        req.userId,
        (title || "").trim().slice(0, 128),
        category || "日常生活",
        content.trim(),
        JSON.stringify(media),
        normalizedContact ? JSON.stringify(normalizedContact) : null,
        normalizedAnonymousIdentity ? JSON.stringify(normalizedAnonymousIdentity) : null,
        normalizedComponents.length ? JSON.stringify(normalizedComponents) : null,
      ],
    );
    success(res, { id: result.insertId });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.vote = async (req, res) => {
  const postId = Number(req.params.id);
  const optionIndexes = Array.isArray(req.body.optionIndexes) ? req.body.optionIndexes.map(Number) : [];
  if (!postId || !optionIndexes.length) return fail(res, '请选择投票选项');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT components FROM forum_post WHERE id = ? AND status = 1 FOR UPDATE', [postId]);
    if (!rows.length) throw new Error('帖子不存在');
    const components = parseComponents(rows[0].components);
    const poll = components.find((item) => item.type === 'poll');
    if (!poll) throw new Error('投票不存在');
    const validIndexes = [...new Set(optionIndexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < poll.options.length);
    if (!validIndexes.length || (poll.mode === 'single' && validIndexes.length !== 1)) throw new Error('投票选项不正确');
    poll.voterIds = Array.isArray(poll.voterIds) ? poll.voterIds : [];
    if (poll.voterIds.some((record) => Number(record.userId) === Number(req.userId))) throw new Error('你已经投过票了');
    validIndexes.forEach((index) => { poll.options[index].votes = (Number(poll.options[index].votes) || 0) + 1; });
    poll.voterIds.push({ userId: req.userId, optionIndexes: validIndexes });
    await conn.query('UPDATE forum_post SET components = ? WHERE id = ?', [JSON.stringify(components), postId]);
    await conn.commit();
    success(res, { components: presentComponents(components, req.userId) });
  } catch (e) { await conn.rollback(); fail(res, safeMessage(e), e.message === '帖子不存在' ? 404 : 400); } finally { conn.release(); }
};

exports.signUpGathering = async (req, res) => {
  const postId = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT p.components, u.nick_name FROM forum_post p LEFT JOIN sys_user u ON u.id = ? WHERE p.id = ? AND p.status = 1 FOR UPDATE', [req.userId, postId]);
    if (!rows.length) throw new Error('帖子不存在');
    const components = parseComponents(rows[0].components);
    const gathering = components.find((item) => item.type === 'gathering');
    if (!gathering) throw new Error('组局不存在');
    gathering.participants = Array.isArray(gathering.participants) ? gathering.participants : [];
    if (gathering.participants.some((record) => Number(record.userId) === Number(req.userId))) throw new Error('你已报名');
    if (gathering.participants.length >= Number(gathering.limit)) throw new Error('报名人数已满');
    gathering.participants.push({ userId: req.userId, nickName: rows[0].nick_name || '校园同学' });
    await conn.query('UPDATE forum_post SET components = ? WHERE id = ?', [JSON.stringify(components), postId]);
    await conn.commit();
    success(res, { components: presentComponents(components, req.userId) });
  } catch (e) { await conn.rollback(); fail(res, safeMessage(e), e.message === '帖子不存在' ? 404 : 400); } finally { conn.release(); }
};

exports.remove = async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return fail(res, '帖子不存在', 404);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [posts] = await conn.query('SELECT user_id FROM forum_post WHERE id = ? FOR UPDATE', [postId]);
    if (!posts.length) {
      await conn.rollback();
      return fail(res, '帖子不存在', 404);
    }
    if (Number(posts[0].user_id) !== Number(req.userId) && !canManagePost(req)) {
      await conn.rollback();
      return fail(res, '无权删除该帖子', 403);
    }
    await conn.query('DELETE cl FROM forum_comment_like cl INNER JOIN forum_comment c ON c.id = cl.comment_id WHERE c.post_id = ?', [postId]);
    await conn.query('DELETE FROM forum_comment WHERE post_id = ?', [postId]);
    await conn.query('DELETE FROM forum_like WHERE post_id = ?', [postId]);
    await conn.query('DELETE FROM forum_favorite WHERE post_id = ?', [postId]);
    await conn.query('DELETE FROM forum_share WHERE post_id = ?', [postId]);
    await conn.query('DELETE FROM post_view WHERE post_id = ?', [postId]);
    await conn.query('DELETE FROM post_hidden_preference WHERE post_id = ?', [postId]);
    const [result] = await conn.query('DELETE FROM forum_post WHERE id = ?', [postId]);
    if (!result.affectedRows) throw new Error('帖子删除失败');
    await conn.commit();
    if (canManagePost(req)) {
      try {
        await writeAdminAudit(req, 'post.delete', 'post', postId, {});
      } catch (auditError) {
        console.error('[admin-audit]', auditError.message);
      }
    }
    success(res, null);
  } catch (e) {
    await conn.rollback();
    fail(res, safeMessage(e), 500);
  } finally {
    conn.release();
  }
};

exports.hideAsNotInterested = async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return fail(res, '帖子不存在', 404);
  try {
    const [posts] = await pool.query('SELECT id, category FROM forum_post WHERE id = ? AND status = 1', [postId]);
    if (!posts.length) return fail(res, '帖子不存在', 404);
    const category = posts[0].category || '';
    await pool.query(
      `INSERT INTO post_hidden_preference (user_id, post_id, category)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE category = VALUES(category), created_at = CURRENT_TIMESTAMP`,
      [req.userId, postId, category],
    );
    if (canManagePost(req)) {
      try {
        await writeAdminAudit(req, 'post.not_interested', 'post', postId, { category });
      } catch (auditError) {
        console.error('[admin-audit]', auditError.message);
      }
    }
    success(res, { postId, category });
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
    const hidden = hiddenPostFilter(req.userId || 0);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1${hidden.clause} ORDER BY p.like_count DESC LIMIT 10`,
      hidden.params,
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
    const hidden = hiddenPostFilter(req.userId || 0);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1 AND ${timeFilter}${hidden.clause}
       ORDER BY p.view_count DESC, p.created_at DESC LIMIT 10`,
      hidden.params,
    );
    success(res, { list: rows.map((item) => mapPost(item, req.userId || 0)), period });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
