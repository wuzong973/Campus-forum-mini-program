Page({
  data: {
    searchKey: '',
    activeCategory: 0,
    categories: [
      { name: '全部' },
      { name: '账号问题' },
      { name: '课程表指南' },
      { name: '其他问题' }
    ],
    faqs: [
      {
        id: 1,
        category: 1,
        question: '如何修改个人资料信息？',
        answer: '进入"我的"页面，点击"设置"，在账号设置区域点击头像、昵称、性别、校区等任意一项，即可打开个人资料编辑弹窗。在弹窗中可以一次性修改所有个人信息，修改完成后点击"确定"保存。'
      },
      {
        id: 2,
        category: 1,
        question: '如何修改注销账号？',
        answer: '进入"我的"页面，点击"设置"，在列表中找到"账号安全"选项，进入后可看到注销账号说明。点击"申请注销账号"按钮，确认后即可提交注销申请。注意：注销后7天内可重新登录恢复账号。'
      },
      {
        id: 3,
        category: 2,
        question: '如何开启课程表提醒功能？',
        answer: '进入课程表页面，点击左上角菜单按钮打开侧边栏，找到"开启首页课程表提醒"选项，打开开关即可。开启后，首页会在上课前自动提醒您的下一节课程。'
      },
      {
        id: 4,
        category: 2,
        question: '如何更改课程表背景颜色？',
        answer: '进入课程表页面，点击左上角菜单按钮打开侧边栏，点击"更改课表背景颜色"，每次点击会在默认灰、浅蓝、浅黄、浅绿四种颜色之间切换。'
      },
      {
        id: 5,
        category: 2,
        question: '如何设置隐藏周末课程？',
        answer: '进入课程表页面，点击左上角菜单按钮打开侧边栏，找到"隐藏周末"选项，打开开关即可隐藏周六和周日的课程显示。关闭开关则恢复显示。'
      },
      {
        id: 6,
        category: 2,
        question: '如何使用AI识别课程表功能？',
        answer: '进入课程表页面，点击导航栏中的"AI"按钮，进入OCR识别页面。您可以上传课程表截图或拍照，系统会自动识别并生成课程表数据。识别完成后可手动调整确认。'
      },
      {
        id: 7,
        category: 3,
        question: '客服工作时间？',
        answer: '客服工作时间为每周一至周五 9:00-18:00（法定节假日除外）。非工作时间提交的反馈我们将在下一个工作日处理。紧急情况可通过"用户反馈"页面提交，我们会尽快回复。'
      }
    ],
    filteredFaqs: []
  },

  onLoad() {
    this.filterFaqs()
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value })
    this.filterFaqs()
  },

  onCategoryTap(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.index })
    this.filterFaqs()
  },

  filterFaqs() {
    const { searchKey, activeCategory, faqs } = this.data
    let list = faqs.map(f => ({ ...f, expanded: false }))

    if (activeCategory > 0) {
      list = list.filter(f => f.category === activeCategory)
    }

    if (searchKey.trim()) {
      const key = searchKey.trim().toLowerCase()
      list = list.filter(f =>
        f.question.toLowerCase().includes(key) ||
        f.answer.toLowerCase().includes(key)
      )
    }

    this.setData({ filteredFaqs: list })
  },

  onToggleFaq(e) {
    const id = e.currentTarget.dataset.id
    const faqs = this.data.filteredFaqs.map(f => {
      if (f.id === id) {
        return { ...f, expanded: !f.expanded }
      }
      return f
    })
    this.setData({ filteredFaqs: faqs })
  },

  onContactService() {
    wx.navigateTo({ url: '/pages/feedback/index' })
  }
})
