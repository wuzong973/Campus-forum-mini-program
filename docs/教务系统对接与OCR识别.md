# 教务系统对接与 OCR 课程表识别

## 概述

教务系统对接采用「jw-crawler 爬虫服务 + 小程序课表页 + OCR 导入」三层架构：服务端 `jw-crawler` 直连教务官网（`jw.gdipu.edu.cn`）完成登录、抓取课表/成绩/考试并做结构化解析；小程序 `pkg-schedule` 模块提供课表展示、账号绑定与验证码输入页；OCR 导入分两条线（课表截图 OCR、教务验证码 OCR）。课表/成绩/考试数据均来自教务 HTML 结构化解析，**并非**来自 OCR。本组文档均生成于 2026-09-14，覆盖同日发生的验证码登录跳转缺陷、教务系统 SLB 间歇 504 抖动、web-view 跳转地址修复、OCR 能力评估与功能恢复优化。

## 原始文档清单

| 原文件名 | 日期 | 一句话要点 |
| -------- | ---- | ---------- |
| OCR识别能力评估_2026-09-14.md | 2026-09-14 | 改进版验证码 OCR 准确率 90%（20 张真值实测），评估优劣并给改进建议，14:40 追加已落地 |
| 修复说明_2026-09-14_教务OCR功能恢复与优化.md | 2026-09-14 | 补齐课表截图 OCR 图片链路 + 验证码 OCR 预处理流水线优化，本地验证通过，给出部署配置 |
| 修复说明_2026-09-14_教务系统暂时无法连接.md | 2026-09-14 | 学校 SLB 间歇 504 致同步失败，新增 500/504 可重试、超时与重试参数加固、文案归一化 |
| 修复说明_2026-09-14_教务系统跳转网址无法打开.md | 2026-09-14 | 官网禁 iframe 又非业务域名，改 payun01.cn 同源反代 `/jsxsd/` 供 web-view 直接打开 |
| 修复说明_2026-09-14_教务验证码跳转与同步失败.md | 2026-09-14 | 业务码/HTTP 状态码混用致不跳验证码页、密码错误被误报同步失败；修复并补「换一张」 |

---

## 一、整体链路与模块职责

### 1.1 项目中存在的两处 OCR（失效原因不同）

| # | 功能 | 链路 | 失效状态 |
| - | ---- | ---- | -------- |
| 1 | 课表截图 OCR（表格/学籍信息类） | `pkg-schedule/schedule-ocr` 页 → `POST /api/v1/schedule/ocr` | **链路断裂，100% 失败**：客户端上传图片，服务端却只读 `req.body.rawText`（multipart 里不存在）→ 永远 422「未能识别出有效课程」，服务端从未有过图片识别引擎 |
| 2 | 教务验证码 OCR | `jw-crawler/captcha-ocr.js`（tesseract.js） | **机制能跑但准确率 ≈0.5%**（2026-09-14 上午实测 191 次猜测仅 1 次命中），线上被迫设 `JW_USE_OCR=0` |

### 1.2 模块职责与数据口径

- **`jw-crawler` 爬虫服务**：直连教务系统登录（`<登录页> → /jsxsd/verifycode.servlet → POST /jsxsd/xk/LoginToXk`），会话 `JSESSIONID` 按 `Path=/jsxsd` 复用，Cookie 与验证码同会话；整学期课表逐周抓取后结构化入库。
- **小程序 `pkg-schedule` 模块**：`schedule-home`（课表首页/绑定入口）、`schedule-login`（验证码输入页）、`schedule-ocr`（截图 OCR 页）。
- **OCR 导入**：课表截图 OCR 走微信「通用印刷体识别」`/cv/ocr/comm`；验证码 OCR 走 tesseract.js 自研预处理。
- **重要说明**：本项目**不存在**「证件/成绩单扫描件识别」功能——课表、考试、成绩数据均来自教务系统 HTML 结构化解析而非 OCR。如需该能力属新需求（身份证等敏感信息还涉及合规，见第九章）。

---

## 二、验证码登录与跳转问题

### 2.1 web-view 跳转地址无法打开

- **现象**：「教务系统 → 教务服务 → 教务系统跳转网址」入口文案展示为 `http://jw.gdipu.edu.cn/jsxsd`（协议与格式均不规范），点击后无法打开官网，停在空白 / 「全景加载失败」页。
- **根因**：
  1. 官网禁止被 iframe 内嵌——登录页 `/jsxsd/` 与 `/jsxsd/framework/xsMain.jsp` 均带 `x-frame-options: SAMEORIGIN`，只允许同源内嵌；旧链路中转页 `embed.html` 在 `payun01.cn` 跨域，浏览器拒绝内嵌，12 秒后落兜底页。
  2. 官网不能作为 web-view 直连目标——`web-view` 要求目标域名已配置为**业务域名**，需在校务站根目录放微信校验文件；`jw.gdipu.edu.cn` 为学校第三方站点，无法上传校验文件，申请不了。
  3. 附带发现：线上静态目录 `/www/wwwroot/payun01.cn/` 没有 `embed.html`（404），旧入口连中转页都打不开；佛山校区「全景」入口同样指向 embed.html 而损坏。
  4. 展示地址本身不规范：协议写成 `http://`（官网为 https）；缺结尾斜杠，`https://jw.gdipu.edu.cn/jsxsd` 实测 302 → `/jsxsd/`，带斜杠才直接 200。
