const { CAMPUS_GROUPS, getSubCampus } = require('../../utils/campus')

Component({
  properties: {
    // 是否显示选择面板
    visible: { type: Boolean, value: false },
    // 当前已选校区（'' = 全部校区）
    value: { type: String, value: '' },
    // 简单模式：仅主校区直选（无分校区二级），用于申请创建群聊等表单
    simple: { type: Boolean, value: false }
  },

  data: {
    groups: CAMPUS_GROUPS,
    level: 1,
    activeMain: '',
    subList: []
  },

  methods: {
    noop() {},

    onClose() {
      this.setData({ level: 1, activeMain: '', subList: [] })
      this.triggerEvent('close')
    },

    onBack() {
      this.setData({ level: 1, activeMain: '', subList: [] })
    },

    onPickAll() {
      this.setData({ level: 1, activeMain: '', subList: [] })
      this.triggerEvent('change', { value: '' })
    },

    onPickMain(e) {
      const name = e.currentTarget.dataset.value
      if (!name) return
      // 简单模式：直接选中主校区
      if (this.data.simple) {
        this.triggerEvent('change', { value: name })
        return
      }
      // 二级模式：展开该主校区的分校区（主校区本身保持已选，可继续细化）
      this.setData({ level: 2, activeMain: name, subList: getSubCampus(name) })
    },

    onPickSub(e) {
      const name = e.currentTarget.dataset.value
      if (!name) return
      this.setData({ level: 1, activeMain: '', subList: [] })
      this.triggerEvent('change', { value: name })
    }
  }
})
