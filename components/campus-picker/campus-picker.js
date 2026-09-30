const { CAMPUS_GROUPS } = require('../../utils/campus')

Component({
  properties: {
    // 是否显示选择面板
    visible: { type: Boolean, value: false },
    // 当前已选校区（'' = 全部校区）
    value: { type: String, value: '' },
    // 兼容旧用法（申请创建群聊等表单），现与普通模式一致：仅主校区直选
    simple: { type: Boolean, value: false },
    // 二级结构模式：一级主校区（广州/佛山）点击展开下属分校区，点击分校区完成选择。
    // 不显示「全部校区」——用于必须明确校区的场景（如校园评价）。
    twoLevel: { type: Boolean, value: false },
    // 仅主校区模式：只列广州校区/佛山校区两格直选，不展开分校区、无「全部校区」
    mainOnly: { type: Boolean, value: false }
  },

  data: {
    groups: CAMPUS_GROUPS,
    // 二级模式中当前展开的主校区
    expanded: ''
  },

  observers: {
    'visible, value'(visible) {
      if (!visible || !this.data.twoLevel) return
      // 打开面板 / 外部值变化时：已选主校区直接展开；已选分校区则展开其所属主校区
      this.setData({ expanded: this.expandGroupFor(this.data.value) })
    }
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent('close')
    },

    // 某校区值（主校区或分校区）应展开的主校区名；未匹配返回 ''
    expandGroupFor(value) {
      const target = String(value || '')
      const group = CAMPUS_GROUPS.find((item) => item.name === target || item.subs.indexOf(target) >= 0)
      return group ? group.name : ''
    },

    // 二级模式：点击一级主校区 → 选中并展开/收起其分校区列表（再点一次收起，选中保留）
    onGroupTap(e) {
      const name = e.currentTarget.dataset.name
      if (!name) return
      const expanded = this.data.expanded === name ? '' : name
      this.setData({ expanded, value: name })
      // 选中主校区即上报（用户可继续点分校区细化，每次选择都会再触发 change）
      this.triggerEvent('change', { value: name })
    },

    onPick(e) {
      // '' = 全部校区；仅保留主校区层级，点击即选中
      const value = e.currentTarget.dataset.value || ''
      this.triggerEvent('change', { value })
    }
  }
})
