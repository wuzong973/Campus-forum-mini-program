// 教务系统考试/成绩页面结构诊断（只读，不落任何用户数据）
// 用法：在服务器上 node scripts/diag-jw-pages.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const crypto = require("crypto");
const JwCrawler = require("/home/springboot/jw-crawler/crawler");
const pool = require("../config/pool");

const SECRET =
  process.env.JW_CRED_KEY ||
  process.env.APP_SECRET ||
  "gdipu-jw-credential-default-secret-key";
const KEY = crypto.createHash("sha256").update(String(SECRET)).digest();

function decryptCredential(payload) {
  const [ivB64, tagB64, dataB64] = String(payload || "").split(":");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      KEY,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    return "";
  }
}

(async () => {
  const [rows] = await pool.query(
    "SELECT user_id, username, password_enc FROM jw_credential ORDER BY updated_at DESC LIMIT 1",
  );
  if (!rows.length) {
    console.log("NO_CREDENTIAL");
    process.exit(0);
  }
  const username = String(rows[0].username || "");
  const password = decryptCredential(rows[0].password_enc);
  if (!username || !password) {
    console.log("DECRYPT_FAIL");
    process.exit(0);
  }
  console.log("account:", username.replace(/(\d{2})\d+(\d{2})/, "$1****$2"));

  const crawler = new JwCrawler({
    verbose: false,
    captchaPath: null,
    useOcr: true,
    maxCaptchaAttempts: 2,
    ocrOptions: { langPath: "/home/springboot/jw-crawler", gzip: false },
  });
  const loginMode = String(process.env.JW_LOGIN_MODE || "direct").toLowerCase();
  if (loginMode === "unified") {
    await crawler.loginWithCaptcha(username, password, { useOcr: true });
  } else {
    await crawler.loginJsxsdWithCaptcha(username, password, { useOcr: true });
  }
  console.log("LOGIN_OK");

  // 菜单中考试/成绩相关路径
  const main = await crawler.getSchedulePage();
  const menuUrls = main.match(/data-url="[^"]*(?:ks|cj)[^"]*"/g) || [];
  console.log("MENU:", [...new Set(menuUrls)].join(" , "));

  // 逐个探测候选页面
  const candidates = [
    "/jsxsd/xsks/xsksap_query",
    "/jsxsd/kscj/cjcx_frm",
    "/jsxsd/kscj/cjcx_list",
  ];
  for (const p of candidates) {
    try {
      const res = await crawler.instance.get(p, {
        headers: {
          Referer:
            "https://jw.gdipu.edu.cn/jsxsd/framework/xsMain_new.jsp?t1=1",
        },
      });
      const html = typeof res.data === "string" ? res.data : "";
      const tag = p.replace(/[^a-z0-9]/gi, "_");
      fs.writeFileSync(`/tmp/diag_${tag}.html`, html);
      const ajax = (html.match(/url\s*:\s*["'][^"']+["']/g) || []).slice(0, 12);
      const forms = html.match(/<form[^>]*>/gi) || [];
      const tableIds = html.match(/<table[^>]*id=["'][^"']+["'][^>]*>/gi) || [];
      console.log(
        `PAGE ${p} status=${res.status} len=${html.length} table=${html.includes("<table")} tableTags=${(html.match(/<table/gi) || []).length}`,
      );
      console.log("  ajax:", [...new Set(ajax)].join(" | ") || "none");
      console.log("  forms:", forms.join(" ; ") || "none");
      console.log("  tableIds:", tableIds.join(" ; ") || "none");
    } catch (e) {
      console.log(`PAGE ${p} ERR ${e.message}`);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
