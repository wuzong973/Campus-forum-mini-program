const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    list: [],
    loading: false,
    loaded: false
  },

  onShow() {
    this.loadList()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadList())
  },

  loadList() {
    this.setData({ loading: true })
    api.getBlacklist().then((res) => {
      const list = (res && res.list || []).map((item) => Object.assign({}, item, {
        dateText: this.formatDate(item.createdAt)
      }))
      this.setData({ list, loading: false, loaded: true })
    }).catch(() => {
      this.setData({ loading: false, loaded: true })
    })
  },

  formatDate(value) {
    const text = String(value || '')
    return text.length >= 10 ? text.slice(0, 10) : (text || '—')
  },

  onUnblock(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.list[index]
    if (!item) return
    wx.showModal({
      title: '解除拉黑',
      content: '解除对「' + (item.nick || '该用户') + '」的拉黑？',
      success: (res) => {
        if (!res.confirm) return
        api.unblockUser(item.userId).then(() => {
          const list = this.data.list.filter((_, i) => i !== index)
          this.setData({ list })
          wx.showToast({ title: '已解除拉黑', icon: 'success' })
        }).catch((err) => {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        })
      }
    })
  },

  goBack() { wx.navigateBack() }
})
