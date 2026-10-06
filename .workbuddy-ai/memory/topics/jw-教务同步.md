# 课表 / 教务同步（jw）

> 从 `MEMORY.md` 拆出（2026-10-06）。低事故区，需要时读取。

- **课表页只渲染「当前选中周」**。**判断「课表丢没丢」看「编辑课表」页（同一 `/schedule/list`，顶部「共 N 门课程」），不是课表页空态**（大一军训 2 周、课程多从第 3 周起）。
- **周次导航栏不得依赖 `courses.length`**：空态须区分「学期无课」与「本周无课」（`semesterCourseCount`/`firstCourseWeek`），本周无课自动跳到首个有课周（跳过单双周不匹配，只跳一次）。顶部「第 N 周」可点开全周次总览。**写操作不得谎报成功**（须等接口成功才提示）。本地 `schedule_courses` **只有写没有读**（死缓存），别写它。
- **业务码在 `data.code`**（`CAPTCHA_REQUIRED`/`JW_CREDENTIAL_INVALID`/`JW_NOT_BOUND`），`code` 是 HTTP 状态码 —— 判业务分支**必须用 `err.bizCode`**。登录：`xsMain.jsp` → `verifycode.servlet`(JPEG) → `POST /jsxsd/xk/LoginToXk`，body `=base64(账号)%%%base64(密码)`；失败原因在 `#showMsg`。容错 `JW_TIMEOUT_MS=10000`/`JW_MAX_RETRIES=1`；OCR `JW_USE_OCR=1` 实测 18/20。`jw_credential` AES-256-GCM。
- **学校侧故障**：教务前置阿里云 SLB 源站超时时间歇 504/502，与我们无关；统一映射 502 +「教务系统暂时无法连接…」，临时故障**不清除已绑定凭证**。官网同源反代 `location /jsxsd/` → `https://jw.gdipu.edu.cn/jsxsd/`（换 Host/Referer、`proxy_hide_header X-Frame-Options`），回滚 `payun01.cn.conf.bak-20260914-jsxsd`。
- 学期口径唯一来源 `utils/schedule.js`：`DEFAULT_SEMESTER_START="2026-09-07"`、`DEFAULT_TOTAL_WEEKS=20`、`computeAcademicWeek()`（周一锚定）。
