# -*- coding: utf-8 -*-
import paramiko
import os
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SERVER = os.getenv("DEPLOY_SERVER", "193.112.187.95")
USER = os.getenv("DEPLOY_USER", "root")
PASS = os.getenv("DEPLOY_PASSWORD")
REMOTE_BASE = os.getenv("DEPLOY_REMOTE_BASE", "/home/springboot/server")
APP_VERSION = os.getenv("DEPLOY_APP_VERSION", "")
LOCAL_BASE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(LOCAL_BASE, ".workbuddy", "deploy_log.txt")

log_lines = []

def log(msg):
    print(msg)
    log_lines.append(str(msg))

if not PASS:
    log("缺少 DEPLOY_PASSWORD 环境变量，已停止部署。")
    sys.exit(1)

# 全量核心后端文件（controllers/routes/utils/app/配置/依赖清单）
# 新增控制器/路由后务必同步此清单：社团（club）、群聊（group-chat）、校园活动（activity）
# 三个模块曾长期漏在清单外，导致 deploy_full.py 跑完线上仍是旧代码。
files = [
    "app.js",
    "ecosystem.config.js",
    "package.json",
    "controllers/activityController.js",
    "controllers/adminController.js",
    "controllers/clubController.js",
    "controllers/commentController.js",
    "controllers/configController.js",
    "controllers/errandController.js",
    "controllers/feedbackController.js",
    "controllers/groupChatController.js",
    "controllers/messageController.js",
    "controllers/notificationController.js",
    "controllers/paymentController.js",
    "controllers/postController.js",
    "controllers/repairController.js",
    "controllers/reviewController.js",
    "controllers/scheduleController.js",
    "controllers/serviceController.js",
    "controllers/shareController.js",
    "controllers/uploadController.js",
    "controllers/userController.js",
    "controllers/walletController.js",
    "routes/activityRoutes.js",
    "routes/adminRoutes.js",
    "routes/clubRoutes.js",
    "routes/commentRoutes.js",
    "routes/configRoutes.js",
    "routes/errandRoutes.js",
    "routes/feedbackRoutes.js",
    "routes/groupChatRoutes.js",
    "routes/messageRoutes.js",
    "routes/notificationRoutes.js",
    "routes/paymentRoutes.js",
    "routes/postRoutes.js",
    "routes/powerProxyRoutes.js",
    "routes/repairRoutes.js",
    "routes/reviewRoutes.js",
    "routes/scheduleRoutes.js",
    "routes/serviceRoutes.js",
    "routes/shareRoutes.js",
    "routes/userRoutes.js",
    "routes/walletRoutes.js",
    "routes/subscribeRoutes.js",
    "services/errandExpiryService.js",
    "services/subscribeService.js",
    # 订阅消息待发补发任务（app.js 启动时 require，漏传会导致服务 MODULE_NOT_FOUND 崩溃）
    "services/subscribeRetryService.js",
    "services/activityReminderService.js",
    "services/notificationService.js",
    # 内容安全与上传链路（P02/P09/P14 修复涉及，漏传会让线上继续跑旧逻辑）
    "middleware/contentSecurity.js",
    "middleware/rateLimit.js",
    "config/cos.js",
    "services/accountDeletionService.js",
    # 媒体异步内容安全检测与违规回调下线：app.js 启动时 require，漏传直接 MODULE_NOT_FOUND
    "services/mediaCheckService.js",
    "routes/wechatPushRoutes.js",
    # 计数器对账任务（P22），同样被 app.js 启动时 require
    "services/counterReconcileService.js",
    "services/ocrService.js",
    "scripts/verify-wechat-config.js",
    "controllers/activityController.js",
    "controllers/errandController.js",
    "controllers/messageController.js",
    "controllers/subscribeController.js",
    "middleware/auth.js",
    "utils/adminAudit.js",
    "utils/defaultProfile.js",
    "utils/helpers.js",
    "utils/migrations.js",
    "utils/wechatToken.js",
    "sql/init.sql",
]

# 教务同步服务运行时会调用工作区外的爬虫脚本，后端逻辑变更时需要同步上传。
extra_files = [
    ("jw-crawler/captcha-ocr.js", "/home/springboot/jw-crawler/captcha-ocr.js"),
    ("jw-crawler/crawler.js", "/home/springboot/jw-crawler/crawler.js"),
]

missing = [f for f in files if not os.path.exists(os.path.join(LOCAL_BASE, "server", f.replace("/", os.sep)))]
if missing:
    log("本地缺失文件: " + ", ".join(missing))
    sys.exit(1)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect(SERVER, username=USER, password=PASS, timeout=15)
except Exception as e:
    log("SSH 连接失败: %r" % e)
    with open(LOG_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(log_lines))
    sys.exit(1)

sftp = ssh.open_sftp()

# 确保远端目录存在
# middleware/ 与 config/ 也要建目录：内容安全中间件、限流与 COS 封装都在这两个目录下
for d in ["controllers", "routes", "services", "utils", "middleware", "config", "scripts"]:
    ssh.exec_command("mkdir -p '%s/%s'" % (REMOTE_BASE, d))

ok, fail = 0, 0
for rel in files:
    local = os.path.join(LOCAL_BASE, "server", rel.replace("/", os.sep))
    remote = "%s/%s" % (REMOTE_BASE, rel)
    try:
        sftp.put(local, remote)
        ok += 1
        log("OK  %s" % rel)
    except Exception as e:
        fail += 1
        log("FAIL  %s  (%r)" % (rel, e))

for local_rel, remote_abs in extra_files:
    local = os.path.join(LOCAL_BASE, local_rel.replace("/", os.sep))
    try:
        sftp.put(local, remote_abs)
        ok += 1
        log("OK  %s -> %s" % (local_rel, remote_abs))
    except Exception as e:
        fail += 1
        log("FAIL  %s  (%r)" % (local_rel, e))

sftp.close()
log("上传完成: 成功 %d 个, 失败 %d 个" % (ok, fail))

# 备份并重启 pm2
log("\n重启服务...")
commands = [
    "cd %s && cp package.json package.json.bak 2>/dev/null; true" % REMOTE_BASE,
    "cd %s && npm install --production --no-audit --no-fund 2>&1 | tail -3" % REMOTE_BASE,
]
if APP_VERSION:
    version = APP_VERSION.replace("'", "'\\''")
    commands.append(
        "cd %s && cp .env .env.bak && "
        "if grep -q '^APP_VERSION=' .env; then "
        "sed -i 's/^APP_VERSION=.*/APP_VERSION=%s/' .env; "
        "else printf '\\nAPP_VERSION=%s\\n' >> .env; fi" % (REMOTE_BASE, version, version)
    )
commands.extend([
    "pm2 restart GQG-campus 2>&1 || pm2 restart all 2>&1",
    "sleep 3 && pm2 list 2>&1",
    "sleep 2 && pm2 logs GQG-campus --lines 8 --nostream 2>&1",
])
for cmd in commands:
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        log(out.strip())
    if err.strip():
        log("[stderr] " + err.strip())

ssh.close()
log("\nDone!")

with open(LOG_PATH, "w", encoding="utf-8") as fh:
    fh.write("\n".join(log_lines))
