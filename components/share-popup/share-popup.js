Component({
  properties: {
    visible: { type: Boolean, value: false },
    postId: { type: Number, value: 0 },
    postTitle: { type: String, value: '' },
    postContent: { type: String, value: '' },
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.onClose();
    },

    onShareToFriend() {
      this.triggerEvent('shareToFriend', { postId: this.data.postId });
      this.onClose();
    },

    onSharePoster() {
      this.triggerEvent('sharePoster', { postId: this.data.postId });
      this.onClose();
    },
  },
});
