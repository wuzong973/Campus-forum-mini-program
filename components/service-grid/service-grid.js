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
    }
  }
})
