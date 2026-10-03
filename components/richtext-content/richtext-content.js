// 后台自定义页面正文的渲染组件：吃 utils/richtext.js 解析出的块列表。
//
// 两种喂法：
//   blocks="{{已解析}}" —— 页面本来就要拿块列表算长度/做判断时用（banner-detail 等 5 处）
//   content="{{原文}}"  —— 只想换个标签、不想动页面数据流时用；解析在组件内部完成
// 同时传时以 blocks 为准。
//
// 链接与图片的行为在组件内统一处理（openLink 的站内/webview/复制兜底、previewImage 的分组），
// 因为全站口径一致；此前每个宿主页面各抄一份 onRichLink/onRichImage，抄漏一处就是死链接。
// imageGroup 用来把正文内联图片并入页面图集，让接收方能左右滑动。
const richtext = require('../../utils/richtext')

Component({
  properties: {
    blocks: { type: Array, value: null },
    content: { type: String, value: '', observer() { this.refresh() } },
    // 原先各处正文 text 节点自带 user-select（长按可选文字），换成组件后必须由宿主保留，
    // 否则群公告这类「复制走」的内容会静默失去可选中性
    selectable: { type: Boolean, value: false },
    imageGroup: { type: Array, value: [] }
  },

  data: {
    items: []
  },

  lifetimes: {
    attached() {
      this.refresh()
    }
  },

  observers: {
    blocks() {
      this.refresh()
    }
  },

  methods: {
    refresh() {
      const blocks = this.data.blocks
      const items = Array.isArray(blocks) ? blocks : richtext.parseBlocks(this.data.content)
      if (JSON.stringify(items) !== JSON.stringify(this.data.items)) this.setData({ items })
    },

    onLinkTap(e) {
      richtext.openLink(e.currentTarget.dataset.href)
    },

    onImageTap(e) {
      const src = e.currentTarget.dataset.src
      if (!src) return
      const group = this.data.imageGroup || []
      wx.previewImage({ urls: group.indexOf(src) >= 0 ? group : [src], current: src })
    }
  }
})
