# 校园论坛小程序

面向校园生活的微信小程序与配套服务端，提供校园社区、课程管理和校园服务等功能。项目采用原生微信小程序 + Node.js 服务端的单仓库结构，业务数据由服务端和 MySQL 管理。

## 功能概览

- **校园社区**：帖子发布与浏览、评论互动、热榜、搜索、用户主页和内容治理。
- **即时沟通**：私信、群聊、未读消息同步与 WebSocket 实时消息。
- **校园生活服务**：跑腿任务、维修预约、活动、社团、校园服务与评价。
- **课程管理**：课表查看与编辑、教务系统课表同步、验证码识别及图片 OCR 导入。
- **账户与运营**：微信登录、用户资料、通知订阅、小程序内管理功能。

部分功能依赖微信开放平台、教务系统、支付渠道、Redis 或对象存储的有效配置；未配置时，相应能力可能不可用。项目不附带可供本地直接使用的演示账号或 Mock 业务数据。

## 项目结构

```text
.
├── pages/、components/、utils/   # 原生微信小程序页面、组件与公共逻辑
├── pkg-admin/、pkg-schedule/     # 管理与课表分包
├── server/                       # Express API、WebSocket 与数据库迁移
├── jw-crawler/                   # 教务系统登录、课表抓取与验证码 OCR
├── assets/                       # 小程序静态资源
└── docs/                          # 架构、业务与运维文档
```

## 技术栈

| 模块           | 技术                                           |
| -------------- | ---------------------------------------------- |
| 小程序         | 微信原生框架、JavaScript、WXML、WXSS           |
| 服务端         | Node.js 18+、Express、JWT、WebSocket           |
| 数据与缓存     | MySQL、Redis                                   |
| 教务同步       | Node.js、Axios、Cheerio、Tesseract.js          |
| 文件与微信能力 | 微信登录/内容安全/支付、腾讯云 COS（按需配置） |

## 本地开发

### 环境要求

- Node.js 18 或更高版本、npm
- 微信开发者工具
- 如需完整运行服务端：MySQL、Redis，以及对应的微信小程序配置

### 启动服务端

```bash
cd server
npm install
```

将 `server/.env.example` 复制为 `server/.env` 并填写本地配置。Windows PowerShell 可运行：

```powershell
Copy-Item .env.example .env
```

至少配置数据库连接、`JWT_SECRET` 和 `WX_APPID` / `WX_APPSECRET`。支付、COS、订阅消息等配置按需填写。空数据库可使用 `server/sql/init.sql` 初始化；服务端启动时也会运行数据库迁移。

启动开发服务：

```bash
npm run dev
```

健康检查地址：`http://localhost:3000/api/v1/health`。要让小程序访问本地服务，还需将 `utils/request.js` 中的 API 地址改为本地可访问的 HTTPS 地址，并在微信开发者工具及小程序后台配置相应合法域名。

### 打开小程序

使用微信开发者工具导入仓库根目录，并选择自己的小程序 AppID。小程序端无需在仓库根目录执行 `npm install`；根目录 `package.json` 中的依赖供项目工具脚本使用。

### 教务爬虫独立调试

爬虫通常由服务端课表同步流程调用。如需单独调试，先进入 `jw-crawler/`，安装依赖并按 `jw-crawler/.env.example` 配置环境，再根据 [爬虫说明](jw-crawler/crawler-info.md) 和 [小程序 API 文档](jw-crawler/MINI_PROGRAM_API.md) 选择命令。教务账号凭证属于敏感信息，请勿提交到仓库或日志。

## 测试

服务端测试：

```bash
cd server
npm test
```

爬虫语法检查：

```bash
cd jw-crawler
npm run check
```

## 文档

- [项目架构与核心业务流程](docs/项目架构与核心业务流程.md)
- [管理后台运维与发布合规](docs/管理后台运维与发布合规.md)
- [教务系统对接与 OCR 识别](docs/教务系统对接与OCR识别.md)
- [校园服务与评价模块](docs/校园服务与评价模块.md)
- [订单跑腿与支付钱包](docs/订单跑腿与支付钱包.md)
- [文档索引](docs/README_文档索引.md)

## 配置与安全

- 本地环境变量使用各模块提供的 `.env.example`；真实 `.env`、密钥、证书、用户数据和生产数据库备份不得提交。
- 生产部署需自行准备 HTTPS 域名、MySQL、Redis、微信小程序资质及合法域名；支付和对象存储需要单独配置并完成验收。
- 发布前请阅读[管理后台运维与发布合规](docs/管理后台运维与发布合规.md)，并逐项核对微信隐私、内容安全、支付回调和备份要求。

## 许可证

本项目采用 [MIT License](LICENSE)。
