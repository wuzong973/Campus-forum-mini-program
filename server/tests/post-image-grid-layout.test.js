// 帖子详情图片九宫格排版回归：flex-wrap + gap 下，每行宽度必须留有余量，
// 否则 rpx→px 向上取整会把「两张图」挤成竖排（只在部分机型复现，肉眼难查）。
// 出问题的原写法：gap 12rpx + width calc(50% - 6rpx) → 两列合计正好 100%，零余量。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

// 注释里会提到出问题的旧写法，断言前先剥掉注释，避免说明文字被当成规则匹配
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'post-detail', 'index.wxss'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function gapOf() {
  const block = css.match(/\.post-images\s*\{[^}]*\}/)
  assert.ok(block, '缺少 .post-images 规则')
  const gap = block[0].match(/gap:\s*(\d+)rpx/)
  assert.ok(gap, '.post-images 应显式声明 gap(rpx)')
  return Number(gap[1])
}

// 返回 { pct, rpx }：width: calc(<pct>% - <rpx>rpx)
function widthOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = css.match(new RegExp(escaped + '\\s*\\{[^}]*\\}'))
  assert.ok(block, '缺少规则 ' + selector)
  const w = block[0].match(/width:\s*calc\(\s*([\d.]+)%\s*-\s*(\d+)rpx\s*\)/)
  assert.ok(w, selector + ' 的 width 应为 calc(<pct>% - <rpx>rpx) 形式')
  return { pct: Number(w[1]), rpx: Number(w[2]) }
}

const gap = gapOf()
const MIN_SLACK_RPX = 8

// 每列数：合计宽度 = cols×(pct% − rpx) + (cols−1)×gap，要求比 100% 至少小 MIN_SLACK_RPX
function assertRowFits(cols, width) {
  const usedPct = cols * width.pct
  const usedRpx = cols * width.rpx - (cols - 1) * gap
  const slack = (100 - usedPct) + usedRpx
  assert.ok(slack >= MIN_SLACK_RPX,
    cols + ' 列排版余量只有 ' + slack.toFixed(2) + 'rpx，需 ≥ ' + MIN_SLACK_RPX + 'rpx（否则会换行）')
  return slack
}

const twoUp = assertRowFits(2, widthOf('.post-images.count-2 .post-img-wrap'))
const threeUp = assertRowFits(3, widthOf('.post-img-wrap'))

// 三列的百分比本身也要够精确：33.33% 会让三列合计差 0.01%，写 33.333% 更稳
assert.ok(widthOf('.post-img-wrap').pct >= 33.33, '三列百分比不应低于 33.33%')
assert.ok(css.indexOf('calc(50% - 6rpx)') < 0, '不应再出现零余量的 calc(50% - 6rpx)')

console.log('post image grid layout test passed. slack: 2列=' + twoUp + 'rpx, 3列=' + threeUp + 'rpx')
