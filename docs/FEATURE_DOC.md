# 功能实现文档

## 1. 架构概览

```
小程序端 (WXML/WXSS/JS)
    ↓ HTTPS
utils/request.js → utils/api.js (Mock降级)
    ↓
Node.js Express (/api/v1)
    ↓
MySQL 8.0 + Redis 7
```

## 2. 新增/完善模块

### 2.1 工具层

| 模块 | 路径 | 功能 |
|------|------|------|
| 请求封装 | `utils/request.js` | Token注入、超时15s、401跳转、静默模式 |
| API 层 | `utils/api.js` | 统一 Mock/API 双通道数据获取 |
| 鉴权 | `utils/auth.js` | 登录检查、用户信息持久化、资料同步 |
| 图片 | `utils/image.js` | 压缩、批量选择、图标常量 |
| 微信能力 | `utils/wechat.js` | 登录、内容检查、图片上传 |

### 2.2 用户认证系统

- **登录：** `pages/login` → `wx.login` → `POST /user/wx-login` → JWT
- **持久化：** token/userInfo 写入 Storage + globalData
- **资料管理：** `pages/settings` → `PUT /user/info`（支持昵称/头像/性别/校区/手机）
- **学号认证：** `POST /user/verify`（后端校验学号格式 + 防重复）
- **登录拦截：** 发帖、评论、点赞、发布跑腿等操作调用 `auth.requireLogin`

### 2.3 校园服务入口

- **首页宫格：** `components/service-grid` + mock/API 双数据源
- **全部服务：** `pages/service-all` → `GET /service/list`
- **路由映射：** 代拿跑腿/课程表/社区 → switchTab 跳转

### 2.4 社区论坛

- **列表：** 首页分类筛选 + 下拉刷新 + 上拉分页
- **搜索：** `pages/search` 防抖 400ms + 关键词过滤
- **发帖：** 标签选择 + 图片压缩 + 内容安全检查
- **详情：** 评论列表 + 点赞 + 本地/API 双写

### 2.5 课程表

- **网格视图：** 按星期×时间段渲染课程卡片
- **添加课程：** 表单校验 → localStorage + `POST /schedule/add`
- **OCR识别：** 模拟/接口识别 → 批量导入课表
- **配置：** 开始日期、隐藏周末、背景色、提醒开关（持久化 Storage）

### 2.6 代拿跑腿

- **大厅：** 类型Tab + 校区切换 + 订单列表
- **数据适配：** normalizeOrder 统一 Mock/API 字段差异
- **发布：** 表单校验 + 登录拦截 + API 提交
- **接单：** 确认弹窗 + `POST /errand/:id/accept`

### 2.7 个人中心

- **钱包：** 余额展示 + 交易记录（Mock数据）
- **我的帖子：** 筛选当前用户发布内容
- **我的消息：** 评论/点赞/系统通知 + 已读标记

### 2.8 视觉与排版

- **字体层级：** `text-h1` ~ `text-small` 全局类（app.wxss）
- **图片懒加载：** post-card 头像/帖子图片 `lazy-load`
- **图片压缩：** 发帖/头像选择自动 `wx.compressImage`
- **图标系统：** `utils/image.js` ICONS 常量集中管理

### 2.9 后端新增接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/user/content-check` | 内容安全检查 |
| POST | `/user/upload/image` | 图片上传（multer, 5MB限制） |
| GET | `/health` | 健康检查（含数据库状态） |

## 3. 配置说明

### 前端切换生产模式

```javascript
// utils/request.js
const BASE_URL = 'https://payun01.cn/api/v1'
const USE_MOCK = false
```

### 后端环境变量

复制 `server/.env.example` 为 `.env`，配置 DB、Redis、JWT、微信 AppID。

## 4. 数据流示例：发帖

1. 用户点击发布 → `auth.requireLogin` 检查
2. 选择图片 → `imageUtil.chooseAndCompress`
3. 提交 → `wechat.checkContent` 内容安全
4. `wechat.uploadImages` 上传图片（非Mock）
5. `POST /post` 创建帖子
6. Mock 模式下写入 `mock.posts` 数组
