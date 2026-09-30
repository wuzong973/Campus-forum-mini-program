const auth = require('../../utils/auth')
const request = require('../../utils/request')
const subscribe = require('../../utils/subscribe')
const { runPullDownRefresh } = require('../../utils/refresh')
// 卡片动效降级开关（低端机 / 设置页关闭），样式见 styles/card-fx.wxss
const motion = require('../../utils/motion')

const STATUS_TEXT = { SUCCESS: '已到账', PENDING: '审核中', PROCESSING: '转账处理中', WAIT_CONFIRM: '待确认收款', REJECTED: '已驳回', FAILED: '转账失败' }

// 提现规则配置
const WITHDRAW_RULES = {
  dailyLimit: 5,        // 每日最多提现次数
  minAmount: 1,         // 最低提现金额（元）
  maxAmount: 5000,      // 单笔最高提现金额（元）
  workHours: '06:00-24:00',  // 受理时间段
  arrivalTime: '1-3个工作日',  // 预计到账时间
  feeDescription: '免手续费，全额到账'  // 手续费说明
}

Page({
  data: {
    balance: '0.00',
    earned: '0.00',
    withdrawing: '0.00',
    records: [],
    loading: false,
    confirming: false,
    // 已自动弹窗提醒过的提现单（每次进入页面每单只提醒一次）
    autoPromptedIds: {},
    showWithdraw: false,
    withdrawAmount: '',
    submitting: false,
    // 提现规则相关数据
    dailyLimit: WITHDRAW_RULES.dailyLimit,
    dailyUsed: 0,
    minAmount: WITHDRAW_RULES.minAmount,
    maxAmount: WITHDRAW_RULES.maxAmount,
    workHours: WITHDRAW_RULES.workHours,
    arrivalTime: WITHDRAW_RULES.arrivalTime,
    feeDescription: WITHDRAW_RULES.feeDescription,
    // 顶部「订阅提现结果提醒」入口：订阅生效（偏好开 + 微信侧已授权）后隐藏，
    // 在设置页关闭「提现结果通知」后重新出现（见 refreshWithdrawSubscribeEntry）
    showWithdrawSubscribeEntry: false,
    withdrawSubscribeChecked: false,
    // 余额卡动效降级：true 时 .fx-stage 挂 fx-off，只停动画、静态描边与背光保留
    fxOff: false
  },

  onShow() {
    // 动效降级每次回到本页都同步：设置页刚关掉要立即生效，低端机判定结果不会变但成本极低（照首页写法）
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    if (!auth.isLoggedIn()) {
      wx.showModal({
        title: '提示',
        content: '查看钱包需要先登录',
        confirmText: '去登录',
        cancelText: '取消',
        success(res) {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
        }
      })
      return
    }
    this.loadWallet()
    this.loadDailyWithdrawCount()
    this.refreshWithdrawSubscribeEntry()
  },

  // ===== 顶部「订阅提现结果提醒」入口 =====
  // 与原「提交提现」按钮走同一个 withdraw 触发组（withdrawSuccess + withdrawResult），
  // 逻辑复用 utils/subscribe.js 的统一封装，原有逻辑一概不动。
  // 显隐口径 entryVisible('withdraw')：偏好已开且微信侧已授权才隐藏，
  // 因此在设置页关闭「提现结果通知」后入口会自动重新出现。
  refreshWithdrawSubscribeEntry() {
    // 本地判定为「需要引导」时直接显示（不发额外请求）；
    // 本地认为「已订阅」时再复核一次服务端额度 —— 额度是「点一次允许发一条」，
    // 高频场景（评论/私信）极易用尽；用尽后必须让入口重新出现，否则用户无从重新订阅。
    if (typeof subscribe.entryVisibleAsync === 'function') {
      subscribe.entryVisibleAsync('withdraw')
        .then((need) => this.setData({ showWithdrawSubscribeEntry: !!need, withdrawSubscribeChecked: false }))
        .catch(() => {})
      return
    }
    const visible = typeof subscribe.entryVisible === 'function' ? subscribe.entryVisible('withdraw') : false
    this.setData({ showWithdrawSubscribeEntry: !!visible, withdrawSubscribeChecked: false })
  },
  // 点击整行（左半区）与拨动开关走同一条路径
  onWithdrawSubscribeTap(e) {
    // 开关被拨到「关」时不申请授权，只回正视觉状态（入口在订阅生效后本就会整体隐藏）
    if (e && e.detail && e.detail.value === false) { this.setData({ withdrawSubscribeChecked: false }); return }
    this.setData({ withdrawSubscribeChecked: true })
    if (typeof subscribe.requestEntryByTap !== 'function') { this.refreshWithdrawSubscribeEntry(); return }
    // 必须在 tap 同步链内进入原生 API；requestEntryByTap = requestTriggerByTap + 允许后写偏好
    subscribe.requestEntryByTap('withdraw')
      .then(() => this.refreshWithdrawSubscribeEntry())
      .catch(() => this.refreshWithdrawSubscribeEntry())
  },

  loadWallet() {
    this.setData({ loading: true })
    const applySummary = (data) => {
      const money = (value) => Number(value || 0).toFixed(2)
      this.setData({
        balance: money(data.available), earned: money(data.earned), withdrawing: money(data.withdrawing),
        records: (data.records || []).map((item) => {
          const isEarning = item.type === 'earning'
          // 收益明细的详细描述：收益关联跑腿订单标题；提现按状态补充说明
          const detailText = isEarning
            ? (item.orderTitle ? `来自订单「${item.orderTitle}」` : '跑腿订单收益，已到账可提现')
            : ({
              PENDING: '等待管理员审核，审核通过后转账',
              PROCESSING: '微信零钱转账处理中',
              WAIT_CONFIRM: '管理员已通过，请点击「确认收款」完成提现（24小时内有效）',
              SUCCESS: '已转账至微信零钱',
              REJECTED: '提现申请已驳回，金额已退回余额',
              FAILED: '转账失败，金额已退回余额'
            }[item.status] || '')
          return {
            ...item,
            title: isEarning ? '跑腿收益' : '提现到微信零钱',
            detailText,
            canConfirm: !isEarning && item.status === 'WAIT_CONFIRM' && Number(item.refId) > 0,
            amountText: `${Number(item.amount) >= 0 ? '+' : '-'}¥${Math.abs(Number(item.amount)).toFixed(2)}`,
            timeText: String(item.createdAt || '').replace('T', ' ').slice(0, 16),
            statusText: STATUS_TEXT[item.status] || item.status
          }
        })
      })
    }
    return request.get('/wallet/summary', {}, true, { silent: true }).then((data) => {
      applySummary(data)
      // 必须传 applySummary 映射后的 this.data.records（含 canConfirm 字段）：
      // 此前直接传接口原始 data.records，其上没有 canConfirm，find 恒为 undefined，自动弹窗永不触发
      this.autoPromptConfirm(this.data.records)
    }).catch(() => {}).finally(() => this.setData({ loading: false }))
  },

  // 有「待确认收款」的提现时，进入钱包自动弹窗引导确认
  autoPromptConfirm(records) {
    const pending = (records || []).find((item) => item.canConfirm && !this.data.autoPromptedIds[item.refId])
    if (!pending || this.data.confirming) return
    this.setData({ ['autoPromptedIds.' + pending.refId]: true })
    wx.showModal({
      title: '提现待确认收款',
      content: `您有一笔 ¥${Math.abs(Number(pending.amount)).toFixed(2)} 的提现已审核通过，需要您确认收款后才能到账，是否立即完成？`,
      confirmText: '确认收款',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) this.doConfirmReceive(Number(pending.refId))
      }
    })
  },

  // 加载今日已提现次数
  loadDailyWithdrawCount() {
    const today = new Date().toISOString().split('T')[0]
    const todayRecords = this.data.records.filter(item => {
      const recordDate = String(item.createdAt || '').split('T')[0]
      return recordDate === today && item.type === 'withdrawal'
    })
    this.setData({ dailyUsed: todayRecords.length })
  },

  // 确认收款：拉起微信商家转账收款确认页（新版商家转账，用户确认后微信才打款）
  onConfirmReceive(e) {
    this.doConfirmReceive(Number(e.currentTarget.dataset.id))
  },

  doConfirmReceive(id) {
    if (!Number.isInteger(id) || id < 1 || this.data.confirming) return
    if (wx.canIUse && !wx.canIUse('requestMerchantTransfer')) {
      return wx.showModal({ title: '提示', content: '当前微信版本过低，请将微信升级至 8.0.30 及以上后重试', showCancel: false })
    }
    this.setData({ confirming: true })
    wx.showLoading({ title: '加载中', mask: true })
    request.get(`/wallet/withdrawals/${id}/transfer-package`, {}, true).then((pkg) => {
      wx.hideLoading()
      if (pkg.status === 'SUCCESS') {
        wx.showToast({ title: '该笔提现已到账', icon: 'success' })
        return this.loadWallet()
      }
      wx.requestMerchantTransfer({
        mchId: pkg.mchId,
        appId: pkg.appId,
        package: pkg.packageInfo,
        success: () => {
          wx.showToast({ title: '已确认，等待到账', icon: 'success' })
          request.post(`/wallet/withdrawals/${id}/sync-transfer`, {}, true).catch(() => {})
          this.loadWallet()
        },
        fail: (err) => {
          const msg = String((err && err.errMsg) || '')
          if (msg.indexOf('cancel') > -1) {
            wx.showToast({ title: '已取消收款', icon: 'none' })
          } else {
            wx.showModal({ title: '收款确认失败', content: msg || '请稍后重试', showCancel: false })
          }
        }
      })
    }).catch((err) => {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '获取收款信息失败', icon: 'none' })
    }).finally(() => this.setData({ confirming: false }))
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, [async () => {
      await this.loadWallet()
      this.loadDailyWithdrawCount()
    }])
  },

  openWithdraw() {
    // 检查每日提现次数限制
    if (this.data.dailyUsed >= this.data.dailyLimit) {
      wx.showToast({ title: `今日提现次数已达上限（${this.data.dailyLimit}次）`, icon: 'none' })
      return
    }
    this.setData({ showWithdraw: true, withdrawAmount: '' })
  },

  closeWithdraw() { if (!this.data.submitting) this.setData({ showWithdraw: false }) },

  onWithdrawInput(e) {
    let value = String(e.detail.value || '').replace(/[^\d.]/g, '')
    const parts = value.split('.')
    value = parts[0] + (parts.length > 1 ? '.' + parts.slice(1).join('').slice(0, 2) : '')
    this.setData({ withdrawAmount: value })
  },

  submitWithdraw() {
    const amount = Number(this.data.withdrawAmount)
    if (!Number.isFinite(amount) || amount < this.data.minAmount) {
      return wx.showToast({ title: `提现金额至少为${this.data.minAmount}元`, icon: 'none' })
    }
    if (amount > this.data.maxAmount) {
      return wx.showToast({ title: `单笔提现金额不能超过${this.data.maxAmount}元`, icon: 'none' })
    }
    if (amount > Number(this.data.balance) || this.data.submitting) {
      return wx.showToast({ title: '可提现余额不足', icon: 'none' })
    }
    if (this.data.dailyUsed >= this.data.dailyLimit) {
      return wx.showToast({ title: `今日提现次数已达上限`, icon: 'none' })
    }

    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('withdraw')
    this.setData({ submitting: true })
    request.post('/wallet/withdrawals', { amount }, true, { idempotencyKey: `withdraw_${Date.now()}` }).then(() => {
      this.setData({ showWithdraw: false, dailyUsed: this.data.dailyUsed + 1 })
      this.loadWallet()
      this.finishWithdrawSubmit()
    }).finally(() => this.setData({ submitting: false }))
  },

  // 提现按钮点击是提现提醒授权的真实用户手势入口（见提现提交处理函数）

  finishWithdrawSubmit() {
    wx.showToast({ title: '已提交审核', icon: 'success' })
  }
})
