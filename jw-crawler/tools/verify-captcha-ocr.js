const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const ROOT = path.join(__dirname, '..');
const cap = require(path.join(ROOT, 'captcha-ocr'));

const BASE = 'https://jw.gdipu.edu.cn';
const OUT_DIR = path.join(ROOT, 'captcha-samples');
const N = 10;

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const opts = { langPath: ROOT, cachePath: path.join(ROOT, '.ocr-cache'), gzip: false };
  const rows = [];

  for (let i = 0; i < N; i++) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({
      baseURL: BASE,
      timeout: 12000,
      jar,
      withCredentials: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Referer: BASE + '/jsxsd/framework/xsMain.jsp',
      },
    }));
    try {
      await client.get('/jsxsd/framework/xsMain.jsp');
      const res = await client.get('/jsxsd/verifycode.servlet?t=' + Math.random(), { responseType: 'arraybuffer' });
      const buf = Buffer.from(res.data);
      const file = path.join(OUT_DIR, `captcha_${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(file, buf);
      const r = await cap.recognizeCaptcha(buf, opts);
      rows.push({
        file: path.basename(file),
        text: r.text,
        valid: r.valid,
        confidence: Math.round((r.confidence || 0) * 10) / 10,
        variant: r.variant,
        consensusCount: (r.consensus && r.consensus[0] && r.consensus[0].count) || 1,
      });
      console.log(`[${i + 1}/${N}] ${rows[i].file} -> ${r.text} conf=${rows[i].confidence} consensus=${rows[i].consensusCount}`);
    } catch (e) {
      console.log(`[${i + 1}/${N}] FETCH/OCR FAILED: ${e.message}`);
      rows.push({ file: `captcha_${String(i + 1).padStart(2, '0')}.png`, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(rows, null, 2));
  console.log('DONE, results saved to captcha-samples/results.json');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
