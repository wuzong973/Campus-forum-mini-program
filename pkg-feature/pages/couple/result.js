const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const motion = require('../../../utils/motion')
const couple = require('../../utils/couple')

const FALLBACK_AVATAR = '/assets/icons/avatar.png'

Page({
  data: {
    loading: true,
    matchId: 0,
    match: null,
    windowRemain: '00:00:00',
    showRematch: false,
    rematching: false,
    modalClosing: false,
    fallbackAvatar: FALLBACK_AVATAR,
    scoreText: '',
    rematchLabel: '重新匹配',
    fxOff: false,
    motionOn: false,
    scoreShown: 0
  },

  onLoad(options) {
    const matchId = Number(options && options.matchId) || 0
    this.revealed = false
    this.setData({ matchId, fxOff: motion.isCardFxOff() })
    this.load()
  },

  onShow() {
    if (this.data.match) this.load({ silent: true })
  },

  onHide() {
    this.stopTimer()
    this.stopScoreTimer()
  },

  onUnload() {
    this.stopTimer()
    this.stopScoreTimer()
    this.clearCloseTimer()
  },

  onPullDownRefresh() {
    this.load({ silent: true }).finally(() => wx.stopPullDownRefresh())
  },

  async load(options) {
    const silent = !!(options && options.silent)
    const allowed = await auth.requireFeatureAccess('一周CP', { autoBack: true })
    if (!allowed) return
    if (!silent) this.setData({ loading: true })
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
      const rematchLabel = match.status !== 'active'
        ? '已结束'
        : (match.canRematch ? '重新匹配' : (match.window && match.window.status === 'ended' ? '本轮已结束' : '已达上限'))
      const score = Math.max(0, Math.min(100, Number(match.score) || 0))
      const firstReveal = !this.revealed
      const patch = {
        loading: false,
        matchId,
        match,
        rematchLabel,
        scoreText: match.commonTags.length
          ? '共同兴趣 ' + match.commonTags.length + ' 个'
          : (match.partner.campus === match.me.campus ? '同校区' : '本轮新匹配')
      }
      if (firstReveal) {
        this.revealed = true
        patch.motionOn = !this.data.fxOff
        patch.scoreShown = this.data.fxOff ? score : 0
      } else {
        patch.scoreShown = score
      }
      this.setData(patch)
      if (firstReveal && !this.data.fxOff) this.animateScore(score)
      if (firstReveal && match.status === 'active') this.playSuccessFeedback()
      this.startTimer()
    } catch (e) {
      if (!silent) this.setData({ loading: false, match: null })
    }
  },

  startTimer() {
    this.stopTimer()
    this.tick()
    this.timer = setInterval(() => this.tick(), 1000)
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  animateScore(target) {
    this.stopScoreTimer()
    this.scoreDelayTimer = setTimeout(() => {
      this.scoreDelayTimer = null
      const startedAt = Date.now()
      const duration = 560
      this.scoreTimer = setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / duration)
        const eased = 1 - Math.pow(1 - progress, 3)
        this.setData({ scoreShown: Math.round(target * eased) })
        if (progress >= 1) this.stopScoreTimer()
      }, 32)
    }, 380)
  },

  stopScoreTimer() {
    if (this.scoreDelayTimer) {
      clearTimeout(this.scoreDelayTimer)
      this.scoreDelayTimer = null
    }
    if (this.scoreTimer) {
      clearInterval(this.scoreTimer)
      this.scoreTimer = null
    }
  },

  playSuccessFeedback() {
    try {
      wx.vibrateShort({
        type: 'medium',
        fail: () => {
          try { wx.vibrateShort({}) } catch (e) {}
        }
      })
    } catch (e) {}
  },

  clearCloseTimer() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
  },

  tick() {
    const match = this.data.match
    if (!match) return
    this.setData({
      windowRemain: match.status === 'active' ? couple.formatRemain(match.windowEndAt) : '00:00:00'
    })
  },

  goChat() {
    const match = this.data.match
    if (!match) return
    wx.navigateTo({ url: '/pkg-feature/pages/couple/chat?matchId=' + match.id })
  },

  goHistory() {
    wx.navigateTo({ url: '/pkg-feature/pages/couple/history' })
  },

  openRematch() {
    const match = this.data.match
    if (!match || match.status !== 'active') return wx.showToast({ title: '该配对已结束', icon: 'none' })
    if (!match.canRematch) {
      const ended = match.window && match.window.status === 'ended'
      return wx.showToast({ title: ended ? '本轮匹配已结束' : '本轮已匹配 10 位，无法继续匹配', icon: 'none' })
    }
    this.clearCloseTimer()
    this.setData({ showRematch: true, modalClosing: false })
  },

  closeRematch() {
    if (this.data.rematching || this.data.modalClosing) return
    if (this.data.fxOff) return this.setData({ showRematch: false })
    this.setData({ modalClosing: true })
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null
      this.setData({ showRematch: false, modalClosing: false })
    }, 180)
  },

  async confirmRematch() {
    if (this.data.rematching) return
    const match = this.data.match
    if (!match) return
    this.setData({ rematching: true })
    try {
      await api.rematchCouple(match.id)
      this.clearCloseTimer()
      this.setData({ showRematch: false, rematching: false, modalClosing: false })
      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
      wx.showToast({ title: '已回到匹配池', icon: 'success' })
      setTimeout(() => {
        wx.redirectTo({ url: '/pkg-feature/pages/couple/index' })
      }, 600)
    } catch (e) {
      this.setData({ rematching: false })
    }
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url] })
  },

  noop() {}
})
