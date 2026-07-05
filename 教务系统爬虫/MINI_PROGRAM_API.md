# Mini Program Multi-User API（小程序多用户 API 接口文档）

> 本后端支持多学生使用。每个小程序用户提交自己的教务账号和密码，服务器会创建独立的 `userId`，在内存中保持独立的爬虫会话，在磁盘上加密存储密码，并将课表缓存存储在该用户的独立目录下。

---

## 启动步骤

```powershell
# 复制环境变量模板
Copy-Item .env.example .env
# 编辑 .env 文件，配置 API_KEY 和 APP_SECRET
npm run server
```

### 必需配置项

```dotenv
# API 密钥，用于验证请求合法性（请替换为随机字符串）
API_KEY=c0281bb37d1651392b35d2d3f725eafdaaf10d54520a93ff6df24ec12e43c541
# 应用密钥，用于生成 userId 和加密用户密码（至少 16 位随机字符）
APP_SECRET=01e7989815447ff03d3050039bcd535d7f6928d26a3912e69f2bb211a039645d06148adc38c5636788513af706891a4d3a86f03c65442b37065263c7f0263bca
```

> ⚠️ **重要**：真实用户登录后请勿修改 `APP_SECRET`，它用于生成 userId 和加密密码，修改后所有旧用户数据将无法使用。

---

## 用户操作流程

```text
用户打开小程序
  -> 输入学号 + 密码
  -> POST /api/user/login（发起登录请求）
  -> 如果需要验证码，显示返回的 captcha.dataUrl
  -> POST /api/user/captcha/:challengeId（提交验证码）
  -> 登录成功，将返回的 userId 存储到小程序本地存储
  -> GET /api/user/schedule?userId=xxx（获取课表）
  -> 渲染课表界面
```

---

## API 接口列表

所有请求可包含以下请求头：

```http
x-api-key: 你的 API_KEY
```

### `POST /api/user/login`（用户登录）

**请求参数**：

```json
{
  "account": "学号",
  "password": "教务密码"
}
```

**成功响应**：

```json
{
  "ok": true,
  "userId": "32位十六进制ID",
  "authenticated": true,
  "auth": {
    "status": "authenticated",
    "authenticated": true
  }
}
```

**需要验证码时（HTTP 409）**：

```json
{
  "ok": false,
  "code": "CAPTCHA_REQUIRED",
  "userId": "32位十六进制ID",
  "challengeId": "uuid格式的挑战ID",
  "captcha": {
    "dataUrl": "data:image/png;base64,..."
  }
}
```

---

### `POST /api/user/captcha/:challengeId`（提交验证码）

**请求参数**：

```json
{
  "code": "a1b2"
}
```

**成功响应**：与 `/api/user/login` 成功响应格式相同，包含 `userId`。

---

### `GET /api/user/schedule?userId=xxx&date=2026-07-03&format=mini`（获取单周课表）

返回一周的课表数据。如果服务器会话已过期，会自动重新加载该用户的加密凭证并登录。

**缓存隔离路径**：

```text
.cache/users/<userId>/schedules/
```

**查询参数**：

| 参数     | 类型   | 说明                                      |
| -------- | ------ | ----------------------------------------- |
| `userId` | string | 用户唯一标识（必需）                      |
| `date`   | string | 目标日期，格式 YYYY-MM-DD                 |
| `format` | string | 响应格式：`mini`（分组）或 `flat`（扁平） |
| `force`  | number | 是否强制刷新：`1` 绕过缓存                |

---

### `GET /api/user/schedule/weeks?userId=xxx&semesterStart=2026-03-02&weeks=19`（获取多周课表）

获取单个用户的多周课表数据。由于爬虫有速率限制，此接口可能需要较长时间。

**查询参数**：

| 参数            | 类型   | 说明                          |
| --------------- | ------ | ----------------------------- |
| `userId`        | string | 用户唯一标识（必需）          |
| `semesterStart` | string | 学期开始日期，格式 YYYY-MM-DD |
| `weeks`         | number | 总周数（默认 19）             |
| `format`        | string | 响应格式：`mini` 或 `flat`    |

---

### `GET /api/user/status?userId=xxx`（查看用户状态）

显示指定用户的认证状态和缓存信息。

---

### `POST /api/user/cache/clear`（清除用户缓存）

**请求参数**：

```json
{
  "userId": "32位十六进制ID"
}
```

仅清除该用户的课表缓存，不影响其他用户。

---

