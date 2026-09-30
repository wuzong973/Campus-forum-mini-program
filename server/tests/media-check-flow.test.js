// 媒体内容安全异步检测链路回归（P02/P14）
// 用假 pool / cos / axios 覆盖：提交任务、回调验签、违规下线、读取出口过滤。
const assert = require('assert')
const crypto = require('crypto')

const QUERIES = []
const DELETED = []
let TASK_ROWS = []
let axiosCalls = []
let axiosResponse = { data: { errcode: 0, trace_id: 'trace-1' } }

const fakePool = {
  async query(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    QUERIES.push({ sql: text, params: params || [] })
    if (/^INSERT INTO media_check_task/.test(text)) return [{ affectedRows: 1 }]
    if (/SELECT \* FROM media_check_task WHERE trace_id/.test(text)) {
      return [TASK_ROWS.filter((row) => String(row.trace_id) === String((params || [])[0]))]
    }
    if (/^UPDATE media_check_task SET status/.test(text)) return [{ affectedRows: 1 }]
    if (/SELECT media_url FROM media_check_task/.test(text)) {
      return [TASK_ROWS.filter((row) => row.status !== 'pass' && row.media_url).map((row) => ({ media_url: row.media_url }))]
    }
    return [[]]
  },
}

function stub(id, exports) {
  const resolved = require.resolve(id)
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

stub('../config/pool', fakePool)
// 与 config/cos.js 的签名保持一致：deleteObject(Key) 收的是字符串 Key
stub('../config/cos', {
  async deleteObject(Key) {
    DELETED.push(Key)
    return true
  },
})
stub('../utils/wechatToken', { async getAccessToken() { return 'fake-token' } })
stub('axios', {
  async post(url, body) {
    axiosCalls.push({ url, body })
    return axiosResponse
  },
})

const mediaCheck = require('../services/mediaCheckService')

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`PASS: ${label}`)
}

