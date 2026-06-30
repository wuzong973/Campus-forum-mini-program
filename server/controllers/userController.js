const pool = require("../config/pool");
const jwt = require("jsonwebtoken");
const jwtConfig = require("../config/jwt");
const axios = require("axios");
const wechatConfig = require("../config/wechat");
const { success, fail } = require("../middleware/auth");
const { safeMessage } = require("../utils/helpers");
const { getAccessToken } = require("../utils/wechatToken");

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
      const accessToken = await getAccessToken();
      const phoneRes = await axios.post(
        `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`,
        { code: phoneCode },
      );
      if (phoneRes.data.errcode)
        return fail(res, "获取手机号失败: " + phoneRes.data.errmsg, 400);
      phone = phoneRes.data.phone_info.phoneNumber;
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
      const [result] = await pool.query(
        "INSERT INTO sys_user (openid, nick_name, avatar_url, phone) VALUES (?, ?, ?, ?)",
        [openid, "校园用户", "", phone],
      );
      user = {
        id: result.insertId,
        openid,
        nick_name: "校园用户",
        avatar_url: "",
        phone,
      };
    }
    const token = jwt.sign({ userId: user.id }, jwtConfig.secret, {
      expiresIn: jwtConfig.expiresIn,
    });
    success(res, {
      id: user.id,
      nickName: user.nick_name,
      avatarUrl: user.avatar_url,
      phone: user.phone,
      token,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getInfo = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nick_name, avatar_url, student_id, is_verified, gender, campus, phone FROM sys_user WHERE id = ?",
      [req.userId],
    );
    if (!rows.length) return fail(res, "用户不存在", 404);
    const u = rows[0];
    success(res, {
      id: u.id,
      nickName: u.nick_name,
      avatarUrl: u.avatar_url,
      studentId: u.student_id,
      isVerified: u.is_verified,
      gender: u.gender,
      campus: u.campus,
      phone: u.phone,
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
    const [rows] = await pool.query(
      `SELECT u.id, u.nick_name, u.avatar_url, u.student_id, u.is_verified, u.gender, u.campus,
        IFNULL((SELECT COUNT(*) FROM forum_post p WHERE p.user_id = u.id AND p.status = 1), 0) AS post_count,
        IFNULL((SELECT SUM(p.like_count) FROM forum_post p WHERE p.user_id = u.id AND p.status = 1), 0) AS like_received
       FROM sys_user u
       WHERE u.id = ?`,
      [profileId],
    );
    if (!rows.length) return fail(res, "用户不存在", 404);
    const u = rows[0];
    success(res, {
      id: u.id,
      nickName: u.nick_name,
      avatarUrl: u.avatar_url,
      studentId: u.student_id,
      verified: !!u.is_verified,
      gender: u.gender,
      campus: u.campus,
      major: u.is_verified ? "认证学生" : "校园用户",
      signature: "该用户还没有填写签名...",
      coverUrl: "/assets/banners/banner-community.png",
      postCount: u.post_count,
      likeReceived: u.like_received,
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.getProfilePosts = async (req, res) => {
  const profileId = parseInt(req.params.id, 10);
  if (!profileId) return fail(res, "用户不存在", 404);
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url, u.is_verified
       FROM forum_post p
       LEFT JOIN sys_user u ON p.user_id = u.id
       WHERE p.user_id = ? AND p.status = 1
       ORDER BY p.created_at DESC
       LIMIT 30`,
      [profileId],
    );
    success(res, {
      list: rows.map((item) => ({
        id: item.id,
        userId: item.user_id,
        nickName: item.nick_name,
        avatarUrl: item.avatar_url,
        verified: !!item.is_verified,
        title: item.title || "",
        category: item.category,
        content: item.content,
        images: item.images,
        likeCount: item.like_count,
        commentCount: item.comment_count,
        favoriteCount: item.favorite_count,
        shareCount: item.share_count || 0,
        createdAt: item.created_at,
      })),
    });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.updateInfo = async (req, res) => {
  const { nickName, avatarUrl, gender, campus, phone } = req.body;
  try {
    const fields = [];
    const values = [];
    if (nickName !== undefined) {
      fields.push("nick_name = ?");
      values.push(nickName);
    }
    if (avatarUrl !== undefined) {
      fields.push("avatar_url = ?");
      values.push(avatarUrl);
    }
    if (gender !== undefined) {
      fields.push("gender = ?");
      values.push(gender);
    }
    if (campus !== undefined) {
      fields.push("campus = ?");
      values.push(campus);
    }
    if (phone !== undefined) {
      fields.push("phone = ?");
      values.push(phone);
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

exports.verify = async (req, res) => {
  const { studentId, realName } = req.body;
  if (!studentId || !/^\d{6,12}$/.test(studentId))
    return fail(res, "请输入有效学号");
  try {
    const [exist] = await pool.query(
      "SELECT id FROM sys_user WHERE student_id = ? AND id != ?",
      [studentId, req.userId],
    );
    if (exist.length) return fail(res, "该学号已被认证");
    await pool.query(
      "UPDATE sys_user SET student_id = ?, real_name = ?, is_verified = 1 WHERE id = ?",
      [studentId, realName || "", req.userId],
    );
    success(res, null, "认证成功");
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};

exports.contentCheck = async (req, res) => {
  const { content } = req.body;
  if (!content) return fail(res, "缺少内容");
  success(res, { safe: true });
};
