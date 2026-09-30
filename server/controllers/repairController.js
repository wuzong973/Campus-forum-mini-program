const crypto = require('crypto')
const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage, clampPageSize, parseImages } = require('../utils/helpers')
const wechat = require('../services/wechatService')
const { createPrivateMessage } = require('./messageController')
const { TECHNICIANS, findTechnician } = require('../config/repairTechnicians')

// 义修预约费统一为 0.01 元（前后端一致：下单落库、订单展示、微信实际收款同源此值）
const DEFAULT_PRICE = 0.01

function makeOrderNo() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `WX${date}${Date.now().toString().slice(-8)}${crypto.randomInt(1000, 10000)}`
}

exports.create = async (req, res) => {
  const { deviceType, description, contactName, contactPhone, wechatId = '', expectedTime = '', serviceAddress, technicianPhone, images = [] } = req.body
  // 维修人员为选填：指定了则校验收单人，未指定则由后台统一分配
  const technician = technicianPhone ? findTechnician(technicianPhone) : null
  if (technicianPhone && !technician) return fail(res, '维修人员不存在')
  if (!deviceType || !description || !contactName || !/^1\d{10}$/.test(contactPhone || '') || !wechatId || !expectedTime || !serviceAddress) {
    return fail(res, '请完整填写预约信息')
  }
  try {
    const amount = DEFAULT_PRICE
    const orderNo = makeOrderNo()
    // 预约时间入口已下线，appointment_time 列（NOT NULL）仅作为下单时间落库
    const appointment = new Date()
    const technicianUserId = technician ? await findTechnicianUserId(technician.phone) : null
    const [result] = await pool.query(
      `INSERT INTO repair_order (order_no,user_id,device_type,fault_type,description,contact_name,contact_phone,wechat_id,expected_time,technician_name,technician_phone,technician_user_id,service_address,appointment_time,images,amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderNo, req.userId, deviceType, '待检测', String(description).slice(0, 500), contactName, contactPhone, String(wechatId).slice(0, 64), String(expectedTime).slice(0, 64), technician ? technician.name : '', technician ? technician.phone : '', technicianUserId, serviceAddress, appointment, JSON.stringify(images.slice(0, 3)), amount],
    )
    success(res, { id: result.insertId, orderNo, amount, technicianUserId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

async function findTechnicianUserId(phone) {
  const [staffRows] = await pool.query(
    'SELECT id FROM sys_user WHERE phone = ? AND status = 1 LIMIT 1',
    [phone]
  )
  return staffRows.length ? staffRows[0].id : null
}

exports.listTechnicians = async (req, res) => {
  try {
    const phones = TECHNICIANS.map((technician) => technician.phone)
    const [rows] = await pool.query(
      'SELECT id, phone FROM sys_user WHERE phone IN (?) AND status = 1',
      [phones]
    )
    const usersByPhone = new Map(rows.map((row) => [row.phone, row]))
    success(res, TECHNICIANS.map((technician) => {
      const user = usersByPhone.get(technician.phone)
      return Object.assign({}, technician, { userId: user ? user.id : null, chatAvailable: !!user })
    }))
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.createPayment = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, u.openid FROM repair_order r JOIN sys_user u ON u.id=r.user_id WHERE r.id=? AND r.user_id=?`,
      [req.params.id, req.userId],
    )
    if (!rows.length) return fail(res, '订单不存在', 404)
    const order = rows[0]
    if (order.status !== 'unpaid') return fail(res, '订单已支付或已关闭')
    const payment = await wechat.createJsapiPayment({
      orderNo: order.order_no,
      description: `校园广轻维修-${order.fault_type}`,
      amountFen: Math.round(Number(order.amount) * 100),
      openid: order.openid,
    })
    success(res, payment)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.listMine = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id,r.order_no,r.device_type,r.description,r.service_address,r.appointment_time,r.expected_time,r.amount,r.status,r.created_at,
        r.technician_name AS technicianName,r.technician_phone AS technicianPhone,
        COALESCE(r.technician_user_id, staff.id) AS technicianUserId
       FROM repair_order r
       LEFT JOIN sys_user staff ON staff.phone = r.technician_phone AND staff.status = 1
       WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 50`,
      [req.userId],
    )
    success(res, rows)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// ===== 管理端：维修预约记录 =====
// 用户端提交的预约维修只写进 repair_order，管理员此前没有任何入口能看到，
// 只能在用户端「我的订单」里看自己下的单。这里把预约单与提交人资料一并返回。
const REPAIR_STATUSES = ['unpaid', 'paid', 'accepted', 'repairing', 'finished', 'cancelled']

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 20)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

exports.adminListOrders = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  let where = 'WHERE 1 = 1'
  const params = []
  if (REPAIR_STATUSES.includes(status)) { where += ' AND r.status = ?'; params.push(status) }
  if (keyword) {
    // 管理员最常见的搜法：按联系人/手机号/宿舍地址找回那条预约
    where += ' AND (r.order_no LIKE ? OR r.contact_name LIKE ? OR r.contact_phone LIKE ?'
      + ' OR r.service_address LIKE ? OR u.nick_name LIKE ?'
      + (/^\d+$/.test(keyword) ? ' OR r.id = ?' : '') + ')'
    const q = '%' + keyword + '%'
    params.push(q, q, q, q, q)
    if (/^\d+$/.test(keyword)) params.push(Number(keyword))
  }
  try {
    const [countRes, listRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM repair_order r LEFT JOIN sys_user u ON u.id = r.user_id ${where}`, params),
      // 头像字段必须叫 avatarUrl：success() 里的 normalizeAvatars 只按 AVATAR_KEYS
      // 白名单修正历史头像路径（/assets/avatar2/1 (9).jpg → avatar_09.jpg），
      // 换成自造的键名会绕过修正，老用户头像显示灰圆。
      pool.query(
        `SELECT r.id, r.order_no orderNo, r.user_id userId, r.device_type deviceType, r.fault_type faultType,
                r.description, r.contact_name contactName, r.contact_phone contactPhone, r.wechat_id wechatId,
                r.expected_time expectedTime, r.service_address serviceAddress, r.images, r.amount, r.status,
                r.technician_name technicianName, r.technician_phone technicianPhone,
                r.paid_at paidAt, r.created_at createdAt,
                u.nick_name nickName, u.avatar_url avatarUrl, u.phone userPhone
         FROM repair_order r LEFT JOIN sys_user u ON u.id = r.user_id
         ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    const total = Number((((countRes[0] || [])[0]) || {}).total || 0)
    const list = listRes[0] || []
    success(res, {
      // images 是 JSON 列，mysql2 可能给出数组/对象/字符串三种形态，统一归一化
      list: list.map((row) => Object.assign({}, row, { images: parseImages(row.images) })),
      total,
      page,
      hasMore: offset + list.length < total
    })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.paymentNotify = async (req, res) => {
  try {
    if (!req.rawBody || !wechat.verifyPaymentCallback(req.headers, req.rawBody)) {
      return res.status(401).json({ code: 'FAIL', message: '签名验证失败' })
    }
    const payment = wechat.decryptPaymentResource(req.body.resource)
    if (payment.trade_state !== 'SUCCESS') return res.json({ code: 'SUCCESS', message: '成功' })
    const conn = await pool.getConnection()
    let order
    try {
      await conn.beginTransaction()
      const [rows] = await conn.query('SELECT * FROM repair_order WHERE order_no=? FOR UPDATE', [payment.out_trade_no])
      if (!rows.length) throw new Error('订单不存在')
      order = rows[0]
      if (payment.appid !== process.env.WX_APPID || payment.mchid !== process.env.WX_MCH_ID || payment.amount.total !== Math.round(Number(order.amount) * 100)) {
        throw new Error('支付订单信息不匹配')
      }
      if (order.status === 'unpaid') {
        await conn.query("UPDATE repair_order SET status='paid',transaction_id=?,paid_at=NOW() WHERE id=?", [payment.transaction_id, order.id])
      }
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
    res.json({ code: 'SUCCESS', message: '成功' })
    if (!order.technician_notified_at) {
      notifyTechnician(order).catch((error) => console.error('[RepairNotify]', order.order_no, error.message))
    }
  } catch (e) {
    console.error('[RepairPaymentNotify]', e.message)
    res.status(500).json({ code: 'FAIL', message: '处理失败' })
  }
}

async function notifyTechnician(order) {
  // 未指定维修人员（由后台分配）时无需通知
  if (!order.technician_phone) return
  const [staffRows] = await pool.query(
    'SELECT id, openid FROM sys_user WHERE phone = ? AND status = 1 LIMIT 1',
    [order.technician_phone]
  )
  const staff = staffRows[0]
  if (staff) {
    try {
      await createPrivateMessage(
        order.user_id,
        staff.id,
        `新的维修预约：${order.description}，期望上门时间 ${order.expected_time || '未填写'}，地址：${order.service_address}。联系电话：${order.contact_phone}${order.wechat_id ? '，微信：' + order.wechat_id : ''}`
      )
    } catch (error) {
      // 站内信发送失败（如黑名单拦截）不影响维修预约流程
      console.error('[RepairNotify]', order.order_no, error.message)
    }
  }
  try {
    await wechat.notifyRepairTechnician(order, staff)
  } catch (error) {
    console.error('[RepairSubscribeNotify]', order.order_no, error.message)
  }
  await pool.query(
    'UPDATE repair_order SET technician_user_id = ?, technician_notified_at = NOW(), notified_at = NOW() WHERE id = ? AND technician_notified_at IS NULL',
    [staff ? staff.id : null, order.id]
  )
}
