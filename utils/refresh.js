// 通用下拉刷新控制器
// 统一处理各页面 onPullDownRefresh 的公共逻辑：
// 1. 刷新锁：刷新进行中禁止重复触发（系统动画期间框架本身会拦截，这里兜底程序性调用）
// 2. 网络预检：离线状态立即给出明确提示并收起，不发无效请求
// 3. 最短反馈时长：保证下拉加载图标至少展示 MIN_REFRESH_MS，避免闪烁
// 4. 自动收起：无论成功失败，刷新结束后自动收起下拉刷新状态
// 5. 错误提示：请求层（utils/request.js）默认已对失败弹 toast，
//    这里只在所有加载任务都失败且无提示来源时兜底提示

const MIN_REFRESH_MS = 600

function getNetworkType() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => resolve(res.networkType || 'unknown'),
      fail: () => resolve('unknown')
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 将页面的加载函数转为 Promise，加载函数内部抛错也不会中断刷新流程
function toPromise(loader, page) {
  try {
    const result = loader.call(page)
    if (result && typeof result.then === 'function') return result
    return Promise.resolve(result)
  } catch (error) {
    return Promise.reject(error)
  }
}

// 等价于 Promise.allSettled（部分基础库不支持 ES2020，手动实现）
function settleAll(promises) {
  return Promise.all(promises.map((p) => Promise.resolve(p).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason })
  )))
}

/**
 * 页面 onPullDownRefresh 统一入口
 * @param {Page} page 页面实例
 * @param {Function|Function[]} [loaders] 数据加载函数（可传多个），返回 Promise 则等待完成
 */
async function runPullDownRefresh(page, loaders) {
  if (page.__pullRefreshing) {
    wx.stopPullDownRefresh()
    return
  }
  page.__pullRefreshing = true
  try {
    const networkType = await getNetworkType()
    if (networkType === 'none') {
      wx.showToast({ title: '当前无网络连接，请检查网络设置', icon: 'none', duration: 2000 })
      return
    }
    const list = Array.isArray(loaders) ? loaders : (loaders ? [loaders] : [])
    const startedAt = Date.now()
    const results = await settleAll(list.map((loader) => toPromise(loader, page)))
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_REFRESH_MS) await delay(MIN_REFRESH_MS - elapsed)
    const rejected = results.filter((item) => item.status === 'rejected')
    if (results.length > 0 && rejected.length === results.length) {
      const error = rejected[0].reason || {}
      const message = error.message || '刷新失败，请稍后重试'
      const networkLike = error.isNetwork || /网络|timeout|fail/i.test(message)
      wx.showToast({ title: networkLike ? '网络不稳定，刷新失败，请重试' : message, icon: 'none' })
    }
  } finally {
    page.__pullRefreshing = false
    wx.stopPullDownRefresh()
  }
}

module.exports = { runPullDownRefresh }
