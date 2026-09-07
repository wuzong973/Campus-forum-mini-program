// 教务系统考试安排真实查询诊断：POST /jsxsd/xsks/xsksap_list 并检查返回表格
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const crypto = require("crypto");
const qs = require("querystring");
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
    "SELECT username, password_enc FROM jw_credential ORDER BY updated_at DESC LIMIT 1",
  );
  const username = String(rows[0].username || "");
  const password = decryptCredential(rows[0].password_enc);

  const crawler = new JwCrawler({
    verbose: false,
    captchaPath: null,
    useOcr: true,
    maxCaptchaAttempts: 2,
    ocrOptions: { langPath: "/home/springboot/jw-crawler", gzip: false },
  });
  await crawler.loginJsxsdWithCaptcha(username, password, { useOcr: true });
  console.log("LOGIN_OK");

  // 1. 拿查询页（含学期选项）
  const page = await crawler.instance.get("/jsxsd/xsks/xsksap_query", {
    headers: {
      Referer: "https://jw.gdipu.edu.cn/jsxsd/framework/xsMain_new.jsp?t1=1",
    },
  });
  const semMatch = String(page.data).match(
    /<select id="xnxqid"[\s\S]*?<option selected value="([^"]+)"/,
  );
  const xnxqid = semMatch ? semMatch[1] : "";
  console.log("SEMESTER:", xnxqid);

  // 2. POST 真实查询
  const res = await crawler.instance.post(
    "/jsxsd/xsks/xsksap_list",
    qs.stringify({
      xqlbmc: "",
      sxxnxq: "",
      dqxnxq: "",
      ckbz: "",
      xnxqid,
      xqlb: "",
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://jw.gdipu.edu.cn/jsxsd/xsks/xsksap_query",
      },
    },
  );
  const html = typeof res.data === "string" ? res.data : "";
  fs.writeFileSync("/tmp/diag_exam_list.html", html);
  console.log("POST status=", res.status, "len=", html.length);

  const cheerio = require("/home/springboot/jw-crawler/node_modules/cheerio");
  const $ = cheerio.load(html);
  const tables = $("table");
  console.log("table count:", tables.length);
  tables.each((i, t) => {
    const rows = $(t).find("tr");
    const headers = rows
      .first()
      .find("th,td")
      .map((_, el) => $(el).text().trim())
      .get();
    console.log(
      `TABLE[${i}] id=${$(t).attr("id") || "-"} rows=${rows.length} headers=${headers.join("|").slice(0, 200)}`,
    );
    if (rows.length > 1) {
      console.log(
        "  ROW1:",
        rows.eq(1).text().replace(/\s+/g, " ").trim().slice(0, 180),
      );
    }
  });
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
