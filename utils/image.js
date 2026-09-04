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
      // 视频需要先接入 media_check_async 和公开 HTTPS 媒体地址，当前发布流程仅允许图片。
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const files = res.tempFiles.map((f) => ({
          type: f.fileType || f.type || 'image',
          path: f.tempFilePath,
          size: f.size || 0,
          thumb: f.thumbTempFilePath || f.tempFilePath
        }))
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

module.exports = { ICONS, getIcon, compressImage, compressImages, chooseAndCompress }
