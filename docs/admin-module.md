# 管理员模块

## 范围与数据模型

本小程序是原生微信客户端，后端使用 Express 和 MySQL。管理员模块管理论坛帖子、可配置内容、功能设置、虚拟物品、用户账户状态以及平台指标。现有公开帖子查询继续只返回 `forum_post.status = 1` 的记录，因此隐藏和已删除的帖子不会暴露给普通用户。

本次迁移新增了 `sys_user.role`、`forum_post.pinned`、`forum_post.review_note` 字段，以及以下数据表：`admin_audit_log`、`system_content`、`feature_config`、`virtual_item` 和 `virtual_item_log`。

初始功能配置项为 `community.enabled`、`errand.enabled`、`repair.enabled` 和 `schedule.enabled`。已禁用的配置会在其 API 路由之前被拦截并返回 HTTP 503；不存在的配置默认视为启用，以保证迁移期间的向后兼容性。

## 角色

| 角色 | 权限 |
| --- | --- |
| `super_admin` | 全部权限，包括角色分配 |
| `content_admin` | 帖子审核、内容/配置管理、仪表盘 |
| `user_admin` | 用户状态管理、仪表盘 |
| `operator` | 虚拟物品、功能配置、仪表盘 |
| `user` | 无管理权限 |

在用户存在后分配第一个管理员。这一步被刻意设计为仅通过数据库引导操作，以防止公开账号自行提权：

```sql
UPDATE sys_user SET role = 'super_admin' WHERE id = <受信任的用户ID>;
```

## 安全与审计行为

所有 `/api/v1/admin/*` 路由都会验证 Bearer Token、检查当前数据库账户状态，并在服务端校验所需角色权限。禁用账户会使后续认证请求立即失效。客户端入口仅为便捷访问；直接导航无法绕过 API 校验。

帖子删除、审核、置顶、批量审核、内容变更、功能变更、虚拟物品变更、用户状态变更和角色变更都会写入 `admin_audit_log`。虚拟物品的创建/更新操作还会额外将操作前后的快照写入 `virtual_item_log`。最后一个启用的超级管理员不能被降级或禁用。

## 验证

在 `server` 目录下运行 `npm test`。测试涵盖现有的冒烟/协议测试以及角色权限和中间件拒绝/放行测试。针对可访问的开发数据库运行 `npm run verify:admin`，以执行幂等迁移并验证新表、角色字段和预置的功能开关。客户端管理页面注册为 `pages/admin/index`；上线前请使用每种角色、已禁用账户、空列表、100条帖子批量操作、无效输入和过期 Token 分别进行测试。