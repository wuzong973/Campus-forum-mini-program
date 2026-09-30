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

// 小程序线上版本号（公开）。发布新版时同步更新服务器 APP_VERSION，
// 前端用它和 wx.getAccountInfoSync().miniProgram.version 比较。
exports.appVersion = (req, res) => {
  const version = String(process.env.APP_VERSION || '').trim()
  success(res, { version })
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

// ===== 校园服务自定义页面（首个应用：校园卡页） =====
// 复用 system_content 表，一行即一张页面，同一类型可维护多张：
// type='service_page_campus_card' → 首页宫格「校园卡」页面（管理后台"物品"页编辑，普通用户只读）
// title = 页面标题；body = JSON { content, images[], updatedAt }；status = 1 发布 / 0 草稿下线；sort_order 决定目录内顺序。
const SERVICE_PAGE_TYPE = 'service_page_campus_card'
const SERVICE_PAGE_COLUMNS = 'id, title, body, status, sort_order, updated_at'

function canManageServicePage(req) {
  return !!(req.user && hasPermission(req.user.role, 'config.manage'))
}

function parseServicePage(row) {
  let meta = {}
  try { meta = JSON.parse(row.body) || {} } catch (e) { meta = {} }
  const images = (Array.isArray(meta.images) ? meta.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
  return {
    id: row.id,
    title: row.title || '',
    content: String(meta.content || ''),
    images,
    status: Number(row.status) === 1,
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: row.updated_at || null
  }
}

// 目录列表：普通用户只返回已发布条目，管理员可读到草稿
function listServicePages(type, req, res) {
  pool.query(`SELECT ${SERVICE_PAGE_COLUMNS} FROM system_content WHERE type = ? ORDER BY sort_order, id`, [type])
    .then(([rows]) => {
      const manage = canManageServicePage(req)
      success(res, { list: rows.map(parseServicePage).filter((page) => manage || page.status) })
    })
    .catch((e) => fail(res, safeMessage(e), 500))
}

function readServicePageById(type, req, res, id) {
  if (!id) return fail(res, '页面 id 不合法')
  pool.query(`SELECT ${SERVICE_PAGE_COLUMNS} FROM system_content WHERE id = ? AND type = ?`, [id, type])
    .then(([rows]) => {
      const row = rows[0]
      if (!row) return success(res, null)
      const page = parseServicePage(row)
      if (!page.status && !canManageServicePage(req)) return success(res, null)
      success(res, page)
    })
    .catch((e) => fail(res, safeMessage(e), 500))
}

function readServicePage(type, req, res) {
  pool.query(
    `SELECT ${SERVICE_PAGE_COLUMNS} FROM system_content WHERE type = ? ORDER BY sort_order, id DESC LIMIT 1`,
    [type]
  ).then(([rows]) => {
    const row = rows[0]
    if (!row) return success(res, null)
    const page = parseServicePage(row)
    const isAdmin = !!(req.user && hasPermission(req.user.role, 'config.manage'))
    if (!page.status && !isAdmin) return success(res, null)
    success(res, page)
  }).catch((e) => fail(res, safeMessage(e), 500))
}

// 表单 → 落库字段；校验不通过时返回 null 并已经写出错误响应
function buildServicePagePayload(req, res) {
  const body = req.body || {}
  const title = String(body.title || '').trim()
  if (!title || title.length > 64) { fail(res, '页面标题不能为空且不超过64字'); return null }
  const content = String(body.content || '').trim()
  if (content.length > 10000) { fail(res, '页面正文不能超过10000字'); return null }
  const images = (Array.isArray(body.images) ? body.images : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, 9)
  const status = body.status === false || Number(body.status) === 0 ? 0 : 1
  const meta = JSON.stringify({ content, images, updatedAt: new Date().toISOString() })
  return { title, meta, status, sortOrder: Math.max(0, Number(body.sortOrder) || 0) }
}

function createServicePage(type, req, res) {
  const payload = buildServicePagePayload(req, res)
  if (!payload) return undefined
  pool.query(
    'INSERT INTO system_content (type, title, body, status, sort_order) VALUES (?, ?, ?, ?, ?)',
    [type, payload.title, payload.meta, payload.status, payload.sortOrder]
  ).then(([result]) => success(res, { id: result.insertId }))
    .catch((e) => fail(res, safeMessage(e), 500))
}

function updateServicePage(type, req, res, id) {
  if (!id) return fail(res, '页面 id 不合法')
  const payload = buildServicePagePayload(req, res)
  if (!payload) return undefined
  pool.query(
    'UPDATE system_content SET title = ?, body = ?, status = ? WHERE id = ? AND type = ?',
    [payload.title, payload.meta, payload.status, id, type]
  ).then(([result]) => {
    if (!result.affectedRows) return fail(res, '页面不存在或已删除', 404)
    success(res, null)
  }).catch((e) => fail(res, safeMessage(e), 500))
}

function deleteServicePage(type, req, res, id) {
  if (!id) return fail(res, '页面 id 不合法')
  pool.query('DELETE FROM system_content WHERE id = ? AND type = ?', [id, type])
    .then(([result]) => {
      if (!result.affectedRows) return fail(res, '页面不存在或已删除', 404)
      success(res, null)
    }).catch((e) => fail(res, safeMessage(e), 500))
}

// 校园卡页面：公开读取（管理员可读到下线草稿便于继续编辑）；增删改需 config.manage 权限。
// 旧版单张接口（campusCardPage）保留给尚未更新的小程序版本读取，指向排序最前的一张已发布页面。
exports.campusCardPage = (req, res) => readServicePage(SERVICE_PAGE_TYPE, req, res)
exports.campusCardPages = (req, res) => listServicePages(SERVICE_PAGE_TYPE, req, res)
exports.campusCardPageById = (req, res) => readServicePageById(SERVICE_PAGE_TYPE, req, res, Number(req.params.id))
exports.createCampusCardPage = (req, res) => createServicePage(SERVICE_PAGE_TYPE, req, res)
exports.saveCampusCardPage = (req, res) => updateServicePage(SERVICE_PAGE_TYPE, req, res, Number(req.params.id))
exports.deleteCampusCardPage = (req, res) => deleteServicePage(SERVICE_PAGE_TYPE, req, res, Number(req.params.id))

// 学车指南自定义页：与校园卡同款（标题+正文+图片），后台「物品」页编辑、普通用户只读。
// 只放一张：读取走单行接口拿到 id，编辑器按 id 更新、没有记录时新建。
const DRIVING_GUIDE_TYPE = 'service_page_driving_guide'
exports.drivingGuidePage = (req, res) => readServicePage(DRIVING_GUIDE_TYPE, req, res)
exports.createDrivingGuidePage = (req, res) => createServicePage(DRIVING_GUIDE_TYPE, req, res)
exports.saveDrivingGuidePage = (req, res) => updateServicePage(DRIVING_GUIDE_TYPE, req, res, Number(req.params.id))

// ===== 驾校运营位（管理后台「物品」页维护，普通用户只读） =====
// 都复用 system_content 单行存储：
//   driving_promo        找驾校列表页顶部横幅：title=主标题，body=JSON { sub, btnText, tags[], image }
//   driving_service_tags 筛选面板的服务保障标签池：title=固定占位，body=JSON { tags[] }

// 单行 upsert：有记录就更新最前一条，没有就插入（运营位每类只保留一条）
function upsertOpsRow(type, title, meta, status, res) {
  pool.query('SELECT id FROM system_content WHERE type = ? ORDER BY sort_order, id DESC LIMIT 1', [type])
    .then(([rows]) => {
      if (rows.length) {
        return pool.query('UPDATE system_content SET title = ?, body = ?, status = ? WHERE id = ?', [title, meta, status, rows[0].id])
      }
      return pool.query('INSERT INTO system_content (type, title, body, status, sort_order) VALUES (?, ?, ?, ?, 0)', [type, title, meta, status])
    })
    .then(() => success(res, null))
    .catch((e) => fail(res, safeMessage(e), 500))
}

function normalizeOpsImages(list, max) {
  return (Array.isArray(list) ? list : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, max)
}

function opsStatus(body) {
  return body.status === false || Number(body.status) === 0 ? 0 : 1
}

exports.drivingPromo = (req, res) => {
  pool.query(
    'SELECT id, title, body, status, updated_at FROM system_content WHERE type = ? ORDER BY sort_order, id DESC LIMIT 1',
    ['driving_promo']
  ).then(([rows]) => {
    const row = rows[0]
    if (!row) return success(res, null)
    const meta = parseBodyMeta(row.body)
    const promo = {
      title: row.title || '',
      sub: String(meta.sub || ''),
      btnText: String(meta.btnText || ''),
      tags: (Array.isArray(meta.tags) ? meta.tags : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 3),
      image: normalizeOpsImages([meta.image], 1)[0] || '',
      status: Number(row.status) === 1,
      updatedAt: row.updated_at || null
    }
    const isAdmin = !!(req.user && hasPermission(req.user.role, 'config.manage'))
    if (!promo.status && !isAdmin) return success(res, null)
    success(res, promo)
  }).catch((e) => fail(res, safeMessage(e), 500))
}

exports.saveDrivingPromo = (req, res) => {
  const body = req.body || {}
  const title = String(body.title || '').trim()
  if (!title || title.length > 20) return fail(res, '主标题不能为空且不超过 20 字')
  const sub = String(body.sub || '').trim()
  if (sub.length > 30) return fail(res, '副标题不能超过 30 字')
  const btnText = String(body.btnText || '').trim()
  if (btnText.length > 12) return fail(res, '按钮文字不能超过 12 字')
  const rawTags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(/[,，、]/)
  const tags = rawTags.map((t) => String(t || '').trim()).filter(Boolean)
  if (tags.length > 3) return fail(res, '右侧标签最多 3 个')
  if (tags.some((t) => t.length > 6)) return fail(res, '右侧标签每个不超过 6 字')
  const image = normalizeOpsImages([body.image], 1)[0] || ''
  const meta = JSON.stringify({ sub, btnText, tags, image, updatedAt: new Date().toISOString() })
  upsertOpsRow('driving_promo', title, meta, opsStatus(body), res)
}

exports.drivingServiceTags = (req, res) => {
  pool.query(
    'SELECT id, title, body, status, updated_at FROM system_content WHERE type = ? ORDER BY sort_order, id DESC LIMIT 1',
    ['driving_service_tags']
  ).then(([rows]) => {
    const row = rows[0]
    if (!row) return success(res, null)
    const meta = parseBodyMeta(row.body)
    success(res, {
      tags: (Array.isArray(meta.tags) ? meta.tags : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 12),
      status: Number(row.status) === 1,
      updatedAt: row.updated_at || null
    })
  }).catch((e) => fail(res, safeMessage(e), 500))
}

exports.saveDrivingServiceTags = (req, res) => {
  const body = req.body || {}
  const raw = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(/[,，、]/)
  const tags = raw.map((t) => String(t || '').trim()).filter(Boolean)
  if (tags.length > 12) return fail(res, '标签池最多 12 个')
  if (tags.some((t) => t.length > 8)) return fail(res, '单个标签不超过 8 字')
  // 允许清空：清空后前台筛选面板整块不显示，所以 title 用占位文本而非标签拼接
  const meta = JSON.stringify({ tags, updatedAt: new Date().toISOString() })
  upsertOpsRow('driving_service_tags', '驾校服务保障标签', meta, opsStatus(body), res)
}

