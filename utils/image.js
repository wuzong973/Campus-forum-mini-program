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
  heart: ICON_BASE + 'heart.png',
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
      success: (res) => resolve(res.tempFilePath),
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
      mediaType: ['image', 'video'],
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
