// 找驾校 · 学车指南：后台可编辑的自定义页面（标题 + 正文 + 图片），与校园卡页同款机制。
// 内容来自 /config/driving-guide-page，管理入口在管理后台「物品 → 学车指南页面」；
// 未发布时展示占位空态，普通用户只读。
const rt = require('../../utils/richtext')

Page({
  data: {
    page: null,
    blocks: [],
    loaded: false
  },

  onLoad() {
    return this.loadPage()
  },

  loadPage() {
    // 惰性 require：本页面可能被纯 Node 测试直接 require，utils/api 顶层依赖 getApp
    const api = require('../../utils/api')
    api.getDrivingGuidePage().then((page) => {
      if (!page) {
        this.setData({ page: null, blocks: [], loaded: true })
        return
      }
      this.setData({
        page: Object.assign({}, page, {
          images: Array.isArray(page.images) ? page.images : [],
          updatedAtText: String(page.updatedAt || '').slice(0, 10)
        }),
        blocks: rt.parseBlocks(page.content),
        loaded: true
      })
      if (page.status && page.title) wx.setNavigationBarTitle({ title: page.title })
    }).catch(() => this.setData({ loaded: true }))
  },

  onPreviewImage(e) {
    const page = this.data.page
    if (!page || !page.images.length) return
    wx.previewImage({ urls: page.images, current: e.currentTarget.dataset.url })
  },



  onShareAppMessage() {
    const page = this.data.page || {}
    return {
      title: page.title || '学车指南',
      path: '/pages/driving-school/guide'
    }
  }
})
