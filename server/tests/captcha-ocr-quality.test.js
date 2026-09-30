// 回归：教务验证码 OCR 质量改进。
// 背景：线上实测 191 次猜测仅 1 次命中（≈0.5%）。改进点：
// ① Otsu 自适应阈值取代固定阈值 165；② 中值滤波/二值膨胀去噪变体；
// ③ 预处理变体间共识选择（多数派优先于单变体高置信度）；④ 无共识时
// 自动补 PSM 8/13 二次识别。真机识别依赖 tesseract worker，这里只测纯逻辑
// 与流水线结构。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const cap = require(path.join(root, 'jw-crawler', 'captcha-ocr'))

// 1. normalizeCaptchaText：小写化、去空白、限长
assert.strictEqual(cap.normalizeCaptchaText('K7M2'), 'k7m2')
assert.strictEqual(cap.normalizeCaptchaText(' a b 3 d '), 'ab3d')
// 严格 4 位时直接返回；不足 4 位才走歧义字符纠正（o→0 i/l→1 z→2 s→5 b→6 g→9）
assert.strictEqual(cap.normalizeCaptchaText('ob1i'), 'ob1i')
assert.strictEqual(cap.normalizeCaptchaText('o b @ x'), '06x')
assert.strictEqual(cap.normalizeCaptchaText('o i l @'), '011')
// 干扰字符剔除后不足 4 位 → 无效文本
assert.strictEqual(cap.normalizeCaptchaText('a@#'), 'a')
assert.strictEqual(cap.normalizeCaptchaText(''), '')

// 2. otsuThreshold：双峰直方图应取到两峰之间的分割点
function grayFrom(values) {
  return Buffer.from(values)
}
const bimodal = []
for (let i = 0; i < 1000; i++) bimodal.push(i % 2 ? 20 : 21)   // 前景峰
for (let i = 0; i < 1000; i++) bimodal.push(i % 2 ? 230 : 231) // 背景峰
const t1 = cap.otsuThreshold(grayFrom(bimodal))
// 阈值必须落在前景峰上界（21）与背景峰下界（230）之间，两峰才能被正确分开
assert.ok(t1 >= 21 && t1 <= 230, '双峰直方图的阈值应落在两峰之间，实际 ' + t1)
// 全同值图不应崩溃，且返回 0-255 内的合法值
const flat = cap.otsuThreshold(grayFrom(new Array(512).fill(128)))
assert.ok(flat >= 0 && flat <= 255)

// 3. selectConsensus：多数派共识优先于单变体高置信度
const results = [
  { text: 'k7ne', valid: true, confidence: 90, variant: 'a', rawText: 'k7ne' },
  { text: 'k7m2', valid: true, confidence: 40, variant: 'b', rawText: 'k7m2' },
  { text: 'k7m2', valid: true, confidence: 50, variant: 'c', rawText: 'k7m2' },
]
const consensus = cap.selectConsensus(results)
assert.strictEqual(consensus.length, 1)
assert.strictEqual(consensus[0].text, 'k7m2')
assert.strictEqual(consensus[0].count, 2)
// 平均置信度相同Count不同时，count 优先（已按 count 排序）
assert.strictEqual(cap.selectConsensus([
  { text: 'aaaa', valid: true, confidence: 80, variant: 'a', rawText: 'aaaa' },
  { text: 'aaaa', valid: true, confidence: 60, variant: 'b', rawText: 'aaaa' },
  { text: 'bbbb', valid: true, confidence: 70, variant: 'c', rawText: 'bbbb' },
])[0].text, 'aaaa')

// 4. 流水线结构：新变体与两段式 PSM 必须存在
const capJs = fs.readFileSync(path.join(root, 'jw-crawler', 'captcha-ocr.js'), 'utf8')
for (const marker of ["name: 'otsu'", "name: 'otsu-negate'", "name: 'median-otsu'", "name: 'otsu-dilate'", 'median(3)', 'dilateBinary']) {
  assert.ok(capJs.includes(marker), `captcha-ocr.js 缺少预处理变体 ${marker}`)
}
assert.ok(capJs.includes("runBatch('7')"), '第一轮必须使用 PSM 7')
// 小角度旋转变体（针对 m→n / g→d 这类倾斜误读），可通过 rotateAngles 关闭
assert.ok(capJs.includes('rotateAngles'), 'captcha-ocr.js 需支持小角度旋转变体')
assert.ok(capJs.includes('otsu-rot'), '旋转变体需以 otsu 二值图为基准')
assert.ok(/\[-8, -4, 4, 8\]/.test(capJs), '默认旋转角度为 ±4°/±8°')
assert.ok(capJs.includes("runBatch('8')") && capJs.includes("runBatch('13')"), '无共识时必须补 PSM 8/13 二次识别')
// 上游消费接口保持稳定：jwScheduleSyncService.recognizeChallengeCaptcha 依赖 text/confidence/valid
const syncJs = fs.readFileSync(path.join(root, 'server', 'services', 'jwScheduleSyncService.js'), 'utf8')
assert.ok(/result\.text[\s\S]{0,200}result\.valid/.test(syncJs.replace(/\r/g, '')), '同步服务依赖的 OCR 结果字段未变')

console.log('Captcha OCR quality test passed.')
