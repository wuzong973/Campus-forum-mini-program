const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

function parseBodyMeta(body) {
  try { return JSON.parse(body) || {} } catch (e) { return {} }
}

// 首页展示配置（公开）：管理后台「配置」里维护的轮播图与公告。
// banner 行：title=主标题，body=JSON {image, subtitle, tag, link}；status=1 启用，sort_order 决定轮播顺序。
// notice 行：title=公告文字，body=JSON {tailText, tailImage}（尾部链接文字与点击后展示的图片）；取排序最前的一条。
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
        tailImage: String(meta.tailImage || '')
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
          icon: String(meta.icon || '')
        }
      })
      .filter((item) => item.text)
    success(res, { banners, notice, publishBanners })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