- **处理方案**：
  - 服务器：`payun01.cn` 增加 `/jsxsd/` 同源反代（核心）。因教务官网 HTML 只用 `/jsxsd/...` 相对路径、无绝对域名引用、无 frame 嵌套，路径级反代可行。配置文件 `/www/server/panel/vhost/nginx/payun01.cn.conf`（备份 `payun01.cn.conf.bak-20260914-jsxsd`），关键片段：
    ```nginx
    location /jsxsd/ {
        proxy_pass https://jw.gdipu.edu.cn/jsxsd/;
        proxy_ssl_server_name on;          # 学校按域名分流，必须带 SNI
        proxy_hide_header X-Frame-Options; # 去掉禁止内嵌的响应头
        proxy_redirect http://jw.gdipu.edu.cn/ /;
        proxy_redirect https://jw.gdipu.edu.cn/ /;
        proxy_connect_timeout 10s; proxy_read_timeout 120s;
    }
    ```
    回滚：`cp <备份> <配置>` 后 `nginx -t && nginx -s reload`。
  - 小程序端：`schedule-home/index.js` 新增 `JW_WEBSITE_URL="https://jw.gdipu.edu.cn/jsxsd/"`（展示）与 `JW_WEBSITE_PROXY_URL="https://payun01.cn/jsxsd/"`（小程序内打开）；`goJwWebsite()` 走反代地址，反代常量置空时回退「复制链接 + 浏览器打开」。`index.wxml` 文案改为 `{{jwWebsiteUrl}}`。`web-static/embed.html` 移出教务白名单、兜底文案改通用、并补部署到线上修好佛山全景入口。
- **涉及文件·配置项**：`pkg-schedule/schedule-home/index.{js,wxml}`、`web-static/embed.html`、`server/tests/services-h5.test.js`、服务器 nginx 配置；常量 `JW_WEBSITE_URL` / `JW_WEBSITE_PROXY_URL`。
- **验证方式**：线上实测 `https://payun01.cn/jsxsd/` 200（含「用户登录」，X-Frame-Options 已剥离）；`/jsxsd/css/style.css` 200、`/jsxsd/verifycode.servlet` 200 `image/jpeg`；浏览器等效完整登录流程（登录页 → 验证码 → POST 302 → proxy_redirect 未跳出本站 → 课表主页会话贯通）全部正常；`server/tests` 27 项通过（含 services-h5、campus-map-panorama）。
- **结论**：反代后 web-view 可直接在自有域名下使用教务系统；日常查课表/成绩/考试仍建议用原生页面，不依赖官网。

### 2.2 点「绑定并同步」不跳验证码页、密码错误误报「同步失败」

- **现象**：
  1. 「教务系统」页点「绑定并同步」后只弹 toast「需要输入教务系统验证码」，不跳转验证码输入页。
  2. 账号密码已正确输入，仍弹「同步失败 / 教务系统登录失败，请检查账号或密码」。
- **根因**：
  - 接口链路本身正常（服务器上用已绑定可用账号 `2025220502332` 实测 `POST /api/v1/schedule/sync 200`，课程 20 / 考试 1 / 成绩 29）。
  - 现象 2 真实原因：教务系统明确拒绝该账号密码。线上落盘失败页原话 `用户名或密码错误` / `验证码错误!!`；按账号统计自 2026-08-27 起 `2024***338` 失败 0 成功（「用户名或密码错误」22 次 + 「验证码错误」10 次），其 `encodedLength` 恒为 31（无编码异常），说明教务侧不接受该账号密码（密码不一致/被锁定/未激活）；同链路 `2025***332` 成功 50 次，可排除小程序/服务端故障。
  - 现象 1 真实原因（代码缺陷）：服务端约定业务码放 `data.code`、HTTP 状态码放 `code`，但页面拿 `err.code`（=409 数字）当业务码，永远匹配不到 `CAPTCHA_REQUIRED`，落到兜底 toast。`schedule-login` 的 `JW_NOT_BOUND` / `JW_CREDENTIAL_INVALID` 分支同问题。
- **处理方案**：
  - 服务端 `services/jwScheduleSyncService.js`：新增 `CAPTCHA_INVALID`（教务回「验证码错误」→ 422 + 业务码，不再与账号密码错误混谈）；`submitScheduleCaptcha` 捕获后自动下发新验证码（凭据仍在挑战里）；账号密码错误透出教务原话并带 `code=JW_CREDENTIAL_INVALID`；新增 `refreshCaptchaChallenge()` 复用挑战内凭据与会话重抓验证码；验证码 MIME 按魔数嗅探（实际返回 JPEG，原硬编码 `image/png`）；挑战落库 `ON DUPLICATE KEY UPDATE` 同步 `captcha_data` / `cookie_jar`。
  - 新增 `controllers/scheduleController.js` 的 `exports.refreshCaptcha`、`routes/scheduleRoutes.js` 的 `POST /api/v1/schedule/sync/captcha/refresh`。
  - 小程序端 `utils/request.js` 统一解析 `error.bizCode = data.code || (string code)`；`schedule-home/index.js` 的 `handleSyncError` 改用 `bizCode` 分支（`CAPTCHA_REQUIRED` / `CAPTCHA_INVALID` → 跳验证码页；凭证类 → 回登录表单并提示教务原话）；`gotoSyncPage(challenge)` 经 `app.globalData.jwCaptchaHandoff` 交挑战给同步页，用户无需重输学号密码。`schedule-login/index.js` 消费 handoff、改用 bizCode、新增 `CAPTCHA_INVALID` 分支、「换一张」走新接口（未绑定态也能刷新）。`utils/api.js` 新增 `refreshScheduleCaptcha(challengeId)`。
  - 线上爬虫协议：线上 `crawler.js` 的 `baseURL = http://`（仓库为 `https://`），教务密码会以 base64 明文过网；本次把线上默认切到 `https://`（备份 `crawler.js.bak-20260914-http`），实测 https 登录+整学期抓取正常。
