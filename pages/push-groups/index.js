// 信息推送群：首页悬浮微信入口打开的落地页。卡片内容在管理后台「配置 → 信息推送群」维护；
// 服务端首次读取会自动内置 5 张默认卡片，本地 FALLBACK 只在接口加载失败时兜底展示。
//
// 交互（2026-10-06 用户口径）：页面**只显示卡片**；点卡片弹「二维码弹窗」，
// 样式与 components/contact-admin 的二维码弹层一致（长按识别 / 点击此处即可跳转）。
// 二维码图取该卡片的 images[0]（后台「配图」第 1 张），标题取卡片 title，跳转取卡片 link。
// 不用 admin 的 QR_PAGE_URL 之外的方式：小程序内长按只能识别小程序码，
// 个人微信二维码必须进 H5 页长按识别，故「点击此处即可跳转」走 webview → web-static/wechat-qr.html。
const api = require('../../utils/api')
// 站内跳转统一入口：识别分包路径 /pkg-xxx/pages/... 并让 tabBar 页走 switchTab
const linkUtil = require('../../utils/link')

const QR_PAGE_URL = 'https://payun01.cn/wechat-qr.html'

const FALLBACK_CARDS = [
  { id: 'f1', icon: '💬', theme: 'orange', title: '点击进入树洞消息推送群', desc: '推送树洞和大学城消息，浏览校园互动' },
  { id: 'f2', icon: '🧺', theme: 'green', title: '点击加入二手物品快速交易群', desc: '只推送低价物品，快来甩卖或捡漏吧' },
  { id: 'f3', icon: '🏃', theme: 'blue', title: '点击加入跑腿代办接单群', desc: '平台0抽成，进群可提前接单' },
  { id: 'f4', icon: '微信', theme: 'purple', title: '点击关注墙墙公众号', desc: '精选校园内容，重要消息及时送达' },
  { id: 'f5', icon: '微信', theme: 'teal', title: '点击添加墙墙微信', desc: '微信号：Wenroujun1', copyText: 'Wenroujun1' }
]

Page({
  data: {
    cards: [],
    loading: true,
    loadFailed: false,
    // 二维码弹窗：qrCard 为当前展示的卡片对象，null 即关闭
    qrCard: null,
    qrImage: '',
    // 放大状态：在页面内放大同一张 <image>，不走 wx.previewImage
    qrExpanded: false
  },

  onLoad() {
    this.loadCards()
  },

  // 兜底恢复：页面被切走时别把 tabBar 留在隐藏态（放大态点右上角胶囊会走到这里）
  onHide() {
    this.setTabBarHidden(false)
  },

  onPullDownRefresh() {
    this.loadCards(() => wx.stopPullDownRefresh())
  },

  loadCards(done) {
    api.getPushGroups().then((list) => {
      // 成功时以服务端为准（空就是空，管理员可自行删光），只有失败才落到本地兜底
      this.setData({ cards: list, loading: false, loadFailed: false })
      if (done) done()
    }).catch(() => {
      this.setData({ cards: FALLBACK_CARDS, loading: false, loadFailed: true })
      if (done) done()
    })
  },

  // 点卡片 = 看这个群的二维码（不再跳页、不再直接跳群链接/复制）
  onCardTap(e) {
    const card = this.data.cards[Number(e.currentTarget.dataset.index)]
    if (!card) return
    const images = Array.isArray(card.images) ? card.images : []
    // 二维码取配图第 1 张：与「添加微信」场景一致，管理员把它当二维码传
    this.setData({ qrCard: card, qrImage: images[0] || '', qrExpanded: false })
  },

  closeQr() {
    this.setData({ qrCard: null, qrImage: '', qrExpanded: false })
    this.setTabBarHidden(false)
  },

  // 弹层内容区吞掉点击，避免穿透到遮罩把弹窗关掉。
  // 放大态例外：弹层已铺满全屏，点任意处 = 退出放大 —— 放大态没有关闭按钮，
  // 这是唯一出口，对齐微信原生图片查看器的「点一下退出」。
  stopPropagation() {
    if (this.data.qrExpanded) {
      this.setData({ qrExpanded: false })
      this.setTabBarHidden(false)
    }
  },

  // 放大态要「真正全屏」，而自定义 tabBar 由框架渲染在页面内容之上、z-index 盖不住它
  // （见 custom-tab-bar/index.js 的 hidden 字段），只能临时整块隐藏。
  // ⚠ 本页不是 tab 页，getTabBar() 会返回 undefined —— 必须判空；恢复点必须齐全
  //    （收起放大 / 关闭弹窗 / 页面 hide），漏一个 tabBar 就永久消失。
  setTabBarHidden(hidden) {
    const pages = getCurrentPages()
    const cur = pages[pages.length - 1]
    const tabBar = cur && typeof cur.getTabBar === 'function' ? cur.getTabBar() : null
    if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ hidden: !!hidden })
  },

  // 「点击此处即可跳转」：进 H5 页长按识别；未配二维码图时按 link / copyText 兜底
  onOpenQrPage() {
    const card = this.data.qrCard || {}
    const image = String(this.data.qrImage || '')
    const link = String(card.link || '')

    if (/^https:\/\//i.test(image)) {
      const params = ['qr=' + encodeURIComponent(image)]
      if (card.title) params.push('text=' + encodeURIComponent(String(card.title)))
      this.closeQr()
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(QR_PAGE_URL + '?' + params.join('&'))
          + '&title=' + encodeURIComponent('二维码识别'),
        fail: () => wx.showToast({ title: '打开失败，请稍后重试', icon: 'none' })
      })
      return
    }

    // 没配二维码图：直接按卡片的跳转链接走（口径与 utils/richtext.openLink 一致）
    if (linkUtil.openPath(link, { fail: () => wx.showToast({ title: '该页面暂不可用', icon: 'none' }) })) {
      this.closeQr()
      return
    }
    if (linkUtil.isWebUrl(link)) {
      this.closeQr()
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(link),
        fail: () => wx.showToast({ title: '打开失败，请稍后重试', icon: 'none' })
      })
      return
    }

    // 只剩 copyText 的卡片（如「点击添加墙墙微信」）：复制到剪贴板总比点了没反应好
    const copyText = String(card.copyText || '')
    if (copyText) {
      wx.setClipboardData({
        data: copyText,
        success: () => {
          wx.showToast({ title: '已复制，去微信粘贴添加', icon: 'none' })
          this.closeQr()
        }
      })
      return
    }

    wx.showToast({ title: '尚未配置二维码或跳转链接', icon: 'none' })
  },

  // 长按 = 微信原生菜单（保存图片 / 发送给朋友 / 收藏 / 识别）。
  // 旧注释曾断言「show-menu-by-longpress 在 mode=widthFix 下失效」，与官方文档不符
  // （2.7.0 起支持、无域名限制、不受 mode 影响），本仓库 pkg-schedule 也一直在用它。
  // 但「小程序内长按只能识别小程序码」是真的：个人好友码识别不出，故提示给出
  // 「保存图片 → 扫一扫 → 相册」这条可靠路径。
  // 点击 = 在同一张 <image> 上就地放大/缩小。
  // 不能再走 wx.previewImage：那是微信自带的查看器，长按菜单由微信决定，
  // 页面里的 show-menu-by-longpress 注入不进去 —— 用户实测「放大后长按没菜单」。
  toggleQrZoom() {
    const next = !this.data.qrExpanded
    this.setData({ qrExpanded: next })
    this.setTabBarHidden(next)
  }
})
