// 回归：① 匿名帖校区显示与普通帖一致 ② 分享海报展示原帖头像/正文/配图 ③ 未选主题分类必须阻止发布并提示
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

let count = 0
function check(fn, message) {
  try {
    fn()
    count++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

function run() {
  const postController = read('server', 'controllers', 'postController.js')
  const publishJs = read('pages', 'post-publish', 'index.js')
  const posterJs = read('pages', 'poster', 'index.js')

  // A. 匿名帖校区：沿用普通帖取数（不再因匿名置空），未设置校区时同样返回空串由前端统一显示
  check(() => {
    assert.ok(!/campus:\s*anonymousIdentity\s*\?/.test(postController), '匿名帖不得再把校区置空')
    assert.ok(/campus:\s*r\.campus\s*\|\|\s*""/.test(postController), 'campus 应与普通帖同口径取 r.campus')
    // 首页乐观插入（发布后立即上屏）也要与普通帖一致
    assert.ok(/campus:\s*me\.campus/.test(publishJs), '发布后本地插入的 campus 应与普通帖一致')
    assert.ok(!/campus:\s*anonymous\s*\?/.test(publishJs), '发布后本地插入不得因匿名置空校区')
    // 渲染层两处都是 post.campus || '未设置校区'，匿名/普通共用
    const cardWxml = read('components', 'post-card', 'post-card.wxml')
    const detailWxml = read('pages', 'post-detail', 'index.wxml')
    assert.ok(/post\.campus \|\| '未设置校区'/.test(cardWxml), '列表卡片按 post.campus 统一渲染')
    assert.ok(/post\.campus \|\| '未设置校区'/.test(detailWxml), '详情页按 post.campus 统一渲染')
  }, 'A. 匿名帖校区沿用普通帖取数与渲染')

  // B. 分享海报：头像/正文/配图必须真实加载并绘制
  check(() => {
    assert.ok(/downloadImage\s*\(/.test(posterJs), '海报需把远程图片下载为本地路径')
    assert.ok(/wx\.downloadFile/.test(posterJs), '远程图片必须走 downloadFile（canvas 不能直接画网络图）')
    assert.ok(/loadCanvasImage\s*\(/.test(posterJs), '需预加载 canvas 图片对象')
    assert.ok(/createImage\(\)/.test(posterJs), '需用 canvas.createImage 创建可绘制图片')
    assert.ok(/drawImage\(assets\.avatarImg/.test(posterJs), '头像必须真实绘制（圆角裁剪）')
    // 内置头像（/assets/avatar2/xxx.jpg）是包内路径，canvas 画不了，必须读成 base64
    assert.ok(/getFileSystemManager\(\)\.readFile/.test(posterJs), '包内头像需读成 base64 才能绘制')
    assert.ok(/data:.*base64,/.test(posterJs), '包内头像需转成 dataURL')
    assert.ok(/drawImage\(img,\s*tx,\s*y,\s*ts,\s*ts\)/.test(posterJs), '配图必须真实绘制')
    assert.ok(/post\.title/.test(posterJs), '海报需展示原帖标题')
    // 视频（发布时也存进 images 列并带 type:'video'）不能按图片画，必须识别并画视频卡片
    assert.ok(/mediaOf\s*\(/.test(posterJs), '需统一识别媒体类型（图片/视频）')
    assert.ok(/type === 'video'/.test(posterJs) && /mp4/.test(posterJs), '需识别 type:video 与视频扩展名')
    assert.ok(/fillText\('视频'/.test(posterJs), '无封面的视频需画视频卡片（含「视频」标识）')
    assert.ok(/wrapText\(ctx,\s*content,\s*cw\)/.test(posterJs), '海报需按宽度换行展示正文')
    // 不允许再只画灰色占位块（头像/配图都必须有真实图片分支）
    assert.ok(!/ctx\.fillStyle = '#E5E7EB'\s*\n\s*ctx\.fill\(\)\s*\n\s*\n\s*const nick/.test(posterJs), '头像不得只有灰底占位')
  }, 'B. 分享海报真实展示头像/标题/正文/配图')

  // C. 主题分类校验：未选分类时点发布必须阻止并提示「请选择分类」
  check(() => {
    assert.ok(!/if\s*\(!this\.data\.canSubmit \|\| this\.data\.submitting\)\s*return/.test(publishJs),
      'onSubmit 不得因 canSubmit=false 直接 return（会导致点了没反应）')
    assert.ok(/if \(this\.data\.submitting\) return/.test(publishJs), 'onSubmit 仍需防重复提交')
    assert.ok(/title: '请选择分类'/.test(publishJs), '未选主题分类需提示「请选择分类」')
    assert.ok(!/title: '请选择标签'/.test(publishJs), '旧文案「请选择标签」应已替换')
    // 分类校验必须排在提交动作（上传/请求）之前
    const submitIndex = publishJs.indexOf('async onSubmit()')
    const block = publishJs.slice(submitIndex, submitIndex + 1200)
    const categoryIndex = block.indexOf("title: '请选择分类'")
    assert.ok(categoryIndex > -1, 'onSubmit 内需包含分类校验')
    assert.ok(block.indexOf('request.post') === -1 || categoryIndex < block.indexOf('uploadImages'), '分类校验需早于上传与请求')
  }, 'C. 未选主题分类阻止发布并提示')

  console.log(count + ' tests passed.')
}

try {
  run()
  process.exit(0)
} catch (err) {
  console.error(err && err.stack)
  process.exit(1)
}