- **涉及文件·接口·字段**：`pkg-schedule/schedule-home`、`pkg-schedule/schedule-login`、`utils/request.js`、`utils/api.js`、`server/services/jwScheduleSyncService.js`、`controllers/scheduleController.js`、`routes/scheduleRoutes.js`、线上 `jw-crawler/crawler.js`；业务码 `CAPTCHA_REQUIRED` / `CAPTCHA_INVALID` / `JW_CREDENTIAL_INVALID` / `JW_NOT_BOUND`；接口 `POST /api/v1/schedule/sync/captcha/refresh`。
- **验证方式**：线上实测 `[flow.sync] 409 需要输入教务系统验证码`、`[refresh] 200`、`[flow.wrongCode] 409 验证码不正确请重新输入`（输错自动换新图）、`[submit] 200 同步成功 课程=20 考试=1 成绩=29`、https 切换后再次验证通过；本地 `server/tests` 25 项通过（新增 `jw-captcha-client-flow.test.js`）。
- **结论**：跳转缺陷修复，验证码页与「换一张」可用；密码错误场景如实提示教务原话，不再误报同步失败。

---

## 三、连接失败与超时处理（学校 SLB 间歇 504）

- **现象**：「教务系统」页点「同步」后提示「教务系统暂时无法连接，请稍后重新重试」；控制台 `POST https://payun01.cn/api/v1/schedule/refresh 502`。
- **根因**（分层定位，每层均有实测数据）：
  1. 我方服务端正常（pm2 双实例 online、`/api/v1/*` 200、日志无异常）。
  2. 我方 → 学校网络间歇失败：服务器采样登录页 12 次 `200×8 / 504×2 / 502×1`；换本地开发机采样 8 次 `200×4 / 504×4` → 与自身服务器/IP/反代无关。
  3. 仅教务系统异常：学校主站 `www.gdipu.edu.cn` 3/3 200（0.06s）。
  4. 504 来自学校前置 SLB：响应头 `via: HTTP/1.1 SLB.75` + `set-cookie: acw_tc=…` + body 为 nginx `504 Gateway Time-out`。
  - 结论：学校侧教务系统性能劣化——登录页响应从 2026-09-14 上午的 0.14s 变成 6–7s，约 20% 请求被前置 SLB 判超时返 504（少量 502）；一次完整同步要打 25+ 请求，必然中途失败。我方错误映射本身正确（`refreshFromJw` 对「非账号密码类」错误归一为 502 +「教务系统暂时无法连接，请稍后刷新重试」）。
- **处理方案**：
  - 真实缺陷（已修）：① `crawler.isRetryableError()` 只认 429/502/503，**不含 504/500**；② 线上 `JW_MAX_RETRIES=0`、`JW_TIMEOUT_MS=8000` 过紧且无兜底；③ `/schedule/sync` 透传 axios 原文 `Request failed with status code 504` 文案不可读。
  - `jw-crawler/crawler.js`：`isRetryableError` 增 **500 / 504**（现覆盖 429/500/502/503/504 + ECONNRESET/ETIMEDOUT/ECONNABORTED/ENOTFOUND/EPIPE）。
  - 线上 `server/.env`：`JW_TIMEOUT_MS` 8000→**12000**、`JW_MAX_RETRIES` 0→**2**、`JW_RETRY_BACKOFF_MS` 300→**800**（备份 `.env.bak-20260914-retry`）。
  - `server/services/jwScheduleSyncService.js`：`normalizeSyncError` 新增上游 5xx 分支，归一为 **502** +「教务系统暂时无法连接（学校服务器响应超时），请稍后重试」+ 业务码 `JW_UPSTREAM_UNAVAILABLE`（**刻意不用 503**：小程序请求层把 503 当作「功能已停用」静默不提示）。
  - `server/.env.example` 补 `JW_TIMEOUT_MS / JW_MAX_RETRIES / JW_RETRY_BACKOFF_MS / JW_FAST_SEMESTER_CONCURRENCY / JW_SYNC_COOLDOWN_MS`；新增 `server/tests/jw-upstream-resilience.test.js`（断言可重试态含 500/504、5xx 归一 502 且不得用 503、`.env.example` 须记录容错参数）。
- **涉及文件·接口·配置项**：`jw-crawler/crawler.js`、`server/services/jwScheduleSyncService.js`、线上 `server/.env`、`.env.example`、`server/tests/jw-upstream-resilience.test.js`；配置 `JW_TIMEOUT_MS` / `JW_MAX_RETRIES` / `JW_RETRY_BACKOFF_MS`；业务码 `JW_UPSTREAM_UNAVAILABLE`。
- **验证方式**：加固后实测免密刷新，日志出现重试（含第 1/2 次重试等待）后成功拿登录页与验证码；线上确认 `JW_TIMEOUT_MS=12000 / JW_MAX_RETRIES=2 / JW_RETRY_BACKOFF_MS=800` 且 `crawler.js` 含 `status === 504`；本地 28 项全过。
- **结论**：抖动期「慢但完整」。2026-09-14 12:53 追加的耗时调优（见第九章配置冲突）进一步把最坏耗时压低；学校恢复正常后重试不触发，同步自然回到 2–6s。

