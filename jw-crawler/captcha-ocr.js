const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const DEFAULT_CHAR_WHITELIST = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_AMBIGUOUS_MAP = {
  o: '0',
  i: '1',
  l: '1',
  '|': '1',
  z: '2',
  s: '5',
  b: '6',
  g: '9',
};

const workerCache = new Map();

function normalizeCaptchaText(text, length = 4, ambiguousMap = DEFAULT_AMBIGUOUS_MAP) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '');

  const strict = raw
    .replace(/[^a-z0-9]/g, '')
    .slice(0, length);

  if (strict.length === length) {
    return strict;
  }

  const corrected = Array.from(raw)
    .map(char => ambiguousMap[char] || char)
    .join('');

  return corrected
    .replace(/[^a-z0-9]/g, '')
    .slice(0, length);
}

function getLocalTesseractOptions(lang, options = {}) {
  const workerOptions = {
    cachePath: options.cachePath || process.cwd(),
    ...options.workerOptions,
  };

  if (options.langPath) {
    workerOptions.langPath = options.langPath;
    if (options.gzip !== undefined) workerOptions.gzip = options.gzip;
    return workerOptions;
  }

  const localTrainedData = path.resolve(process.cwd(), `${lang}.traineddata`);
  if (fs.existsSync(localTrainedData)) {
    workerOptions.langPath = path.dirname(localTrainedData);
    workerOptions.gzip = false;
  }

  return workerOptions;
}

async function toImageBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return fs.promises.readFile(input);
}

// Otsu 大津法：按灰度直方图求类间方差最大的分割阈值。
// 教务验证码前景/背景明暗随图变化，固定阈值（旧版 165）经常整体切糊，
// 逐图自适应比猜一个全局值稳得多。
function otsuThreshold(grayRaw) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < grayRaw.length; i++) histogram[grayRaw[i]]++;
  const total = grayRaw.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * histogram[v];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let v = 0; v < 256; v++) {
    wB += histogram[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * histogram[v];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  return threshold;
}

async function computeAdaptiveThreshold(base) {
  const { data } = await base
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return otsuThreshold(data);
}

// 二值图膨胀（前景为黑，即 3x3 最小值滤波）。sharp 0.33 尚无内置 dilate，
// 自实现一个：把细笔画/断裂笔画连起来，针对 1/l/i 这类细字符。
async function dilateBinary(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * channels, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const p = data[(yy * width + xx) * channels];
          if (p < v) v = p;
        }
      }
      out[(y * width + x) * channels] = v;
    }
  }
  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

async function buildImageVariants(input, options = {}) {
  const source = await toImageBuffer(input);
  const scale = options.scale || 6;

  const base = sharp(source).resize({ width: 80 * scale, withoutEnlargement: false }).grayscale();
  const threshold = options.threshold || (await computeAdaptiveThreshold(base));

  const otsu = base.clone().normalize().threshold(threshold);
  const otsuPng = await otsu.clone().png().toBuffer();
  const variants = [
    { name: 'original', input: source },
    { name: 'gray-scale', input: await base.clone().normalize().png().toBuffer() },
    { name: 'otsu', input: otsuPng },
    { name: 'otsu-negate', input: await otsu.clone().negate().png().toBuffer() },
    // 中值滤波去掉椒盐噪点后再二值化，针对验证码里的孤立杂点
    { name: 'median-otsu', input: await base.clone().normalize().median(3).threshold(threshold).png().toBuffer() },
    { name: 'otsu-dilate', input: await dilateBinary(otsuPng) },
  ];

  // 小角度旋转变体：教务验证码字符自带随机倾斜，实测 m→n、g→d 这类误读多由倾斜造成。
  // 在最优的二值图（otsu）上再转 ±4°/±8° 各识别一次，用于救回倾斜字符；
  // 每张约 +50ms，默认开启，可用 rotateAngles: [] 关闭。
  const rotateAngles = options.rotateAngles !== undefined
    ? options.rotateAngles
    : [-8, -4, 4, 8];
  for (const deg of rotateAngles) {
    variants.push({
      name: `otsu-rot${deg > 0 ? '+' : ''}${deg}`,
      input: await otsu.clone()
        .rotate(deg, { background: '#ffffff' })
        .png()
        .toBuffer(),
    });
  }

  if (options.debugDir) {
    await fs.promises.mkdir(options.debugDir, { recursive: true });
    for (const variant of variants) {
      await fs.promises.writeFile(path.join(options.debugDir, `captcha_${variant.name}.png`), variant.input);
    }
  }

  return variants;
}

