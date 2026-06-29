const api = require('../../utils/api')

Page({
  data: {
    username: '',
    password: '',
    loading: false
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onLogin() {
    const { username, password } = this.data
    if (!username) {
      wx.showToast({ title: '请输入学号', icon: 'none' })
      return
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    api.syncSchedule(username, password)
      .then(() => {
        this.setData({ loading: false })
        wx.showToast({ title: '同步成功', icon: 'success' })
        // 清除本地课表缓存，返回后会自动重新加载
        wx.removeStorageSync('schedule_courses')
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      })
      .catch((err) => {
        this.setData({ loading: false })
        wx.showModal({
          title: '同步失败',
          content: err && err.message ? err.message : '账号或密码错误，请重试',
          showCancel: false
        })
      })
  }
})