---

## 四、OCR 识别能力评估（教务验证码）

**评估对象**：`jw-crawler/captcha-ocr.js`（工作区版，含 Otsu 自适应阈值/中值滤波/二值膨胀/多变体共识/两段式 PSM）；对照 `git HEAD` 版（固定阈值 165、单轮 PSM 7）。方式：20 张真实验证码人工核对真值 + 代码审查 + 边界实测，未改业务代码。

### 4.1 准确率（20 张真值，2026-09-14）

| 维度 | 判断 | 依据 |
| ---- | ---- | ---- |
| 识别准确率 | ✅ 可用于生产 | 整图 **18/20 = 90%**，字符级 77/80 = 96.3%，格式合法 20/20 |
| 相比旧版 | ✅ 显著提升 | 旧版整图 9/20 = 45%、字符级 60%、格式合法 13/20 |
| 稳定性 | ✅ 良好 | 同图连 3 次一致；2 张并发均正确；单张平均 240ms（最长 657ms） |
| 边界情况 | ⚠️ 部分可接受、部分有风险 | 非法输入均干净抛错不卡死；但登录路径未捕获异常、长度/语言假设硬编码 |
| 潜在缺陷 | ⚠️ 多处 | 见 4.4 |

- 整图 18/20=90%（采样 10 张 8/10，新抓 10 张 10/10）；字符级两类误读均单字符：`4→d`、`1→l`、`g→d`；格式合法 20/20（旧版 13/20）意味不再「白跑一次」。平均 240ms 对同步耗时影响可忽略。
- 样本量 n=20，90% 的 95% 置信区间约 ±13%（真实水平约 77%–100%），需 100+ 张更稳。

### 4.2 稳定性实测

| 项目 | 结果 |
| ---- | ---- |
| 同图重复识别 ×3 | `h8ym/h8ym/h8ym` 确定、无抖动 |
| 并发 2 张（共享 worker） | `h8ym / 3c33` 均正确，388ms，无参数竞争 |
| 内存 | 常驻 worker `rss≈200MB`（pm2 双实例≈400MB，当前机器充足） |
| 线上日志 | 生产日志 `Total count=` 等 tesseract 调试输出 0 条，无污染 |

### 4.3 适用截图类型与边界

- **输入健壮性**（均干净抛错）：空 Buffer→`Input Buffer is empty`；`null`→`TypeError path`；非图片→`unsupported image format`；不存在路径→`ENOENT`。
- **极端尺寸/纯色**：1×1 纯白→`a`(valid=false)；2000×1000 纯白→空(valid=false)；纯黑/全透明/纯灰→均 valid=false（无崩溃，但产出「合法但无意义」结果）。
- **文字形态**：中文四字→`oh37`(valid=true，⚠️ 合法≠有意义)；特殊符号 `a@#5`→`a5`(valid=false ✅)；五位 `ab12c`→`abl2`(valid=true，⚠️ 静默截断为 4 位)；大写 `AB12`→`12`(valid=false，⚠️ 白名单仅小写)；倾斜：5°/10°→`h8yn`、20°→`hays`、45°/90°→无效（⚠️ **无去斜处理，倾斜是主要残余误差来源**）。
- **结论（适用类型）**：改进版 OCR 对「4 位小写字母+数字」的真实教务验证码效果最佳（90%）；对纯中文图、5 位图、>20° 倾斜、大写图会产出误判或无效结果。

### 4.4 局限与潜在缺陷（按优先级）

| # | 缺陷 | 影响 |
| - | ---- | ---- |
| 1 | **改进版 OCR 当前未生效**：线上 `JW_USE_OCR=0` | 90% 识别能力用不上，用户每次手输（以 2026-09-14 14:40 文档为准，已改回 1 并部署） |
| 2 | **置信度不可作质量门槛**：`conf≥65` 的 3 张中 2 张错（33%），`conf<65` 的 17 张全对 | `JW_OCR_AUTO_FILL_CONFIDENCE=65` 触发的自动提交更易提交错误答案 |
| 3 | 登录路径未捕获 OCR 异常 | 学校抖动返 HTML 时同步以 500+英文报错失败，而非降级人工输入（2026-09-14 已补 try/catch，见第五章） |
| 4 | 「合法」判定过宽：中文图、5 位图都产 valid=true | 教务验证码形态变化会「稳定地错」并耗登录尝试 |
| 5 | 验证码图片未做魔数校验 | 学校返 HTML 时挑战里存 HTML 字节，客户端 `<image>` 破图（2026-09-14 已加 `isImageBuffer()`，见第五章） |
| 6 | `DEFAULT_AMBIGUOUS_MAP` 形同虚设 | 只在「严格提取不足 4 位」生效，真实误读发生在严格提取成功后，映射不介入 |
| 7 | 共识机制无法区分对错 | 共识≥6 的 11/12 正确、共识 2–5 的 7/8 正确，无区分度 |

### 4.5 评估结论

改进版验证码 OCR 已**可用于生产**（90% 整图、96.3% 字符级、格式合法 100%），相较旧版（45%）显著提升且稳定；但置信度与对错基本不相关，不能做自动提交门控。两处残余错误（`pe41→pedl`、`3yyg→3yyd`）均为同形异类误读（数字↔字母），所有预处理/旋转变体读数一致，属识别引擎分类问题。

---

## 五、OCR 功能恢复与优化

### 5.1 做了什么