async function main() {
  // ---- 1) 未配置回调 Token：整条链路静默降级，绝不阻断上传 ----
  delete process.env.WX_MESSAGE_TOKEN
  const skipped = await mediaCheck.submit({ userId: 7, mediaUrl: 'https://cdn.example/uploads/a.jpg' })
  check('submit 返回 skipped 而不是抛错', () => {
    assert.strictEqual(skipped.submitted, false)
    assert.strictEqual(skipped.reason, 'token_not_configured')
    assert.strictEqual(mediaCheck.available(), false)
    assert.strictEqual(mediaCheck.verifySignature({ signature: 'x', timestamp: '1', nonce: '2' }), false)
  })

  // ---- 2) 配置 Token 后按官方协议提交 ----
  process.env.WX_MESSAGE_TOKEN = 'test-token'
  TASK_ROWS = [{ id: 1, trace_id: 'trace-1', media_type: 'image', media_url: 'https://cdn.example/uploads/a.jpg', object_key: 'uploads/a.jpg', status: 'pending' }]
  const submitted = await mediaCheck.submit({
    userId: 7,
    mediaUrl: 'https://cdn.example/uploads/a.jpg',
    objectKey: 'uploads/a.jpg',
    mediaType: 'image',
    openid: 'openid-1',
    scene: 3,
  })
  check('提交走 media_check_async 并落任务表', () => {
    assert.strictEqual(submitted.submitted, true)
    assert.strictEqual(submitted.traceId, 'trace-1')
    const call = axiosCalls[0]
    assert.match(call.url, /https:\/\/api\.weixin\.qq\.com\/wxa\/media_check_async\?access_token=fake-token$/)
    assert.strictEqual(call.body.media_url, 'https://cdn.example/uploads/a.jpg')
    assert.strictEqual(call.body.media_type, 2, '图片 media_type 固定为 2')
    assert.strictEqual(call.body.version, 2)
    assert.strictEqual(call.body.scene, 3)
    assert.strictEqual(call.body.openid, 'openid-1')
    const insert = QUERIES.find((q) => /^INSERT INTO media_check_task/.test(q.sql))
    assert.ok(insert, '应写入任务表')
    assert.deepStrictEqual(insert.params.slice(0, 4), [7, 'trace-1', 'image', 'uploads/a.jpg'])
  })

  check('回调验签：sha1(sort(token,timestamp,nonce))', () => {
    const timestamp = '1700000000'
    const nonce = 'abc123'
    const signature = crypto.createHash('sha1').update(['test-token', timestamp, nonce].sort().join('')).digest('hex')
    assert.strictEqual(mediaCheck.verifySignature({ signature, timestamp, nonce }), true)
    assert.strictEqual(mediaCheck.verifySignature({ signature: 'wrong', timestamp, nonce }), false)
    assert.strictEqual(mediaCheck.verifySignature({ signature, timestamp }), false)
  })

  // ---- 3) 检测通过：只更新状态，不动文件 ----
  await mediaCheck.handleEvent({ Event: 'wxa_media_check', trace_id: 'trace-1', errcode: 0, result: { suggest: 'pass', label: 100 } })
  check('suggest=pass 不删除文件', () => {
    const update = QUERIES.filter((q) => /^UPDATE media_check_task SET status = \?, label/.test(q.sql)).pop()
    assert.strictEqual(update.params[0], 'pass')
    assert.strictEqual(DELETED.length, 0)
    assert.strictEqual(mediaCheck.isBlocked('https://cdn.example/uploads/a.jpg'), false)
  })

  // ---- 4) 检测违规：下线对象并进入读路径过滤集合 ----
  await mediaCheck.handleEvent({ Event: 'wxa_media_check', trace_id: 'trace-1', errcode: 0, result: { suggest: 'risky', label: 21169 } })
  check('suggest=risky 删除 COS 对象并标记 removed', () => {
    assert.deepStrictEqual(DELETED, ['uploads/a.jpg'])
    const updates = QUERIES.filter((q) => /^UPDATE media_check_task SET status/.test(q.sql))
    // 先写 risky（带 label/errcode），删除对象成功后再落 removed 标记
    assert.strictEqual(updates[updates.length - 2].params[0], 'risky')
    assert.match(updates[updates.length - 1].sql, /SET status = 'removed'/)
    assert.strictEqual(mediaCheck.isBlocked('https://cdn.example/uploads/a.jpg'), true)
  })

  check('违规地址在读取出口被过滤（数组与 JSON 串两种形态）', () => {
    const blocked = 'https://cdn.example/uploads/a.jpg'
    assert.deepStrictEqual(
      mediaCheck.filterStoredImages([blocked, 'https://cdn.example/uploads/b.jpg']),
      ['https://cdn.example/uploads/b.jpg'],
    )
    assert.strictEqual(
      mediaCheck.filterStoredImages(JSON.stringify([{ type: 'video', url: blocked }, { url: 'https://cdn.example/uploads/c.jpg' }])),
      JSON.stringify([{ url: 'https://cdn.example/uploads/c.jpg' }]),
    )
    assert.strictEqual(mediaCheck.filterStoredImages('not-json'), 'not-json', '非 JSON 字符串原样返回')
  })

  check('非媒体检测事件与未知 trace_id 安全忽略', async () => {
    assert.strictEqual(await mediaCheck.handleEvent({ Event: 'other_event' }), false)
    assert.strictEqual(await mediaCheck.handleEvent({ Event: 'wxa_media_check' }), false)
    assert.strictEqual(await mediaCheck.handleEvent({ Event: 'wxa_media_check', trace_id: 'unknown-trace' }), false)
  })

  check('检测接口报错按未通过处理（宁可下线）', async () => {
    TASK_ROWS = [{ id: 2, trace_id: 'trace-err', media_type: 'image', media_url: 'https://cdn.example/uploads/err.jpg', object_key: 'uploads/err.jpg', status: 'pending' }]
    await mediaCheck.handleEvent({ Event: 'wxa_media_check', trace_id: 'trace-err', errcode: -100 })
    const update = QUERIES.filter((q) => /^UPDATE media_check_task SET status = \?, label/.test(q.sql)).pop()
    assert.strictEqual(update.params[0], 'failed')
    assert.deepStrictEqual(DELETED[1], 'uploads/err.jpg')
  })

  console.log(`媒体检测链路回归通过 ${passed} 组断言。`)
}

main().catch((error) => {
  console.error('FAILED:', error && error.message)
  process.exit(1)
})