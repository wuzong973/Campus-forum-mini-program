Component({
  properties: {
    visible: { type: Boolean, value: false },
    latestVersion: { type: String, value: '' },
    localVersion: { type: String, value: '' },
    updating: { type: Boolean, value: false }
  },
  methods: {
    onConfirm() { if (!this.data.updating) this.triggerEvent('confirm') },
    onCancel() { if (!this.data.updating) this.triggerEvent('cancel') },
    stopPropagation() {}
  }
})
