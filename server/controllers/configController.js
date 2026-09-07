const pool = require('../config/pool')
const { success, fail, hasPermission } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

function parseBodyMeta(body) {
  try { return JSON.parse(body) || {} } catch (e) { return {} }
}

// 十六进制颜色校验：合法返回 #RRGGBB，否则返回空串（表示未自定义）
function normalizeHex(v) {
  const s = String(v || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s
  return ''
}

// 首页展示配置（公开）：管理后台「配置」里维护的轮播图与公告。
// banner 行：title=主标题，body=JSON {image, subtitle, tag, link}；status=1 启用，sort_order 决定轮播顺序。
// notice 行：title=公告文字，body=JSON {tailText, tailImage, linkText, linkUrl, bgColor, textColor}（尾部链接与右侧跳转链接等）；取排序最前的一条。
// publish_banner 行：发布页（发布帖子/发布跑腿）顶部自动轮播横幅，title=横幅文字，body=JSON {style, icon}。
exports.home = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, type, title, body, sort_order sortOrder FROM system_content WHERE type IN ('banner', 'notice', 'publish_banner') AND status = 1 ORDER BY sort_order, id"
    )
    const banners = rows
      .filter((row) => row.type === 'banner')
      .map((row) => {
        const meta = parseBodyMeta(row.body)
        return {
          id: row.id,
          title: row.title || '',
          image: String(meta.image || ''),
          subtitle: String(meta.subtitle || ''),
          tag: String(meta.tag || ''),
          link: String(meta.link || ''),
          accent: String(meta.accent || ''),
          sortOrder: row.sortOrder
        }
      })
      .filter((item) => item.image)
    let notice = null
    const noticeRow = rows.find((row) => row.type === 'notice')
    if (noticeRow) {
      const meta = parseBodyMeta(noticeRow.body)
      notice = {
        text: noticeRow.title || '',
        tailText: String(meta.tailText || ''),
        tailImage: String(meta.tailImage || ''),
        // 右侧蓝色链接：linkText 显示文字（默认"点此查看"），linkUrl 为点击跳转的小程序页面路径（留空则弹出管理员微信二维码）
        linkText: String(meta.linkText || ''),
        linkUrl: String(meta.linkUrl || ''),
        bgColor: normalizeHex(meta.bgColor),
        textColor: normalizeHex(meta.textColor)
      }
    }
    // 发布页轮播横幅（发布帖子/发布跑腿页顶部，自动左右轮播）
    const publishBanners = rows
      .filter((row) => row.type === 'publish_banner')
      .map((row) => {
        const meta = parseBodyMeta(row.body)
        return {
          id: row.id,
          text: row.title || '',
          style: String(meta.style || 'red'),
          icon: String(meta.icon || ''),
          bgColor: normalizeHex(meta.bgColor),
          textColor: normalizeHex(meta.textColor),
          // 点击横幅跳转：link 支持 /pages/... 或 https；detailTitle/detailContent 为公告详情页内容
          link: String(meta.link || ''),
          linkText: String(meta.linkText || ''),
          detailTitle: String(meta.detailTitle || ''),
          detailContent: String(meta.detailContent || '')
        }
      })
      .filter((item) => item.text)
    success(res, { banners, notice, publishBanners })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// ===== 页面横幅（两个独立横幅，机制一致、内容互不影响） =====
// 复用 system_content 表，每个类型只维护一条：
// type='message_banner' → 「我的」页「消息通知」卡片顶部横幅
// type='post_banner'    → 帖子详情页「每日热榜」卡片上方横幅
// title = 横幅文字；body = JSON { icon, detailTitle, detailContent, images[], link, linkText, updatedAt }；status = 1 发布 / 0 下线。
function parsePageBanner(row) {
  let meta = {}
  try { meta = JSON.parse(row.body) || {} } catch (e) { meta = {} }
  const images = (Array.isArray(meta.images) ? meta.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
  return {
    id: row.id,
    scope: row.type === 'post_banner' ? 'post' : 'message',
    text: row.title || '',
    icon: String(meta.icon || '👍'),
    detailTitle: String(meta.detailTitle || ''),
    detailContent: String(meta.detailContent || ''),
    images,
    link: String(meta.link || ''),
    linkText: String(meta.linkText || ''),
    bgColor: normalizeHex(meta.bgColor),
    textColor: normalizeHex(meta.textColor),
    status: Number(row.status) === 1,
    updatedAt: row.updated_at || null
  }
}

// 读取横幅（公开）：未发布/已下线时普通用户拿到 null；管理员可读到下线内容便于继续编辑
function readPageBanner(type, req, res) {
  pool.query(
    'SELECT id, type, title, body, status, updated_at FROM system_content WHERE type = ? ORDER BY sort_order, id DESC LIMIT 1',
    [type]
  ).then(([rows]) => {
    const row = rows[0]
    if (!row || !String(row.title || '').trim()) return success(res, null)
    const banner = parsePageBanner(row)
    const isAdmin = !!(req.user && hasPermission(req.user.role, 'config.manage'))
    if (!banner.status && !isAdmin) return success(res, null)
    success(res, banner)
  }).catch((e) => fail(res, safeMessage(e), 500))
}

// 保存横幅（管理员，config.manage 权限）：单条 upsert，成功后向全部在线客户端广播实时刷新
function writePageBanner(type, req, res) {
  const body = req.body || {}
  const text = String(body.text || '').trim()
  if (!text || text.length > 60) return fail(res, '横幅文字不能为空且不超过60字')
  const detailTitle = String(body.detailTitle || '').trim().slice(0, 60)
  const detailContent = String(body.detailContent || '').trim()
  if (detailContent.length > 5000) return fail(res, '详情内容不能超过5000字')
  const images = (Array.isArray(body.images) ? body.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, 9)
  const meta = JSON.stringify({
    icon: String(body.icon || '👍').trim().slice(0, 8) || '👍',
    detailTitle,
    detailContent,
    images,
    link: String(body.link || '').trim().slice(0, 500),
    linkText: String(body.linkText || '').trim().slice(0, 30),
    bgColor: normalizeHex(body.bgColor),
    textColor: normalizeHex(body.textColor),
    updatedAt: new Date().toISOString()
  })
  const status = body.status === false || Number(body.status) === 0 ? 0 : 1
  pool.query(
    'SELECT id FROM system_content WHERE type = ? ORDER BY sort_order, id DESC LIMIT 1',
    [type]
  ).then(([rows]) => {
    let query
    if (rows.length) {
      query = pool.query('UPDATE system_content SET title = ?, body = ?, status = ? WHERE id = ?', [text, meta, status, rows[0].id])
    } else {
      query = pool.query(
        'INSERT INTO system_content (type, title, body, status, sort_order) VALUES (?, ?, ?, ?, 0)',
        [type, text, meta, status]
      )
    }
    return query
  }).then(() => {
    try { require('../ws/wsServer').broadcast({ type: 'banner_update', data: { scope: type === 'post_banner' ? 'post' : 'message' } }) } catch (e) { /* WS 不可用不影响保存 */ }
    success(res, null)
  }).catch((e) => fail(res, safeMessage(e), 500))
}

// 「我的」页消息通知横幅
exports.messageBanner = (req, res) => readPageBanner('message_banner', req, res)
exports.saveMessageBanner = (req, res) => writePageBanner('message_banner', req, res)

// 帖子详情页「每日热榜」上方横幅
exports.postBanner = (req, res) => readPageBanner('post_banner', req, res)
exports.savePostBanner = (req, res) => writePageBanner('post_banner', req, res)

