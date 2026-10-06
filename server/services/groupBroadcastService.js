const axios = require('axios')
const pool = require('../config/pool')
const { getAccessToken, invalidateAccessToken } = require('../utils/wechatToken')

/**
 * 微信群播报（「论坛广播」）内容生产线。
 *
 * 产出形态参考群里常见的论坛广播：若干条新帖摘要，每条下面跟一个可点开直达
 * 帖子详情页的小程序短链（#小程序://xxx/yyy），末尾附论坛入口短链。
 *
 * 官方边界（为什么这个服务只生产内容、不直接发微信群）：
 *   - genwxashortlink 是官方接口，生成聊天里可点开的短链；
 *   - 但微信没有任何官方接口能把消息发进普通微信群。最后一公里有两条路：
 *     a) 配置了企业微信自建应用（WECOM_* 环境变量）时，把现成文案推到运营者的
 *        企微应用消息里，人复制粘贴进群（全程官方接口，零封号风险）；
 *     b) 后续接个人号/企微号协议机器人，调 runOnce() 拿文案自己发。
 *
 * 短链缓存：genwxashortlink 有总量配额且链接有约 30 天有效期，
 * 同一页面地址生成一次后落库复用，临近过期（>25 天）才重新生成。
 */

const SHORT_LINK_API = 'https://api.weixin.qq.com/wxa/genwxashortlink'
// 短链约 30 天过期，缓存 25 天后视为陈旧，重新生成兜底
const SHORT_LINK_STALE_DAYS = 25
// 单条播报最多带多少条帖子，避免文案过长
const MAX_POSTS = Number(process.env.BROADCAST_MAX_POSTS || 10)
// 摘要最长字符数（截断加省略号）
const SUMMARY_MAX_CHARS = 42
const SEPARATOR = '—————'
// 没有历史播报记录时（首次运行）默认回看多少分钟内的新帖，防止把整个历史都翻出来
const FIRST_LOOKBACK_MINUTES = Number(process.env.BROADCAST_FIRST_LOOKBACK_MINUTES || 60)
// 定时扫描间隔（分钟），BROADCAST_INTERVAL_MINUTES 未配置或为 0 = 不开定时
const INTERVAL_MINUTES = Number(process.env.BROADCAST_INTERVAL_MINUTES || 30)

// 帖子详情页路径（与 subscribeService 分享路径保持一致）
const POST_PAGE = 'pages/post-detail/index'
// 播报末尾「最新投稿论坛入口」指向的页面
const ENTRY_PAGE = process.env.BROADCAST_ENTRY_PAGE || 'pages/index/index'

let timer = null

// ===== 多实例并发锁 =====
// 本服务跑在 pm2 cluster 双实例上，两个实例的定时器会同瞬间触发；
// 不加锁时两边各自生成一条播报 → 同一批新帖被播报两次（2026-10-03 实测踩坑两次）。
// 用 MySQL 原生 GET_LOCK 互斥：服务器未部署 Redis，ioredis 锁会静默失效，
// 而 MySQL 是本服务必依赖件，锁必然有效。锁随连接释放，异常时自动解除。
const GENERATION_LOCK_NAME = 'group_broadcast_gen'

// 群播报机器人（UI 自动化）所需的三列：旧库无这几列，首次运行前补齐。
// DDL 为代码内常量；列已存在（ER_DUP_FIELDNAME）属正常路径。
let columnsReady = false
async function ensureGroupSentColumns() {
  if (columnsReady) return
  try {
    await pool.query("ALTER TABLE group_broadcast_log ADD COLUMN group_sent TINYINT(1) NOT NULL DEFAULT 0")
  } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e }
  try {
    await pool.query("ALTER TABLE group_broadcast_log ADD COLUMN group_sent_at DATETIME DEFAULT NULL")
  } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e }
  try {
    await pool.query("ALTER TABLE group_broadcast_log ADD COLUMN bot_claimed_at DATETIME DEFAULT NULL")
  } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e }
  columnsReady = true
}

