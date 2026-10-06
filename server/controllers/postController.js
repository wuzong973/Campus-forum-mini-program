const pool = require("../config/pool");
const { success, fail, hasPermission } = require("../middleware/auth");
const { parseImages, clampPageSize, safeMessage } = require("../utils/helpers");
const { createNotification } = require('../services/notificationService');
const { writeAdminAudit } = require('../utils/adminAudit');
// 异步内容安全检测判违规的图片地址，在所有读取出口统一过滤（P02/P14）
const mediaCheck = require('../services/mediaCheckService');
// 兼容重命名前的旧头像路径，避免真机渲染空白（详见 utils/defaultProfile.js）
const { normalizeLegacyAvatarUrl, normalizeAnonymousAvatarUrl, isAnonymousAvatarUrl, pickAnonymousAvatar } = require('../utils/defaultProfile');

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

// 「最新」流排除的分类（含旧分类名）：只在其对应分类页展示
const LATEST_EXCLUDED_CATEGORY = '二手闲置';
const LATEST_EXCLUDED_VALUES = categoryValues(LATEST_EXCLUDED_CATEGORY);

function hiddenPostFilter(userId) {
  if (!userId) return { clause: '', params: [] };
  return {
    clause: ` AND NOT EXISTS (
      SELECT 1 FROM post_hidden_preference hp
      WHERE hp.user_id = ? AND (hp.post_id = p.id OR (hp.category <> '' AND hp.category = p.category))
    )
    AND p.user_id NOT IN (SELECT ub.blocked_id FROM user_blacklist ub WHERE ub.user_id = ?)`,
    params: [userId, userId],
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
  const nickName = String(value.nickName).trim().slice(0, 32);
  const raw = String(value.avatarUrl).trim();
  // Anonymous artwork is bundled in the mini program and must not be an arbitrary remote URL.
  if (raw.indexOf('/assets/avatar1/') !== 0) return null;
  // 旧文件名（含空格与半角括号，真机解析失败）先纠正；纠正后仍不在素材池内的
  // 历史脏数据稳定映射到池内形象，避免渲染层持续报「Failed to load image」
  const normalized = normalizeAnonymousAvatarUrl(raw);
  const avatarUrl = isAnonymousAvatarUrl(normalized) ? normalized : pickAnonymousAvatar(nickName || raw);
  return { nickName, avatarUrl };
}

function parseComponents(components) {
  const value = parseJson(components, []);
  return Array.isArray(value) ? value : [];
}

function normalizeComponents(components) {
  const input = parseComponents(components);
  const normalized = [];
  // 支持一帖最多3个投票组件
  const polls = input.filter((item) => item && item.type === 'poll');
  if (polls.length > 3) throw new Error('最多可添加3个投票组件');
  polls.forEach((poll) => {
    const options = (Array.isArray(poll.options) ? poll.options : []).map((item) => ({ text: String((item || {}).text || '').trim().slice(0, 80), votes: Number((item || {}).votes) || 0 })).filter((item) => item.text);
    if (!String(poll.question || '').trim() || options.length < 2 || options.length > 8 || !['single', 'multiple'].includes(poll.mode)) throw new Error('投票组件格式不正确');
    normalized.push({ type: 'poll', question: String(poll.question).trim().slice(0, 80), mode: poll.mode, options, voterIds: [] });
  });
  if (input.length !== normalized.length) throw new Error('不支持的帖子组件');
  return normalized;
}

function presentComponents(components, userId) {
  return parseComponents(components).map((component, index) => {
    // _key 用于前端列表渲染的唯一键（一帖可含多个投票）
    const base = Object.assign({}, component, { _key: component.type + '-' + index });
    if (base.type === 'poll') {
      const voterIds = Array.isArray(base.voterIds) ? base.voterIds : [];
      const selected = voterIds.find((record) => Number(record.userId) === Number(userId));
      base.selectedOptionIndexes = selected ? selected.optionIndexes : [];
      base.voterIds = undefined;
    }
    return base;
  });
}

// 供 userController.mapProfilePost 复用：主页帖子卡片也要下发投票等组件的渲染视图
exports.presentComponents = presentComponents;

function mapPost(r, userId, includeContact = false) {
  const anonymousIdentity = parseAnonymousIdentity(r.anonymous_identity);
  const post = {
    id: r.id,
    userId: r.user_id,
    nickName: anonymousIdentity ? anonymousIdentity.nickName : (r.nick_name || '校园同学'),
    avatarUrl: anonymousIdentity ? anonymousIdentity.avatarUrl : normalizeLegacyAvatarUrl(r.avatar_url),
    // 校区与普通帖一致：直接取用户设置的校区（匿名不隐藏校区，与列表/详情/热榜渲染口径统一）。
    // 未设置校区时与普通帖一样返回空串，由客户端统一显示「未设置校区」。
    campus: r.campus || "",
    title: r.title || "",
    category: normalizeForumCategory(r.category),
    content: r.content,
    images: mediaCheck.filterStoredImages(parseImages(r.images)),
    likeCount: r.like_count,
    commentCount: r.comment_count,
    favoriteCount: r.favorite_count,
    followCount: r.follow_count || 0,
    shareCount: r.share_count || 0,
    viewCount: r.view_count || 0,
    verified: !!r.is_verified,
    certLabel: r.cert_label || '',
    // 旧查询/客户端缓存可能没有该列，缺省视为允许
    allowAnonymousPm: r.allow_anonymous_pm === undefined ? true : !!r.allow_anonymous_pm,
    postCount: r.post_count || 0,
    isLiked: !!r.isLiked,
    isFavorited: !!r.isFavorited,
    isFollowed: !!r.isFollowed,
    pinned: !!r.pinned,
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
    } else {
      // 无分类（「最新」）时排除二手闲置，该分类只在对应分类页展示
      where += ` AND p.category NOT IN (${LATEST_EXCLUDED_VALUES.map(() => '?').join(', ')})`;
      params.push(...LATEST_EXCLUDED_VALUES);
    }
    const hidden = hiddenPostFilter(userId);
    where += hidden.clause;
    params.push(...hidden.params);
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM forum_post p ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited,
        IFNULL((SELECT 1 FROM forum_post_follow pf WHERE pf.post_id = p.id AND pf.user_id = ?), 0) AS isFollowed
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id ${where} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`,
      // SELECT 里有 3 个 ?（isLiked / isFavorited / isFollowed），必须补够 3 个 userId，
      // 否则后续参数整体错位：把 WHERE 的占位符当成 isFollowed，LIMIT/OFFSET 也一起挪位
      // → 未登录时报 ER_WRONG_VALUE_COUNT，接口 500。
      [userId, userId, userId].concat(params, [pageSize, offset]),
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
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited,
        IFNULL((SELECT 1 FROM forum_post_follow pf WHERE pf.post_id = p.id AND pf.user_id = ?), 0) AS isFollowed
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id WHERE p.id = ? AND p.status = 1${hidden.clause}`,
      [userId, userId, userId, req.params.id].concat(hidden.params),
    );
    if (!rows.length) return fail(res, "帖子不存在", 404);
    // 浏览量：每次打开详情都 +1（含作者与游客），post_view 仅记录独立访客
    if (userId) {
      await pool.query('INSERT IGNORE INTO post_view (post_id, user_id) VALUES (?, ?)', [rows[0].id, userId]);
    }
    await pool.query('UPDATE forum_post SET view_count = view_count + 1 WHERE id = ?', [rows[0].id]);
    rows[0].view_count = Number(rows[0].view_count || 0) + 1;
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
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
        IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked,
        IFNULL((SELECT 1 FROM forum_favorite f WHERE f.post_id = p.id AND f.user_id = ?), 0) AS isFavorited,
        IFNULL((SELECT 1 FROM forum_post_follow pf WHERE pf.post_id = p.id AND pf.user_id = ?), 0) AS isFollowed
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id ${where}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [userId, userId, userId].concat(queryParams, [pageSize, offset]),
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
  // 纯图片/视频帖子允许无文字内容
  const imageList = Array.isArray(images) ? images : [];
  const videoList = Array.isArray(videos) ? videos : [];
  if ((!content || !content.trim()) && !imageList.length && !videoList.length) return fail(res, "请输入内容或上传图片/视频");
  const normalizedContact = parseContact(contact);
  if (contact && !normalizedContact) return fail(res, '联系方式格式不正确');
  if (normalizedContact && !['手机号码', '微信账号', 'QQ账号'].includes(normalizedContact.type)) return fail(res, '不支持的联系方式类型');
  try {
    const normalizedAnonymousIdentity = parseAnonymousIdentity(anonymousIdentity);
    if (anonymousIdentity && !normalizedAnonymousIdentity) return fail(res, '分身身份格式不正确');
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
    // 支持一帖多投票：pollIndex 指定第几个投票，缺省投第一个
    const polls = components.filter((item) => item.type === 'poll');
    const requestedPollIndex = Number(req.body.pollIndex);
    const pollIndex = Number.isInteger(requestedPollIndex) && requestedPollIndex >= 0 ? requestedPollIndex : 0;
    const poll = polls[pollIndex];
    if (!poll) throw new Error('投票不存在');
    const validIndexes = [...new Set(optionIndexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < poll.options.length);
    if (!validIndexes.length || (poll.mode === 'single' && validIndexes.length !== 1)) throw new Error('投票选项不正确');
    poll.voterIds = Array.isArray(poll.voterIds) ? poll.voterIds : [];
    if (poll.voterIds.some((record) => Number(record.userId) === Number(req.userId))) throw new Error('你已经投过票了');
    // P19：投票明细落表，靠 uk_poll_vote(post_id, poll_index, user_id) 提供数据库级唯一约束。
    // 同一事务内先插明细再改 JSON，并发重复投票（双击、多端同时提交）会被唯一键挡下；
    // JSON 里的 voterIds 继续作为展示与历史数据兜底，读路径不变。
    await conn.query(
      'INSERT INTO forum_poll_vote (post_id, poll_index, option_indexes, user_id) VALUES (?, ?, ?, ?)',
      [postId, pollIndex, validIndexes.join(','), req.userId],
    );
    validIndexes.forEach((index) => { poll.options[index].votes = (Number(poll.options[index].votes) || 0) + 1; });
    poll.voterIds.push({ userId: req.userId, optionIndexes: validIndexes });
    await conn.query('UPDATE forum_post SET components = ? WHERE id = ?', [JSON.stringify(components), postId]);
    await conn.commit();
    success(res, { components: presentComponents(components, req.userId) });
  } catch (e) {
    await conn.rollback();
    // 唯一键冲突就是重复投票，给前端明确的文案而不是「数据库操作失败」
    if (e && e.code === 'ER_DUP_ENTRY') return fail(res, '你已经投过票了', 400);
    fail(res, safeMessage(e), e.message === '帖子不存在' ? 404 : 400);
  } finally { conn.release(); }
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
    // Keep the post record so its owner can review deleted content later.
    // Public feeds and profile pages already filter to status = 1.
    const [result] = await conn.query('UPDATE forum_post SET status = 0, pinned = 0 WHERE id = ? AND status <> 0', [postId]);
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

// 「我删除的-隐藏」列表：用户手动隐藏（不感兴趣）的帖子，含已删除的帖子
exports.hiddenList = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT hp.created_at AS hidden_at, p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm
       FROM post_hidden_preference hp
       JOIN forum_post p ON p.id = hp.post_id
       LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE hp.user_id = ?
       ORDER BY hp.created_at DESC
       LIMIT 100`,
      [req.userId],
    );
    success(res, {
      list: rows.map((r) => Object.assign(mapPost(r, req.userId), {
        hiddenAt: r.hidden_at,
        isPostDeleted: Number(r.status) === 0,
      })),
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

// 取消隐藏：删除偏好记录后，该帖与其分类重新对用户可见
exports.unhide = async (req, res) => {
  const postId = Number(req.params.postId);
  if (!Number.isInteger(postId) || postId <= 0) return fail(res, '帖子不存在', 404);
  try {
    await pool.query('DELETE FROM post_hidden_preference WHERE user_id = ? AND post_id = ?', [req.userId, postId]);
    success(res, null, '已取消隐藏');
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.hideAsNotInterested = async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) return fail(res, '帖子不存在', 404);
  try {
    const [posts] = await pool.query('SELECT id, category, user_id FROM forum_post WHERE id = ? AND status = 1', [postId]);
    if (!posts.length) return fail(res, '帖子不存在', 404);
    // scope=author 拉黑作者：屏蔽其全部帖子并加入黑名单（可在黑名单管理解除）
    // 其余情况（scope=post 或默认）仅隐藏这一条帖子，不影响同分类其他内容
    const scope = (req.body || {}).scope === 'author' ? 'author' : 'post';
    if (scope === 'author') {
      const authorId = Number(posts[0].user_id);
      if (authorId === Number(req.userId)) return fail(res, '不能拉黑自己', 400);
      const [users] = await pool.query('SELECT id FROM sys_user WHERE id = ? AND status = 1', [authorId]);
      if (!users.length) return fail(res, '用户不存在', 404);
      await pool.query('INSERT IGNORE INTO user_blacklist (user_id, blocked_id) VALUES (?, ?)', [req.userId, authorId]);
    }
    await pool.query(
      `INSERT INTO post_hidden_preference (user_id, post_id, category)
       VALUES (?, ?, '')
       ON DUPLICATE KEY UPDATE category = '', created_at = CURRENT_TIMESTAMP`,
      [req.userId, postId],
    );
    if (canManagePost(req)) {
      try {
        await writeAdminAudit(req, 'post.not_interested', 'post', postId, { scope });
      } catch (auditError) {
        console.error('[admin-audit]', auditError.message);
      }
    }
    success(res, { postId, scope });
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
      const [removed] = await conn.query(
        "DELETE FROM forum_like WHERE post_id = ? AND user_id = ?",
        [req.params.id, req.userId],
      );
      // affectedRows === 0：明细已被并发请求删掉，计数器不能再减（P22）
      if (!removed || removed.affectedRows !== 0) {
        await conn.query(
          "UPDATE forum_post SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?",
          [req.params.id],
        );
      }
      await conn.commit();
      success(res, { liked: false });
    } else {
      // INSERT IGNORE + 唯一键 uk_post_user：并发双击只有一次真正插入成功（P22）
      const [added] = await conn.query(
        "INSERT IGNORE INTO forum_like (post_id, user_id) VALUES (?, ?)",
        [req.params.id, req.userId],
      );
      if (!added || added.affectedRows !== 0) {
        await conn.query(
          "UPDATE forum_post SET like_count = like_count + 1 WHERE id = ?",
          [req.params.id],
        );
      }
      await conn.commit();
      const [posts] = await pool.query('SELECT user_id, title FROM forum_post WHERE id = ?', [req.params.id]);
      if (posts.length && Number(posts[0].user_id) !== Number(req.userId)) {
        const [actors] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ?', [req.userId]);
        const actor = actors.length ? { id: actors[0].id, nickName: actors[0].nick_name, avatarUrl: actors[0].avatar_url } : null;
        createNotification({
          userId: posts[0].user_id,
          type: 'like',
          title: '你的帖子收到了点赞',
          content: '帖子被点赞',
          relatedId: req.params.id,
          actorUserId: actor ? actor.id : null,
          actorNick: actor ? actor.nickName : '',
          actorAvatar: actor ? actor.avatarUrl : '',
          postTitle: posts[0].title || ''
        }).catch(() => {});
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
      const [removed] = await conn.query(
        "DELETE FROM forum_favorite WHERE post_id = ? AND user_id = ?",
        [req.params.id, req.userId],
      );
      // 同上：只有明细真被删除才扣计数（P22）
      if (!removed || removed.affectedRows !== 0) {
        await conn.query(
          "UPDATE forum_post SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?",
          [req.params.id],
        );
      }
      await conn.commit();
      success(res, { favorited: false });
    } else {
      const [added] = await conn.query(
        "INSERT IGNORE INTO forum_favorite (post_id, user_id) VALUES (?, ?)",
        [req.params.id, req.userId],
      );
      if (!added || added.affectedRows !== 0) {
        await conn.query(
          "UPDATE forum_post SET favorite_count = favorite_count + 1 WHERE id = ?",
          [req.params.id],
        );
      }
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

// 蹲贴：切换「蹲」一篇帖子。与点赞/收藏同一套约定——明细表 forum_post_follow
// 与 forum_post.follow_count 计数器在同一事务内双写，返回真实落库后的数值供前端纠偏。
exports.follow = async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (!postId) return fail(res, '帖子不存在', 404);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [posts] = await conn.query('SELECT id FROM forum_post WHERE id = ? AND status = 1', [postId]);
    if (!posts.length) {
      await conn.rollback();
      return fail(res, '帖子不存在', 404);
    }
    const [exist] = await conn.query(
      'SELECT id FROM forum_post_follow WHERE post_id = ? AND user_id = ?',
      [postId, req.userId],
    );
    let followed;
    if (exist.length) {
      const [removed] = await conn.query('DELETE FROM forum_post_follow WHERE post_id = ? AND user_id = ?', [postId, req.userId]);
      // 明细真被删掉才扣计数（P22）
      if (!removed || removed.affectedRows !== 0) {
        await conn.query('UPDATE forum_post SET follow_count = GREATEST(follow_count - 1, 0) WHERE id = ?', [postId]);
      }
      followed = false;
    } else {
      const [added] = await conn.query('INSERT IGNORE INTO forum_post_follow (post_id, user_id) VALUES (?, ?)', [postId, req.userId]);
      if (!added || added.affectedRows !== 0) {
        await conn.query('UPDATE forum_post SET follow_count = follow_count + 1 WHERE id = ?', [postId]);
      }
      followed = true;
    }
    const [countRows] = await conn.query('SELECT follow_count FROM forum_post WHERE id = ?', [postId]);
    await conn.commit();
    success(res, {
      followed,
      followCount: countRows.length ? (Number(countRows[0].follow_count) || 0) : 0,
    });
  } catch (e) {
    await conn.rollback();
    fail(res, safeMessage(e), 500);
  } finally {
    conn.release();
  }
};

// 蹲贴列表（消息页「蹲贴」标签页）
//   type=mine   我蹲过的帖子（按蹲贴时间倒序）
//   type=theirs 其他用户蹲过的我的帖子（按最近被蹲时间倒序，附蹲贴者昵称预览）
// 两个列表都不做 GROUP BY：theirs 用相关子查询取「最近被蹲时间」，避免 p.* 与
// ONLY_FULL_GROUP_BY 冲突（同库里其它聚合查询踩过这个坑）。
exports.followedList = async (req, res) => {
  const userId = req.userId;
  if (!userId) return fail(res, '未登录', 401);
  const type = req.query.type === 'theirs' ? 'theirs' : 'mine';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = clampPageSize(req.query.pageSize, 20);
  const offset = (page - 1) * pageSize;
  const baseSelect = `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
      IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count,
      IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked`;
  try {
    if (type === 'mine') {
      const [[count]] = await pool.query(
        `SELECT COUNT(*) AS total FROM forum_post_follow f
         JOIN forum_post p ON p.id = f.post_id AND p.status = 1
         WHERE f.user_id = ?`,
        [userId],
      );
      const [rows] = await pool.query(
        `${baseSelect}, 1 AS isFollowed, f.created_at AS followed_at
         FROM forum_post_follow f
         JOIN forum_post p ON p.id = f.post_id AND p.status = 1
         LEFT JOIN sys_user u ON p.user_id = u.id
         WHERE f.user_id = ?
         ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
        // baseSelect 里的 isLiked 子查询占 1 个 userId，必须补在最前，
        // 否则后面的 f.user_id / LIMIT / OFFSET 整体错位
        [userId, userId, pageSize, offset],
      );
      return success(res, {
        list: rows.map((r) => Object.assign(mapPost(r, userId), { followedAt: r.followed_at, squatUsers: [] })),
        total: count.total,
        hasMore: offset + pageSize < count.total,
      });
    }

    // 其他用户蹲过的我的帖子：只要有人（非我自己）蹲过就展示
    const [[count]] = await pool.query(
      `SELECT COUNT(*) AS total FROM forum_post p
       WHERE p.user_id = ? AND p.status = 1
         AND EXISTS (SELECT 1 FROM forum_post_follow f WHERE f.post_id = p.id AND f.user_id <> ?)`,
      [userId, userId],
    );
    const [rows] = await pool.query(
      `${baseSelect},
        IFNULL((SELECT 1 FROM forum_post_follow pf WHERE pf.post_id = p.id AND pf.user_id = ?), 0) AS isFollowed,
        (SELECT MAX(f3.created_at) FROM forum_post_follow f3 WHERE f3.post_id = p.id AND f3.user_id <> ?) AS last_followed_at
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.user_id = ? AND p.status = 1
         AND EXISTS (SELECT 1 FROM forum_post_follow f WHERE f.post_id = p.id AND f.user_id <> ?)
       ORDER BY last_followed_at DESC LIMIT ? OFFSET ?`,
      // 5 个 userId：baseSelect 的 isLiked、isFollowed、last_followed_at、WHERE、EXISTS
      [userId, userId, userId, userId, userId, pageSize, offset],
    );
    // 蹲贴者昵称预览：一次 IN 查询取回本页所有帖子的蹲贴用户，按帖子分组取最近 5 位
    const postIds = rows.map((r) => r.id);
    const squatMap = {};
    if (postIds.length) {
      const [followRows] = await pool.query(
        `SELECT f.post_id, f.user_id, u.nick_name, u.avatar_url
         FROM forum_post_follow f LEFT JOIN sys_user u ON u.id = f.user_id
         WHERE f.post_id IN (${postIds.map(() => '?').join(', ')}) AND f.user_id <> ?
         ORDER BY f.created_at DESC`,
        postIds.concat([userId]),
      );
      followRows.forEach((row) => {
        const list = squatMap[row.post_id] || (squatMap[row.post_id] = []);
        if (list.length < 5) {
          list.push({
            userId: row.user_id,
            nickName: row.nick_name || '校园同学',
            avatarUrl: normalizeLegacyAvatarUrl(row.avatar_url),
          });
        }
      });
    }
    return success(res, {
      list: rows.map((r) => Object.assign(mapPost(r, userId), {
        followedAt: r.last_followed_at,
        squatUsers: squatMap[r.id] || [],
      })),
      total: count.total,
      hasMore: offset + pageSize < count.total,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.hot = async (req, res) => {
  try {
    const hidden = hiddenPostFilter(req.userId || 0);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1${hidden.clause} ORDER BY p.view_count DESC, p.created_at DESC LIMIT 15`,
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
  // 热榜：按 period 指定时间范围内的帖子，按浏览量排序
  // today 覆盖前天+昨天+今天三天；history 不限时间
  try {
    // today：前天+昨天+今天三天窗口（产品要求每日热榜覆盖近三天）
    const periodSince = {
      today: 'CURDATE() - INTERVAL 2 DAY',
      week: 'CURDATE() - INTERVAL 7 DAY',
      month: 'CURDATE() - INTERVAL 1 MONTH',
      halfyear: 'CURDATE() - INTERVAL 6 MONTH',
      year: 'CURDATE() - INTERVAL 1 YEAR',
      history: '',
    };
    const since = periodSince[req.query.period] !== undefined
      ? periodSince[req.query.period]
      : periodSince.today;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);
    const hidden = hiddenPostFilter(req.userId || 0);
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.status = 1${since ? ` AND p.created_at >= ${since}` : ''}${hidden.clause}
       ORDER BY p.view_count DESC, p.created_at DESC LIMIT ${limit}`,
      hidden.params,
    );
    // 时间窗口内不足 limit 条时，用更早的高浏览帖子补齐，保证榜单始终接近 limit 条
    let list = rows;
    if (list.length < limit) {
      const excludeIds = list.map((r) => r.id);
      const [extra] = await pool.query(
        `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label, u.allow_anonymous_pm,
          IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
         FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id
         WHERE p.status = 1${hidden.clause}${excludeIds.length ? ` AND p.id NOT IN (${excludeIds.map(() => '?').join(',')})` : ''}
         ORDER BY p.view_count DESC, p.created_at DESC LIMIT ${limit - list.length}`,
        [...hidden.params, ...excludeIds],
      );
      list = list.concat(extra);
      list.sort(
        (a, b) =>
          (Number(b.view_count) - Number(a.view_count)) ||
          (new Date(b.created_at) - new Date(a.created_at)),
      );
    }
    success(res, { list: list.map((item) => mapPost(item, req.userId || 0)) });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
