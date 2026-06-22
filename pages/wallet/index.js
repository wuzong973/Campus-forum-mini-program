const auth = require('../../utils/auth')

Page({
  data: {
    balance: '0.00',
    records: []
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.showModal({
        title: '提示',
        content: '请先登录后查看钱包',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
          else wx.navigateBack()
        }
      })
      return
    }
    const records = wx.getStorageSync('wallet_records') || [
      { id: 1, title: '跑腿收入', amount: '+5.00', time: '2026-06-10 14:30' },
      { id: 2, title: '发布跑腿', amount: '-3.00', time: '2026-06-08 09:15' }
    ]
    let balance = 0
    records.forEach((r) => { balance += parseFloat(r.amount) })
    this.setData({
      balance: balance.toFixed(2),
      records
    })
  },

  onRecharge() {
    wx.showToast({ title: '充值功能即将上线', icon: 'none' })
  },

  onWithdraw() {
    wx.showToast({ title: '提现功能即将上线', icon: 'none' })
  }
})
