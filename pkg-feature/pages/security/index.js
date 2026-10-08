const auth = require('../../../utils/auth')
const request = require('../../../utils/request')
const { runPullDownRefresh } = require('../../../utils/refresh')

Page({
  data: { deletionRequest: null, loading: false },

  onShow() {
    if (!auth.isLoggedIn()) return
    this.loadDeletionRequest()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, this.loadDeletionRequest)
  },

  loadDeletionRequest() {
    return request.get('/user/deletion-request', {}, true, { silent: true })
      .then((deletionRequest) => this.setData({ deletionRequest }))
      .catch(() => this.setData({ deletionRequest: null }))
  },

  onDeleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '提交后将进入 7 天冷静期。冷静期内可随时撤销，期满后将按平台规则处理相关数据。确定提交吗？',
      confirmColor: '#FF4D4F',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ loading: true })
        request.post('/user/deletion-request', {}, true, { showLoading: '提交中...' })
          .then((deletionRequest) => {
            this.setData({ deletionRequest })
            wx.showToast({ title: '注销申请已提交', icon: 'success' })
          })
          .catch((error) => wx.showToast({ title: error.message || '提交失败，请稍后重试', icon: 'none' }))
          .finally(() => this.setData({ loading: false }))
      }
    })
  },

  onCancelDeletion() {
    wx.showModal({
      title: '撤销注销申请',
      content: '撤销后账号将继续正常使用。',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ loading: true })
        request.del('/user/deletion-request', {}, true, { showLoading: '撤销中...' })
          .then(() => {
            this.setData({ deletionRequest: null })
            wx.showToast({ title: '已撤销申请', icon: 'success' })
          })
          .catch((error) => wx.showToast({ title: error.message || '撤销失败，请稍后重试', icon: 'none' }))
          .finally(() => this.setData({ loading: false }))
      }
    })
  }
})
