Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onAgree() {
      this.triggerEvent('agree')
    },

    onReject() {
      this.triggerEvent('reject')
    },

    onViewAgreement(e) {
      const type = e.currentTarget.dataset.type
      this.triggerEvent('viewagreement', { type })
    }
  }
})
