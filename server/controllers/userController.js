const pool = require("../config/pool");
const jwt = require("jsonwebtoken");
const jwtConfig = require("../config/jwt");
const axios = require("axios");
const wechatConfig = require("../config/wechat");
const { success, fail } = require("../middleware/auth");
const { safeMessage, clampPageSize, parseImages } = require("../utils/helpers");
const { getAccessToken } = require("../utils/wechatToken");
const { verifyJwAccount } = require("../services/jwScheduleSyncService");
// 默认头像/昵称与旧路径归一化：与 migrations 的历史数据修复共用同一套规则
const {
  buildDefaultProfile,
  normalizeLegacyAvatarUrl,
  normalizeAnonymousAvatarUrl,
  isAnonymousAvatarUrl,
  pickAnonymousAvatar,
} = require("../utils/defaultProfile");

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function parseAnonymousIdentity(value) {
  const identity = parseJson(value, null);
  if (!identity || !identity.nickName || !identity.avatarUrl) return null;
  const nickName = String(identity.nickName).trim().slice(0, 32);
  const raw = String(identity.avatarUrl).trim();
  if (raw.indexOf('/assets/avatar1/') !== 0) return null;
  // 旧文件名先纠正，纠正不了的（历史脏数据）稳定映射到池内形象 —— 个人主页里的
  // 匿名帖/评论头像同样会出现图裂，这里是最靠近数据出口的纠正点
  const normalized = normalizeAnonymousAvatarUrl(raw);
  const avatarUrl = isAnonymousAvatarUrl(normalized) ? normalized : pickAnonymousAvatar(nickName || raw);
  return { nickName, avatarUrl };
}

function mapProfilePost(item) {
  const anonymous = parseAnonymousIdentity(item.anonymous_identity);
  return {
    id: item.id,
    userId: item.user_id,
    nickName: anonymous ? anonymous.nickName : (item.nick_name || '校园同学'),
    avatarUrl: anonymous ? anonymous.avatarUrl : normalizeLegacyAvatarUrl(item.avatar_url),
    campus: anonymous ? '' : (item.campus || ''),
    verified: !!item.is_verified,
    certLabel: item.cert_label || '',
    title: item.title || '',
    category: item.category,
    content: item.content,
    images: item.images,
    likeCount: item.like_count,
    commentCount: item.comment_count,
    favoriteCount: item.favorite_count,
    shareCount: item.share_count || 0,
    // 浏览量：SQL 是 `SELECT p.*`，论坛表里这一列一直有值，早期漏映射导致
    // 主页（自己看、别人看都一样）所有帖子的「N 浏览」恒显示 0。
    // 与 postController.mapPost 的口径保持一致（缺省 0，而不是 undefined）。
    viewCount: item.view_count || 0,
    // 置顶标记：同一个漏映射问题。帖子卡片的「置顶」角标读 post.pinned，
    // 缺失时置顶帖在主页与普通帖长得一样。
    pinned: !!item.pinned,
    // 当前访问者是否点过赞：帖子卡片 footer 的点赞按钮读它。
    // 「我的帖子」页（pages/my-posts）与主页共用本映射，但只有前者渲染 footer，
    // 所以这一列最初被漏掉时，表现为「我的帖子列表里点赞按钮永远没选中」。
    // 取不到时按 false 兜底（没有该列的查询，如「已删除帖子」列表，同样安全）。
    isLiked: !!item.isLiked,
    createdAt: item.created_at,
    isAnonymous: !!anonymous,
    isDeleted: Number(item.status) === 0,
  };
}

