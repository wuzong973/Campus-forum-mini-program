import paramiko

SERVER = "193.112.187.95"
USER = "root"
PASS = "Wzl@88888"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(SERVER, username=USER, password=PASS, timeout=10)

cmds = [
    "pm2 logs GQG-campus --lines 10 --nostream",
]
for cmd in cmds:
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out: print(out)
    if err: print("STDERR:", err)

ssh.close()
