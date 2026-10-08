import paramiko
import os
import base64
import sys
import argparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SERVER = "193.112.187.95"
USER = "root"
PASS = "Wzl@88888"
REMOTE_BASE = "/home/springboot/server"
APP_VERSION = os.getenv("DEPLOY_APP_VERSION", "")
# nginx 直接托管的静态站点目录（小程序 web-view 用的 H5 页面、微信业务域名校验文件放这里）
STATIC_REMOTE_BASE = "/www/wwwroot/payun01.cn"
LOCAL_BASE = r"d:\校园论坛小程序"

files = [
    ("server/app.js", "app.js"),
    ("server/controllers/adminController.js", "controllers/adminController.js"),
    ("server/controllers/serviceController.js", "controllers/serviceController.js"),
    ("server/controllers/userController.js", "controllers/userController.js"),
    ("server/controllers/uploadController.js", "controllers/uploadController.js"),
    ("server/controllers/errandController.js", "controllers/errandController.js"),
    ("server/controllers/messageController.js", "controllers/messageController.js"),
    ("server/controllers/commentController.js", "controllers/commentController.js"),
    ("server/controllers/configController.js", "controllers/configController.js"),
    ("server/controllers/scheduleController.js", "controllers/scheduleController.js"),
    ("server/routes/scheduleRoutes.js", "routes/scheduleRoutes.js"),
    ("server/services/jwScheduleSyncService.js", "services/jwScheduleSyncService.js"),
    ("server/routes/configRoutes.js", "routes/configRoutes.js"),
    ("server/routes/powerProxyRoutes.js", "routes/powerProxyRoutes.js"),
    ("server/controllers/postController.js", "controllers/postController.js"),
    ("server/routes/adminRoutes.js", "routes/adminRoutes.js"),
    # 维修预约：用户端 repairRoutes + 管理端「日志 → 维修信息」的 adminListOrders 都在 repairController，
    # 两者必须同批上传（只传路由会 MODULE_NOT_FOUND）
    ("server/controllers/repairController.js", "controllers/repairController.js"),
    ("server/controllers/reviewController.js", "controllers/reviewController.js"),
    ("server/routes/repairRoutes.js", "routes/repairRoutes.js"),
    ("server/routes/reviewRoutes.js", "routes/reviewRoutes.js"),
    ("server/routes/userRoutes.js", "routes/userRoutes.js"),
    ("server/routes/postRoutes.js", "routes/postRoutes.js"),
    ("server/routes/feedbackRoutes.js", "routes/feedbackRoutes.js"),
    ("server/routes/errandRoutes.js", "routes/errandRoutes.js"),
    ("server/controllers/feedbackController.js", "controllers/feedbackController.js"),
    ("server/services/errandExpiryService.js", "services/errandExpiryService.js"),
    ("server/services/subscribeService.js", "services/subscribeService.js"),
    ("server/services/wechatService.js", "services/wechatService.js"),
    # 订阅消息路由与控制器：本轮新增了 POST /subscribe/throttled（上报「命中弹窗节流」），
    # 缺这两个文件会出现「客户端上报 404、后台「命中节流」永远为空」。
    ("server/controllers/subscribeController.js", "controllers/subscribeController.js"),
    ("server/routes/subscribeRoutes.js", "routes/subscribeRoutes.js"),
    # 订阅消息待发补发任务（app.js 启动时 require，漏传会导致服务 MODULE_NOT_FOUND 崩溃）
    ("server/services/subscribeRetryService.js", "services/subscribeRetryService.js"),
    ("server/services/accountDeletionService.js", "services/accountDeletionService.js"),
    ("server/services/wechatPayV3Service.js", "services/wechatPayV3Service.js"),
    # 内容安全与上传链路（P02/P09/P14）：文本检测中间件、限流、COS 删除能力、私信路由
    ("server/routes/messageRoutes.js", "routes/messageRoutes.js"),
    ("server/middleware/contentSecurity.js", "middleware/contentSecurity.js"),
    ("server/middleware/rateLimit.js", "middleware/rateLimit.js"),
    ("server/config/cos.js", "config/cos.js"),
    # 通知快照与活动提醒占位修正（P20/P21/P13）
    ("server/services/notificationService.js", "services/notificationService.js"),
    ("server/services/activityReminderService.js", "services/activityReminderService.js"),
    # 媒体异步检测与计数器对账：app.js 启动即 require，漏传会 MODULE_NOT_FOUND 崩溃
    ("server/services/mediaCheckService.js", "services/mediaCheckService.js"),
    ("server/services/counterReconcileService.js", "services/counterReconcileService.js"),
    ("server/routes/wechatPushRoutes.js", "routes/wechatPushRoutes.js"),
    ("server/config/wechatPay.js", "config/wechatPay.js"),
    ("server/utils/migrations.js", "utils/migrations.js"),
    ("server/sql/init.sql", "sql/init.sql"),
]

