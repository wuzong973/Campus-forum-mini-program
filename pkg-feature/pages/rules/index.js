const { runPullDownRefresh } = require('../../../utils/refresh')

Page({
  data: {
    rules: [
      {
        id: 1,
        icon: '✕',
        iconClass: 'red',
        title: '禁止违法内容',
        desc: '严禁发布违反国家法律法规的内容，包括但不限于：暴力、恐怖、赌博、毒品等信息。'
      },
      {
        id: 2,
        icon: '👤',
        iconClass: 'orange',
        title: '禁止人身攻击',
        desc: '禁止对他人进行侮辱、诽谤、威胁等行为，保持理性讨论。'
      },
      {
        id: 3,
        icon: '🔔',
        iconClass: 'green',
        title: '禁止垃圾广告',
        desc: '未经许可禁止发布商业广告、推广信息或重复内容。'
      },
      {
        id: 4,
        icon: '🔒',
        iconClass: 'blue',
        title: '保护隐私',
        desc: '禁止公开他人隐私信息，包括电话号码、住址、身份证号等。'
      },
      {
        id: 5,
        icon: '✎',
        iconClass: 'blue',
        title: '内容原创性',
        desc: '转载内容需注明出处，禁止盗用他人作品。'
      },
      {
        id: 6,
        icon: '💬',
        iconClass: 'orange',
        title: '文明用语',
        desc: '禁止使用低俗、谩骂、歧视性语言，保持文明交流。'
      }
    ]
  },

  onAgree() {
    wx.showToast({ title: '已同意社区规定', icon: 'success' })
    setTimeout(() => {
      wx.navigateBack()
    }, 1000)
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
