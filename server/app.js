const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pool = require("./config/pool");
const logger = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const rateLimit = require("./middleware/rateLimit");
const { fail } = require("./middleware/auth");
const requestContext = require("./middleware/requestContext");
const featureFlag = require("./middleware/featureFlag");

function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return
  const required = [
    "JWT_SECRET", "DB_HOST", "DB_USER", "DB_PASSWORD", "WX_APPID", "WX_APPSECRET",
    "WX_MCH_ID", "WX_SERIAL_NO", "WX_APIV3_KEY", "WX_PLATFORM_PUBLIC_KEY",
    "WX_PAY_NOTIFY_URL", "UPLOAD_PUBLIC_BASE_URL", "UPLOAD_STORAGE_DRIVER", "CORS_ORIGIN"
  ]
  const placeholders = new Set(["", "change_me_in_local_only", "your_appid", "your_appsecret", "replace-with-secret-manager"])
  const missing = required.filter((key) => placeholders.has(String(process.env[key] || "").trim()))
  // WX_PRIVATE_KEY 允许由服务器证书文件回退提供（见 config/wechatPay.js）
  const payKeyPath = `${process.env.WX_PAY_CERT_DIR || "/www/wxpay_cert"}/apiclient_key.pem`
  if (placeholders.has(String(process.env.WX_PRIVATE_KEY || "").trim()) && !fs.existsSync(payKeyPath)) {
    missing.push("WX_PRIVATE_KEY")
  }
  if (missing.length) {
    console.error(`生产环境缺少必需配置：${missing.join(", ")}`)
    process.exit(1)
  }
  if (!/^https:\/\//i.test(process.env.UPLOAD_PUBLIC_BASE_URL) || !/^https:\/\//i.test(process.env.WX_PAY_NOTIFY_URL)) {
    console.error("生产环境的上传地址和支付回调地址必须使用 HTTPS")
    process.exit(1)
  }
}

assertProductionConfig()

const userRoutes = require("./routes/userRoutes");
const postRoutes = require("./routes/postRoutes");
const commentRoutes = require("./routes/commentRoutes");
const shareRoutes = require("./routes/shareRoutes");
const messageRoutes = require("./routes/messageRoutes");
const configRoutes = require("./routes/configRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const errandRoutes = require("./routes/errandRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const repairRoutes = require("./routes/repairRoutes");
const adminRoutes = require("./routes/adminRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const walletRoutes = require("./routes/walletRoutes");
const clubRoutes = require("./routes/clubRoutes");
const groupChatRoutes = require("./routes/groupChatRoutes");
const activityRoutes = require("./routes/activityRoutes");
const subscribeRoutes = require("./routes/subscribeRoutes");
const broadcastRoutes = require("./routes/broadcastRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const powerProxyRoutes = require("./routes/powerProxyRoutes");
const drivingSchoolRoutes = require("./routes/drivingSchoolRoutes");
const wsServer = require("./ws/wsServer");
const { runMigrations } = require("./utils/migrations");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
  }),
);
app.use(express.json({
  limit: "10mb",
  verify(req, res, buffer) {
    if (["/api/v1/repair/payment/notify", "/api/v1/payment/notify", "/api/v1/payment/refund/notify", "/api/v1/wallet/transfer/notify"].includes(req.originalUrl)) req.rawBody = buffer.toString("utf8");
  },
}));
app.use(express.urlencoded({ extended: true }));
// API 一律禁缓存：帖子/热榜等内容会因「作者或管理员删除」而在服务端立刻变化，
// 任何中间层（CDN、企业代理、客户端缓存）缓存住旧响应，都会让已删除的帖子继续出现。
// 之前响应里没有任何 Cache-Control，等于把「要不要缓存」交给中间层自行决定。
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(requestContext);
app.use(logger);
// 微信「消息推送」回调（媒体内容安全检测结果）：注册在全局限流之前，
// 否则全局 120 次/分钟窗口会把微信批量回调判为失败并触发重推（与支付回调同类问题）。
app.use('/api/v1/wechat', require('./routes/wechatPushRoutes'));
app.use(rateLimit({ max: 120 }));
// 本地磁盘上传（UPLOAD_STORAGE_DRIVER=disk）需要对外暴露 /uploads；
// 开发环境同样托管，方便本地调试。对象存储模式下图片由 COS 提供。
if (process.env.NODE_ENV !== "production" || String(process.env.UPLOAD_STORAGE_DRIVER || "").toLowerCase() === "disk") {
  app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
    // Helmet defaults to Cross-Origin-Resource-Policy: same-origin. Public
    // uploads must be embeddable by the WeChat runtime, which is cross-origin.
    setHeaders(res) {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  }));
}