async function getWechatPhone(phoneCode) {
  const accessToken = await getAccessToken();
  const phoneRes = await axios.post(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`,
    { code: phoneCode },
    { timeout: 5000 },
  );
  if (phoneRes.data.errcode || !(phoneRes.data.phone_info || {}).phoneNumber) {
    const detail = phoneRes.data.errmsg || "未返回手机号";
    const error = new Error("获取手机号失败: " + detail);
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return phoneRes.data.phone_info.phoneNumber;
}

exports.phoneLogin = async (req, res) => {
  const { code, phoneCode } = req.body;
  if (!code) return fail(res, "缺少登录code");
  if (!phoneCode) return fail(res, "缺少手机号授权code");
  try {
    let openid;
    let phone;
    const isDev = wechatConfig.appId === "your_appid";
    if (isDev && process.env.NODE_ENV === "production") {
      return fail(res, "微信配置未完成", 500);
    }
    // 获取 openid（用于用户唯一标识）
    if (!isDev) {
      const wxRes = await axios.get(
        `https://api.weixin.qq.com/sns/jscode2session?appid=${wechatConfig.appId}&secret=${wechatConfig.appSecret}&js_code=${code}&grant_type=authorization_code`,
      );
      if (wxRes.data.errcode)
        return fail(res, "微信登录失败: " + wxRes.data.errmsg, 400);
      openid = wxRes.data.openid;
      // 获取手机号（通过 getPhoneNumber 接口）
      phone = await getWechatPhone(phoneCode);
    } else {
      openid = "dev_" + code.slice(0, 16);
      phone = "13800138000";
    }
    // 优先按手机号查找用户（手机号为登录主标识）
    let [rows] = await pool.query(
      'SELECT * FROM sys_user WHERE phone = ? AND phone <> ""',
      [phone],
    );
    if (!rows.length) {
      // 兼容旧用户：按 openid 查找
      [rows] = await pool.query("SELECT * FROM sys_user WHERE openid = ?", [
        openid,
      ]);
    }
    let user;
    if (rows.length) {
      user = rows[0];
      // 更新 openid 与手机号（若发生变更）
      if (user.openid !== openid || user.phone !== phone) {
        await pool.query(
          "UPDATE sys_user SET openid = ?, phone = ? WHERE id = ?",
          [openid, phone, user.id],
        );
        user.openid = openid;
        user.phone = phone;
      }
    } else {
      // 新用户：注册即分配非空头像与随机昵称，避免写入空头像/"校园用户"脏数据
      // （旧逻辑写入 avatar_url='' 且昵称固定"校园用户"，前端补报失败时头像永久为空）
      const defaultProfile = buildDefaultProfile()
      const [result] = await pool.query(
        "INSERT INTO sys_user (openid, nick_name, avatar_url, phone) VALUES (?, ?, ?, ?)",
        [openid, defaultProfile.nickName, defaultProfile.avatarUrl, phone],
      );
      user = {
        id: result.insertId,
        openid,
        nick_name: defaultProfile.nickName,
        avatar_url: defaultProfile.avatarUrl,
        phone,
      };
    }
    const token = jwt.sign({ userId: user.id }, jwtConfig.secret, {
      expiresIn: jwtConfig.expiresIn,
    });
    success(res, {
      id: user.id,
      nickName: user.nick_name,
      avatarUrl: normalizeLegacyAvatarUrl(user.avatar_url),
      phone: user.phone,
      gender: Number(user.gender) || 0,
      campus: user.campus || '',
      role: user.role || 'user',
      token,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getInfo = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nick_name, avatar_url, student_id, real_name, is_verified, gender, campus, phone, role, status, allow_anonymous_pm, hide_profile_posts FROM sys_user WHERE id = ?",
      [req.userId],
    );
    if (!rows.length) return fail(res, "用户不存在", 404);
    const u = rows[0];
    success(res, {
      id: u.id,
      nickName: u.nick_name,
      avatarUrl: normalizeLegacyAvatarUrl(u.avatar_url),
      studentId: u.student_id,
      realName: u.real_name || "",
      isVerified: u.is_verified,
      gender: u.gender,
      campus: u.campus,
      phone: u.phone,
      role: u.role || 'user',
      status: u.status,
      allowAnonymousPm: u.allow_anonymous_pm === undefined ? true : !!u.allow_anonymous_pm,
      hideProfilePosts: !!u.hide_profile_posts,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getProfile = async (req, res) => {
  const profileId = parseInt(req.params.id, 10);
  const currentUserId = req.userId || 0;
  if (!profileId) return fail(res, "用户不存在", 404);
  try {
    // 匿名帖只有作者本人主页可见，访客看到的帖子数不含匿名帖
    const anonymousFilter =
      Number(currentUserId) === profileId ? "" : " AND p.anonymous_identity IS NULL";
    const [rows] = await pool.query(
      `SELECT u.id, u.nick_name, u.avatar_url, u.student_id, u.is_verified, u.gender, u.campus, u.allow_anonymous_pm, u.hide_profile_posts,
        IFNULL((SELECT COUNT(*) FROM forum_post p WHERE p.user_id = u.id AND p.status = 1${anonymousFilter}), 0) AS post_count,
        IFNULL((SELECT SUM(p.like_count) FROM forum_post p WHERE p.user_id = u.id AND p.status = 1), 0) AS like_received
       FROM sys_user u
       WHERE u.id = ?`,
      [profileId],
    );
    if (!rows.length) return fail(res, "用户不存在", 404);
    const u = rows[0];
    // 「隐藏主页帖子」开启后，访客视角帖子数一并按 0 下发（与 getProfilePosts 的空列表口径一致）
    const hidePostsFromVisitor = Number(u.hide_profile_posts) === 1 && Number(currentUserId) !== profileId;
    success(res, {
      id: u.id,
      nickName: u.nick_name,
      avatarUrl: normalizeLegacyAvatarUrl(u.avatar_url),
      studentId: u.student_id,
      verified: !!u.is_verified,
      gender: u.gender,
      campus: u.campus,
      major: u.is_verified ? "认证学生" : "校园用户",
      signature: "该用户还没有填写签名...",
      coverUrl: "/assets/banners/profile-cover.jpg",
      postCount: hidePostsFromVisitor ? 0 : u.post_count,
      likeReceived: u.like_received,
      allowAnonymousPm: u.allow_anonymous_pm === undefined ? true : !!u.allow_anonymous_pm,
      hideProfilePosts: !!u.hide_profile_posts,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getProfilePosts = async (req, res) => {
  const profileId = parseInt(req.params.id, 10);
  const currentUserId = req.userId || 0;
  if (!profileId) return fail(res, "用户不存在", 404);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 30));
  const offset = (page - 1) * pageSize;
  try {
    // 「隐藏主页帖子」开启后访客拿不到帖子列表，仅作者本人可见；查不到用户按未隐藏处理（旧行为：空列表）
    const [targetUsers] = await pool.query('SELECT hide_profile_posts FROM sys_user WHERE id = ?', [profileId]);
    if (Number((targetUsers[0] || {}).hide_profile_posts) === 1 && Number(currentUserId) !== profileId) {
      return success(res, { list: [], total: 0, page, hasMore: false });
    }
    // 匿名帖仅作者本人可见，其他访客进入主页时不返回
    const anonymousFilter =
      Number(currentUserId) === profileId ? "" : " AND p.anonymous_identity IS NULL";
    const whereSql = `WHERE p.user_id = ? AND p.status = 1${anonymousFilter}`;
    const [[count], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM forum_post p ${whereSql}`, [profileId]),
      pool.query(
        `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label,
            IFNULL((SELECT 1 FROM forum_like l WHERE l.post_id = p.id AND l.user_id = ?), 0) AS isLiked
         FROM forum_post p
         LEFT JOIN sys_user u ON p.user_id = u.id
         ${whereSql}
         ORDER BY p.created_at DESC
         LIMIT ? OFFSET ?`,
        // isLiked 子查询引入了 1 个新占位符，必须补在最前面。
        // 漏补会让后续参数整体错位：profileId 被当成 userId、pageSize 被当成 OFFSET
        // → 结果错乱或 ER_WRONG_VALUE_COUNT 500。未登录时 currentUserId 为 0，
        // 子查询恒不命中，isLiked 自然为 0，与「游客未点赞」语义一致。
        [currentUserId].concat([profileId], [pageSize, offset]),
      ),
    ]);
    const total = Number(count[0].total);
    success(res, {
      list: rows.map(mapProfilePost),
      total,
      page,
      hasMore: offset + rows.length < total,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getMyDeletedPosts = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.campus, u.is_verified, u.cert_label
       FROM forum_post p
       LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.user_id = ? AND p.status = 0
       ORDER BY p.updated_at DESC, p.created_at DESC
       LIMIT 50`,
      [req.userId],
    );
    success(res, { list: rows.map(mapProfilePost) });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.updateInfo = async (req, res) => {
  const { nickName, avatarUrl, gender, campus, phone, allowAnonymousPm, hideProfilePosts } = req.body;
  if (phone !== undefined) return fail(res, "手机号需通过微信授权更新", 400);
  try {
    const fields = [];
    const values = [];
    if (allowAnonymousPm !== undefined) {
      const flag = Number(allowAnonymousPm);
      if (![0, 1].includes(flag)) return fail(res, "分身私信设置无效", 400);
      fields.push("allow_anonymous_pm = ?");
      values.push(flag);
    }
    if (hideProfilePosts !== undefined) {
      const flag = Number(hideProfilePosts);
      if (![0, 1].includes(flag)) return fail(res, "隐藏主页帖子设置无效", 400);
      fields.push("hide_profile_posts = ?");
      values.push(flag);
    }
    if (nickName !== undefined) {
      if (typeof nickName !== "string" || !nickName.trim() || nickName.trim().length > 64) return fail(res, "昵称长度应为1至64个字符", 400);
      fields.push("nick_name = ?");
      values.push(nickName.trim());
    }
    if (avatarUrl !== undefined) {
      if (typeof avatarUrl !== "string" || avatarUrl.length > 512) return fail(res, "头像地址无效", 400);
      fields.push("avatar_url = ?");
      values.push(avatarUrl);
    }
    if (gender !== undefined) {
      if (![0, 1, 2].includes(Number(gender))) return fail(res, "性别参数无效", 400);
      fields.push("gender = ?");
      values.push(Number(gender));
    }
    if (campus !== undefined) {
      if (typeof campus !== "string" || campus.trim().length > 64) return fail(res, "校区信息无效", 400);
      fields.push("campus = ?");
      values.push(campus.trim());
    }
    if (!fields.length) return fail(res, "无更新内容");
    values.push(req.userId);
    await pool.query(
      `UPDATE sys_user SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );
    success(res, null);
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.updatePhone = async (req, res) => {
  const phoneCode = String(req.body.phoneCode || "").trim();
  const manualPhone = String(req.body.phone || "").trim();
  const wechatReady = wechatConfig.appId !== "your_appid" && wechatConfig.appSecret && wechatConfig.appSecret !== "your_appsecret";
  // 手动改绑仅限未配置微信凭据的本地/测试环境；生产环境必须走 getPhoneNumber 授权凭证，
  // 防止已登录会话把手机号（登录主标识）无验证改绑到任意号码
  if (manualPhone && wechatReady) return fail(res, "请通过微信手机号授权更新", 400);
  if (manualPhone && !/^1[3-9]\d{9}$/.test(manualPhone)) return fail(res, "请输入正确的11位手机号", 400);
  if (!manualPhone && !phoneCode) return fail(res, "缺少手机号授权凭证", 400);
  let phone = manualPhone;
  try {
    if (!manualPhone) {
      if (!wechatReady) {
        return fail(res, "微信配置未完成", 503);
      }
      phone = await getWechatPhone(phoneCode);
    }
    const [result] = await pool.query("UPDATE sys_user SET phone = ? WHERE id = ?", [phone, req.userId]);
    if (!result.affectedRows) return fail(res, "用户不存在", 404);
    success(res, { phone }, "手机号已更新");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return fail(res, "该手机号已绑定其他账号", 409);
    fail(res, safeMessage(e), e.status || 500);
  }
};

exports.verify = async (req, res) => {
  const { studentId, realName } = req.body;
  // 学号位数不限制，填多少位都可以（DB student_id 为 VARCHAR(32)，超长截断）
  const normalizedStudentId = String(studentId || "").trim().slice(0, 32);
  if (!normalizedStudentId) return fail(res, "请输入学号");
  try {
    const [exist] = await pool.query(
      "SELECT id FROM sys_user WHERE student_id = ? AND id != ?",
      [normalizedStudentId, req.userId],
    );
    if (exist.length) return fail(res, "该学号已被认证");
    await pool.query(
      "UPDATE sys_user SET student_id = ?, real_name = ?, is_verified = 1 WHERE id = ?",
      [normalizedStudentId, realName || "", req.userId],
    );
    success(res, null, "认证成功");
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

function formatDeletionRequest(row) {
  if (!row || row.status !== 'pending') return null
  return {
    status: row.status,
    requestedAt: row.requested_at,
    scheduledFor: row.scheduled_for
  }
}

exports.getDeletionRequest = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT status, requested_at, scheduled_for FROM account_deletion_request WHERE user_id = ? LIMIT 1",
      [req.userId]
    )
    success(res, formatDeletionRequest(rows[0]))
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

exports.requestDeletion = async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO account_deletion_request (user_id, status, requested_at, scheduled_for, cancelled_at, completed_at)
       VALUES (?, 'pending', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), NULL, NULL)
       ON DUPLICATE KEY UPDATE status = 'pending', requested_at = NOW(), scheduled_for = DATE_ADD(NOW(), INTERVAL 7 DAY), cancelled_at = NULL, completed_at = NULL`,
      [req.userId]
    )
    const [rows] = await pool.query(
      "SELECT status, requested_at, scheduled_for FROM account_deletion_request WHERE user_id = ? LIMIT 1",
      [req.userId]
    )
    success(res, formatDeletionRequest(rows[0]), '注销申请已提交')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

exports.cancelDeletion = async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE account_deletion_request SET status = 'cancelled', cancelled_at = NOW() WHERE user_id = ? AND status = 'pending'",
      [req.userId]
    )
    if (!result.affectedRows) return fail(res, '没有可撤销的注销申请', 404)
    success(res, null, '注销申请已撤销')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

exports.contentCheck = async (req, res) => {
  const { content } = req.body;
  if (!content) return fail(res, "缺少内容");
  success(res, { safe: true });
};

exports.getRiderVerification = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, campus_name campusName, student_id studentId, campus_credential campusCredential, phone, status, review_note reviewNote, reviewed_at reviewedAt, created_at createdAt FROM rider_verification WHERE user_id = ? LIMIT 1",
      [req.userId]
    );
    if (!rows.length) return success(res, { status: 'none' });
    const r = rows[0];
    success(res, {
      id: r.id,
      campusName: r.campusName,
      studentId: r.studentId,
      campusCredential: r.campusCredential,
      phone: r.phone,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

// 教务系统验证（骑手认证方式一）：学号+密码登录教务系统，成功即通过认证成为骑手
exports.verifyRiderByJw = async (req, res) => {
  const body = req.body || {};
  let studentId = String(body.studentId || '').trim();
  const password = String(body.password || '');
  const phone = String(body.phone || '').trim();

  if (!studentId) return fail(res, "请输入学号");
  // 学号位数不限制，填多少位都可以（DB student_id 为 VARCHAR(32)，超长截断）
  studentId = studentId.slice(0, 32);
  if (!password) return fail(res, "请输入教务系统密码");
  if (!phone) return fail(res, "请绑定联系手机号");

  try {
    const [exist] = await pool.query("SELECT id, status FROM rider_verification WHERE user_id = ?", [req.userId]);
    if (exist.length && exist[0].status === 'approved') return fail(res, "您已通过骑手认证", 409);

    // 教务系统登录验证：密码仅用于本次登录验证，不保存、不落库
    try {
      await verifyJwAccount({ userId: req.userId, username: studentId, password });
    } catch (verifyError) {
      return fail(res, safeMessage(verifyError), verifyError.status || 500);
    }

    // 验证通过 → 直接通过认证，具备接单资格
    if (exist.length) {
      await pool.query(
        "UPDATE rider_verification SET student_id=?, campus_credential='', phone=?, status='approved', review_note='教务系统验证自动通过', reviewed_by=NULL, reviewed_at=NOW() WHERE user_id=?",
        [studentId, phone, req.userId]
      );
    } else {
      // 注意：campus_credential 走教务验证时没有凭证图，必须显式传 '' 占位，
      // 否则 4 个 `?` 只喂 3 个参数 —— mysql2 会把 phone 错位塞给 campus_credential，
      // 且第 4 个 `?` 原样留在 SQL 里触发 ER_PARSE_ERROR，
      // 被 safeMessage 归一成「数据库操作失败」（2026-09-21 线上事故）
      await pool.query(
        "INSERT INTO rider_verification (user_id, student_id, campus_credential, phone, status, review_note, reviewed_at) VALUES (?, ?, ?, ?, 'approved', '教务系统验证自动通过', NOW())",
        [req.userId, studentId, '', phone]
      );
    }
    // 与管理员人工审核通过的行为保持一致
    await pool.query("UPDATE sys_user SET is_verified = 1 WHERE id = ?", [req.userId]);
    success(res, { status: 'approved' }, "教务系统验证通过，你已成为骑手");
  } catch (e) {
    // safeMessage 对 ER_* 一律只说「数据库操作失败」，真实原因必须落到日志里，
    // 否则线上只能看到一句无法定位的提示（本次事故就是这么被藏住的）
    console.error("[verifyRiderByJw] 认证失败:", (e && e.code) || "", (e && e.message) || e);
    fail(res, safeMessage(e), 500);
  }
};

exports.submitRiderVerification = async (req, res) => {
  const body = req.body || {};
  const campusName = String(body.campusName || '').trim();
  let studentId = String(body.studentId || '').trim();
  const campusCredential = String(body.campusCredential || '').trim();
  const phone = String(body.phone || '').trim();

  // 证件人工审核路径：证件照片必填，学号选填（超长截断至 32 位）
  if (!campusCredential) return fail(res, "校园认证信息不完整");
  studentId = studentId.slice(0, 32);
  if (!phone) return fail(res, "请绑定联系手机号");

  try {
    const [exist] = await pool.query("SELECT id, status FROM rider_verification WHERE user_id = ?", [req.userId]);
    if (exist.length && exist[0].status === 'approved') return fail(res, "您已通过骑手认证", 409);

    if (exist.length) {
      await pool.query(
        "UPDATE rider_verification SET campus_name=?, student_id=?, campus_credential=?, phone=?, status='pending', review_note='', reviewed_by=NULL, reviewed_at=NULL WHERE user_id=?",
        [campusName, studentId, campusCredential, phone, req.userId]
      );
    } else {
      await pool.query(
        "INSERT INTO rider_verification (user_id, campus_name, student_id, campus_credential, phone) VALUES (?, ?, ?, ?, ?)",
        [req.userId, campusName, studentId, campusCredential, phone]
      );
    }
    success(res, null, "认证信息已提交，等待管理员审核");
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getInteractionStats = async (req, res) => {
  const userId = req.userId;
  if (!userId) return fail(res, "未登录", 401);
  try {
    // 统计口径与互动列表一致：仅统计未删除帖子（列表按 p.status=1 过滤），避免徽标数大于可见列表
    const [[likedRow]] = await pool.query(
      "SELECT COUNT(DISTINCT p.id) as count FROM forum_like x JOIN forum_post p ON p.id = x.post_id AND p.status = 1 WHERE x.user_id = ?",
      [userId],
    );
    const [[sharedRow]] = await pool.query(
      "SELECT COUNT(DISTINCT p.id) as count FROM forum_share x JOIN forum_post p ON p.id = x.post_id AND p.status = 1 WHERE x.user_id = ? AND x.status = 1",
      [userId],
    );
    const [[commentedRow]] = await pool.query(
      "SELECT COUNT(DISTINCT p.id) as count FROM forum_comment x JOIN forum_post p ON p.id = x.post_id AND p.status = 1 WHERE x.user_id = ? AND x.status = 1",
      [userId],
    );
    const [[favoritedRow]] = await pool.query(
      "SELECT COUNT(DISTINCT p.id) as count FROM forum_favorite x JOIN forum_post p ON p.id = x.post_id AND p.status = 1 WHERE x.user_id = ?",
      [userId],
    );
    success(res, {
      liked: likedRow.count,
      shared: sharedRow.count,
      commented: commentedRow.count,
      favorited: favoritedRow.count,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getInteractionList = async (req, res) => {
  const userId = req.userId;
  if (!userId) return fail(res, "未登录", 401);
  const type = req.params.type;
  const validTypes = ["liked", "shared", "commented", "favorited"];
  if (!validTypes.includes(type)) return fail(res, "无效类型", 400);
  const page = parseInt(req.query.page, 10) || 1;
  const pageSize = clampPageSize(req.query.pageSize);
  const offset = (page - 1) * pageSize;
  try {
    let joinTable, joinCol, extraWhere = "";
    let isLiked = 0, isFavorited = 0;
    if (type === "liked") {
      joinTable = "forum_like"; joinCol = "post_id"; isLiked = 1;
    } else if (type === "favorited") {
      joinTable = "forum_favorite"; joinCol = "post_id"; isFavorited = 1;
    } else if (type === "shared") {
      joinTable = "forum_share"; joinCol = "post_id"; extraWhere = " AND x.status = 1";
    } else {
      joinTable = "forum_comment"; joinCol = "post_id"; extraWhere = " AND x.status = 1";
    }
    const [[countRow]] = await pool.query(
      `SELECT COUNT(DISTINCT p.id) as total
       FROM ${joinTable} x
       JOIN forum_post p ON p.id = x.${joinCol} AND p.status = 1
       WHERE x.user_id = ?${extraWhere}`,
      [userId],
    );
    const distinct = type === "commented" ? "DISTINCT p.id" : "p.id";
    const [rows] = await pool.query(
      `SELECT ${distinct}, p.user_id, p.title, p.category, p.content, p.images,
        p.like_count, p.comment_count, p.favorite_count, p.share_count, p.view_count, p.created_at,
        u.nick_name, u.avatar_url, u.campus, u.is_verified,
        IFNULL((SELECT COUNT(*) FROM forum_post fp2 WHERE fp2.user_id = p.user_id AND fp2.status = 1), 0) AS post_count
       FROM ${joinTable} x
       JOIN forum_post p ON p.id = x.${joinCol} AND p.status = 1
       LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE x.user_id = ?${extraWhere}
       ORDER BY x.created_at DESC LIMIT ? OFFSET ?`,
      [userId, pageSize, offset],
    );
    const total = countRow ? countRow.total : 0;
    success(res, {
      list: rows.map((r) => ({
        id: r.id, userId: r.user_id, nickName: r.nick_name, avatarUrl: normalizeLegacyAvatarUrl(r.avatar_url), campus: r.campus || "",
        title: r.title || "", category: r.category, content: r.content,
        images: parseImages(r.images), likeCount: r.like_count, commentCount: r.comment_count,
        favoriteCount: r.favorite_count, shareCount: r.share_count || 0, viewCount: r.view_count || 0,
        verified: !!r.is_verified, postCount: r.post_count || 0,
        isLiked: !!isLiked, isFavorited: !!isFavorited, createdAt: r.created_at,
      })),
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
