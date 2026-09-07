const ICON_BASE = '/assets/icons/'

const ICONS = {
  wallet: ICON_BASE + 'wallet.png',
  order: ICON_BASE + 'order.png',
  post: ICON_BASE + 'post.png',
  message: ICON_BASE + 'message.png',
  security: ICON_BASE + 'security.png',
  rules: ICON_BASE + 'rules.png',
  service: ICON_BASE + 'service.png',
  feedback: ICON_BASE + 'feedback.png',
  help: ICON_BASE + 'help.png',
  about: ICON_BASE + 'about.png',
  avatar: ICON_BASE + 'avatar.png',
  heart: ICON_BASE + 'heart-outline.png',
  heartOutline: ICON_BASE + 'heart-outline.png',
  comment: ICON_BASE + 'comment.png',
  share: ICON_BASE + 'share.png'
}

function getIcon(name) {
  return ICONS[name] || ''
}

function compressImage(filePath, quality) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality: quality || 80,
      success: (res) => {
        const compressed = res.tempFilePath
        // 开发者工具中压缩后的临时文件可能无法被本地服务器加载，
        // 通过 wx.getImageInfo 验证文件是否可访问，不可用则回退原始文件。
        wx.getImageInfo({
          src: compressed,
          success: () => resolve(compressed),
          fail: () => resolve(filePath)
        })
      },
      fail: () => resolve(filePath)
    })
  })
}

function compressImages(filePaths, quality) {
  return Promise.all(filePaths.map((p) => compressImage(p, quality)))
}

function chooseAndCompress(count) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: count || 9,
      // 帖子发布开放视频：图片 + 视频混选，视频时长不得超过 1 分钟
      mediaType: ['image', 'video'],
      sizeType: ['compressed'],
      maxDuration: MAX_VIDEO_DURATION,
      success: async (res) => {
        // maxDuration 只限制「拍摄」，相册长视频按 duration 二次校验后过滤
        const { valid, overLong } = splitOverlongVideos(res.tempFiles)
        if (overLong) wx.showToast({ title: '视频不能超过1分钟，已过滤', icon: 'none' })
        // 帖子最多 1 个视频：一次选中多个视频时只保留第一个
        let videoSeen = false
        const files = []
        valid.forEach((f) => {
          const isVideo = (f.fileType || f.type) === 'video'
          if (isVideo && videoSeen) return
          if (isVideo) videoSeen = true
          files.push({
            type: isVideo ? 'video' : 'image',
            path: f.tempFilePath,
            size: f.size || 0,
            thumb: f.thumbTempFilePath || f.tempFilePath,
            duration: f.duration || 0
          })
        })
        const compressed = await Promise.all(files.map(async (file) => {
          if (file.type === 'video') return file
          return Object.assign({}, file, { path: await compressImage(file.path) })
        }))
        resolve(compressed)
      },
      fail: reject
    })
  })
}

// 视频时长上限（秒）：全小程序上传/发布视频统一不得超过 1 分钟
const MAX_VIDEO_DURATION = 60

// chooseMedia 的 maxDuration 只限制「拍摄」，从相册选择的长视频不受其约束，
// 必须按返回的 duration（秒）二次校验。返回 valid（未超限文件）与 overLong（是否拦下过超限视频）
function splitOverlongVideos(files, limit) {
  const max = Number(limit) > 0 ? Number(limit) : MAX_VIDEO_DURATION
  const valid = []
  let overLong = false
  ;(files || []).forEach((f) => {
    const isVideo = (f.fileType || f.type) === 'video'
    if (isVideo && Number(f.duration) > max) { overLong = true; return }
    valid.push(f)
  })
  return { valid, overLong }
}

module.exports = { ICONS, getIcon, compressImage, compressImages, chooseAndCompress, MAX_VIDEO_DURATION, splitOverlongVideos }
