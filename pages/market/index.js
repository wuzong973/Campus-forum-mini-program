// 校园市场（租赁服务 / 校园数码 / 校园家政 / DIY电脑）
// 四个类别均为后台可编辑的自定义页面（标题 + 正文 + 图片，每类一张），
// 内容来自 /config/market-page/:category，管理入口在管理后台「物品」页；
// 未发布/未创建时展示占位空态，普通用户始终只读。实现方式与「校园卡」页面一致。
const api = require('../../utils/api')
const motion = require('../../utils/motion')
const richtext = require('../../utils/richtext')

const CATEGORIES = [
  { key: 'rental', name: '租赁服务' },
  { key: 'digital', name: '校园数码' },
  { key: 'housekeeping', name: '校园家政' },
  { key: 'diypc', name: 'DIY电脑' }
]

// 正文走标记语法渲染（与校园卡 / 学车指南同一套解析器与组件）
function decoratePage(page) {
  const images = (page && page.images) || []
  return Object.assign({}, page, { blocks: richtext.parseBlocks(page && page.content), images })
}

Page({
  data: {
    categories: CATEGORIES,
    activeCategory: CATEGORIES[0].key,
    // 每个分类的已加载页面缓存：切回不再重复请求
    pageCache: {},
    page: null,
    loading: true,
    // 动效降级：低端机或用户在「设置 → 显示 → 卡片动效」关闭时为 true
    fxOff: false
  },

  onLoad() {
    this.setData({ fxOff: motion.isCardFxOff() })
    this.loadCategory(this.data.activeCategory)
  },

  onShow() {
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
  },

  onPullDownRefresh() {
    const key = this.data.activeCategory
    this.setData({ pageCache: {} })
    this.loadCategory(key).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeCategory) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ activeCategory: key })
    this.loadCategory(key)
  },

  loadCategory(key) {
    const cached = this.data.pageCache[key]
    if (cached) {
      this.setData({ page: cached, loading: false })
      return Promise.resolve()
    }
    this.setData({ loading: true })
    return api.getMarketPage(key).then((page) => {
      const decorated = page ? decoratePage(page) : null
      this.setData({
        page: decorated,
        loading: false,
        ['pageCache.' + key]: decorated
      })
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
    const active = this.data.categories.find((item) => item.key === this.data.activeCategory) || {}
    return {
      title: '校园市场 · ' + (active.name || ''),
      path: '/pages/market/index'
    }
  }
})