**课表截图 OCR（核心修复，补齐图片识别链路）**：技术选型微信官方「通用印刷体识别」`POST /cv/ocr/comm`——复用既有 access_token 基础设施（`utils/wechatToken.js` 缓存+失效重试），无新增第三方依赖；验证码 OCR 同类 Tesseract 已被证不适合中文表格截图。

| 文件 | 修改 |
| ---- | ---- |
| `server/services/ocrService.js`（新增） | `recognizeScheduleImage(buffer)`：sharp 压缩到 ≤900KB/2048px → 调 `/cv/ocr/comm` → 提取 `items[].text` 逐行文本；40001/40014/42001 凭据失效自动刷新重试；45009/超配额→「今日课表识别次数已用完」，本地内存日计数 `SCHEDULE_OCR_DAILY_LIMIT`（默认 200）防刷；损坏/伪造图片→400；`captureOcrImageMiddleware` |
| `server/routes/scheduleRoutes.js` | `/ocr` 插入 `captureOcrImageMiddleware`，**必须在内容安全检测之前**——否则 imgSecCheck 把长图压到 1080px 致识别率崩塌 |
| `server/controllers/scheduleController.js` | `exports.ocr` 重写：有图走「微信 OCR → parseOcrText 结构化」(`strategy=wechat-ocr+rule-parse`)；JSON 传 `rawText` 旧用法保留(`strategy=rule-parse-v2`)；修复 multer 临时文件从不清理导致 uploads 膨胀 |

小程序端 `pkg-schedule/schedule-ocr` 无需改动（原本按「上传图片→返回 courses/tips」契约写，是服务端从未兑现）。

**验证码 OCR（预处理与决策流水线优化）**：

| 改进点 | 原状 | 现状 | 针对问题 |
| ------ | ---- | ---- | -------- |
| 阈值分割 | 固定 165 | **Otsu 大津法逐图自适应** | 明暗随图变化时固定阈值整体切糊 |
| 预处理变体 | 4 个 | 6 个（原图/灰度/otsu/otsu-negate/median-otsu/otsu-dilate） | 孤立杂点、细字符断裂 |
| PSM 模式 | 仅 PSM 7 | **两段式**：先 PSM 7 跑全部变体，无共识补 PSM 8/13 | 字符粘连、间距不均定位失败 |
| 共识决策 | 已有 | 抽 `selectConsensus()`，修 `b.confidence/a.count` 笔误（应为 b.count） | 多数派优先 |

验证码 OCR 安全网不变：置信度 ≥ `JW_OCR_AUTO_FILL_CONFIDENCE` 才自动提交；60 以下只预填；识别异常不影响人工输入。

### 5.2 幂等键与失败保留原课表

- **幂等键**：挑战落库用 `ON DUPLICATE KEY UPDATE` 同步更新 `captcha_data` / `cookie_jar`（来自第二章 2.2 修复），同一 `challengeId` 重复提交/换图不会新建挑战，避免重复消耗学校登录尝试。
- **失败保留原课表**：失败时不覆盖既有课表——`submitScheduleCaptcha` 捕获 `CAPTCHA_INVALID` 后自动下发新验证码，凭据仍保留在挑战内，用户不必重输学号密码；账号密码错误分支仅透出教务原话、不擦写本地课表。

### 5.3 422 语义

`CAPTCHA_INVALID`：教务系统回「验证码错误」时单独归一化为 **HTTP 422 + 业务码 `CAPTCHA_INVALID`**，不再与账号密码错误（归一 400 + `JW_CREDENTIAL_INVALID`）混为一谈；422 语义即「验证码本身无效，请换一张重试」，客户端据此走「换一张」而非回登录表单。

### 5.4 验证方式与结论

- 本地：合成验证码 5 张冒烟 3/5 完全命中、5/5 得有效 4 位结果且多数共识（仅证流水线健康，不代表真实验证码命中率）；`server/tests` 28 项全绿（新增 `schedule-ocr-image.test.js`、`captcha-ocr-quality.test.js`）。
- 真实验证码实测（2026-09-14，本地直连抓 10 张人工核对）：

| 指标 | 修复前（上午实测） | 修复后（同日实测） |
| ---- | ------------------ | ------------------ |
| 单张命中率 | ≈0.5%（191 次 1 命中） | **80%（8/10）** |
| 3 次内综合成功率 | ≈1.5% | ≈99.2%（每次失败自动换图重试） |
| 误读样本 | 基本全错 | 2 张均为 g/d 混淆 |

- **关键发现**：Tesseract 置信度与对错基本不相关（误读样本 conf 85/85.5，全对样本 conf 0–15）。故建议部署设 `JW_OCR_AUTO_FILL_CONFIDENCE=100`（关闭自动提交、保留预填一键确认），80% 用户免打字、20% 改 1–2 字符且绝不自动提交错误答案；服务端直连路径 `JW_OCR_MIN_CONFIDENCE=0` + `JW_CAPTCHA_ATTEMPTS=3` 保持默认（失败自动换图，期望浪费 ≈0.2 次学校请求/次登录）。
- 课表截图 OCR：修复前 100% 失败（永远 422）→ 微信通用印刷体+规则解析端到端可用。
- 线上状态：该文档「未部署」，部署步骤见第九章；验证码 OCR 80% 命中达启用标准。

---

## 六、课表同步数据口径与常见失败原因

### 6.1 同步数据口径

