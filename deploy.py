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
# nginx 直接托管的静态站点目录（小程序 web-view 用的 H5 页面、微信业务域名校验文件放这里）
STATIC_REMOTE_BASE = "/www/wwwroot/payun01.cn"
LOCAL_BASE = r"d:\校园论坛小程序"

files = [
    ("server/app.js", "app.js"),
    ("server/controllers/adminController.js", "controllers/adminController.js"),
    ("server/controllers/userController.js", "controllers/userController.js"),
    ("server/controllers/uploadController.js", "controllers/uploadController.js"),
    ("server/controllers/errandController.js", "controllers/errandController.js"),
    ("server/controllers/messageController.js", "controllers/messageController.js"),
    ("server/controllers/configController.js", "controllers/configController.js"),
    ("server/controllers/scheduleController.js", "controllers/scheduleController.js"),
    ("server/routes/configRoutes.js", "routes/configRoutes.js"),
    ("server/controllers/postController.js", "controllers/postController.js"),
    ("server/routes/adminRoutes.js", "routes/adminRoutes.js"),
    ("server/routes/userRoutes.js", "routes/userRoutes.js"),
    ("server/routes/postRoutes.js", "routes/postRoutes.js"),
    ("server/routes/feedbackRoutes.js", "routes/feedbackRoutes.js"),
    ("server/routes/errandRoutes.js", "routes/errandRoutes.js"),
    ("server/controllers/feedbackController.js", "controllers/feedbackController.js"),
    ("server/utils/migrations.js", "utils/migrations.js"),
]

static_files = [
    ("web-static/wechat-qr.html", "wechat-qr.html"),
    ("web-static/assets/admin-wechat-qr.png", "assets/admin-wechat-qr.png"),
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
        remote = f"{REMOTE_BASE}/{remote_rel.replace(chr(92), '/')}"
        print(f"Uploading: {local_rel}")
        sftp.put(local, remote)
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