static_files = [
    ("web-static/wechat-qr.html", "wechat-qr.html"),
    ("web-static/assets/admin-wechat-qr.png", "assets/admin-wechat-qr.png"),
    ("web-static/services/index.html", "services/index.html"),
    ("web-static/embed.html", "embed.html"),
]

# 非 server 目录的远端文件（绝对远端路径）：教务爬虫被 jwScheduleSyncService 引用，
# 改动 crawler.js 后必须同步上传，否则线上仍是旧逻辑
extra_files = [
    ("jw-crawler/crawler.js", "/home/springboot/jw-crawler/crawler.js"),
]

parser = argparse.ArgumentParser()
parser.add_argument("--static-only", action="store_true", help="只上传静态网页文件，不动 node 服务")
args = parser.parse_args()

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(SERVER, username=USER, password=PASS, timeout=10)
sftp = ssh.open_sftp()

if not args.static_only:
    for local_rel, remote_rel in files:
        local = os.path.join(LOCAL_BASE, local_rel)
        # 新增文件可能落在还没建立的目录里（如 middleware/、config/）
        ssh.exec_command(f"mkdir -p '{REMOTE_BASE}/{os.path.dirname(remote_rel).replace(chr(92), '/')}'")
        remote = f"{REMOTE_BASE}/{remote_rel.replace(chr(92), '/')}"
        print(f"Uploading: {local_rel}")
        sftp.put(local, remote)
        print(f"  OK")

    for local_rel, remote_abs in extra_files:
        local = os.path.join(LOCAL_BASE, local_rel)
        ssh.exec_command(f"mkdir -p '{os.path.dirname(remote_abs)}'")
        print(f"Uploading extra: {local_rel} -> {remote_abs}")
        sftp.put(local, remote_abs)
        print(f"  OK")

# 静态网页文件（nginx 直接托管，无需重启 pm2）
for local_rel, remote_rel in static_files:
    local = os.path.join(LOCAL_BASE, local_rel)
    remote = f"{STATIC_REMOTE_BASE}/{remote_rel}"
    ssh.exec_command(f"mkdir -p '{os.path.dirname(remote)}'")
    print(f"Uploading static: {local_rel}")
    sftp.put(local, remote)
    print(f"  OK")

sftp.close()

if args.static_only:
    ssh.close()
    print("Done (static only)!")
    sys.exit(0)

if APP_VERSION:
    if not __import__("re").fullmatch(r"\d+\.\d+\.\d+", APP_VERSION):
        raise ValueError("DEPLOY_APP_VERSION 必须是 x.y.z 格式")
    print(f"Updating APP_VERSION to {APP_VERSION}...")
    version_cmd = (
        f"cd {REMOTE_BASE} && cp .env .env.bak-$(date +%Y%m%d%H%M%S) && "
        f"if grep -q '^APP_VERSION=' .env; then "
        f"sed -i 's/^APP_VERSION=.*/APP_VERSION={APP_VERSION}/' .env; "
        f"else printf '\\nAPP_VERSION={APP_VERSION}\\n' >> .env; fi"
    )
    stdin, stdout, stderr = ssh.exec_command(version_cmd)
    err = stderr.read().decode()
    if err:
        raise RuntimeError(err)

# Restart server
print("\nRestarting server...")
stdin, stdout, stderr = ssh.exec_command("pm2 restart GQG-campus")
out = stdout.read().decode()
err = stderr.read().decode()
if out: print(out)
if err: print("ERR:", err)

stdin, stdout, stderr = ssh.exec_command("sleep 2 && pm2 list")
out = stdout.read().decode()
print(out)

ssh.close()
print("Done!")