- 一次完整同步打 25+ 个请求，覆盖整学期逐周课表（2026-09-14 实测 20 周）、成绩查询页 `/jsxsd/kscj/cjcx_list`、考试安排；成功示例 `课程=20 考试=1 成绩=29`。
- 凭证来源：`jw_credential` 表（加密存储），解密取密码；会话 `JSESSIONID` 按 `Path=/jsxsd` 复用，Cookie 与验证码同会话。
- 登录请求体：`userAccount` / `RANDOMCODE` / `encoded`(=`base64(账号)%%%base64(密码)`) / `pwdstr1` / `pwdstr2`，与教务页面 `submitForm1()` + `conwork.js` 的 `encodeInp` 同算法。
- 临时故障保护：`refreshFromJw` 保留已绑定凭证，学校恢复后直接点「同步」即可，无需重新绑定。

### 6.2 常见失败原因

| 失败现象 | 根因 | 归一化 |
| -------- | ---- | ------ |
| 「教务系统暂时无法连接」 | 学校 SLB 间歇 504（非我方故障） | 502 + `JW_UPSTREAM_UNAVAILABLE`（见第三章） |
| 弹「需要输入教务系统验证码」不跳转 | 业务码/HTTP 状态码混用（代码缺陷，已修） | 409 + `CAPTCHA_REQUIRED` → 跳验证码页 |
| 「同步失败 / 请检查账号或密码」 | 教务系统拒绝该账号密码（密码错/锁定/未激活） | 400 + `JW_CREDENTIAL_INVALID`（透教务原话） |
| 验证码输错 | OCR 猜错或用户输错 | 422 + `CAPTCHA_INVALID` → 自动换新图 |
| 同步变慢（8.5s～31.7s） | 学校侧变慢变抖 + 重试必然代价（见第三章） | 重试后「慢但完整」 |

- 账号统计反例（自 2026-08-27）：`2025***332` 成功 50 次（仅「验证码错误」13 次，凭据正确）；`2024***338` 成功 0 次（「用户名或密码错误」22 次），说明个别账号属教务侧凭证问题，非系统故障。

### 6.3 教学周与周日期的单一口径（多端一致）

课表上「第 N 周」「本周日期区间」「表头各列日期」必须来自同一个函数，否则同一份课表会在两台设备上显示不同的周次/日期。2026-09-20 用户反馈「手机端显示 9.20-9.26、开发者工具显示 9.14-9.20」，排查出两条**互相独立**的根因：

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 两端「本周」日期相差 1 天（9/20 起 vs 9/21 起） | 学期起始日存在**周日锚点**写法：校历图注是「教学周 2026年9月6日 起」，用户可在「设置开始日期」里照抄 `2026-09-06`。它与周一锚点 `2026-09-07` 只差 1 天，但 `computeAcademicWeek` 的 `floor(天数差/7)+1` 在**周日**这个边界上会差一周（9/20 用 9/06 起算是第 3 周、用 9/07 起算才是第 2 周） | `utils/schedule.js` 新增 `parseSemesterStart()`：解析后把周日值锚定到次日周一（其余取值原样保留）；`computeAcademicWeek` 内部改用它，课表页三处日期计算全部改走它 |
| 同一端内「标题第 3 周、表头 9/21、卡片却写 9.14-9.20」 | `switchWeek()` 只 `setData({ currentWeek })`，不重算 `currentWeekText`。点「下一周」或触发「本周无课自动跳到有课周」（`maybeJumpToCourseWeek` → `switchWeek`）后，卡片日期停在上周 | `switchWeek()` 与 `weekDateText(week)` 同批更新；`initFromConfig` 也改用同一方法，保证三处同源 |

口径约定（改课表日期相关代码前必读）：

- 第 1 教学周 = **2026-09-07（周一）**。三处同值：前端 `utils/schedule.js` 的 `DEFAULT_SEMESTER_START`、后端 `jwScheduleSyncService` 的 `SCHEDULE_DEFAULT_START_DATE`、爬虫 `JW_SEMESTER_START`。
- 周次一律 `floor((今天 − 起始日)/7)+1`，且**起始日必须先锚定到周一**。校历页 `week1Monday`（`firstWeekSunday + 1`）走的是同一条口径。
- 首页「今天第几周」（`pages/index/index.js` 的 `renderTodaySchedule`）此前自己算，默认值还残留**上一学期**的 `2026-03-02`，未配置起始日的用户会被算成第 29 周、当天课程全部筛不出来（首页恒显示「今天没课」，而课表页正常）。现改用 `computeAcademicWeek`；分包 `pkg-schedule/schedule-home` 的 `resolveCurrentWeek` 一并收敛。
- 历史遗留的 `2026-03-02` 默认值已从 `server/utils/migrations.js`、`server/sql/init.sql`、`jw-crawler/crawler.js` 清除（爬虫默认抓取周数同时由 19 对齐为 20）。**存量 `schedule_config` 表的列默认值不单独 ALTER** —— 写入路径一定显式带 `start_date`，改它没有任何行为差异。

护栏：`server/tests/school-term-consistency.test.js` 覆盖「周日锚点归一到周一」「切周后日期区间同步更新」「表头首列与卡片区间同源」「源码中不再出现 `parseLocalDate` 与 `2026-03-02`」，并对两条根因各做了一次反向验证（回退源码后必须以 exit 1 失败）。

---

## 七、配置项与时间线冲突说明

下列配置项在多文档中出现冲突或调整，统一以**时间最新**文档为准（均发生于 2026-09-14）：

