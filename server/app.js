const path = require("path");
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
    "WX_PRIVATE_KEY", "WX_PAY_NOTIFY_URL", "UPLOAD_PUBLIC_BASE_URL", "UPLOAD_STORAGE_DRIVER", "CORS_ORIGIN"
  ]
  const placeholders = new Set(["", "change_me_in_local_only", "your_appid", "your_appsecret", "replace-with-secret-manager"])
  const missing = required.filter((key) => placeholders.has(String(process.env[key] || "").trim()))
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
const scheduleRoutes = require("./routes/scheduleRoutes");
const errandRoutes = require("./routes/errandRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const repairRoutes = require("./routes/repairRoutes");
const adminRoutes = require("./routes/adminRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const walletRoutes = require("./routes/walletRoutes");
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
app.use(requestContext);
app.use(logger);
app.use(rateLimit({ max: 120 }));
// Local disk uploads are useful only for development. Production must use a
// controlled object store and expose its HTTPS base URL via configuration.
if (process.env.NODE_ENV !== "production") {
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
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
app.use("/api/v1/schedule", featureFlag("schedule.enabled"), scheduleRoutes);
app.use("/api/v1/errand", featureFlag("errand.enabled"), errandRoutes);
app.use("/api/v1/service", serviceRoutes);
app.use("/api/v1/repair", featureFlag("repair.enabled"), repairRoutes);
app.use("/api/v1/payment", paymentRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/notification", notificationRoutes);
app.use("/api/v1/feedback", feedbackRoutes);
app.use("/api/v1/wallet", walletRoutes);

app.use("/api/v1/*", (req, res) => fail(res, "接口不存在", 404));

app.use(errorHandler);

let server = null;

async function start() {
  await runMigrations();
  server = app.listen(PORT, () => {
    console.log(`广轻工后端服务运行在端口 ${PORT}`);
  });
  wsServer.init(server);
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
