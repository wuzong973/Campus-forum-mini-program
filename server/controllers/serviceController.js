const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

exports.list = async (req, res) => {
  try {
    const [categories] = await pool.query('SELECT * FROM service_category ORDER BY sort_order')
    const [items] = await pool.query('SELECT * FROM service_item WHERE status = 1 ORDER BY sort_order')
    const result = categories.map((cat) => ({
      id: cat.id,
      title: cat.name,
      items: items.filter((i) => i.category_id === cat.id).map((i) => ({
        id: i.id, name: i.name, icon: i.icon, badge: i.badge, link: i.link,
        miniAppId: i.mini_app_id || '', iconPath: i.icon_path || '', sortOrder: i.sort_order
      }))
    }))
    success(res, result)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
