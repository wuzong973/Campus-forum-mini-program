const express = require("express");
const http = require("http");
const { URL } = require("url");

const router = express.Router();

const TARGET_ORIGIN = "http://bd.bdfairy.cn";
const TARGET_HOST = "bd.bdfairy.cn";
const PROXY_PREFIX = "/api/v1/power";
const COOKIE_PREFIX = "bd_power_";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getTargetUrl(req) {
  return new URL(req.url, TARGET_ORIGIN);
}

function buildRequestHeaders(req, targetUrl) {
  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  headers["accept-encoding"] = "identity";
  headers.referer = targetUrl.href;
  headers.origin = TARGET_ORIGIN;

  // 只转发代理页自己写入的 Cookie，避免把小程序登录态等本站 Cookie 送到第三方。
  const proxyCookies = String(headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.indexOf(COOKIE_PREFIX) === 0)
    .map((item) => {
      const separator = item.indexOf("=");
      const name = item.slice(COOKIE_PREFIX.length, separator);
      return `${name}=${item.slice(separator + 1)}`;
    });

  if (proxyCookies.length) {
    headers.cookie = proxyCookies.join("; ");
  } else {
    delete headers.cookie;
  }

  delete headers["x-forwarded-proto"];
  headers["x-forwarded-proto"] = "https";
  return headers;
}

function rewriteLocation(value, targetUrl) {
  try {
    const url = new URL(value, targetUrl);
    if (url.host.toLowerCase() === TARGET_HOST) {
      return `${PROXY_PREFIX}${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch (e) {
    return value;
  }
}

function rewriteSetCookie(value) {
  const parts = String(value).split(";");
  const pair = parts.shift() || "";
  const separator = pair.indexOf("=");
  if (separator < 0) return null;

  const name = pair.slice(0, separator).trim();
  const cookieValue = pair.slice(separator + 1).trim();
  const keptAttributes = [];

  for (const rawAttribute of parts) {
    const attribute = rawAttribute.trim();
    const [attributeName] = attribute.split("=");
    const lowerName = String(attributeName || "").trim().toLowerCase();
    if (["domain", "path", "secure", "samesite"].indexOf(lowerName) > -1) continue;
    keptAttributes.push(attribute);
  }

  return [
    `${COOKIE_PREFIX}${name}=${cookieValue}`,
    `Path=${PROXY_PREFIX}`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
  ].concat(keptAttributes).join("; ");
}

function rewriteProxyText(text) {
  return text
    .replace(/(?:https?:)?\/\/bd\.bdfairy\.cn/gi, PROXY_PREFIX)
    .replace(
      /(\s(?:href|src|action|data-src|data-url)\s*=\s*)(["'])\/(?!\/|api\/v1\/power(?:\/|$))/ig,
      (match, attribute, quote) => `${attribute}${quote}${PROXY_PREFIX}/`,
    )
    .replace(
      /(\burl\(\s*["']?)\/(?!\/|api\/v1\/power(?:\/|$))/ig,
      (match, prefix) => `${prefix}${PROXY_PREFIX}/`,
    )
    .replace(
      /(["'])\/(?!\/|api\/v1\/power(?:\/|$))([^"'\r\n]+?)\1/g,
      (match, quote, path) => `${quote}${PROXY_PREFIX}/${path}${quote}`,
    );
}

function injectBaseTag(html) {
  if (/<base\s/i.test(html)) return html;
  const baseTag = `<base href="${PROXY_PREFIX}/">`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    return html.replace(headMatch[0], `${headMatch[0]}${baseTag}`);
  }
  return baseTag + html;
}

function isRewritableText(contentType) {
  // 外部 JS 可能包含以 "/" 开头的普通字符串（例如 Vue 编译器标记），
  // 通用路径改写会破坏库代码；HTML/CSS 才做文本重写，JS 保持原样透传。
  return /text\/html|text\/css/i.test(contentType);
}

router.all(/^\/.*/, (req, res) => {
  let targetUrl;
  try {
    targetUrl = getTargetUrl(req);
  } catch (e) {
    return res.status(400).send("Invalid power service URL");
  }

  const headers = buildRequestHeaders(req, targetUrl);
  let requestBody = req;

  // Express 的 JSON / form 中间件已消费请求流，这里用解析后的 body 重建转发内容。
  if (req.method !== "GET" && req.method !== "HEAD" && req.body && Object.keys(req.body).length) {
    const contentType = String(req.headers["content-type"] || "");
    if (contentType.indexOf("application/x-www-form-urlencoded") === 0) {
      requestBody = new URLSearchParams(req.body).toString();
    } else if (contentType.indexOf("application/json") === 0) {
      requestBody = JSON.stringify(req.body);
    }
    headers["content-length"] = Buffer.byteLength(requestBody);
  }

  const upstream = http.request(targetUrl, {
    method: req.method,
    headers,
  }, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers };
    HOP_BY_HOP_HEADERS.forEach((name) => delete responseHeaders[name]);
    delete responseHeaders["content-security-policy"];
    delete responseHeaders["x-frame-options"];

    if (responseHeaders.location) {
      responseHeaders.location = rewriteLocation(responseHeaders.location, targetUrl);
    }
    if (responseHeaders["set-cookie"]) {
      const cookies = [].concat(responseHeaders["set-cookie"])
        .map(rewriteSetCookie)
        .filter(Boolean);
      if (cookies.length) {
        responseHeaders["set-cookie"] = cookies;
      } else {
        delete responseHeaders["set-cookie"];
      }
    }

    const contentType = String(responseHeaders["content-type"] || "");
    res.removeHeader("Content-Security-Policy");

    if (req.method === "HEAD") {
      res.status(upstreamRes.statusCode).set(responseHeaders).end();
      return;
    }

    if (isRewritableText(contentType)) {
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf8");
        body = rewriteProxyText(body);
        if (/text\/html/i.test(contentType)) {
          body = injectBaseTag(body);
        }
        delete responseHeaders["content-length"];
        responseHeaders["content-length"] = Buffer.byteLength(body);
        res.status(upstreamRes.statusCode).set(responseHeaders).send(body);
      });
      return;
    }

    res.status(upstreamRes.statusCode).set(responseHeaders);
    upstreamRes.pipe(res);
  });

  upstream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(502).send("Power service is unavailable");
  });

  if (req.method === "GET" || req.method === "HEAD") {
    upstream.end();
  } else {
    requestBody.pipe ? requestBody.pipe(upstream) : upstream.end(requestBody);
  }
});

module.exports = router;
