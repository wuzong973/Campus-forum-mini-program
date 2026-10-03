// 校园服务通用详情页（校车时刻 / 轻友指南 / 校园卡 / 速印 / 返乡大巴 / 特惠寄件）
// 除校园卡外内容全部来自 utils/campus-services.js，页面只负责渲染：
//   作用说明 → 适用场景 → 关键信息（未填写时降级为咨询入口）→ 使用流程 → 温馨提示 → 常见问题 → 相关入口 → 咨询
// 校园卡页已改为后台可编辑的自定义页面（标题+正文+图片，可多张），内容来自 /config/campus-card-pages，
// 管理入口在管理后台「物品」页；未发布时展示占位空态，普通用户始终只读。
const campusServices = require('../../utils/campus-services')
// 卡片动效降级开关（低端机 / 用户在设置里关闭）：命中时挂 .fx-off
const motion = require('../../utils/motion')
const richtext = require('../../utils/richtext')

// 关键信息行的结构化渲染判定（对齐校历页的卡片时间轴风格）：
//   时刻行（全部以 HH:MM 开头、以 / 分隔）→ 时间胶囊；
//   站点行（以 - 分隔的多个短站点名）→ 流程时间轴；其余保持纯文本
const TIME_PART_RE = /^\d{1,2}:\d{2}/
function decorateInfoLine(line) {
  const value = String((line && line.value) || '')
  const slashParts = value.split('/').map((s) => s.trim()).filter(Boolean)
  if (slashParts.length > 1 && slashParts.every((part) => TIME_PART_RE.test(part))) {
    return Object.assign({}, line, { kind: 'times', parts: slashParts })
  }
  const dashParts = value.split(/\s*[-－]\s*/).map((s) => s.trim()).filter(Boolean)
  if (dashParts.length > 1 && dashParts.every((part) => part.length <= 16)) {
    return Object.assign({}, line, { kind: 'flow', parts: dashParts })
  }
  return Object.assign({}, line, { kind: 'text', parts: [] })
}

function decorateInfoItems(items) {
  return (items || []).map((item) => Object.assign({}, item, {
    lines: (item.lines || []).map(decorateInfoLine)
  }))
}

// 后台可编辑的校园卡页面（可多张）：正文走标记语法，目录行取首个可读块剥标记做摘要
function decorateCardPage(page) {
  const blocks = richtext.parseBlocks(page.content)
  const first = blocks.find((block) => block.type !== 'hr' && block.type !== 'img')
  const summary = first ? richtext.stripMarks(first.runs.map((run) => run.t).join('')) : ''
  return Object.assign({}, page, {
    blocks,
    summary: summary.length > 46 ? summary.slice(0, 46) + '…' : summary,
    updatedAtText: String(page.updatedAt || '').slice(0, 10)
  })
}

Page({
  data: {
    service: null,
    hasInfo: false,
    infoItems: [],
    isCardPage: false,
    servicePage: null,
    cardBlocks: [],
    // 后台配置了多张校园卡页面时先展示目录，点条目进入对应页面
    cardPages: [],
    // 动效降级：低端机或用户在「设置 → 显示 → 卡片动效」关闭时为 true，挂 .fx-off
    fxOff: false
  },

  onShow() {
    // 动效降级每次回到页面都同步：设置页刚关掉要立即生效，低端机判定不随页面变但成本极低
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    const raw = campusServices.getServiceById(id)
    if (!raw) return this.failBack()

    // 统一把可选项补成空数组，避免 WXML 里出现 undefined.length
    const service = Object.assign({}, raw, {
      scenes: raw.scenes || [],
      steps: raw.steps || [],
      tips: raw.tips || [],
      links: raw.links || [],
      info: Object.assign({ title: '关键信息', note: '', items: [], emptyText: '' }, raw.info || {}),
      faqs: (raw.faqs || []).map((item) => Object.assign({ expanded: false }, item))
    })

    this.setData({ service, hasInfo: campusServices.hasServiceInfo(service), infoItems: decorateInfoItems(service.info.items) })
    wx.setNavigationBarTitle({ title: service.name })
    if (service.id === 'campus-card') {
      // card=页面 id：从校园卡目录进入某一张具体页面
      this.cardId = (options && options.card) || ''
      this.setData({ isCardPage: true })
      this.loadCardPage(this.cardId)
    }
  },

  loadCardPage(cardId) {
    // 惰性 require：本页面被纯 Node 测试直接 require，utils/api 顶层依赖 getApp
    const api = require('../../utils/api')
    const loading = cardId
      ? api.getCampusCardPage(cardId).then((page) => (page ? [page] : []))
      : api.getCampusCardPages()
    loading.then((list) => {
      const pages = (list || []).map(decorateCardPage)
      // 只有一张时直接铺开内容，多张时先展示目录由用户选择
      const single = pages.length === 1 ? pages[0] : null
      this.setData({
        servicePage: single,
        cardBlocks: single ? single.blocks : [],
        cardPages: single ? [] : pages
      })
      if (single && single.status && single.title) wx.setNavigationBarTitle({ title: single.title })
    }).catch(() => {})
  },

  onOpenCardPage(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/campus-service/index?id=campus-card&card=' + id })
  },

  onPreviewCardImage(e) {
    const page = this.data.servicePage
    if (!page || !page.images.length) return
    wx.previewImage({ urls: page.images, current: e.currentTarget.dataset.url })
  },

  failBack() {
    wx.showToast({ title: '该服务不存在或已下线', icon: 'none' })
    setTimeout(() => {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) })
    }, 900)
  },

  onToggleFaq(e) {
    const index = Number(e.currentTarget.dataset.index)
    const target = this.data.service && this.data.service.faqs[index]
    if (!target) return
    this.setData({ ['service.faqs[' + index + '].expanded']: !target.expanded })
  },

  onLinkTap(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.navigateTo({ url, fail: () => wx.switchTab({ url }) })
  },

  onShareAppMessage() {
    const service = this.data.service || {}
    return {
      title: (service.name || '校园服务') + '｜' + (service.tagline || ''),
      path: '/pages/campus-service/index?id=' + (service.id || '') + (this.cardId ? '&card=' + this.cardId : '')
    }
  }
})
