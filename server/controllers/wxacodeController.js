const crypto = require("crypto");
const pool = require("../config/pool");
const axios = require("axios");
const { success, fail } = require("../middleware/auth");
const { safeMessage } = require("../utils/helpers");
const { getAccessToken } = require("../utils/wechatToken");
const { putObject, headObject, getPublicUrl } = require("../config/cos");

// 分享海报用的小程序码接口：调 getwxacodeunlimit 生成「直达帖子详情」的码。
// 此前海报画的是静态占位图，扫出来只能进小程序首页，到不了帖子本身。
// 对象存储模式下生成的码上传 COS，headObject 命中即直接复用，不重复消耗
// 微信接口配额；本地磁盘开发模式直接回传 base64 data URL（canvas 原生支持），
// 接口始终只回 JSON。

// 上传驱动与 uploadController 的口径一致：object=COS，disk=本地磁盘
const STORAGE_DRIVER = String(process.env.UPLOAD_STORAGE_DRIVER || "object").toLowerCase();

// COS Key 用帖子 id 的 SHA-256 摘要构造：输出为定长十六进制串，
// 不携带任何用户可控字符（无路径分隔符/特殊符号）
function wxacodeObjectKey(postId) {
  const digest = crypto.createHash("sha256").update("wxacode-post-" + postId).digest("hex");
  return "uploads/wxacode/post-" + digest + ".png";
}

exports.postWxacode = async (req, res) => {
  const rawId = String(req.params.id || "").trim();
  const postId = parseInt(rawId, 10);
  // 仅接受纯数字 id
  if (!postId || !/^\d+$/.test(rawId)) return fail(res, "参数错误", 400);
  try {
    const [rows] = await pool.query(
      "SELECT id FROM forum_post WHERE id = ? AND status = 1",
      [postId],
    );
    if (!rows.length) return fail(res, "帖子不存在", 404);

    if (STORAGE_DRIVER === "object") {
      if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY || !process.env.COS_BUCKET) {
        return fail(res, "对象存储未配置", 503);
      }
      // COS 已有历史生成物时直接复用
      const objectKey = wxacodeObjectKey(postId);
      const exists = await headObject(objectKey);
      if (exists) return success(res, { url: getPublicUrl(objectKey) });
    }

    const accessToken = await getAccessToken();
    // check_path 关闭：线上版本未及时更新时也不阻断生成（扫码进入的页面参数解析在 post-detail 里兜底）
    const { data } = await axios.post(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`,
      {
        page: "pages/post-detail/index",
        scene: `id=${postId}`,
        width: 430,
        check_path: false,
      },
      { timeout: 10000, responseType: "arraybuffer" },
    );
    const buffer = Buffer.from(data);
    // 失败时微信返回 JSON（首字节 '{'），成功时返回图片二进制
    if (!buffer.length || buffer[0] === 0x7b) {
      let info = {};
      try { info = JSON.parse(buffer.toString("utf8")); } catch (e) { /* ignore */ }
      console.warn("[wxacode] 生成失败:", info.errcode, info.errmsg);
      return fail(res, "小程序码生成失败", 503);
    }

    let url = "";
    if (STORAGE_DRIVER === "object") {
      const objectKey = wxacodeObjectKey(postId);
      await putObject({ Key: objectKey, Body: buffer, ContentType: "image/png" });
      url = getPublicUrl(objectKey);
    } else {
      // 开发模式：不落盘，直接回传 base64（canvas 可直接绘制 data URL）
      url = `data:image/png;base64,${buffer.toString("base64")}`;
    }
    success(res, { url });
  } catch (e) {
    fail(res, safeMessage(e), 500);
  }
};
