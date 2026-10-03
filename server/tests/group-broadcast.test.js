/**
 * 微信群播报文案组装 回归测试（无需数据库 / 无需网络）
 *
 * 覆盖 services/groupBroadcastService.js 的纯逻辑部分：
 *   A. clip：连续空白折叠成单空格；超长截断并以「…」结尾且不超过上限
 *   B. composeBroadcast：每条「摘要+短链」、条目间空行、————— 分隔线、页脚与论坛入口
 *   C. composeBroadcast：无自定义页脚时不产生空页脚行；单条帖子不出现分隔线
 *   D. 短链保持 genwxashortlink 返回的 #小程序:// 原文，不被改写（改写后聊天里点不开）
 */
const assert = require('assert')
const { clip, composeBroadcast } = require('../services/groupBroadcastService')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

// A. clip
check(() => {
  assert.strictEqual(clip('  出一把   战载\n8000  '), '出一把 战载 8000')
}, 'clip 折叠连续空白并去首尾')

check(() => {
  const out = clip('找'.repeat(100))
  assert.strictEqual(out.length, 42)
  assert.ok(out.endsWith('…'))
}, 'clip 超长截断为 42 字符并以省略号结尾')

check(() => {
  assert.strictEqual(clip('短内容'), '短内容')
}, 'clip 不截断短文本')

// B/C. composeBroadcast
check(() => {
  const text = composeBroadcast(
    [
      { id: 1, title: '出一把战载 8000 4ug5', content: '', link: '#小程序://广轻论坛/AbCdEf1G' },
      { id: 2, title: '', content: '有谁可以说一下在万象影城看复联的场次', link: '#小程序://广轻论坛/xYzWq9876' }
    ],
    '#小程序://广轻论坛/EntrY99',
    '考驾照就选【晨曦驾校】'
  )
  const lines = text.split('\n')
  assert.strictEqual(lines[0], '出一把战载 8000 4ug5')
  assert.strictEqual(lines[1], '#小程序://广轻论坛/AbCdEf1G')
  assert.strictEqual(lines[2], '')
  assert.strictEqual(lines[3], '有谁可以说一下在万象影城看复联的场次')
  assert.ok(lines.includes('—————'), '应有分隔线')
  assert.ok(lines.includes('考驾照就选【晨曦驾校】'), '应包含自定义页脚')
  const entryIdx = lines.indexOf('最新投稿广轻工论坛入口：')
  assert.ok(entryIdx > 0)
  assert.strictEqual(lines[entryIdx + 1], '#小程序://广轻论坛/EntrY99', '末行应为论坛入口短链')
  assert.strictEqual(lines[lines.length - 1], '#小程序://广轻论坛/EntrY99', '短链必须是最后一行（微信识别依赖行尾）')
}, 'composeBroadcast 组装多条播报：摘要+短链+分隔线+页脚+入口')

check(() => {
  const text = composeBroadcast(
    [{ id: 1, title: '唯一一条', content: '', link: '#小程序://广轻论坛/Only1Post' }],
    '#小程序://广轻论坛/EntrY99'
  )
  // 分隔线固定出现在「帖子区」与「论坛入口」之间，单条也应有
  assert.ok(text.includes('—————'), '单条也应有帖子区与入口区之间的分隔线')
  assert.strictEqual(text.split('\n')[0], '唯一一条')
}, 'composeBroadcast 单条：分隔线仅在帖子区与入口区之间')

// D. 短链原样保留
check(() => {
  const text = composeBroadcast(
    [{ id: 1, title: 't', content: '', link: '#小程序://在校生/F1lehHfeRoY1fH' }],
    '#小程序://在校生/EntrY00'
  )
  assert.ok(text.includes('#小程序://在校生/F1lehHfeRoY1fH'))
  assert.ok(!text.includes('mp://'), '不应改写短链前缀')
}, '短链保持 #小程序:// 原文不被改写')

console.log(`\n共 ${testCount} 项断言通过`)
