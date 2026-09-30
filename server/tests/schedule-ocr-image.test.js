// 回归：课表截图 OCR 链路。
// 修复前：客户端上传图片（multipart），服务端 exports.ocr 只读 req.body.rawText
// （multipart 里不存在该字段）→ 永远 422「未能识别出有效课程」；且 multer 临时文件
// 从不清理。本测试锁住图片识别、rawText 兼容、临时文件清理三个行为。
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 在 require controller 之前替换 ocrService，避免真实调用微信接口
const ocrServicePath = require.resolve('../services/ocrService')
const ocrStub = {
  isConfigured: () => true,
  captureOcrImageMiddleware: (req, res, next) => next(),
  recognizeScheduleImage: async () => ({ lines: [], rawText: '' }),
}
require.cache[ocrServicePath] = {
  id: ocrServicePath,
  filename: ocrServicePath,
  loaded: true,
  exports: ocrStub,
}

const controller = require('../controllers/scheduleController')

function makeRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  return res
}

async function runOcr(req) {
  const res = makeRes()
  await controller.ocr(req, res)
  return res
}

function tempPng() {
  const p = path.join(os.tmpdir(), 'ocr-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.png')
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return p
}

;(async () => {
  // 1. 图片路径：OCR 文本被结构化成课程，strategy 标明实际链路，临时文件被清理
  {
    const filePath = tempPng()
    ocrStub.recognizeScheduleImage = async () => ({
      lines: [
        '高等数学 周一 第1节 1-16周 A301 张老师',
        '大学英语 周三 第3节 1-16周 B205 李老师',
      ],
      rawText: '高等数学 周一 第1节 1-16周 A301 张老师\n大学英语 周三 第3节 1-16周 B205 李老师',
    })
    const res = await runOcr({ body: {}, ocrImageBuffer: Buffer.from('img'), file: { path: filePath } })
    assert.strictEqual(res.statusCode, 200, '图片识别应成功: ' + JSON.stringify(res.body))
    assert.strictEqual(res.body.data.strategy, 'wechat-ocr+rule-parse')
    assert.strictEqual(res.body.data.courses.length, 2)
    assert.strictEqual(res.body.data.courses[0].name, '高等数学')
    assert.strictEqual(res.body.data.courses[0].weekDay, 1)
    assert.strictEqual(res.body.data.courses[0].startTime, '08:30')
    assert.strictEqual(res.body.data.courses[1].weekDay, 3)
    // fs.unlink 是异步回调，给事件循环一拍时间完成删除
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(!fs.existsSync(filePath), 'multer 临时文件必须被清理')
  }

  // 2. OCR 服务抛 expose 错误 → 透出明确提示与状态码
  {
    ocrStub.recognizeScheduleImage = async () => {
      const e = new Error('今日课表识别次数已用完，请明天再试或手动录入课程')
      e.status = 503; e.expose = true; throw e
    }
    const res = await runOcr({ body: {}, ocrImageBuffer: Buffer.from('img'), file: null })
    assert.strictEqual(res.statusCode, 503)
    assert.ok(/次数已用完/.test(res.body.message))
  }

  // 3. OCR 返回空文本 → 422 + 可读提示
  {
    ocrStub.recognizeScheduleImage = async () => ({ lines: [], rawText: '' })
    const res = await runOcr({ body: {}, ocrImageBuffer: Buffer.from('img'), file: null })
    assert.strictEqual(res.statusCode, 422)
    assert.ok(res.body.message.includes('未能识别出有效课程'))
  }

  // 4. 兼容旧 rawText JSON 调用（不得触发微信 OCR）
  {
    let called = false
    ocrStub.recognizeScheduleImage = async () => { called = true; return { lines: [], rawText: '' } }
    const res = await runOcr({ body: { rawText: '数据结构 周五 第5节 1-16周 C110 王老师' }, file: null })
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.body.data.strategy, 'rule-parse-v2')
    assert.strictEqual(res.body.data.courses[0].name, '数据结构')
    assert.strictEqual(res.body.data.courses[0].weekDay, 5)
    assert.ok(!called, 'rawText 模式不得触发微信 OCR')
  }

  // 5. 微信凭据未配置 → 503 明确提示而不是含糊报错
  {
    ocrStub.isConfigured = () => false
    const res = await runOcr({ body: {}, ocrImageBuffer: Buffer.from('img'), file: null })
    assert.strictEqual(res.statusCode, 503)
    assert.ok(/未配置/.test(res.body.message))
    ocrStub.isConfigured = () => true
  }

  console.log('Schedule OCR image test passed.')
})().catch((e) => { console.error(e); process.exit(1) })
