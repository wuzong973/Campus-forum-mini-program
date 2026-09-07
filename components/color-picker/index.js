// 通用颜色选择器弹层：预设色板 + 十六进制色值输入 + 即时预览 + 恢复默认
// 用法：<color-picker show="{{show}}" value="{{hex}}" title="选择背景颜色"
//          bind:close="onPickerClose" bind:confirm="onPickerConfirm" />
// confirm 事件 detail = { hex }（hex 为空字符串表示恢复默认）
const PRESETS = [
  '#FFFFFF', '#F8FAFC', '#E4E9F2', '#9AA6BF', '#5B6472', '#1F2329', '#000000',
  '#E34D4D', '#FF7D00', '#FFB02E', '#F7BA1E', '#FFE2E2', '#FFF1DE', '#FFF7E8',
  '#3AA356', '#00B42A', '#3D7BFA', '#3A6FE3', '#E0F5E6', '#E3EDFF', '#E8F3FF',
  '#8A4DE0', '#F53F8E', '#C9502C', '#7B5B3A', '#F0E5FF', '#FFE8F1', '#F5EDE3'
]

function normalizeHex(v) {
  const s = String(v || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s
  return ''
}

// 根据背景亮度自动返回可读的文字颜色
function contrastText(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 >= 160 ? '#1F2329' : '#FFFFFF'
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    value: { type: String, value: '' },
    title: { type: String, value: '选择颜色' }
  },

  data: {
    presets: PRESETS,
    hex: '',
    hexInput: '',
    previewText: '#FFFFFF'
  },

  observers: {
    'show, value': function (show, value) {
      if (!show) return
      const hex = normalizeHex(value)
      this.setData({ hex, hexInput: hex, previewText: hex ? contrastText(hex) : '#FFFFFF' })
    }
  },

  methods: {
    onPresetTap(e) {
      const hex = normalizeHex(e.currentTarget.dataset.hex)
      if (!hex) return
      this.setData({ hex, hexInput: hex, previewText: contrastText(hex) })
    },

    onHexInput(e) { this.setData({ hexInput: e.detail.value }) },

    onHexApply() {
      const hex = normalizeHex(this.data.hexInput)
      if (!hex) return wx.showToast({ title: '请输入 6 位色值，如 #4A7AFF', icon: 'none' })
      this.setData({ hex, hexInput: hex, previewText: contrastText(hex) })
    },

    onClear() {
      this.triggerEvent('confirm', { hex: '' })
      this.close()
    },

    onConfirm() {
      const hex = this.data.hex
      if (!hex) return wx.showToast({ title: '请先选择颜色或输入色值', icon: 'none' })
      this.triggerEvent('confirm', { hex })
      this.close()
    },

    close() { this.triggerEvent('close') },
    noop() {}
  }
})
