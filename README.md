# 校园小程序第二版

一个基于微信小程序和 Node.js 服务端的校园论坛/服务平台项目，包含首页、帖子、任务、校园日程、用户中心等模块。

## 项目结构

- 小程序前端：`app.js`、`pages/`、`components/`、`utils/`
- 服务端：`server/`
- 教务系统爬虫：`教务系统爬虫/`

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
   - 爬虫目录执行：`cd "教务系统爬虫" && npm install`
2. 配置环境变量
   - 参考 `server/.env.example` 和 `教务系统爬虫/.env.example`
3. 启动服务
   - 服务端：`cd server && npm run dev`
   - 爬虫脚本：`cd "教务系统爬虫" && node crawler.js`

## 说明

- 本项目包含测试数据、开发调试文件和本地配置文件，实际部署时请根据环境进行调整。
- 如需公开使用，请自行替换敏感配置和密钥。
