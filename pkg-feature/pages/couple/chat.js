const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const messageStore = require('../../../utils/messageStore')
const wechat = require('../../../utils/wechat')
const image = require('../../../utils/image')
const subscribe = require('../../../utils/subscribe')
const couple = require('../../utils/couple')

const FALLBACK_AVATAR = '/assets/icons/avatar.png'

Page({
  data: {
    loading: true,
    matchId: 0,
    match: null,
    peerId: 0,
    personaKey: '',
    partnerName: '',
    meAvatar: FALLBACK_AVATAR,
    partnerAvatar: FALLBACK_AVATAR,
    mePhoto: '',
    partnerPhoto: '',
    messages: [],
    inputValue: '',
    activePanel: '',
    voiceMode: false,
    recording: false,
    videoSending: false,
    playingId: 0,
    emojiList: [
      '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆',
      '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗',
      '😙', '😚', '🙂', '🤗', '🤩', '🤨', '😐', '😑',
      '😶', '😏', '😣', '😮', '🤐', '😯', '😪', '😫',
      '🥱', '😴', '😛', '😜', '😝', '🤤', '😒', '😓',
      '😔', '😕', '🙃', '🤑', '😲', '☹️', '🙁', '😖'
    ],
    readonly: false,
    sending: false,
    imageSending: false,
    recalling: false,
    scrollIntoView: ''
  },

  onLoad(options) {
    this.setData({ matchId: Number(options && options.matchId) || 0 })
    this.load()
  },

  onUnload() {
    if (this._offMessage) this._offMessage()
    if (this.data.recording && this.recorder) {
      this.voiceCancelled = true
      try { this.recorder.stop() } catch (e) {}
    }
    this.stopVoice()
  },

  async load() {
    const allowed = await auth.requireFeatureAccess('一周CP', { autoBack: true })
    if (!allowed) return
    try {
      let matchId = this.data.matchId
      if (!matchId) {
        const state = await api.getCoupleCurrent()
        matchId = state.currentMatch && state.currentMatch.id
      }
      if (!matchId) {
        this.setData({ loading: false, match: null })
        return
      }
      const match = await api.getCoupleMatch(matchId)
      const peerId = Number(match.chatPeerId)
      const personaKey = match.personaKey
      const readonly = match.status !== 'active'
      this.setData({
        loading: false,
        matchId,
        match,
        peerId,
        personaKey,
        partnerName: match.partner.nickName,
        meAvatar: match.me.avatarUrl || FALLBACK_AVATAR,
        partnerAvatar: match.partner.avatarUrl || FALLBACK_AVATAR,
        mePhoto: match.me.photoUrl || '',
        partnerPhoto: match.partner.photoUrl || '',
        readonly
      })
      wx.setNavigationBarTitle({ title: match.partner.nickName || '聊天' })
      messageStore.connect()
      this._offMessage = messageStore.onMessage((payload) => this.onIncoming(payload))
      await this.loadHistory()
      if (!readonly) messageStore.markRead(peerId, personaKey).catch(() => {})
    } catch (e) {
      this.setData({ loading: false, match: null })
    }
  },

  async loadHistory() {
    const peerId = this.data.peerId
    const personaKey = this.data.personaKey
    if (!peerId || !personaKey) return
    try {
      const result = await messageStore.getHistory(peerId, 1, 50, false, null, 'peer', personaKey, 0)
      const messages = (result.list || []).map((message) => this.decorate(message))
      this.setData({ messages }, () => this.scrollBottom())
    } catch (e) {
      this.setData({ messages: [] })
    }
  },

  decorate(message) {
    const mine = Number(message.senderId) !== Number(this.data.peerId)
    const type = message.msgType || 'text'
    let voiceUrl = ''
    let voiceDuration = 0
    if (type === 'voice') {
      try {
        const voice = JSON.parse(message.content || '{}')
        voiceUrl = voice.url || ''
        voiceDuration = Math.max(1, Math.round((Number(voice.duration) || 0) / 1000))
      } catch (e) {
        voiceUrl = message.content || ''
        voiceDuration = 1
      }
    }
    return {
      id: message.id,
      mine,
      type,
      text: type === 'text' ? (message.content || '') : '',
      content: message.content || '',
      voiceUrl,
      voiceDuration,
      time: couple.formatClock(message.createdAt),
      avatar: mine
        ? (this.data.mePhoto || this.data.meAvatar)
        : (this.data.partnerPhoto || this.data.partnerAvatar)
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  requestMessageSubscribe() {
    if (typeof subscribe.requestTriggerByTap !== 'function') return Promise.resolve()
    return subscribe.requestTriggerByTap('message').then((res) => {
      if (res && res.rejected && res.rejected.indexOf('message') > -1 && typeof subscribe.guideReopen === 'function') {
        subscribe.guideReopen(['message'], '私信通知', { throttleKey: 'subscribe_reopen_guide_chat' })
      }
    }).catch(() => {})
  },

  onInputFocus() {
    this.setData({ activePanel: '' })
  },

  onToggleEmoji() {
    if (this.data.recording) return
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.setData({
      voiceMode: false,
      activePanel: this.data.activePanel === 'emoji' ? '' : 'emoji'
    })
  },

  onToggleTools() {
    if (this.data.recording) return
    if (this.data.activePanel !== 'tools') this.requestMessageSubscribe()
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.setData({
      voiceMode: false,
      activePanel: this.data.activePanel === 'tools' ? '' : 'tools'
    })
  },

  onToggleVoice() {
    if (this.data.readonly || this.data.recording) return
    if (!this.data.voiceMode) this.requestMessageSubscribe()
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.setData({
      voiceMode: !this.data.voiceMode,
      activePanel: ''
    })
  },

  initRecorder() {
    if (this.recorder) return this.recorder
    const recorder = wx.getRecorderManager()
    recorder.onStop((res) => this.handleVoiceStop(res))
    recorder.onError(() => {
      this.recordingStarted = false
      this.setData({ recording: false })
      wx.showToast({ title: '录音失败，请重试', icon: 'none' })
    })
    this.recorder = recorder
    return recorder
  },

  onVoiceStart() {
    if (this.data.readonly || this.data.recording) return
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.voiceCancelled = false
    this.voiceHolding = true
    this.recordingStarted = false
    this.voiceStartAt = Date.now()
    this.setData({ recording: true, activePanel: '' })
    wechat.ensurePrivacyAuthorize().then((allowed) => {
      if (!allowed) {
        this.voiceHolding = false
        this.setData({ recording: false })
        wx.showToast({ title: '请先同意隐私保护指引', icon: 'none' })
        return
      }
      if (!this.voiceHolding) return
      wx.authorize({
        scope: 'scope.record',
        success: () => {
          if (!this.voiceHolding) return
          try {
            this.initRecorder().start({
              duration: 60000,
              format: 'mp3',
              sampleRate: 16000,
              numberOfChannels: 1,
              encodeBitRate: 48000
            })
            this.recordingStarted = true
          } catch (e) {
            this.voiceHolding = false
            this.setData({ recording: false })
            wx.showToast({ title: '录音启动失败，请重试', icon: 'none' })
          }
        },
        fail: () => {
          this.voiceHolding = false
          this.setData({ recording: false })
          wx.showModal({
            title: '需要麦克风权限',
            content: '语音聊天需要使用麦克风，请在设置中开启录音权限。',
            confirmText: '去设置',
            success: (res) => { if (res.confirm && wx.openSetting) wx.openSetting() }
          })
        }
      })
    })
  },

  onVoiceEnd() {
    this.voiceHolding = false
    if (!this.recordingStarted) {
      this.setData({ recording: false })
      return
    }
    this.setData({ recording: false })
    try { this.recorder.stop() } catch (e) {}
  },

  onVoiceCancel() {
    this.voiceCancelled = true
    this.voiceHolding = false
    if (this.recordingStarted) {
      this.setData({ recording: false })
      try { this.recorder.stop() } catch (e) {}
    } else {
      this.setData({ recording: false })
    }
  },

  async handleVoiceStop(res) {
    this.recordingStarted = false
    this.setData({ recording: false })
    if (this.voiceCancelled) {
      this.voiceCancelled = false
      return
    }
    const filePath = res && res.tempFilePath
    const duration = Number(res && res.duration) || (Date.now() - (this.voiceStartAt || Date.now()))
    if (!filePath) return
    if (duration < 1000) {
      wx.showToast({ title: '录音时间太短', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    wx.showLoading({ title: '发送语音...', mask: true })
    try {
      const url = await wechat.uploadAudio(filePath)
      if (!/^https?:\/\//.test(url)) throw new Error('语音上传失败')
      await this.sendContent(JSON.stringify({ url, duration }), 'voice')
      wx.hideLoading()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '语音发送失败，请重试', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },

  playVoice(e) {
    const id = Number(e.currentTarget.dataset.id)
    const url = e.currentTarget.dataset.url
    if (!id || !url) return
    if (this.data.playingId === id) {
      this.stopVoice()
      return
    }
    this.stopVoice()
    const audio = wx.createInnerAudioContext()
    audio.src = url
    audio.onEnded(() => {
      this.setData({ playingId: 0 })
      this.audio = null
      try { audio.destroy() } catch (e) {}
    })
    audio.onError(() => {
      this.setData({ playingId: 0 })
      this.audio = null
      try { audio.destroy() } catch (e) {}
      wx.showToast({ title: '语音播放失败', icon: 'none' })
    })
    audio.play()
    this.audio = audio
    this.setData({ playingId: id })
  },

  stopVoice() {
    if (this.audio) {
      try { this.audio.stop() } catch (e) {}
      try { this.audio.destroy() } catch (e) {}
      this.audio = null
    }
    if (this.data.playingId) this.setData({ playingId: 0 })
  },

  onEmojiTap(e) {
    const emoji = e.currentTarget.dataset.emoji
    if (!emoji) return
    this.setData({ inputValue: (this.data.inputValue + emoji).slice(0, 200) })
  },

  async sendContent(content, msgType = 'text') {
    const result = await messageStore.sendMessage(
      this.data.peerId,
      content,
      msgType,
      false,
      null,
      this.data.personaKey,
      0
    )
    const message = this.decorate({
      id: result.id,
      senderId: result.senderId,
      content,
      msgType,
      createdAt: result.createdAt
    })
    this.setData({ messages: this.data.messages.concat(message) }, () => this.scrollBottom())
  },

  async send() {
    if (this.data.readonly) return wx.showToast({ title: '该配对已结束，仅可查看历史消息', icon: 'none' })
    if (this.data.sending || this.data.imageSending || this.data.videoSending || this.data.recording) return
    const text = String(this.data.inputValue || '').trim()
    if (!text) return wx.showToast({ title: '先写点什么', icon: 'none' })
    this.requestMessageSubscribe()
    this.setData({ sending: true })
    try {
      await this.sendContent(text, 'text')
      this.setData({ inputValue: '', activePanel: '', sending: false })
    } catch (e) {
      this.setData({ sending: false })
    }
  },

  onChooseImage() {
    if (this.data.readonly) return wx.showToast({ title: '该配对已结束，仅可查看历史消息', icon: 'none' })
    if (this.data.imageSending || this.data.videoSending) return
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const paths = (res.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean)
        if (!paths.length) return
        this.setData({ activePanel: '', imageSending: true })
        wx.showLoading({ title: '发送图片...', mask: true })
        try {
          const urls = await wechat.uploadImages(paths)
          for (const url of urls) {
            if (!/^https?:\/\//.test(url)) throw new Error('图片上传失败')
            await this.sendContent(url, 'image')
          }
        } catch (e) {
          wx.showToast({ title: e.message || '图片发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
          this.setData({ imageSending: false })
        }
      }
    })
  },

  onChooseVideo() {
    if (this.data.readonly) return wx.showToast({ title: '该配对已结束，仅可查看历史消息', icon: 'none' })
    if (this.data.imageSending || this.data.videoSending) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      success: async (res) => {
        const raw = (res.tempFiles || [])[0]
        if (!raw || !raw.tempFilePath) return
        const { valid } = image.splitOverlongVideos([raw])
        if (!valid.length) {
          wx.showToast({ title: '视频不能超过1分钟，请重新选择', icon: 'none' })
          return
        }
        this.setData({ activePanel: '', videoSending: true })
        wx.showLoading({ title: '发送视频...', mask: true })
        try {
          const url = await wechat.uploadVideo(raw.tempFilePath)
          if (!/^https?:\/\//.test(url)) throw new Error('视频上传失败')
          await this.sendContent(url, 'video')
        } catch (e) {
          wx.showToast({ title: e.message || '视频发送失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
          this.setData({ videoSending: false })
        }
      }
    })
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = this.data.messages.filter((item) => item.type === 'image').map((item) => item.content).filter(Boolean)
    if (!current || !urls.length) return
    wx.previewImage({ current, urls })
  },

  onRecallMessage(e) {
    if (this.data.readonly) return wx.showToast({ title: '配对已结束，无法撤回', icon: 'none' })
    if (this.data.recalling) return
    const id = Number(e.currentTarget.dataset.id)
    const message = this.data.messages.find((item) => Number(item.id) === id)
    if (!message || !message.mine) return
    wx.showModal({
      title: '撤回消息',
      content: '撤回后对方将无法看到该消息。',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ recalling: true })
        messageStore.recallMessage(this.data.peerId, id, this.data.personaKey).then(() => {
          this.removeMessage(id)
          wx.showToast({ title: '消息已撤回', icon: 'success' })
        }).catch((err) => {
          this.setData({ recalling: false })
          wx.showToast({ title: err.message || '撤回失败', icon: 'none' })
        })
      }
    })
  },

  removeMessage(messageId) {
    if (!messageId) return
    this.setData({
      messages: this.data.messages.filter((item) => Number(item.id) !== Number(messageId)),
      recalling: false
    })
  },

  onIncoming(payload) {
    if (!payload) return
    if (Number(payload.peerId) !== Number(this.data.peerId)) return
    if (String(payload.personaKey || '') !== String(this.data.personaKey)) return
    if (payload.type === 'message_recalled') {
      this.removeMessage(payload.data && payload.data.id)
      return
    }
    if (payload.type !== 'message') return
    const message = this.decorate(payload.data || {})
    if (this.data.messages.some((item) => String(item.id) === String(message.id))) return
    this.setData({ messages: this.data.messages.concat(message) }, () => this.scrollBottom())
    if (!this.data.readonly) messageStore.markRead(this.data.peerId, this.data.personaKey).catch(() => {})
  },

  scrollBottom() {
    this.setData({ scrollIntoView: '' })
    wx.nextTick(() => this.setData({ scrollIntoView: 'chat-bottom' }))
  },

  noop() {}
})
