// 全站统一的二维码长按识别工具
//
// 使用方式（任何展示用户图片的页面/组件）：
//   1. 图片标签上加 bindlongpress="onImageQrScan" data-url="{{item}}" data-urls="{{list}}"
//   2. js 里注册处理器：
//        const qr = require('../../utils/qr')
//        onImageQrScan(e) { qr.recognize(e.currentTarget.dataset.url, e.currentTarget.dataset.urls) }
//
// 交互：长按弹出菜单（识别图中二维码 / 预览大图）；识别成功后按内容统一分发：
//   ① 微信好友名片链接（u.wechat.com / weixin.qq.com）→ 弹窗确认后跳 H5 识别页长按原图添加
//   ② 小程序页面路径（/pages/...）→ 直接跳转，失败则复制
//   ③ 可信域名 https 链接 → 内置浏览器直接打开
//   ④ 其余 https 链接 → webview 兜底页（自动复制 + 引导浏览器打开）
//   ⑤ 其他文本 → 复制到剪贴板

// web-view 可直接打开的可信域名（与 pages/webview 的白名单保持一致）
const WEBVIEW_ALLOWED_HOSTS = [
  'jw.gdipu.edu.cn',
  'mobilelib.wx.chaoxing.com',
  'www.720yun.com',
  'payun01.cn'
]

let _jsQR
function loadJsQR() {
  if (_jsQR !== undefined) return _jsQR
  try { _jsQR = require('./jsqr') } catch (e) { _jsQR = null }
  return _jsQR
}

// 远程图片先下载为本地临时文件（需域名在 downloadFile 合法域名内），本地路径直接使用
function downloadImage(url) {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(url)
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => (res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('download fail'))),
      fail: reject
    })
  })
}

// 在离屏画布上按指定缩放比例解码一次
function decodeWithScale(canvas, img, jsQR, scale) {
  const w = Math.max(1, Math.round((img.width || 0) * scale))
  const h = Math.max(1, Math.round((img.height || 0) * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const result = jsQR(imageData.data, w, h)
  return result && result.data ? String(result.data) : ''
}

// 解码二维码内容：原图 → 缩小档依次尝试，覆盖大图/密集点阵
function decodeQr(url) {
  const jsQR = loadJsQR()
  if (!jsQR) return Promise.reject(new Error('decoder unavailable'))
  return downloadImage(url).then((filePath) => new Promise((resolve, reject) => {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 300, height: 300 })
      const img = canvas.createImage()
      img.onload = () => {
        try {
          const nativeSide = Math.max(img.width || 0, img.height || 0) || 1
          const scales = nativeSide > 640
            ? [Math.min(1, 640 / nativeSide), Math.min(1, 400 / nativeSide), 0.4]
            : [1, 0.6]
          const tryNext = (index) => {
            if (index >= scales.length) {
              reject(new Error('no qr'))
              return
            }
            try {
              const text = decodeWithScale(canvas, img, jsQR, scales[index])
              if (text) resolve(text)
              else tryNext(index + 1)
            } catch (err) {
              tryNext(index + 1)
            }
          }
          tryNext(0)
        } catch (err) { reject(err) }
      }
      img.onerror = () => reject(new Error('image load fail'))
      img.src = filePath
    } catch (err) { reject(err) }
  }))
}

function copyText(text, silent) {
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: silent ? '链接已复制' : '内容已复制', icon: 'success' })
  })
}

