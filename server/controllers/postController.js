const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { parseImages, clampPageSize, safeMessage } = require('../utils/helpers')

function mapPost(r) {
  return {
    id: r.id, userId: r.user_id, nickName: r.nick_name, avatarUrl: r.avatar_url,
    category: r.category, content: r.content, images: parseImages(r.images),
    likeCount: r.like_count, commentCount: r.comment_count, favoriteCount: r.favorite_count,
    createdAt: r.created_at
  }
}

exports.list = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = clampPageSize(req.query.pageSize)
  const category = req.query.category || ''
  const offset = (page - 1) * pageSize
  try {
    let where = 'WHERE p.status = 1'
    const params = []
    if (category && category !== '全部帖子') {
      where += ' AND p.category = ?'
      params.push(category)
    }
    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM forum_post p ${where}`, params)
    const [rows] = await pool.query(
      `SELECT p.*, u.nick_name, u.avatar_url FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )
    const total = countRows[0].total
    success(res, { list: rows.map(mapPost), total, hasMore: offset + pageSize < total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.detail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT p.*, u.nick_name, u.avatar_url FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id WHERE p.id = ? AND p.status = 1',
      [req.params.id]
    )
    if (!rows.length) return fail(res, '帖子不存在', 404)
    success(res, mapPost(rows[0]))
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.create = async (req, res) => {
  const { category, content, images } = req.body
  if (!content || !content.trim()) return fail(res, '内容不能为空')
  try {
    const [result] = await pool.query(
      'INSERT INTO forum_post (user_id, category, content, images) VALUES (?, ?, ?, ?)',
      [req.userId, category || '日常生活', content.trim(), JSON.stringify(images || [])]
    )
    success(res, { id: result.insertId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.remove = async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE forum_post SET status = 0 WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!result.affectedRows) return fail(res, '无权删除或帖子不存在', 403)
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.like = async (req, res) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [exist] = await conn.query('SELECT id FROM forum_like WHERE post_id = ? AND user_id = ?', [req.params.id, req.userId])
    if (exist.length) {
      await conn.query('DELETE FROM forum_like WHERE post_id = ? AND user_id = ?', [req.params.id, req.userId])
      await conn.query('UPDATE forum_post SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?', [req.params.id])
      await conn.commit()
      success(res, { liked: false })
    } else {
      await conn.query('INSERT INTO forum_like (post_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      await conn.query('UPDATE forum_post SET like_count = like_count + 1 WHERE id = ?', [req.params.id])
      await conn.commit()
      success(res, { liked: true })
    }
  } catch (e) {
    await conn.rollback()
    fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
}

exports.favorite = async (req, res) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [exist] = await conn.query('SELECT id FROM forum_favorite WHERE post_id = ? AND user_id = ?', [req.params.id, req.userId])
    if (exist.length) {
      await conn.query('DELETE FROM forum_favorite WHERE post_id = ? AND user_id = ?', [req.params.id, req.userId])
      await conn.query('UPDATE forum_post SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?', [req.params.id])
      await conn.commit()
      success(res, { favorited: false })
    } else {
      await conn.query('INSERT INTO forum_favorite (post_id, user_id) VALUES (?, ?)', [req.params.id, req.userId])
      await conn.query('UPDATE forum_post SET favorite_count = favorite_count + 1 WHERE id = ?', [req.params.id])
      await conn.commit()
      success(res, { favorited: true })
    }
  } catch (e) {
    await conn.rollback()
    fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
}

exports.hot = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT p.*, u.nick_name, u.avatar_url FROM forum_post p LEFT JOIN sys_user u ON p.user_id = u.id WHERE p.status = 1 ORDER BY p.like_count DESC LIMIT 10'
    )
    success(res, rows.map(mapPost))
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
