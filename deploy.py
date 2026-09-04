import paramiko
import os
import base64

SERVER = "193.112.187.95"
USER = "root"
PASS = "Wzl@88888"
REMOTE_BASE = "/home/springboot/server"
LOCAL_BASE = r"d:\校园论坛小程序"

files = [
    ("server/app.js", "app.js"),
    ("server/controllers/adminController.js", "controllers/adminController.js"),
    ("server/controllers/userController.js", "controllers/userController.js"),
    ("server/controllers/errandController.js", "controllers/errandController.js"),
    ("server/routes/adminRoutes.js", "routes/adminRoutes.js"),
    ("server/routes/userRoutes.js", "routes/userRoutes.js"),
    ("server/utils/migrations.js", "utils/migrations.js"),
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(SERVER, username=USER, password=PASS, timeout=10)
sftp = ssh.open_sftp()

for local_rel, remote_rel in files:
    local = os.path.join(LOCAL_BASE, local_rel)
    remote = f"{REMOTE_BASE}/{remote_rel.replace(chr(92), '/')}"
    print(f"Uploading: {local_rel}")
    sftp.put(local, remote)
    print(f"  OK")

sftp.close()

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
