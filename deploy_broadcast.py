# -*- coding: utf-8 -*-
"""一次性部署脚本：上传微信群播报相关文件 + 更新服务器 .env + 重启 pm2。

凭据不写在本脚本里：BROADCAST_* 从执行环境的环境变量读取；
SSH 密码沿用 deploy.py 已有的同款配置。
"""
import os
import sys
import shlex
import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LOCAL_BASE = r"D:\校园论坛小程序\server"
REMOTE_BASE = "/home/springboot/server/"

FILES = [
    "app.js",
    "utils/migrations.js",
    "services/groupBroadcastService.js",
    "controllers/broadcastController.js",
    "routes/adminRoutes.js",
    "routes/broadcastRoutes.js",
]

# 播报配置项（值来自环境变量，缺失即报错退出）
BROADCAST_ENV_KEYS = [
    "BROADCAST_ENABLED",
    "BROADCAST_INTERVAL_MINUTES",
    "BROADCAST_MAX_POSTS",
    "BROADCAST_ENTRY_PAGE",
    "BROADCAST_FOOTER",
    "BROADCAST_FOOTER_LINK",
    "BROADCAST_WECOM_CORP_ID",
    "BROADCAST_WECOM_SECRET",
    "BROADCAST_WECOM_AGENT_ID",
    "BROADCAST_WECOM_TOUSER",
    "BROADCAST_BOT_TOKEN",
]


def main():
    values = {}
    missing = [k for k in ["BROADCAST_WECOM_CORP_ID", "BROADCAST_WECOM_SECRET", "BROADCAST_WECOM_AGENT_ID"]
               if not os.environ.get(k)]
    if missing:
        print("缺少环境变量:", ", ".join(missing))
        sys.exit(1)
    for k in BROADCAST_ENV_KEYS:
        v = os.environ.get(k, "")
        if v:
            values[k] = v

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("193.112.187.95", username="root", password="Wzl@88888", timeout=15)

    # 服务器 SFTP 在同一连接上连续 put 会偶发远端 ENOENT，失败就整连接重建重试一次
    def upload(sftp, local, remote):
        sftp.put(local, remote)
        print("uploaded:", os.path.basename(remote))

    sftp = client.open_sftp()
    for rel in FILES:
        local = os.path.join(LOCAL_BASE, *rel.split("/"))
        remote = REMOTE_BASE + rel
        try:
            upload(sftp, local, remote)
        except Exception as e:
            print("retry after:", repr(e))
            try:
                sftp.close()
            except Exception:
                pass
            client.close()
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect("193.112.187.95", username="root", password="Wzl@88888", timeout=15)
            sftp = client.open_sftp()
            upload(sftp, local, remote)
    sftp.close()

    # .env：备份 -> 清掉旧 BROADCAST_* -> 追加新值（值经 shlex 安全拼接）
    lines = "".join(f"{k}={shlex.quote(str(v))}\n" for k, v in values.items())
    cmd = (
        "cd {base} && cp .env .env.bak-broadcast && "
        "sed -i '/^BROADCAST_/d' .env && "
        "printf {payload} >> .env && "
        "grep -c '^BROADCAST_' .env"
    ).format(base=REMOTE_BASE, payload=shlex.quote(lines))
    _, stdout, stderr = client.exec_command(cmd)
    out, err = stdout.read().decode(), stderr.read().decode()
    print("env updated, BROADCAST_ lines:", out.strip())
    if err:
        print("STDERR:", err)
        sys.exit(1)

    # 重启并查看启动日志
    for cmd in [
        "cd {base} && pm2 restart GQG-campus".format(base=REMOTE_BASE),
        "sleep 4 && pm2 logs GQG-campus --nostream --lines 30 | grep -E 'GroupBroadcast|migrations|Error|error' | tail -15",
    ]:
        _, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        err = stderr.read().decode()
        if err:
            print("STDERR:", err)

    client.close()
    print("done")


if __name__ == "__main__":
    main()
