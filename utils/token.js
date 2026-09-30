/**
 * JWT 载荷解析（仅解码，不验签）
 *
 * 用途：前端需要知道「本地这个 token 到底还有没有效」，才能避免
 * 「app.globalData.token 有值 → 守卫全部放行 → 服务端每个鉴权接口都 401」
 * 的僵尸登录态。
 *
 * 服务端签发的是 HS256 标准三段式 JWT，载荷为 { userId, iat, exp }。
 * 小程序运行时不保证有 atob / Buffer，这里自带一份纯 JS 的 base64 解码。
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// 提前视为过期的安全余量：避免「本地判定还有 1 秒、请求到服务端已经过期」的边界抖动
const EXPIRY_SKEW_MS = 60 * 1000

function base64ToBytes(input) {
  // JWT 用的是 base64url：先把 -/_ 换回 +// 再解码，
  // 否则含 - 或 _ 的载荷会被当成非法字符剔除，解出乱码。
  const source = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '')
  let output = ''
  let buffer = 0
  let bits = 0
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i)
    if (char === '=') break
    const value = BASE64_CHARS.indexOf(char)
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return output
}

// 把「每字符 = 一个字节」的串按 UTF-8 还原成正常字符串。
// JWT 载荷是 UTF-8 编码的 JSON，昵称等字段可能含中文，不能直接当 latin1 用。
function utf8Decode(bytes) {
  let output = ''
  for (let i = 0; i < bytes.length; i += 1) {
    const b1 = bytes.charCodeAt(i)
    if (b1 < 0x80) {
      output += String.fromCharCode(b1)
      continue
    }
    if (b1 < 0xe0) {
      output += String.fromCharCode(((b1 & 0x1f) << 6) | (bytes.charCodeAt(++i) & 0x3f))
      continue
    }
    if (b1 < 0xf0) {
      const b2 = bytes.charCodeAt(++i)
      const b3 = bytes.charCodeAt(++i)
      output += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
      continue
    }
    const b2 = bytes.charCodeAt(++i)
    const b3 = bytes.charCodeAt(++i)
    const b4 = bytes.charCodeAt(++i)
    const codePoint =
      ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
    const offset = codePoint - 0x10000
    output += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff))
  }
  return output
}

function base64ToUtf8(input) {
  return utf8Decode(base64ToBytes(input))
}

function decodeTokenPayload(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const payload = JSON.parse(base64ToUtf8(parts[1]))
    return payload && typeof payload === 'object' ? payload : null
  } catch (e) {
    return null
  }
}

// 过期时间（毫秒时间戳）；无法解析时返回 0
function tokenExpiresAt(token) {
  const payload = decodeTokenPayload(token)
  const exp = payload && Number(payload.exp)
  if (!exp || !Number.isFinite(exp)) return 0
  return exp * 1000
}

/**
 * 是否已过期。
 * 注意：无法解析（非标准 JWT / 老格式）时一律返回 false —— 宁可退回
 * 「交给服务端判定」的旧行为，也不要误判把正常用户踢下线。
 */
function isTokenExpired(token, skewMs) {
  const expiresAt = tokenExpiresAt(token)
  if (!expiresAt) return false
  const skew = typeof skewMs === 'number' ? skewMs : EXPIRY_SKEW_MS
  return Date.now() >= expiresAt - skew
}

module.exports = {
  decodeTokenPayload,
  tokenExpiresAt,
  isTokenExpired,
  EXPIRY_SKEW_MS,
}
