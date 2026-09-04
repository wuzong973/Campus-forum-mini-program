# 质量检查报告

**项目：** 广轻工校园小程序  
**检查日期：** 2026-06-17  
**检查范围：** 前端全部页面/组件/工具函数 + 后端 server 目录

---

## 1. 检查摘要

| 维度 | 检查前 | 检查后 | 状态 |
|------|--------|--------|------|
| 语法错误 | 1 处（wechat.js 上传函数） | 0 | ✅ 已修复 |
| 页面路由注册 | wallet 未注册 | 已注册 | ✅ 已修复 |
| 数据一致性 | 分类/校区命名不一致 | 已统一 | ✅ 已修复 |
| API 对接 | 几乎全部 Mock | 统一 api.js 层 + Mock 降级 | ✅ 已完善 |
| 后端安全 | 多项 P0 问题 | 事务/校验/共享连接池 | ✅ 已加固 |
| 图片优化 | 无懒加载/压缩 | lazy-load + compressImage | ✅ 已实现 |
| 字体规范 | 仅基础变量 | 完整 text-h1~small 层级 | ✅ 已实现 |
| 错误处理 | 静默失败 | 超时/401/友好提示 | ✅ 已实现 |

---

## 2. 已修复问题清单

### 2.1 前端

| 编号 | 文件 | 问题 | 修复方案 |
|------|------|------|----------|
| F-01 | `utils/wechat.js` | uploadImages 语法错误 | 重写上传逻辑 |
| F-02 | `app.json` | wallet 页面未注册 | 添加 pages/wallet/index |
| F-03 | `utils/mock.js` | 帖子分类与筛选项不匹配 | 统一 categories 数组 |
| F-04 | `utils/mock.js` | 跑腿校区与 UI 不一致 | 改为佛山/广州校区 |
| F-05 | `pages/index/index.js` | 分类筛选永远为空 | 接入 api.getPostList |
| F-06 | `pages/settings/index.js` | 资料不持久化 | auth.syncProfile + Storage |
| F-07 | `pages/schedule/index` | 无课表网格 | 新增课程网格渲染 |
| F-08 | `pages/schedule-add` | 保存不落库 | localStorage + API 双写 |
| F-09 | `post-card` | 图片无懒加载 | 添加 lazy-load |
| F-10 | 多处页面 | 无登录拦截 | auth.requireLogin 统一封装 |

### 2.2 后端

| 编号 | 文件 | 问题 | 修复方案 |
|------|------|------|----------|
| B-01 | 6 个 controller | 各自创建连接池 | 统一 config/pool.js |
| B-02 | postController | JSON.parse 数组崩溃 | parseImages 工具函数 |
| B-03 | postController | 软删除帖仍可访问 | detail 加 status=1 |
| B-04 | errandController | 接单竞态 | FOR UPDATE 事务 |
| B-05 | like/favorite | 计数可能为负 | GREATEST + 事务 |
| B-06 | 路由缺失 | upload/content-check | 新增接口 |
| B-07 | rateLimit | Redis 不可用时限流失效 | express-rate-limit 降级 |
| B-08 | app.js | 无 404/优雅关闭 | 补充处理 |

---

## 3. 代码规范评估

- **命名规范：** 符合微信小程序驼峰命名，后端 snake_case 数据库字段 + camelCase API 响应
- **模块化：** 新增 `utils/auth.js`、`utils/api.js`、`utils/image.js` 职责分离
- **注释：** 关键业务逻辑有注释，无冗余注释
- **安全性：** 生产环境强制 JWT_SECRET；学号认证防重复；pageSize 上限 50

---

## 4. 剩余建议（上线前）

1. 完成服务端部署、HTTPS 合法域名和数据库验收后，再将 `utils/request.js` 中 `USE_MOCK` 改为 `false`
2. 替换 `assets/tabbar/` 占位图标为设计稿图标
3. 配置微信服务器域名白名单
4. 执行 `server/sql/init.sql` 初始化生产数据库
5. 配置 Nginx 反向代理与 SSL 证书

---

## 5. 结论

项目已完成系统性质量检查与核心修复。当前默认使用 Mock 数据，避免未部署的线上接口造成空页面；完成服务端部署后再开启真实接口。上线前仍须完成域名、数据库、微信支付与真机验收。
