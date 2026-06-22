Page({
  data: {},

  onDeleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后所有数据将被永久删除，7天内可恢复。确定要申请注销吗？',
      confirmColor: '#FF4D4F',
      success(res) {
        if (res.confirm) {
          wx.showToast({ title: '注销申请已提交', icon: 'success' })
        }
      }
    })
  }
})