// 下载二维码图片并保存到相册：微信限制小程序 web-view 内长按无法识别个人微信好友码，
// 保存后引导用户到 微信"扫一扫"→"相册" 选择图片完成识别添加
function saveQrImage(imageUrl) {
  if (!imageUrl) {
    wx.showToast({ title: '没有可保存的图片', icon: 'none' })
    return
  }
  // 本包内图（如内置兜底码 /assets/avatar2/管理员微信.png）不是 http，
  // 先用 getImageInfo 换成本地可读路径再复用下面同一条下载→存相册链路；
  // 少了这一步，弹窗显示兜底图时「保存图片」这条出口会直接消失。
  if (!/^https?:\/\//i.test(imageUrl)) {
    wx.getImageInfo({
      src: imageUrl,
      success: (r) => saveQrImage(r.path),
      fail: () => wx.showToast({ title: '图片读取失败，请截图保存', icon: 'none' })
    })
    return
  }
  wx.showLoading({ title: '保存中...', mask: true })
  wx.downloadFile({
    url: imageUrl,
    success: (res) => {
      wx.hideLoading()
      wx.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        success: () => {
          wx.showModal({
            title: '已保存到相册',
            content: '打开微信"扫一扫"→ 右上角"相册"选择这张图片，即可识别并添加好友',
            showCancel: false,
            confirmText: '知道了'
          })
        },
        fail: (err) => {
          const msg = String((err && err.errMsg) || '')
          if (msg.indexOf('auth') > -1 || msg.indexOf('deny') > -1) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存图片到相册',
              confirmText: '去设置',
              success: (r) => { if (r.confirm) wx.openSetting() }
            })
          } else {
            wx.showToast({ title: '保存失败，请重试', icon: 'none' })
          }
        }
      })
    },
    fail: () => {
      wx.hideLoading()
      wx.showToast({ title: '图片下载失败', icon: 'none' })
    }
  })
}

// 按识别内容分发跳转/操作
function handleQrContent(content, imageUrl) {
  const text = String(content || '').trim()
  if (!text) {
    wx.showToast({ title: '未识别到二维码内容', icon: 'none' })
    return
  }
  // ① 微信好友名片/加好友链接：小程序内（含 web-view）长按无法识别个人微信好友码，
  //    提供"保存图片去扫一扫识别"与"复制链接"两个可靠出口
  if (/^https:\/\/u\.wechat\.com\//i.test(text) || /weixin\.qq\.com\//i.test(text)) {
    const actions = []
    // 本包内兜底码同样能存（saveQrImage 已支持），不再用 https 门槛把这条出口摘掉
    if (imageUrl) actions.push('保存图片，去微信扫一扫识别')
    actions.push('复制链接')
    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        const label = actions[res.tapIndex]
        if (label.indexOf('保存') === 0) saveQrImage(imageUrl)
        else copyText(text)
      },
      fail: () => {}
    })
    return
  }
  // ② 小程序内部页面路径
  if (/^\/(pages|packages)\//.test(text)) {
    wx.navigateTo({ url: text, fail: () => copyText(text) })
    return
  }
  // ③ 网页链接：可信域名直接打开，其余交给 webview 兜底页（自动复制 + 引导浏览器打开）
  const hostMatch = text.match(/^https:\/\/([^/:?#]+)/i)
  const host = hostMatch ? hostMatch[1].toLowerCase() : ''
  if (/^https?:\/\//i.test(text)) {
    const title = host && WEBVIEW_ALLOWED_HOSTS.indexOf(host) > -1 ? '外部链接' : '外部链接'
    wx.navigateTo({
      url: '/pages/webview/index?url=' + encodeURIComponent(text) + '&title=' + encodeURIComponent(title)
    })
    return
  }
  // ④ 其他文本内容
  copyText(text)
}

// 解码 + 按内容分发，单独导出：弹窗里的「识别二维码」按钮直接调它，
// 不用再套一层 ActionSheet（原生长按菜单不可用时，这是可靠兜底）
function decodeAndHandle(url) {
  if (!url) return
  wx.showLoading({ title: '识别中...', mask: true })
  decodeQr(url)
    .then((content) => {
      wx.hideLoading()
      handleQrContent(content, url)
    })
    .catch((err) => {
      wx.hideLoading()
      const unavailable = err && err.message === 'decoder unavailable'
      wx.showToast({ title: unavailable ? '识别组件未加载，请重新编译' : '未识别到二维码，可先保存图片去扫一扫', icon: 'none' })
    })
}

// 长按入口：弹出识别菜单（识别 / 预览）
// url: 当前图片地址；allUrls: 同屏图片列表（预览大图时左右滑动查看）
function recognize(url, allUrls) {
  if (!url) return
  wx.showActionSheet({
    itemList: ['识别图中二维码', '预览大图'],
    success: (res) => {
      if (res.tapIndex === 1) {
        wx.previewImage({ current: url, urls: (allUrls && allUrls.length ? allUrls : [url]) })
        return
      }
      decodeAndHandle(url)
    },
    fail: () => {}
  })
}

module.exports = { recognize, decodeAndHandle, decodeQr, handleQrContent, saveQrImage }