function selectConsensus(results) {
  // 多个预处理变体可能给出不同结果。若同一 4 位文本被多个变体认可，
  // 优先选共识结果，比单纯取最高置信度更抗单张图预处理造成的误读。
  const groups = new Map();
  for (const item of results.filter(item => item.valid)) {
    const group = groups.get(item.text) || {
      text: item.text,
      count: 0,
      confidence: 0,
      variants: [],
      rawTexts: [],
    };
    group.count += 1;
    group.confidence += (item.confidence || 0);
    group.variants.push(item.variant);
    group.rawTexts.push(item.rawText);
    groups.set(item.text, group);
  }

  return Array.from(groups.values())
    .filter(group => group.count > 1)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      const aAvg = a.confidence / a.count;
      const bAvg = b.confidence / b.count;
      return bAvg - aAvg;
    });
}

async function recognizeCaptcha(input, options = {}) {
  const {
    lang = 'eng',
    expectedLength = 4,
    charWhitelist = DEFAULT_CHAR_WHITELIST,
    ambiguousMap = DEFAULT_AMBIGUOUS_MAP,
    minConfidence = 0,
    variants = true,
    verbose = false,
    reuseWorker = true,
    multiPsm = true,
  } = options;

  const workerOptions = getLocalTesseractOptions(lang, options);
  if (verbose) {
    workerOptions.logger = (message) => console.log('[OCR]', message);
  }

  const workerKey = JSON.stringify({
    lang,
    langPath: workerOptions.langPath || '',
    cachePath: workerOptions.cachePath || '',
    gzip: workerOptions.gzip,
  });

  let worker = reuseWorker ? workerCache.get(workerKey) : null;
  if (!worker) {
    worker = await createWorker(lang, 1, workerOptions, {
      load_system_dawg: '0',
      load_freq_dawg: '0',
      load_number_dawg: '0',
      load_punc_dawg: '0',
    });
    if (reuseWorker) workerCache.set(workerKey, worker);
  }

  try {
    const imageVariants = variants ? await buildImageVariants(input, options) : [{ name: 'original', input }];
    const results = [];

    const runBatch = async (psm) => {
      await worker.setParameters({
        tessedit_char_whitelist: charWhitelist,
        tessedit_pageseg_mode: psm,
        classify_bln_numeric_mode: '0',
        user_defined_dpi: '300',
      });
      const batch = [];
      for (const variant of imageVariants) {
        const result = await worker.recognize(variant.input);
        const rawText = result.data.text || '';
        const text = normalizeCaptchaText(rawText, expectedLength, ambiguousMap);
        const valid = new RegExp(`^[a-z0-9]{${expectedLength}}$`).test(text);
        batch.push({
          variant: variant.name,
          psm,
          text,
          rawText,
          confidence: result.data.confidence,
          minConfidence,
          valid,
        });
      }
      return batch;
    };

    const sortByPreference = () => {
      results.sort((a, b) => {
        if (a.valid !== b.valid) return a.valid ? -1 : 1;
        return (b.confidence || 0) - (a.confidence || 0);
      });
    };

    // 第一轮：单行模式（PSM 7）跑全部预处理变体，常规情况即可达成共识；
    // 无共识时第二轮补 PSM 8（单词）与 PSM 13（原始行），换定位方式救回
    // 字符被干扰线粘连或间距不均的图，常规路径不多花这 2/3 的时间。
    results.push(...(await runBatch('7')));
    sortByPreference();

    let consensus = selectConsensus(results);
    if (!consensus.length && multiPsm) {
      results.push(...(await runBatch('8')), ...(await runBatch('13')));
      sortByPreference();
      consensus = selectConsensus(results);
    }

    const selected = consensus.length
      ? {
          variant: consensus[0].variants.join(","),
          text: consensus[0].text,
          rawText: consensus[0].rawTexts[0],
          confidence: consensus[0].confidence / consensus[0].count,
          minConfidence,
          valid: true,
        }
      : results[0];

    return {
      ...selected,
      candidates: results,
      consensus: consensus.map(group => ({
        text: group.text,
        count: group.count,
        confidence: group.confidence / group.count,
      })),
    };
  } finally {
    if (!reuseWorker) {
      await worker.terminate();
    }
  }
}

async function terminateCachedWorkers() {
  const workers = Array.from(workerCache.values());
  workerCache.clear();
  await Promise.allSettled(workers.map(worker => worker.terminate()));
}

module.exports = {
  DEFAULT_AMBIGUOUS_MAP,
  DEFAULT_CHAR_WHITELIST,
  buildImageVariants,
  getLocalTesseractOptions,
  normalizeCaptchaText,
  otsuThreshold,
  recognizeCaptcha,
  selectConsensus,
  terminateCachedWorkers,
};

if (require.main === module) {
  (async () => {
    const imagePath = process.argv[2] || './captcha.png';
    const result = await recognizeCaptcha(imagePath, { verbose: process.argv.includes('--verbose') });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
  })().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
