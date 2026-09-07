# 校园小程序第二版

一个基于微信小程序和 Node.js 服务端的校园论坛/服务平台项目，包含首页、帖子、任务、校园日程、用户中心等模块。

## 项目结构

- 小程序前端：`app.js`、`pages/`、`components/`、`utils/`
- 服务端：`server/`
- 教务系统爬虫：`jw-crawler/`

## 技术栈

- 微信小程序
- Node.js
- Express
- MySQL
- 微信登录/授权

## 快速开始

1. 安装依赖
   - 前端小程序无需额外安装依赖
   - 服务端执行：`cd server && npm install`
   - 爬虫目录执行：`cd "jw-crawler" && npm install`
2. 配置环境变量
   - 参考 `server/.env.example` 和 `jw-crawler/.env.example`
3. 启动服务
   - 服务端：`cd server && npm run dev`
   - 爬虫脚本：`cd "jw-crawler" && node crawler.js`

## 说明

- 生产运行不依赖本地 Mock、seed 演示数据或开发登录入口；真实业务数据由服务端数据库产生和维护。
- 部署前请按 `docs/RELEASE_CHECKLIST.md` 配置生产环境变量、微信合法域名、数据库、对象存储与支付回调。
