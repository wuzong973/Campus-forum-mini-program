const api = require('../../utils/api')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    postId: 0,
    post: null,
    posterTempPath: '',
    generating: true,
    canvasWidth: 0,
    canvasHeight: 0,
  },

  onLoad(options) {
    const postId = parseInt(options.postId, 10)
    if (!postId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    const sysInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const dpr = sysInfo.pixelRatio || 2
    const canvasWidth = Math.floor(sysInfo.windowWidth * 0.88)
    const canvasHeight = Math.floor(canvasWidth * 1.45)
    this.setData({ postId, canvasWidth, canvasHeight })
    this._dpr = dpr
    this.loadPost(postId)
  },

  loadPost(postId) {
    return api.getPostDetail(postId).then((post) => {
      if (post) {
        this.setData({ post })
        // 用 readFile 读取项目内图片为 base64，canvas 可直接使用
        const fs = wx.getFileSystemManager()
        fs.readFile({
          filePath: '/assets/icons/qrcode-placeholder.jpg',
          encoding: 'base64',
          success: (res) => {
            this._qrTempPath = 'data:image/jpeg;base64,' + res.data
            console.log('QR image loaded as base64, length:', res.data.length)
            this.generatePoster(post)
          },
          fail: (err) => {
            console.error('QR readFile failed:', JSON.stringify(err))
            this._qrTempPath = null
            this.generatePoster(post)
          }
        })
      } else {
        wx.showToast({ title: '帖子不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    })
  },

  generatePoster(post) {
    const query = wx.createSelectorQuery()
    query.select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          this.setData({ generating: false })
          wx.showToast({ title: '海报生成失败', icon: 'none' })
          return
        }
        const canvas = res[0].node
        const dpr = this._dpr
        const W = this.data.canvasWidth
        const H = this.data.canvasHeight
        canvas.width = W * dpr
        canvas.height = H * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)

        // === 蓝色背景 ===
        ctx.fillStyle = '#3B82F6'
        ctx.fillRect(0, 0, W, H)

        // === 白色卡片 ===
        const pad = 16
        const cardX = pad
        const cardY = 24
        const cardW = W - pad * 2
        const cardH = H - 72
        const radius = 16

        this.roundRect(ctx, cardX, cardY, cardW, cardH, radius)
        ctx.fillStyle = '#FFFFFF'
        ctx.fill()

        // 内容区域
        const ip = 18
        const cx = cardX + ip
        const cw = cardW - ip * 2
        let y = cardY + 18

        // --- 头像 + 昵称 + 时间 ---
        const avatarSize = 36
        ctx.beginPath()
        ctx.arc(cx + avatarSize / 2, y + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
        ctx.fillStyle = '#E5E7EB'
        ctx.fill()

        const nick = post.nickName || '校园同学'
        ctx.fillStyle = '#1F2937'
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(nick, cx + avatarSize + 8, y + avatarSize / 2 - 7)

        const timeText = format.formatRelativeTime(post.createdAt) || '刚刚'
        ctx.fillStyle = '#9CA3AF'
        ctx.font = '11px sans-serif'
        ctx.fillText(timeText, cx + avatarSize + 8, y + avatarSize / 2 + 9)

        y += avatarSize + 14

        // --- 帖子内容 ---
        ctx.fillStyle = '#1F2937'
        ctx.font = '15px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        const content = post.content || ''
        const lines = this.wrapText(ctx, content, cw)
        const maxLines = 5
        for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
          ctx.fillText(lines[i], cx, y + i * 22)
        }
        if (lines.length > maxLines) {
          ctx.fillStyle = '#9CA3AF'
          ctx.fillText('...', cx, y + maxLines * 22)
        }
        y += Math.min(lines.length, maxLines) * 22 + 12

        // --- 图片缩略图 ---
        if (post.images && post.images.length > 0) {
          const ts = 48
          const tg = 6
          const maxT = 3
          for (let i = 0; i < Math.min(post.images.length, maxT); i++) {
            const tx = cx + i * (ts + tg)
            this.roundRect(ctx, tx, y, ts, ts, 4)
            ctx.fillStyle = '#F3F4F6'
            ctx.fill()
          }
          if (post.images.length > 3) {
            ctx.fillStyle = '#9CA3AF'
            ctx.font = '10px sans-serif'
            ctx.fillText('+' + (post.images.length - 3), cx + 3 * (ts + tg), y + ts / 2 - 4)
          }
          y += ts + 12
        }

        // --- 虚线分隔 ---
        ctx.save()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = '#D1D5DB'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, y)
        ctx.lineTo(cx + cw, y)
        ctx.stroke()
        ctx.restore()

        y += 14

        // --- 小程序码区域 ---
        const qrSize = 64
        const qrX = cx
        const qrY = y

        if (this._qrTempPath) {
          console.log('Drawing QR code, path:', this._qrTempPath)
          const qrImage = canvas.createImage()
          qrImage.onload = () => {
            console.log('QR image loaded, size:', qrImage.width, 'x', qrImage.height)
            this.roundRect(ctx, qrX, qrY, qrSize, qrSize, 6)
            ctx.fillStyle = '#FFFFFF'
            ctx.fill()
            ctx.drawImage(qrImage, qrX + 2, qrY + 2, qrSize - 4, qrSize - 4)
            this.drawQrText(ctx, qrX, qrY, qrSize, cw, cx)
            setTimeout(() => this.exportCanvas(canvas, W, H, dpr), 100)
          }
          qrImage.onerror = (e) => {
            console.error('QR image draw failed:', e, 'path:', this._qrTempPath)
            this.drawQrPlaceholder(ctx, qrX, qrY, qrSize)
            this.drawQrText(ctx, qrX, qrY, qrSize, cw, cx)
            setTimeout(() => this.exportCanvas(canvas, W, H, dpr), 100)
          }
          qrImage.src = this._qrTempPath
        } else {
          this.drawQrPlaceholder(ctx, qrX, qrY, qrSize)
          this.drawQrText(ctx, qrX, qrY, qrSize, cw, cx)
          setTimeout(() => this.exportCanvas(canvas, W, H, dpr), 100)
        }

        // --- 底部品牌文字 ---
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = '#FFFFFF'
        ctx.font = 'bold 12px sans-serif'
        ctx.fillText('在校论坛@帕云校园', W / 2, cardY + cardH - 10)
      })
  },

  drawQrText(ctx, qrX, qrY, qrSize, cw, cx) {
    const qrTextMaxW = cw - qrSize - 10
    const qrTextX = qrX + qrSize + 10
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#374151'
    ctx.font = '12px sans-serif'
    const line1 = this.truncateText(ctx, '长按识别扫码  查看完整帖子', qrTextMaxW)
    const line2 = this.truncateText(ctx, '参与帖子互动  自助发布投稿', qrTextMaxW)
    ctx.fillText(line1, qrTextX, qrY + 4)
    ctx.fillText(line2, qrTextX, qrY + 22)
  },

  drawQrPlaceholder(ctx, qrX, qrY, qrSize) {
    this.roundRect(ctx, qrX, qrY, qrSize, qrSize, 6)
    ctx.fillStyle = '#F9FAFB'
    ctx.fill()
    ctx.strokeStyle = '#E5E7EB'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#9CA3AF'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('小程序码', qrX + qrSize / 2, qrY + qrSize / 2)
  },

  exportCanvas(canvas, W, H, dpr) {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: W,
      height: H,
      destWidth: W * dpr,
      destHeight: H * dpr,
      quality: 1,
      success: (res) => {
        this.setData({ posterTempPath: res.tempFilePath, generating: false })
      },
      fail: () => {
        this.setData({ generating: false })
        wx.showToast({ title: '海报生成失败', icon: 'none' })
      },
    })
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  },

  wrapText(ctx, text, maxWidth) {
    const lines = []
    let currentLine = ''
    for (let i = 0; i < text.length; i++) {
      const testLine = currentLine + text[i]
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = text[i]
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)
    return lines.length ? lines : ['']
  },

  truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text
    let result = ''
    for (let i = 0; i < text.length; i++) {
      const test = result + text[i]
      if (ctx.measureText(test).width > maxWidth) break
      result = test
    }
    return result + '...'
  },

  onSaveToAlbum() {
    if (!this.data.posterTempPath) return
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterTempPath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            },
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
    })
  },

  onBack() {
    wx.navigateBack()
  },

  onShareAppMessage() {
    const post = this.data.post
    return {
      title: post ? (post.title || post.content || '校园帖子分享') : '校园帖子分享',
      path: '/pages/post-detail/index?id=' + this.data.postId,
    }
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadPost(this.data.postId))
  }
})
