// 校园圈学车落地页：找驾校列表页顶部横幅（校园圈学车）的跳转目标。
// 与「学车指南」完全独立：内容是后台可编辑的自定义页（标题 + 正文 + 图片，每类一张），
// 来自 /config/promo-landing-page，管理入口在管理后台「物品 → 校园圈学车页面」；
// 未发布/未创建时展示占位空态，普通用户只读。展示口径与校园卡/校园市场页一致。
const api = require('../../../utils/api')
const richtext = require('../../../utils/richtext')

Page({
  data: {
    page: null,
    blocks: [],
    loading: true
  },

  onLoad() {
    this.loadPage()
  },

  onPullDownRefresh() {
    this.loadPage().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  loadPage() {
    this.setData({ loading: true })
    return api.getPromoLandingPage().then((page) => {
      this.setData({
        page: page || null,
        blocks: richtext.parseBlocks(page && page.content),
        loading: false
      })
      if (page && page.status && page.title) wx.setNavigationBarTitle({ title: page.title })
    }).catch(() => {
      this.setData({ page: null, loading: false })
    })
  },

  onPreviewImage(e) {
    const page = this.data.page
    if (!page || !page.images.length) return
    wx.previewImage({ urls: page.images, current: e.currentTarget.dataset.url })
  },



  onShareAppMessage() {
    return {
      title: '校园圈学车｜找驾校 · 比价格 · 看口碑',
      path: '/pkg-feature/pages/driving-school/index'
    }
  }
})
