// ===== 液态标签指示条（elastic tab indicator）驱动器 =====
// 设计文档：docs/2026-09-30_液态标签指示条.md
//
// 双相位模型（需求：前沿快跑 / 后沿延迟 6 帧追赶 / 中途拉伸 2 倍+ / 末端轻微超调）：
//   相位一 rush（0.1s ≈ 6 帧）：前沿以 cubic-bezier(0.3, 0.9, 0.5, 1) 奔向目标位置，
//     后沿原地不动 —— 指示条被拉伸到「原宽 + 位移」，跨多格跳转时远超 2 倍；
//   相位二 chase（0.3s）：后沿延迟 6 帧后以 cubic-bezier(0.34, 1.42, 0.6, 1) 追赶、
//     宽度同步收回。left 的超调增量与 width 的反向增量恰好抵消，
//     前沿全程钉在目标位置，只有后沿轻微越过目标再回落 —— 即「末端超调」。
//
// 实现约束：
// - 位置/宽度一律 left/width（需求红线，scaleX 会把圆角拉变形）。
//   left/width 每帧触发 layout，但指示条绝对定位、尺寸极小，
//   回流范围被限制在标签栏容器内（position:relative 的 .liquid-tab-track）。
// - 每次切换只有 2 次 setData（相位一、相位二各一次），
//   中间插值全部交给 CSS transition —— 禁止逐帧 setData/rAF 驱动（setData 过桥开销大）。
// - 快速连点安全：重入时清除相位定时器，CSS transition 会从当前实时位置重定向，
//   不会跳变。
//
// 用法（见 docs）：
//   const liquidTab = require('../../utils/liquid-tab')
//   onReady: this.liquidTab = liquidTab.create(this, {
//     track: '.top-tabs',        // 定位上下文（会自动获得 .liquid-tab-track）
//     items: '.top-tab',         // 全部标签节点
//     indicator: '.liquid-indicator'
//   })
//   this.liquidTab.init(0)       // 首次落位（无动画）
//   切换 tab：this.liquidTab.moveTo(index)
//   标签数量/可见性变化后：this.liquidTab.refresh(index)  // 重测量并落位
//   onUnload: this.liquidTab.destroy()

// 相位一时长：6 帧 @60fps，也是后沿的延迟时长
const PHASE1_MS = 100
// 相位二时长：后沿追赶 + 宽度收回 + 末端超调
const PHASE2_MS = 300
// 相位二定时器的渲染缓冲：setData 过桥存在 1~2 帧延迟，
// 提前切相位会把 rush 截断，多等 2 帧视觉不可感知
const PHASE1_BUFFER_MS = 32

function create(page, opts) {
  const styleKey = opts.styleKey || 'liquidStyle'
  const phaseKey = opts.phaseKey || 'liquidPhase'
  const state = { geo: null, cur: null, index: -1, timer: null, measuring: null }

  function apply(left, width, phase) {
    state.cur = { left: left, width: width }
    const patch = {}
    patch[styleKey] = 'left:' + left.toFixed(2) + 'px;width:' + width.toFixed(2) + 'px;'
    patch[phaseKey] = phase
    page.setData(patch)
  }

  // 测量各标签相对 track 的 left/width（px，真机与开发者工具均适用）
  function measure() {
    if (state.measuring) return state.measuring
    state.measuring = new Promise(function (resolve) {
      const q = typeof page.createSelectorQuery === 'function'
        ? page.createSelectorQuery()
        : wx.createSelectorQuery().in(page)
      q.selectAll(opts.items).boundingClientRect()
      q.select(opts.track).boundingClientRect()
      q.exec(function (res) {
        state.measuring = null
        const items = res && res[0]
        const track = res && res[1]
        if (!items || !items.length || !track) return resolve(null)
        resolve(items.map(function (r) {
          return { left: r.left - track.left, width: r.width }
        }))
      })
    })
    return state.measuring
  }

  function clearTimer() {
    if (state.timer) { clearTimeout(state.timer); state.timer = null }
  }

  // 无动画落位（初始挂载 / 列表变化后重排）
  function snap(index) {
    return Promise.resolve(state.geo || measure()).then(function (geo) {
      if (!geo || !geo[index]) return
      state.geo = geo
      state.index = index
      clearTimer()
      apply(geo[index].left, geo[index].width, '')
    })
  }

  // 两相位切换动画。index 为标签在「当前已渲染节点序」中的位置
  // （有条件隐藏标签的页面需自行换算，见 profile 页接法）
  function moveTo(index) {
    clearTimer()
    Promise.resolve(state.geo || measure()).then(function (geo) {
      if (!geo || !geo[index]) return
      state.geo = geo
      if (state.index === -1 || !state.cur) {
        // 首次没有落位基准：直接落位，不播拉伸（没有"原位"可拉伸）
        state.index = index
        apply(geo[index].left, geo[index].width, '')
        return
      }
      if (index === state.index) return
      const from = state.cur
      const to = geo[index]
      state.index = index
      let rushLeft
      let rushWidth
      if (to.left >= from.left) {
        // 右移：前沿是右沿 —— 后沿留在原地，宽度拉到「目标右沿 − 当前左沿」
        rushLeft = from.left
        rushWidth = (to.left + to.width) - from.left
      } else {
        // 左移：前沿是左沿 —— left 冲到目标，宽度拉到「当前右沿 − 目标左沿」，
        // 左右两个相位分量以同曲线插值，右沿（后沿）在 rush 期间纹丝不动
        rushLeft = to.left
        rushWidth = (from.left + from.width) - to.left
      }
      apply(rushLeft, rushWidth, 'liquid-indicator--rush')
      state.timer = setTimeout(function () {
        state.timer = null
        apply(to.left, to.width, 'liquid-indicator--chase')
      }, PHASE1_MS + PHASE1_BUFFER_MS)
    })
  }

  // 标签集合变化（数量/可见性/窗口尺寸）后重新测量并落位
  function refresh(index) {
    state.geo = null
    return snap(index === undefined ? state.index : index)
  }

  function destroy() { clearTimer() }

  return { moveTo: moveTo, snap: snap, refresh: refresh, destroy: destroy, measure: measure }
}

module.exports = { create: create, PHASE1_MS: PHASE1_MS, PHASE2_MS: PHASE2_MS }
