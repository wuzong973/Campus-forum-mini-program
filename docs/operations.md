# 运维：备份、恢复与可靠性

## MySQL 备份策略

1. 启用 MySQL 二进制日志，保留期应长于全量备份保留期。
2. 在低流量时段每日运行一次 `server/scripts/backup-mysql.ps1 -Mode full`。
3. 每小时运行 `server/scripts/backup-mysql.ps1 -Mode incremental -BinlogStart mysql-bin.000001:4`。在下次运行前将成功结束的文件/位置持久化到调度器状态中。
4. 将备份复制到应用服务器之外并加密存储。每日全量备份至少保留 14 天，每季度进行一次恢复测试。

该脚本从 `server/.env` 读取数据库凭证，仅对子客户端进程设置 `MYSQL_PWD`，并在退出前清除。脚本要求 `mysqldump`、`mysqlbinlog` 和 `mysql` 在 `PATH` 中可用。

## 恢复演练

1. 使用 `restore-mysql.ps1 -BackupFile <路径> -ConfirmRestore` 将最新全量备份恢复到隔离数据库。
2. 按时间顺序使用 `mysql` 应用增量 binlog 文件。
3. 运行完整性检查：`sys_user`、`forum_post`、`private_message`、`user_schedule`、`errand_order` 和 `repair_order` 的行数；验证最新创建时间戳。
4. 记录恢复点目标和恢复时间目标。建议初始目标：RPO ≤ 1 小时，RTO ≤ 4 小时。

## 监控与访问控制

- 为应用程序、备份工作进程和模式迁移分别使用独立的 MySQL 用户。应用程序用户不得拥有 `DROP`、`GRANT` 或全局管理权限。
- 生产环境仅保持 HTTPS 和 WSS。当引入浏览器管理控制台时，配置 CORS 使用显式允许的来源，而非 `*`。
- 在隐私政策允许的范围内，发送包含 `requestId`、路由、状态码、耗时和认证用户 ID 的结构化日志。切勿记录 JWT、授权码、手机号、密码或支付密钥。
- 对 5xx 错误率、MySQL 连接池饱和、Redis 错误、WebSocket 重连量、支付回调失败和备份作业失败设置告警。