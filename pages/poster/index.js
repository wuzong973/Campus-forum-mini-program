const api = require('../../utils/api')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    postId: 0,
    post: null,
    posterTempPath: '',
    generating: true,
    // P12：详情/素材/绘制任一环节失败都要落到可见的错误态，
    // 否则 generating 永远为 true，页面卡在「海报生成中」且无重试入口
    loadError: '',
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
    // P12：详情请求失败（网络/服务异常）以前没有 catch，页面会一直停在生成中状态
    this.setData({ generating: true, loadError: '' })
    return api.getPostDetail(postId).then((post) => {
      if (!post) {
        this.setData({ generating: false, loadError: '帖子不存在或已被删除' })
        wx.showToast({ title: '帖子不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }
      this.setData({ post })
      // 先把海报需要的图片全部落地成本地路径，再绘制
      return this.prepareAssets(post).then(() => this.generatePoster(post))
    }).catch((error) => {
      console.warn('[poster] 加载失败:', error && error.message)
      this.fail('海报生成失败，请重试')
    })
  },

  // 统一的失败出口：收起 loading、给出错误态（WXML 里带重试按钮）
  fail(message) {
    this.setData({ generating: false, loadError: message })
    wx.showToast({ title: message, icon: 'none' })
  },

  retry() {
    if (!this.data.postId) return
    this.loadPost(this.data.postId)
  },

  // canvas 2d 的 drawImage 不能直接画网络图片：远程图片必须先下载为本地临时文件
  // （域名需在 downloadFile 合法域名内，本项目图片/头像都在 https://payun01.cn）。
  // 另外项目内置头像（/assets/avatar2/xxx.jpg）是包内路径，canvas 也画不了，
  // 需要读成 base64 dataURL 再绘制。
  downloadImage(url) {
    if (!url) return Promise.resolve('')
    if (/^https?:\/\//i.test(url)) {
      return new Promise((resolve) => {
        wx.downloadFile({
          url,
          success: (res) => resolve(res.statusCode === 200 ? res.tempFilePath : ''),
          fail: () => resolve(''),
        })
      })
    }
    // 已是本地临时文件（downloadFile 结果 / 用户上传的临时路径）直接可用
    if (/^(wxfile:|http:\/\/tmp\/|\/tmp\/|\/var\/)/i.test(url)) return Promise.resolve(url)
    // 包内资源：读成 base64
    return new Promise((resolve) => {
      wx.getFileSystemManager().readFile({
        filePath: url,
        encoding: 'base64',
        success: (res) => {
          const ext = (url.split('.').pop() || 'png').toLowerCase()
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/' + ext
          resolve('data:' + mime + ';base64,' + res.data)
        },
        fail: () => resolve(''),
      })
    })
  },

  // 帖子媒体历史结构兼容：'url' / { url } / { path } / { thumb }，并识别视频
  // （发布时视频也存进 images 列，带 type:'video' 标记；canvas 无法绘制视频帧，
  //   没有封面图时按「视频卡片」绘制）
  mediaOf(item) {
    if (!item) return null
    if (typeof item === 'string') {
      return { url: item, cover: '', isVideo: /\.(mp4|mov|m4v|avi|webm)(\?|$)/i.test(item) }
    }
    const url = item.url || item.path || ''
    const cover = item.cover || item.thumb || item.poster || ''
    const isVideo = item.type === 'video' || /\.(mp4|mov|m4v|avi|webm)(\?|$)/i.test(url)
    return { url, cover, isVideo }
  },

  prepareAssets(post) {
    const tasks = []

    this._avatarPath = ''
    tasks.push(
      this.downloadImage(post.avatarUrl).then((path) => { this._avatarPath = path })
    )

    this._media = (post.images || [])
      .map((item) => this.mediaOf(item))
      .filter((m) => m && (m.url || m.cover))
      .slice(0, 3)
    this._mediaPaths = new Array(this._media.length).fill('')
    this._media.forEach((media, index) => {
      // 视频优先用封面图；没有封面就不下载（绘制端画视频卡片）
      const src = media.isVideo ? media.cover : media.url
      if (!src) return
      tasks.push(
        this.downloadImage(src).then((path) => { this._mediaPaths[index] = path })
      )
    })

    // 小程序码占位图：项目内图片读成 base64，canvas 可直接使用
    tasks.push(new Promise((resolve) => {
      wx.getFileSystemManager().readFile({
        filePath: '/assets/icons/qrcode-placeholder.jpg',
        encoding: 'base64',
        success: (res) => {
          this._qrTempPath = 'data:image/jpeg;base64,' + res.data
          resolve()
        },
        fail: () => {
          this._qrTempPath = null
          resolve()
        },
      })
    }))

    return Promise.all(tasks)
  },

  // 预加载成 canvas 可绘制对象；失败返回 null，由绘制端降级为占位样式
  loadCanvasImage(canvas, src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null)
      try {
        const img = canvas.createImage()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = src
      } catch (e) {
        resolve(null)
      }
    })
  },

  generatePoster(post) {
    const query = wx.createSelectorQuery()
    query.select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          // P12：canvas 节点没就绪（低版本基础库/页面已卸载）同样走错误态
          this.fail('海报生成失败，请重试')
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

        // 先把头像/配图预加载好，再一次性绘制，避免出现「图片还没加载完就导出」
        const mediaPaths = this._mediaPaths || []
        const imageTasks = [this.loadCanvasImage(canvas, this._avatarPath)]
          .concat(mediaPaths.map((path) => this.loadCanvasImage(canvas, path)))
          .concat([this.loadCanvasImage(canvas, this._qrTempPath)])

        Promise.all(imageTasks).then((images) => {
          const avatarImg = images[0]
          const mediaImgs = images.slice(1, 1 + mediaPaths.length)
          const qrImg = images[images.length - 1]
          this.drawPoster(ctx, canvas, post, W, H, { avatarImg, mediaImgs, qrImg })
        }).catch((error) => {
          // P12：绘制过程（字体度量/像素比异常）抛错同样收进错误态，不停留在「生成中」
          console.warn('[poster] 绘制失败:', error && error.message)
          this.fail('海报生成失败，请重试')
        })
      })
  },

  drawPoster(ctx, canvas, post, W, H, assets) {
    // === 蓝色背景 ===
    ctx.fillStyle = '#3B82F6'
    ctx.fillRect(0, 0, W, H)

    // === 白色卡片 ===
    const pad = 16
    const cardX = pad
    const cardY = 24
    const cardW = W - pad * 2
    const radius = 16
    const ip = 18
    const cx = cardX + ip
    const cw = cardW - ip * 2
    const qrSize = 64

    // 先量算内容高度，让卡片高度自适应（内容短时不留大片空白）
    const titleText = String(post.title || '').trim()
    const contentText = String(post.content || '').trim()
    const mediaList = this._media || []
    const maxLineCount = mediaList.length ? 4 : 7
    ctx.font = 'bold 16px sans-serif'
    const measureTitleLines = titleText ? this.wrapText(ctx, titleText, cw).slice(0, 2) : []
    ctx.font = '15px sans-serif'
    const measureContentLines = contentText ? this.wrapText(ctx, contentText, cw).slice(0, maxLineCount) : []
    const bodyH =
      18 + 36 + 14 +
      (measureTitleLines.length ? measureTitleLines.length * 23 + 6 : 0) +
      (measureContentLines.length ? measureContentLines.length * 22 + 10 : 0) +
      (mediaList.length ? 72 + 12 : 0)
    const cardH = Math.max(300, Math.min(H - 72, bodyH + 12 + qrSize + 16))

    this.roundRect(ctx, cardX, cardY, cardW, cardH, radius)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()

    let y = cardY + 18

    // --- 头像 + 昵称 + 时间 ---
    const avatarSize = 36
    const avatarCx = cx + avatarSize / 2
    const avatarCy = y + avatarSize / 2
    if (assets.avatarImg) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(avatarCx, avatarCy, avatarSize / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(assets.avatarImg, cx, y, avatarSize, avatarSize)
      ctx.restore()
    } else {
      // 头像缺失/加载失败：灰底 + 昵称首字，避免出现空白圆
      ctx.beginPath()
      ctx.arc(avatarCx, avatarCy, avatarSize / 2, 0, Math.PI * 2)
      ctx.fillStyle = '#E5E7EB'
      ctx.fill()
      const initial = String(post.nickName || '校').slice(0, 1)
      ctx.fillStyle = '#9CA3AF'
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(initial, avatarCx, avatarCy + 1)
    }

    const nick = post.nickName || '校园同学'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1F2937'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText(nick, cx + avatarSize + 8, y + avatarSize / 2 - 7)

    const timeText = format.formatRelativeTime(post.createdAt) || '刚刚'
    ctx.fillStyle = '#9CA3AF'
    ctx.font = '11px sans-serif'
    ctx.fillText(timeText, cx + avatarSize + 8, y + avatarSize / 2 + 9)

    y += avatarSize + 14

    // --- 标题（原帖标题也要出现在海报里）---
    const title = String(post.title || '').trim()
    if (title) {
      ctx.fillStyle = '#111827'
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      const titleLines = this.wrapText(ctx, title, cw).slice(0, 2)
      titleLines.forEach((line, i) => ctx.fillText(line, cx, y + i * 23))
      y += titleLines.length * 23 + 6
    }

    // --- 帖子媒体（图片直出；视频画封面，没封面画视频卡片）---
    const media = this._media || []
    const hasMedia = media.length > 0
    const content = String(post.content || '').trim()
    const maxLines = hasMedia ? 4 : 7
    ctx.fillStyle = '#1F2937'
    ctx.font = '15px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    if (content) {
      const lines = this.wrapText(ctx, content, cw)
      const shown = lines.slice(0, maxLines)
      shown.forEach((line, i) => ctx.fillText(line, cx, y + i * 22))
      if (lines.length > maxLines) {
        const last = shown[shown.length - 1]
        ctx.fillStyle = '#9CA3AF'
        ctx.fillText('…', cx + ctx.measureText(last).width, y + (shown.length - 1) * 22)
      }
      y += shown.length * 22 + 10
    }

    // --- 媒体缩略图（真实图片圆角裁剪；视频画封面或视频卡片）---
    if (hasMedia) {
      const ts = 72
      const tg = 8
      for (let i = 0; i < media.length; i++) {
        const tx = cx + i * (ts + tg)
        const item = media[i]
        const img = assets.mediaImgs[i]
        if (img) {
          ctx.save()
          this.roundRect(ctx, tx, y, ts, ts, 6)
          ctx.clip()
          ctx.drawImage(img, tx, y, ts, ts)
          ctx.restore()
        } else if (item.isVideo) {
          // 视频：canvas 无法绘制视频帧，画一个带播放标识的视频卡片
          this.roundRect(ctx, tx, y, ts, ts, 6)
          ctx.fillStyle = '#111827'
          ctx.fill()
          ctx.beginPath()
          ctx.arc(tx + ts / 2, y + ts / 2 - 6, 13, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.92)'
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(tx + ts / 2 - 4, y + ts / 2 - 12)
          ctx.lineTo(tx + ts / 2 + 7, y + ts / 2 - 6)
          ctx.lineTo(tx + ts / 2 - 4, y + ts / 2)
          ctx.closePath()
          ctx.fillStyle = '#111827'
          ctx.fill()
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.font = '11px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('视频', tx + ts / 2, y + ts - 14)
          ctx.textAlign = 'left'
        } else {
          this.roundRect(ctx, tx, y, ts, ts, 6)
          ctx.fillStyle = '#F3F4F6'
          ctx.fill()
        }
        // 视频有封面时补一个播放角标
        if (item.isVideo && img) {
          ctx.beginPath()
          ctx.arc(tx + ts / 2, y + ts / 2, 13, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(17,24,39,0.55)'
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(tx + ts / 2 - 4, y + ts / 2 - 6)
          ctx.lineTo(tx + ts / 2 + 7, y + ts / 2)
          ctx.lineTo(tx + ts / 2 - 4, y + ts / 2 + 6)
          ctx.closePath()
          ctx.fillStyle = '#FFFFFF'
          ctx.fill()
        }
      }
      if (media.length >= 3 && (post.images || []).length > 3) {
        ctx.fillStyle = '#9CA3AF'
        ctx.font = '11px sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('+' + ((post.images || []).length - 3), cx + 3 * (ts + tg) + 2, y + ts / 2)
      }
      y += ts + 12
    }

    // --- 小程序码区域（贴卡片底部，避免正文短时中间留大片空白）---
    const qrX = cx
    const brandY = cardY + cardH - 12
    // 贴卡片底部，同时保证不与上方正文/配图重叠
    const qrY = Math.max(y + 16, brandY - 26 - qrSize)
    const dividerY = qrY - 12

    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = '#D1D5DB'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, dividerY)
    ctx.lineTo(cx + cw, dividerY)
    ctx.stroke()
    ctx.restore()

    if (assets.qrImg) {
      this.roundRect(ctx, qrX, qrY, qrSize, qrSize, 6)
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.drawImage(assets.qrImg, qrX + 2, qrY + 2, qrSize - 4, qrSize - 4)
    } else {
      this.drawQrPlaceholder(ctx, qrX, qrY, qrSize)
    }
    this.drawQrText(ctx, qrX, qrY, qrSize, cw, cx)

    // --- 底部品牌文字（画在卡片下方的蓝底上；原先画在卡片内且为白色，实际不可见）---
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText('在校论坛@帕云校园', W / 2, cardY + cardH + 22)

    setTimeout(() => this.exportCanvas(canvas, W, H, this._dpr), 120)
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
    ctx.fillText(line1, qrTextX, qrY + 14)
    ctx.fillText(line2, qrTextX, qrY + 34)
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
        // P12：导出临时图片失败也要给出可重试的错误态
        this.fail('海报生成失败，请重试')
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
