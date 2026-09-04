const auth = require('../../utils/auth')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

const STATUS_TEXT = { SUCCESS: '已到账', PENDING: '审核中', PROCESSING: '转账处理中', REJECTED: '已驳回', FAILED: '转账失败' }

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
    feeDescription: WITHDRAW_RULES.feeDescription
  },

  onShow() {
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
  },

  loadWallet() {
    this.setData({ loading: true })
    const applySummary = (data) => {
      const money = (value) => Number(value || 0).toFixed(2)
      this.setData({
        balance: money(data.available), earned: money(data.earned), withdrawing: money(data.withdrawing),
        records: (data.records || []).map((item) => ({
          ...item,
          amountText: `${Number(item.amount) >= 0 ? '+' : '-'}¥${Math.abs(Number(item.amount)).toFixed(2)}`,
          timeText: String(item.createdAt || '').replace('T', ' ').slice(0, 16),
          statusText: STATUS_TEXT[item.status] || item.status
        }))
      })
    }
    if (request.USE_MOCK) {
      const mock = require('../../utils/mock')
      applySummary(mock.walletSummary)
      this.setData({ loading: false })
      return
    }
    return request.get('/wallet/summary', {}, true, { silent: true }).then(applySummary).catch(() => {}).finally(() => this.setData({ loading: false }))
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

    this.setData({ submitting: true })
    if (request.USE_MOCK) {
      const mock = require('../../utils/mock')
      const amount = Number(this.data.withdrawAmount)
      mock.walletSummary.records.unshift({
        id: Date.now(), type: 'withdrawal', amount: -amount,
        title: '提现至微信零钱（审核中）', status: 'PENDING',
        createdAt: new Date().toISOString()
      })
      mock.walletSummary.available = Number((mock.walletSummary.available - amount).toFixed(2))
      mock.walletSummary.withdrawing = Number((mock.walletSummary.withdrawing + amount).toFixed(2))
      wx.showToast({ title: '已提交审核', icon: 'success' })
      this.setData({ showWithdraw: false, dailyUsed: this.data.dailyUsed + 1, submitting: false })
      this.loadWallet()
      return
    }
    request.post('/wallet/withdrawals', { amount }, true, { idempotencyKey: `withdraw_${Date.now()}` }).then(() => {
      wx.showToast({ title: '已提交审核', icon: 'success' })
      this.setData({ showWithdraw: false, dailyUsed: this.data.dailyUsed + 1 })
      this.loadWallet()
    }).finally(() => this.setData({ submitting: false }))
  }
})