| 配置项 | 早期值/建议 | 最新值 | 依据 |
| ------ | ---------- | ------ | ---- |
| `JW_USE_OCR` | 上午实测≈0 命中建议置 0（2026-09-14 12:53 暂时无法连接文档已置 0）；OCR 恢复与优化文档建议部署时设 1 | **=1（已部署）** | 以 2026-09-14 14:40 OCR 评估文档为准：改回 1 并重启，实测免密刷新 `dfyb` → 登录成功 → `POST /schedule/refresh 200`（4.1s），全程免人工输入 |
| `JW_OCR_AUTO_FILL_CONFIDENCE` | 65（默认，触发自动提交） | **建议 =100** | 多文档一致：置信度不可靠，关闭自动提交、保留预填一键确认 |
| `JW_MAX_RETRIES` | 0→2（暂时无法连接第四节） | **=1** | 以 2026-09-14 12:53 调优为准：一次重试足以兜瞬时 504，最坏单请求 ~38s→~20s |
| `JW_TIMEOUT_MS` | 8000→12000（第四节） | **=10000** | 2026-09-14 12:53 调优：学校 SLB ~6s 返 504，健康响应 ≤7s，10s 足够 |
| `JW_RETRY_BACKOFF_MS` | 300→800（第四节） | **=500** | 2026-09-14 12:53 调优：退避更短减少等待 |
| `JW_OCR_MIN_CONFIDENCE` / `JW_CAPTCHA_ATTEMPTS` | — | 0 / 3（保持默认） | OCR 恢复与优化文档：服务端直连失败自动换图重试 |
| `SCHEDULE_OCR_DAILY_LIMIT` | — | 200（默认，可选） | OCR 恢复与优化文档：本地内存日计数防刷 |

> 注：`JW_USE_OCR` 在同日经历过「置 0（12:53，针对改进前低命中率）→ 改回 1（14:40，改进版 90% 命中已验证）」。后续若命中率明显回落（<30%）可再切回 0（用 `node tools/verify-captcha-ocr.js` 复测）。

---

## 八、复现与回归素材

