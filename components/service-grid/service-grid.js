Component({
  properties: {
    services: { type: Array, value: [] },
    columns: { type: Number, value: 5 }
  },
  methods: {
    onTap(e) {
      const item = e.currentTarget.dataset.item
      this.triggerEvent('tap', { item })
    }
  }
})