app.get("/api/v1/health", async (req, res) => {
  let dbOk = false;
  try {
    await pool.query("SELECT 1");
    dbOk = true;
  } catch (e) {
    /* ignore */
  }
  res.json({
    code: 200,
    message: "ok",
    data: { status: "running", database: dbOk },
  });
});

app.use("/api/v1/user", userRoutes);
app.use("/api/v1/post", featureFlag("community.enabled"), postRoutes);
app.use("/api/v1/comment", featureFlag("community.enabled"), commentRoutes);
app.use("/api/v1/share", featureFlag("community.enabled"), shareRoutes);
app.use("/api/v1/message", messageRoutes);
app.use("/api/v1/config", configRoutes);
app.use("/api/v1/schedule", featureFlag("schedule.enabled"), scheduleRoutes);
app.use("/api/v1/errand", featureFlag("errand.enabled"), errandRoutes);
app.use("/api/v1/service", serviceRoutes);
app.use("/api/v1/repair", featureFlag("repair.enabled"), repairRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/notification", notificationRoutes);
app.use("/api/v1/feedback", feedbackRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/club", clubRoutes);
app.use("/api/v1/group-chat", groupChatRoutes);
app.use("/api/v1/activity", activityRoutes);
app.use("/api/v1/subscribe", subscribeRoutes);
// 群播报机器人通道（X-Bot-Token 鉴权，BROADCAST_BOT_TOKEN 未配置即关闭）
app.use("/api/v1/broadcast", broadcastRoutes);
app.use("/api/v1/review", reviewRoutes);
app.use("/api/v1/power", powerProxyRoutes);
app.use("/api/v1/driving-school", drivingSchoolRoutes);

app.use("/api/v1/*", (req, res) => fail(res, "接口不存在", 404));

app.use(errorHandler);

let server = null;

async function start() {
  // 数据库未就绪时原地重试而不是退出，避免 pm2 崩溃循环后进入 errored 状态不再拉起
  for (let attempt = 1; ; attempt++) {
    try {
      await runMigrations();
      break;
    } catch (err) {
      console.error(`[Startup] 数据库初始化失败（第 ${attempt} 次）:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 10000)));
    }
  }
  server = app.listen(PORT, () => {
    console.log(`广轻工后端服务运行在端口 ${PORT}`);
  });
  wsServer.init(server);
  // 跑腿订单超时自动取消：待支付超 30 分钟取消；待接单超 30 分钟取消并原路退款
  require("./services/errandExpiryService").start();
  // 活动开始前 30 分钟提醒已报名用户（订阅消息）
  require("./services/activityReminderService").start();
  // 注销冷静期到期后真正删除账号数据（每小时扫描 pending 且 scheduled_for<=NOW 的申请）
  require("./services/accountDeletionService").start();
  // 订阅消息待发补发：合并窗口过期 / 额度恢复后把「本该发但没发出去」的通知补上
  require("./services/subscribeRetryService").start();
  // 媒体内容安全：定时刷新「异步检测已判违规」的地址集合，读取出口统一过滤
  require("./services/mediaCheckService").start();
  // 计数器对账：修正点赞/评论/收藏/蹲贴/转发计数与明细表的双写偏差（P22）
  require("./services/counterReconcileService").start();
  // 微信群播报（论坛广播）：定时聚合新帖生成「摘要+小程序短链」文案，BROADCAST_ENABLED=1 才开定时
  require("./services/groupBroadcastService").start();
}

start().catch((err) => {
  console.error("[Startup]", err.message);
  process.exit(1);
});

function shutdown() {
  if (!server) {
    pool.end().then(() => process.exit(0));
    return;
  }
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = app;
