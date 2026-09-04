const crypto = require('crypto')
const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const wechat = require('../services/wechatService')
const { createPrivateMessage } = require('./messageController')
const { TECHNICIANS, findTechnician } = require('../config/repairTechnicians')

const DEFAULT_PRICE = 19.9

function makeOrderNo() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `WX${date}${Date.now().toString().slice(-8)}${crypto.randomInt(1000, 10000)}`
}

exports.create = async (req, res) => {
  const { deviceType, description, contactName, contactPhone, serviceAddress, appointmentTime, technicianPhone, images = [] } = req.body
  const technician = findTechnician(technicianPhone)
  if (!deviceType || !description || !contactName || !/^1\d{10}$/.test(contactPhone || '') || !serviceAddress || !appointmentTime || !technician) {
    return fail(res, '请完整填写预约信息')
  }
  const appointment = new Date(appointmentTime)
  if (!Number.isFinite(appointment.getTime()) || appointment.getTime() < Date.now() - 60000) return fail(res, '预约时间无效')
  try {
    const amount = DEFAULT_PRICE
    const orderNo = makeOrderNo()
    const [staffRows] = await pool.query(
      'SELECT id FROM sys_user WHERE phone = ? AND status = 1 LIMIT 1',
      [technician.phone]
    )
    const technicianUserId = staffRows.length ? staffRows[0].id : null
    const [result] = await pool.query(
      `INSERT INTO repair_order (order_no,user_id,device_type,fault_type,description,contact_name,contact_phone,technician_name,technician_phone,technician_user_id,service_address,appointment_time,images,amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderNo, req.userId, deviceType, '待检测', String(description).slice(0, 500), contactName, contactPhone, technician.name, technician.phone, technicianUserId, serviceAddress, appointment, JSON.stringify(images.slice(0, 3)), amount],
    )
    success(res, { id: result.insertId, orderNo, amount, technicianUserId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
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
      `SELECT r.id,r.order_no,r.device_type,r.description,r.service_address,r.appointment_time,r.amount,r.status,r.created_at,
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
  const [staffRows] = await pool.query(
    'SELECT id, openid FROM sys_user WHERE phone = ? AND status = 1 LIMIT 1',
    [order.technician_phone]
  )
  const staff = staffRows[0]
  const appointmentTime = new Date(order.appointment_time).toLocaleString('zh-CN', { hour12: false })
  if (staff) {
    try {
      await createPrivateMessage(
        order.user_id,
        staff.id,
        `新的维修预约：${order.device_type}，预约时间 ${appointmentTime}，地址：${order.service_address}。`
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
