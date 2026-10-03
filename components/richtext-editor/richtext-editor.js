// 正文富文本编辑器（工具栏 + textarea），给管理后台所有「正文」字段复用。
//
// 为什么做成组件而不是每页复制一份工具栏：后台有十几处正文入口，复制会把
// 标记语法、光标处理、上传、颜色弹层散落到各页，任何一处改动都要全量跟改。
//
// 对宿主页面的唯一约定：组件抛 `input` 事件，载荷是 { value, cursor }
// —— 与原生 textarea 的 bindinput 形状一致，所以各页现有的
// bindinput="formInput" / onFieldInput 处理函数可以原样接上去，不用改。
const richtext = require('../../utils/richtext')
const wechat = require('../../utils/wechat')

// 工具栏按钮：kind 决定走哪条插入逻辑，cmd 是参数。
//
// label 是给测试与无障碍用的语义名（不再直接显示）；显示内容二选一：
//   icon  —— 几何图标名，由 wxml + wxss 用 view 画出来（对齐/列表/分隔线）
//   glyph —— 直接排的字形（←/→/🖼）
// 依然显示文字的只有「B I U S A / H1 H2 H3」这类本身就是字形预览的按钮，
// 以及设计稿里没有图标形态的「引用 / 链接 / 预览」。
const TOOLBAR = [
  { group: 'inline', items: [
    { label: 'B', kind: 'inline', cmd: 'bold', demo: 'rt-demo-b' },
    { label: 'I', kind: 'inline', cmd: 'italic', demo: 'rt-demo-i' },
    { label: 'U', kind: 'inline', cmd: 'underline', demo: 'rt-demo-u' },
    { label: 'S', kind: 'inline', cmd: 'strike', demo: 'rt-demo-s' },
    { label: 'A', kind: 'color', demo: 'rt-demo-color' }
  ] },
  { group: 'heading', items: [
    { label: 'H1', kind: 'line', cmd: 'h1' },
    { label: 'H2', kind: 'line', cmd: 'h2' },
    { label: 'H3', kind: 'line', cmd: 'h3' }
  ] },
  { group: 'align', items: [
    { label: '左', kind: 'align', cmd: 'l', icon: 'align-left' },
    { label: '中', kind: 'align', cmd: 'c', icon: 'align-center' },
    { label: '右', kind: 'align', cmd: 'r', icon: 'align-right' }
  ] },
  { group: 'list', items: [
    { label: '列表', kind: 'line', cmd: 'bullet', icon: 'bullet' },
    { label: '编号', kind: 'line', cmd: 'number', icon: 'number' },
    { label: '引用', kind: 'line', cmd: 'quote', icon: 'quote' }
  ] },
  { group: 'indent', items: [
    { label: '‹缩进', kind: 'indent', cmd: -1, glyph: '←' },
    { label: '缩进›', kind: 'indent', cmd: 1, glyph: '→' }
  ] },
  { group: 'insert', items: [
    { label: '链接', kind: 'inline', cmd: 'link', glyph: '🔗' },
    { label: '分隔线', kind: 'divider', icon: 'divider' },
    { label: '图片', kind: 'image' }
  ] },
  { group: 'view', items: [
    { label: '预览', kind: 'preview' }
  ] }
]

Component({
  properties: {
    value: { type: String, value: '', observer(next) {
      // 宿主回填同一个值时不再 setData，避免打字过程中被自己的回环打断
      if (next !== this.data.text) this.setData({ text: next || '' })
    } },
    placeholder: { type: String, value: '' },
    maxlength: { type: Number, value: 5000 },
    // 部分后台表单的 textarea 高度不同，宿主可覆盖类名
    textareaClass: { type: String, value: '' },
    disabled: { type: Boolean, value: false }
  },

  data: {
    groups: TOOLBAR,
    text: '',
    cursor: -1,
    // 预览默认打开：管理员的诉求是「别让我费劲猜 ** 会渲染成什么」，
    // 默认展开渲染效果，写完即时可见；不需要时点一下「预览」收起即可。
    preview: true,
    uploading: false
  },

  lifetimes: {
    attached() {
      this.setData({ text: this.data.value || '' })
    }
  },

  methods: {
    // 统一出口：内部状态 + 宿主事件一次写齐
    emit(text, cursor) {
      if (text.length > this.data.maxlength) {
        wx.showToast({ title: '内容不能超过' + this.data.maxlength + '字', icon: 'none' })
        return
      }
      // 连续点同一按钮时光标值可能不变，textarea 就不重定位；先归 -1 再设回强制生效
      this.setData({ text, cursor: -1 }, () => {
        this.setData({ cursor })
        this.triggerEvent('input', { value: text, cursor })
      })
    },

    onInput(e) {
      const detail = e.detail || {}
      this.setData({ text: detail.value || '', cursor: detail.cursor })
      this.triggerEvent('input', { value: detail.value || '', cursor: detail.cursor })
    },

    onCmd(e) {
      const { kind, cmd } = e.currentTarget.dataset
      if (kind === 'preview') return this.setData({ preview: !this.data.preview })
      const text = this.data.text
      // 光标只决定「作用在哪一行」；即便个别机型没把光标恢复到位，按行包裹产出的仍是完整成对标记
      const cursor = this.data.cursor >= 0 ? Math.min(this.data.cursor, text.length) : text.length
      if (kind === 'image') return this.pickImage(cursor)
      if (kind === 'color') return this.pickColor(cursor)
      const next = richtext.applyCommand(text, cursor, kind, cmd)
      if (next) this.emit(next.text, next.cursor)
    },

    pickColor(cursor) {
      const keys = Object.keys(richtext.COLOR_MAP)
      wx.showActionSheet({
        itemList: keys.map((k) => k + '色文字'),
        success: (res) => {
          const key = keys[res.tapIndex]
          if (!key) return
          const next = richtext.applyCommand(this.data.text, cursor, 'color', key)
          this.emit(next.text, next.cursor)
        },
        fail: () => {}
      })
    },

    // 图片走全站同一套上传通道，拿到 https 地址后写成整行图片标记
    pickImage(cursor) {
      if (this.data.uploading) return
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        success: (res) => {
          const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
          if (!paths.length) return
          this.setData({ uploading: true })
          wx.showLoading({ title: '上传中...', mask: true })
          wechat.uploadImages(paths).then((urls) => {
            wx.hideLoading()
            this.setData({ uploading: false })
            const url = (urls || [])[0]
            if (!url) { wx.showToast({ title: '图片上传失败', icon: 'none' }); return }
            const next = richtext.insertImage(this.data.text, cursor, url, '配图')
            this.emit(next.text, next.cursor)
          }).catch((err) => {
            wx.hideLoading()
            this.setData({ uploading: false })
            wx.showToast({ title: (err && err.message) || '图片上传失败', icon: 'none' })
          })
        },
        fail: () => {}
      })
    }
  }
})