### `POST /api/user/logout`（用户退出登录）

清除该用户的内存中爬虫会话。加密凭证仍保留在磁盘上，以便后续课表同步时可以重新登录。

---

## 小程序调用示例

```js
// API 基础地址（替换为你的服务器域名）
const API_BASE = "https://your-domain.example.com";
// 与后端相同的 API 密钥
const API_KEY =
  "c0281bb37d1651392b35d2d3f725eafdaaf10d54520a93ff6df24ec12e43c541";

/**
 * 通用 API 请求函数
 * @param {Object} options - 请求配置
 * @param {string} options.url - 请求路径
 * @param {string} options.method - 请求方法（GET/POST）
 * @param {Object} options.data - 请求数据
 */
function apiRequest({ url, method = "GET", data = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${url}`,
      method,
      data,
      header: { "x-api-key": API_KEY },
      success(res) {
        // 需要验证码
        if (res.statusCode === 409 && res.data.code === "CAPTCHA_REQUIRED") {
          resolve({ needCaptcha: true, challenge: res.data });
          return;
        }
        // 请求成功
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data.ok) {
          resolve(res.data);
          return;
        }
        // 请求失败
        reject(new Error(res.data?.message || "request failed"));
      },
      fail: reject,
    });
  });
}

/**
 * 用户登录
 * @param {string} account - 学号
 * @param {string} password - 密码
 */
async function login(account, password) {
  const result = await apiRequest({
    url: "/api/user/login",
    method: "POST",
    data: { account, password },
  });

  // 如果需要验证码，返回验证码信息
  if (result.needCaptcha) return result;

  // 登录成功，保存 userId
  wx.setStorageSync("jwUserId", result.userId);
  return result;
}

/**
 * 提交验证码
 * @param {string} challengeId - 验证码挑战 ID
 * @param {string} code - 4 位验证码
 */
async function submitCaptcha(challengeId, code) {
  const result = await apiRequest({
    url: `/api/user/captcha/${challengeId}`,
    method: "POST",
    data: { code },
  });
  // 验证成功，保存 userId
  wx.setStorageSync("jwUserId", result.userId);
  return result;
}

/**
 * 获取课表
 * @param {string} date - 目标日期，格式 YYYY-MM-DD
 */
function getSchedule(date) {
  const userId = wx.getStorageSync("jwUserId");
  return apiRequest({
    url: "/api/user/schedule",
    data: { userId, date, format: "mini" },
  });
}
```

---

## 安全说明

| 安全措施             | 说明                                                              |
| -------------------- | ----------------------------------------------------------------- |
| **小程序不存储密码** | 小程序仅存储 `userId`，不存储教务密码                             |
| **密码加密**         | 用户密码使用 AES-256-GCM 加密后存储到 `.data/users/<userId>.json` |
| **会话隔离**         | 每个用户在内存中有独立的爬虫实例和 Cookie 容器                    |
| **缓存隔离**         | 每个用户有独立的课表缓存目录                                      |
| **HTTPS 要求**       | 生产环境必须使用 HTTPS                                            |
| **密钥保护**         | `API_KEY` 和 `APP_SECRET` 不应出现在客户端代码中                  |
| **微信登录绑定**     | 后续可在后端实现 `openid -> userId` 的映射                        |

---

## 响应数据结构

### 课表响应格式（`format=mini`）

```json
{
  "ok": true,
  "userId": "32位十六进制ID",
  "source": "live",
  "date": "2026-07-03",
  "courseCount": 5,
  "schedule": {
    "flat": [],
    "byDay": [],
    "bySection": []
  }
}
```

### 课程对象字段说明

| 字段                | 类型   | 说明                            |
| ------------------- | ------ | ------------------------------- |
| `id`                | string | 课程唯一标识符                  |
| `name`              | string | 课程名称                        |
| `teacher`           | string | 授课教师                        |
| `location`          | string | 上课地点/教室                   |
| `campus`            | string | 所属校区                        |
| `weekDay.index`     | number | 星期索引（1=周一，7=周日）      |
| `weekDay.name`      | string | 星期名称                        |
| `section.start`     | number | 开始节次                        |
| `section.end`       | number | 结束节次                        |
| `section.label`     | string | 节次范围标签                    |
| `section.timeRange` | string | 时间范围                        |
| `weeks.text`        | string | 周数文本描述                    |
| `weeks.ranges`      | array  | 周数范围数组                    |
| `weeks.parity`      | string | 单双周标识（all/single/double） |
