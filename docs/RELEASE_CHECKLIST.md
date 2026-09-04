# 发布核验清单

## 部署前配置

- 在 `server/.env` 设置强随机 `JWT_SECRET`、生产 MySQL/Redis 配置和真实微信 AppID/AppSecret。
- 在 `server/.env` 设置 `AI_API_KEY`；密钥仅保存于服务端，不能提交到小程序代码或版本库。
- 配置微信支付商户号、证书、回调 HTTPS 地址后，才可启用维修支付相关流程。
- 部署本次服务端代码。服务启动时会执行数据库迁移；新环境也可先执行 `server/sql/init.sql`。
- 确保上传目录已替换为受控对象存储或已配置可访问的 HTTPS 地址。

## 微信后台配置

- 配置 `https://payun01.cn` 为 request、uploadFile、downloadFile 与 socket 合法域名。
- 如保留对应服务入口，将 `https://jw.gdipu.edu.cn`、`https://mobilelib.wx.chaoxing.com`、`https://www.720yun.com` 配置为业务域名，并在真机验证页面可打开。
- 为 `scope.userLocation` 提供与校园地图一致的隐私说明；检查隐私保护指引已包含定位、图片选择和手机号授权用途。
- 核验 `navigateToMiniProgramAppIdList` 中每个 AppID 均已获授权并可从正式版跳转。

## 发布验收

- 在 iOS 与 Android 真机完成登录、发帖、评论、私信、课程表、跑腿、维修预约、反馈、注销申请与 AI 问答的主流程回归。
- 在弱网条件下检查读取失败提示、写入不重复提交、离线队列重放和 WebSocket 重连。
- 使用微信开发者工具的真机调试与体验版，确认合法域名校验已开启且没有 HTTP WebView 访问。
- 钱包入口应维持关闭，直到真实资金账本、支付回调、退款/提现审核和对账流程均完成验收。
