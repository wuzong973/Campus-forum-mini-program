Component({
  properties: {
    services: { type: Array, value: [] },
    columns: { type: Number, value: 5 },
    layout: { type: String, value: 'grid' }
  },
  methods: {
    onTap(e) {
      const item = e.currentTarget.dataset.item
      this.triggerEvent('tap', { item })
    },

    onScroll(e) {
      const detail = e.detail || {}
      this.triggerEvent('scroll', {
        scrollLeft: detail.scrollLeft || 0,
        scrollWidth: detail.scrollWidth || 0,
        clientWidth: detail.clientWidth || 0
      })
    }
  }
})