- 验证码 OCR 评估脚本与 20 张样本真值表：`C:\Users\w'w'w\AppData\Local\Temp\jwdiag\`（`ocr_eval.js` / `ocr_eval_old2.js` / `ocr_edge.js` / `caps/` / `montage.png`），建议固化为 fixture 做回归护栏（断言整图准确率 ≥80%）。
- 真实验证码复测工具：`jw-crawler/tools/verify-captcha-ocr.js`（抓 10 张 → OCR → 存 `captcha-samples/`，样本目录不入库）。
- 护栏测试：`jw-upstream-resilience.test.js`（容错）、`jw-captcha-client-flow.test.js`（验证码客户端流）、`schedule-ocr-image.test.js` + `captcha-ocr-quality.test.js`（OCR 链路与质量）、`services-h5.test.js`（反代/H5）、`schedule-empty-state-and-session.test.js`（课表空态/周次跳转/登录态失效，见第九章）。

---

## 九、课表展示空态与登录态失效（2026-09-18 修复）

两个用户反馈，根因都不在教务账号：

| 反馈 | 表面现象 | 真实原因 |
| ---- | -------- | -------- |
| 「账号密码正确却提示未登录」 | 教务系统页点「绑定并同步」→ toast「未登录」 | **小程序自身登录态失效**：`utils/request.js` 的 401 分支抛 `new Error('未登录')`。`logs/out.log` 显示 `POST /schedule/sync 401` 耗时仅 0.5~0.75ms（`auth` 中间件直接拒绝，**从未访问教务**）；同一 IP 随后 `phone-login 200` → `schedule/bind 200` → `schedule/sync 200` |
| 「手动添加了课表但不显示」 | 课程表页空态「暂无课程」，编辑课表却显示「共 25 门」 | **周次过滤 + 误导性空态**：课表页只渲染当前选中周，该账号 25 门课全部从第 3 周开始（大一军训 2 周），第 2 周过滤后为 0；且周次导航栏当时挂在 `courses.length > 0` 上，本周没课时**根本无法切周**，用户只能得出「课表没导入成功」的结论 |

实测面：192 个有课表的用户里只有 56 人（29%）在第 2 周有课 —— 71% 的人会看到这个误导性空态。

### 9.1 四处改动

1. **课表页空态与周次可达性**（`pages/schedule/index.{js,wxml,wxss}`）
   - 周次导航栏不再依赖 `courses.length`：本周没课也能切周；「本学期课表」入口改按 `semesterCourseCount` 显示。
   - 空态区分两种语义：本学期有课 → 「第 N 周暂无课程」+「你的课表共 X 门课，最早从第 M 周开始上课」，并给「跳到第 M 周 / 看本学期课表」按钮；本学期无课 → 保留原「暂无课程」文案。
   - 新增 `semesterCourseCount` / `firstCourseWeek`；首次进入若本周无课则自动跳到首个有课周（**只跳一次**，之后尊重用户手动翻周）；`resolveFirstActiveWeek()` 计算首个有课周时会跳过单双周不匹配的周。
   - **顶部「第 N 周」可点击**（导航栏的 `week-text` 与周次导航条的 `week-nav-center` 两处，均带小三角提示）→ 打开全周次总览，与本学期课表按钮同一视图。目的是让用户一眼看到全学期每周几门课、哪一周开始有课，不必一周周点「下一周」去试；学期里一门课都没有时如实提示「还没有课表，可手动添加或同步教务」，不假装有内容。
2. **手动添加课程的诚实反馈与定位**（`pkg-schedule/schedule-add/index.js`）
   - `POST /schedule/add` 改为**等接口成功才提示「保存成功」**；失败弹「保存失败」+ 真实原因，401 交给统一处理不重复弹窗。原先是 fire-and-forget + `.catch(()=>{})`，401/断网时照样谎报成功。
   - 删除没人读的本地死缓存 `schedule_courses` 写入（课表页与编辑页读的都是服务端 `/schedule/list`）。
   - 成功后把 `{startWeek, endWeek, weekType}` 交给课表页（`app.globalData.scheduleJumpToWeek`），课表页据此定位到**用户所选的周**。
   - **同一原则推广到「清空全部课表」**：`pages/schedule/index.js` 与 `pkg-schedule/schedule-edit/index.js` 都改为等 `POST /schedule/clear` 成功才清列表并提示；失败保持原样（原先 fire-and-forget + 立刻提示「已清空」，401/断网时刷新后课程全部回来）。
3. **401 统一处理**（`utils/request.js`）
   - 「带了 token 却被判 401」= 登录态过期 → 清 token、断开旧 WebSocket、弹**一次**「登录已失效 / 去登录」（5 分钟冷却 + 弹窗互斥去重，`silent:true` 也提示）。
   - 「本地没有 token 的 401」= 游客访问 → 不弹登录失效，保持原有静默 / 「未登录」toast 行为，不误伤公开页面。
4. **登录态判定与 JWT 有效期**（新增 `utils/token.js`；`utils/login-expiry.js`、`utils/auth.js`、`server/config/jwt.js` + `.env`）
   - 新增 `utils/token.js`：纯 JS 解 base64url JWT 载荷（小程序运行时没有 `atob`），`isTokenExpired()` 带 60s 安全余量；不可解析时返回 `false`（退回「交给服务端判定」，不误伤正常用户）。
   - `auth.isLoggedIn()` 改为「有 token **且未过期**」，过期即清登录态 —— 消除「本地有 token → 守卫放行 → 服务端全 401」的僵尸窗口。
   - `checkLoginExpiry()` 先判 token `exp`（返回 `{reason:'token-expired'}`），再判 90 天未活跃（`{reason:'inactive'}`）；`app.js` 按 reason 给不同文案。
   - **`JWT_EXPIRES` 由 `7d` 调整为 `30d`**（`.env` 与 `config/jwt.js` 兜底值同步），已部署。改有效期**不会作废存量 token**，新签发 token 实测有效期 30.00 天。

### 9.2 回归护栏

`server/tests/schedule-empty-state-and-session.test.js`（32 项，已登记进 `npm test`）：token 解码与过期判定、两条清理判据、401 三态（带 token / 游客 silent / 游客主动）、课表空态与跳周（含单双周）、点周次打开全周次总览、清空课表的成功/失败两态、手动添加源码护栏、JWT 30d 断言。

### 9.3 生效方式

- **服务端**（`config/jwt.js` + `.env`）已部署并重启，`/api/v1/health` 200。
- **小程序端**（课表页、手动添加页、`utils/{request,auth,token,login-expiry}.js`、`app.js`）需在**微信开发者工具重新上传**后生效。

---

## 十、遗留问题与后续建议

1. **`2024***338` 的教务密码需人工核实**：教务系统返回「用户名或密码错误」。建议先用浏览器直接登录 `https://jw.gdipu.edu.cn/jsxsd/` 验证；注意区分**统一身份认证（UAS/CAS）密码**与教务系统本地密码，多次失败可能已触发教务侧锁定。
2. **小程序端需重新上传**：跳转逻辑与验证码页改动在客户端，需在微信开发者工具上传新版本后生效（服务端已部署）。
3. **线上 `jw-crawler/crawler.js` 仍保留调试代码**（`testParseLocal`、`--parse-only`、`schedule_samples`），与仓库版本存在非功能性差异，建议以仓库版本重新对齐。
4. **证件/成绩单扫描件/学籍证明识别**：项目中无此功能，本次未实现；通用印刷体 OCR 链路（ocrService）已提供技术底座，若要做属新功能需另行评估（身份证等敏感个人信息涉及合规）。
5. **微信 OCR 配额**：免费配额以微信侧实际为准；本地 `SCHEDULE_OCR_DAILY_LIMIT` 仅保护性闸门，超限有明确文案兜底。微信 OCR 只能在生产服务器实测（本地开发机 IP 不在白名单），上线后先用真实课表截图调一次 `/schedule/ocr` 确认 `/cv/ocr/comm` 可用与配额。
6. **学校侧 504 需学校处理**：可向学校网络中心/教务反馈「教务系统前置 SLB 间歇返回 504」，附 2026-09-14 12:20–12:45 采样（约 20% 请求 504）。
7. **反代风险**：学生教务账号密码经自有服务器中转（与爬虫同性质）；微信审核若抽查该入口看到的是第三方页面，建议保留「说明」文案让用户知晓这是学校官网。学校若调整反爬/校验（Referer 白名单、封代理 IP），反代可能失效，届时把 `JW_WEBSITE_PROXY_URL` 置空即回退「复制链接」方案。反代仅覆盖 `/jsxsd/`，官网未用 `/sso.jsp` 不在代理范围。
8. **OCR 进一步提升方向**：两处残余误读为同形异类（数字↔字母），可行方向——同图分别用 `0-9` 与 `a-z` 白名单各识别一次、按位置置信度择优选类（成本约 +1 倍识别时间），或改专用验证码识别模型；并给测试补真值基准、区分「合法」与「可信」（要求 `consensus≥2` 且至少一变体 conf 非 0）。
