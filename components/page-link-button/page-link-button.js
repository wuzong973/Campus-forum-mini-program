// 自定义页面正文下方的「跳转按钮」：链接与文字都在后台「编辑<页面名>」表单里配。
//
// 为什么做成组件：校园卡 / 学车指南 / 校园市场 / 校园圈学车四个页面是同一种内容结构，
// 各自抄一份按钮就会走出四种圆角、四种间距，「保持一致」的要求靠复制是守不住的。
//
// 行为口径与正文里的链接完全一致，直接复用 utils/richtext.openLink：
// 站内 /pages/... 导航、http(s) 走 webview、其余复制兜底。这样管理员在正文里加链接
// 和在按钮上加链接，跳转表现不会出现两套。
const richtext = require('../../utils/richtext')

Component({
  properties: {
    link: { type: String, value: '' },
    linkText: { type: String, value: '' }
  },

  data: {
    show: false,
    label: ''
  },

  observers: {
    'link, linkText'(link, linkText) {
      const href = String(link || '').trim()
      const text = String(linkText || '').trim()
      // 没有链接就不出按钮；文案留空时给一个中性兜底，避免出现空白按钮
      this.setData({
        show: !!href,
        label: text || '查看详情'
      })
    }
  },

  methods: {
    onTap() {
      const href = String(this.data.link || '').trim()
      if (!href) return
      richtext.openLink(href)
    }
  }
})
