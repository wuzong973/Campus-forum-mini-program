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
files = [
    "app.js",
    "ecosystem.config.js",
    "package.json",
    "controllers/adminController.js",
    "controllers/commentController.js",
    "controllers/configController.js",
    "controllers/errandController.js",
    "controllers/feedbackController.js",
    "controllers/messageController.js",
    "controllers/notificationController.js",
    "controllers/paymentController.js",
    "controllers/postController.js",
    "controllers/repairController.js",
    "controllers/scheduleController.js",
    "controllers/serviceController.js",
    "controllers/shareController.js",
    "controllers/uploadController.js",
    "controllers/userController.js",
    "controllers/walletController.js",
    "routes/adminRoutes.js",
    "routes/commentRoutes.js",
    "routes/configRoutes.js",
    "routes/errandRoutes.js",
    "routes/feedbackRoutes.js",
    "routes/messageRoutes.js",
    "routes/notificationRoutes.js",
    "routes/paymentRoutes.js",
    "routes/postRoutes.js",
    "routes/repairRoutes.js",
    "routes/scheduleRoutes.js",
    "routes/serviceRoutes.js",
    "routes/shareRoutes.js",
    "routes/userRoutes.js",
    "routes/walletRoutes.js",
    "utils/adminAudit.js",
    "utils/helpers.js",
    "utils/migrations.js",
    "utils/wechatToken.js",
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
for d in ["controllers", "routes", "utils"]:
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

sftp.close()
log("上传完成: 成功 %d 个, 失败 %d 个" % (ok, fail))

# 备份并重启 pm2
log("\n重启服务...")
for cmd in [
    "cd %s && cp package.json package.json.bak 2>/dev/null; true" % REMOTE_BASE,
    "cd %s && npm install --production --no-audit --no-fund 2>&1 | tail -3" % REMOTE_BASE,
    "pm2 restart GQG-campus 2>&1 || pm2 restart all 2>&1",
    "sleep 3 && pm2 list 2>&1",
    "sleep 2 && pm2 logs GQG-campus --lines 8 --nostream 2>&1",
]:
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