async function getOrCreateShortLink(pageUrl) {
  const [rows] = await pool.query(
    `SELECT link FROM broadcast_short_link
     WHERE page_key = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [pageUrl, SHORT_LINK_STALE_DAYS]
  )
  if (rows.length) return rows[0].link

  const link = await withTokenRetry(async (token) => {
    const { data } = await axios.post(
      `${SHORT_LINK_API}?access_token=${token}`,
      { page_url: pageUrl },
      { timeout: 8000 }
    )
    if (data && data.errcode) {
      const err = new Error(`genwxashortlink 失败: ${data.errcode} ${data.errmsg}`)
      err.wechatCode = data.errcode
      throw err
    }
    return data.link
  })

  await pool.query(
    `INSERT INTO broadcast_short_link (page_key, link) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE link = VALUES(link), created_at = NOW()`,
    [pageUrl, link]
  )
  return link
}

// 40001/42001（token 失效）时强制刷新一次再试，与 subscribeService 同一套自愈逻辑
async function withTokenRetry(fn) {
  let token = await getAccessToken()
  try {
    return await fn(token)
  } catch (e) {
    if (![40001, 42001].includes(Number(e.wechatCode))) throw e
    invalidateAccessToken(token)
    token = await getAccessToken({ forceRefresh: true })
    return fn(token)
  }
}

function toMysqlDateTime(d) {
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

function clip(text, max = SUMMARY_MAX_CHARS) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

/**
 * 组装播报文案（纯函数，tests 直接引用）。
 * @param {Array<{id:number, title:string, content:string}>} posts 按展示顺序排列
 * @param {string} entryLink 论坛入口短链
 * @param {string} footer 运营自定义页脚（如广告位），可为空
 */
// 摘要标签规则：标题/内容命中关键词时，在摘要前加【标签】（按需扩充此表即可）
const SUMMARY_TAG_RULES = [
  { keyword: '投票', tag: '投票' },
]

function summaryTag(post) {
  const text = ((post.title || '') + ' ' + (post.content || '')).trim()
  if (!text) return ''
  for (const rule of SUMMARY_TAG_RULES) {
    if (text.includes(rule.keyword)) return rule.tag
  }
  return ''
}

function composeBroadcast(posts, entryLink, footer = '') {
  const lines = []
  posts.forEach((post, index) => {
    const tag = post.tag ? '【' + post.tag + '】' : ''
    const summary = clip(post.title || post.content)
    lines.push(tag + summary)
    // genwxashortlink 返回的 #小程序://xxx/yyy 原文粘进微信聊天即可点开，
    // 不要改写成其它形态（群里看到的 mp:// 是协议号发结构化消息时的渲染效果）
    lines.push(post.link)
    if (index < posts.length - 1) lines.push('')
  })
  lines.push(SEPARATOR)
  if (footer) lines.push(footer)
  lines.push('')
  lines.push('最新投稿广轻工论坛入口：')
  lines.push(entryLink)
  return lines.join('\n')
}

/**
 * 对外入口：加多实例锁后调 generateBroadcast。
 * @param {{ windowStart?: Date, deliver?: boolean, force?: boolean }} [options]
 *   windowStart 手动指定窗口起点（后台「立即生成」可用）；deliver 默认按环境配置；
 *   force=true 跳过「60 秒内已生成过」的兜底检查（仅显式手动调用时使用）。
 */
async function runOnce(options = {}) {
  await ensureGroupSentColumns()
  const conn = await pool.getConnection()
  let locked = false
  try {
    const [[lockRow]] = await conn.query("SELECT GET_LOCK('group_broadcast_gen', 0) AS got")
    if (!lockRow || !lockRow.got) {
      console.log('[GroupBroadcast] 另一实例正在生成本轮播报，跳过')
      return { skipped: true, reason: 'locked' }
    }
    locked = true
    if (!options.force && !options.windowStart) {
      const [recentRows] = await conn.query(
        'SELECT id FROM group_broadcast_log WHERE created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1'
      )
      if (recentRows.length) {
        console.log('[GroupBroadcast] 60 秒内已生成过播报，跳过本轮')
        return { skipped: true, reason: 'recent' }
      }
    }
    const result = await generateBroadcast(options, conn)
    // 跑腿/互助订单播报：独立于新帖播报的一条单独消息（同在生成锁内，防双实例重复）
    try {
      const errand = await generateErrandBroadcast()
      if (errand && !errand.skipped) {
        result.errand = { id: errand.id, postCount: errand.postCount, delivered: errand.delivered }
      }
    } catch (e) {
      console.error('[GroupBroadcast] 跑腿订单播报生成失败：', e.message)
    }
    return result
  } finally {
    if (locked) {
      try { await conn.query("SELECT RELEASE_LOCK('group_broadcast_gen')") } catch (e) { /* 连接释放时锁自动解除 */ }
    }
    conn.release()
  }
}

/**
 * 扫描上一个窗口内的新帖并生成一条播报文案（内部函数，调用方须持有生成锁）。
 * @param {{ windowStart?: Date, deliver?: boolean }} [options]
 *   windowStart 手动指定窗口起点（后台「立即生成」可用）；deliver 默认按环境配置。
 * @param {object} conn 持锁连接：窗口游标读取与播报落库必须走同一连接。
 */
async function generateBroadcast(options, conn) {
  const [lastRows] = await conn.query(
    'SELECT window_end FROM group_broadcast_log ORDER BY id DESC LIMIT 1'
  )
  const windowEnd = new Date()
  const windowStart = options.windowStart
    || (lastRows.length ? lastRows[0].window_end : new Date(Date.now() - FIRST_LOOKBACK_MINUTES * 60 * 1000))

  const [posts] = await conn.query(
    `SELECT id, title, content FROM forum_post
     WHERE status = 1 AND created_at > ? AND created_at <= ?
     ORDER BY created_at DESC LIMIT ?`,
    [windowStart, windowEnd, MAX_POSTS]
  )
  if (!posts.length) {
    return { content: '', postCount: 0, windowStart, windowEnd, delivered: false, skipped: true }
  }

  // 短链逐条生成（有缓存），入口页短链每轮复用
  const items = []
  for (const post of posts) {
    const link = await getOrCreateShortLink(`${POST_PAGE}?id=${post.id}`)
    items.push({ ...post, link, tag: summaryTag(post) })
  }
  const entryLink = await getOrCreateShortLink(ENTRY_PAGE)

  // 页脚（广告位，如驾校推荐）：BROADCAST_FOOTER 文案 + BROADCAST_FOOTER_LINK。
  // LINK 支持两种写法：#小程序:// 开头的现成短链直接用；否则视为页面路径，生成/缓存短链
  let footer = process.env.BROADCAST_FOOTER || ''
  if (process.env.BROADCAST_FOOTER_LINK) {
    const configured = process.env.BROADCAST_FOOTER_LINK
    const footerLink = configured.startsWith('#小程序://')
      ? configured
      : await getOrCreateShortLink(configured)
    footer = [footer, footerLink].filter(Boolean).join(' ')
  }

  const content = composeBroadcast(items, entryLink, footer)

  const [result] = await conn.query(
    `INSERT INTO group_broadcast_log (window_start, window_end, post_count, content, delivered)
     VALUES (?, ?, ?, ?, 0)`,
    [windowStart, windowEnd, posts.length, content]
  )

  let delivered = false
  const shouldDeliver = options.deliver !== undefined ? options.deliver : wecomConfigured()
  if (shouldDeliver) {
    try {
      await pushToWecomOperator(content)
      delivered = true
    } catch (e) {
      console.error('[GroupBroadcast] 企微应用消息投递失败：', e.message)
    }
  }
  if (delivered) {
    await pool.query('UPDATE group_broadcast_log SET delivered = 1, delivered_at = NOW() WHERE id = ?', [result.insertId])
  }
  console.log(`[GroupBroadcast] 生成播报 #${result.insertId}：${posts.length} 条新帖${delivered ? '，已推送企微' : ''}`)
  return { id: result.insertId, content, postCount: posts.length, windowStart, windowEnd, delivered }
}

// ===== 跑腿/互助订单播报（单独一条消息，参考同类产品形态）=====
// 新订单 = status='pending'（待接单）且创建时间晚于游标；游标存于 broadcast_cursor 表。
const ERRAND_PAGE = 'pages/errand-detail/index'
const ERRAND_LABEL = '【新跑腿/互助订单】'
const ERRAND_MAX = 5

let stateTableReady = false
async function ensureStateTable() {
  if (stateTableReady) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS broadcast_cursor (
      name VARCHAR(32) NOT NULL PRIMARY KEY,
      value VARCHAR(64) NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `)
  stateTableReady = true
}

function composeErrandBroadcast(orders) {
  // 摘要优先用「公开描述」（发布页的主要需求文本），标题常被填得很随意（如"."）
  return orders
    .map((o) => ERRAND_LABEL + clip(o.description || o.title || '', 40) + '\n' + o.link)
    .join('\n\n')
}

async function generateErrandBroadcast() {
  await ensureStateTable()
  const [cursorRows] = await pool.query("SELECT value FROM broadcast_cursor WHERE name = 'errand'")
  const since = cursorRows.length ? cursorRows[0].value : null
  const [orders] = since
    ? await pool.query(
        `SELECT id, type, title, description, created_at FROM errand_order
         WHERE status = 'pending' AND created_at > ? ORDER BY created_at ASC LIMIT ?`,
        [since, ERRAND_MAX])
    : await pool.query(
        `SELECT id, type, title, description, created_at FROM errand_order
         WHERE status = 'pending' AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         ORDER BY created_at ASC LIMIT ?`,
        [ERRAND_MAX])

  // 无论有没有新订单，都把游标推进到当前时间，避免反复扫旧单
  const [[nowRow]] = await pool.query('SELECT NOW() AS nw')
  await pool.query(
    `INSERT INTO broadcast_cursor (name, value) VALUES ('errand', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [toMysqlDateTime(nowRow.nw)])

  if (!orders.length) {
    return { skipped: true, reason: 'no-errands' }
  }

  const items = []
  for (const order of orders) {
    const link = await getOrCreateShortLink(`${ERRAND_PAGE}?id=${order.id}`)
    items.push({ ...order, link })
  }
  const content = composeErrandBroadcast(items)

  const [result] = await pool.query(
    `INSERT INTO group_broadcast_log (window_start, window_end, post_count, content, delivered)
     VALUES (?, NOW(), ?, ?, 0)`,
    [since || new Date(Date.now() - 30 * 60 * 1000), orders.length, content]
  )

  let delivered = false
  if (wecomConfigured()) {
    try {
      await pushToWecomOperator(content)
      delivered = true
    } catch (e) {
      console.error('[GroupBroadcast] 跑腿订单播报的企微投递失败：', e.message)
    }
  }
  if (delivered) {
    await pool.query('UPDATE group_broadcast_log SET delivered = 1, delivered_at = NOW() WHERE id = ?', [result.insertId])
  }
  console.log(`[GroupBroadcast] 生成跑腿订单播报 #${result.insertId}：${orders.length} 单${delivered ? '，已推送企微' : ''}`)
  return { id: result.insertId, content, postCount: orders.length, delivered, kind: 'errand' }
}

// ===== 企业微信自建应用投递（官方接口，把现成文案推给运营者复制进群）=====
function wecomConfigured() {
  return Boolean(process.env.BROADCAST_WECOM_CORP_ID && process.env.BROADCAST_WECOM_SECRET && process.env.BROADCAST_WECOM_AGENT_ID)
}

let corpTokenCache = null
async function getCorpToken() {
  if (corpTokenCache && corpTokenCache.expireAt > Date.now() + 120 * 1000) return corpTokenCache.token
  const { data } = await axios.get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', {
    params: {
      corpid: process.env.BROADCAST_WECOM_CORP_ID,
      corpsecret: process.env.BROADCAST_WECOM_SECRET
    },
    timeout: 8000
  })
  if (data.errcode) throw new Error(`获取企微凭据失败: ${data.errcode} ${data.errmsg}`)
  corpTokenCache = { token: data.access_token, expireAt: Date.now() + Number(data.expires_in || 7200) * 1000 }
  return corpTokenCache.token
}

async function pushToWecomOperator(content) {
  const token = await getCorpToken()
  const { data } = await axios.post(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
    {
      touser: process.env.BROADCAST_WECOM_TOUSER || '@all',
      msgtype: 'text',
      agentid: Number(process.env.BROADCAST_WECOM_AGENT_ID),
      text: { content }
    },
    { timeout: 8000 }
  )
  if (data.errcode) throw new Error(`企微应用消息发送失败: ${data.errcode} ${data.errmsg}`)
}

function start() {
  if (process.env.BROADCAST_ENABLED !== '1') {
    console.log('[GroupBroadcast] 未开启定时播报（BROADCAST_ENABLED!=1），仅可通过后台接口手动生成')
    return
  }
  const intervalMs = Math.max(5, INTERVAL_MINUTES) * 60 * 1000
  timer = setInterval(() => {
    runOnce().catch((e) => console.error('[GroupBroadcast]', e.message))
  }, intervalMs)
  console.log(`[GroupBroadcast] 定时播报已开启，每 ${INTERVAL_MINUTES} 分钟一轮`)
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = {
  runOnce, composeBroadcast, composeErrandBroadcast, summaryTag,
  clip, getOrCreateShortLink, start, stop
}
