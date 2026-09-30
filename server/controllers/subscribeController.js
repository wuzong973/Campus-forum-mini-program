const subscribeService = require('../services/subscribeService')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

/**
 * 上报订阅授权结果。
 *
 * 前端在 wx.requestSubscribeMessage 的 success 回调里，把用户点了「允许」的
 * 模板类型传上来，服务端据此 +1 额度。微信侧没有「查询订阅状态」的接口，
 * 额度只能由客户端上报——这是官方设计的固有约束，不是实现偷懒。
 *
 * 安全性：额度只增不减地加 1，且服务端有发送频控兜底，
 * 即使客户端伪造上报，最坏结果是多发一条通知，不会造成资金或数据风险。
 */
exports.report = async (req, res) => {
  try {
    const types = Array.isArray(req.body && req.body.tplTypes)
      ? req.body.tplTypes
      : [req.body && req.body.tplType].filter(Boolean)
    const valid = types.filter((t) => subscribeService.TPL_TYPES.includes(t))
    if (!valid.length) return fail(res, '缺少有效的模板类型')
    const quota = await subscribeService.grantQuota(req.userId, valid)
    success(res, { quota })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

/**
 * 查询当前用户各模板剩余额度（前端可用于决定是否还要引导授权）
 */
exports.quota = async (req, res) => {
  try {
    const quota = await subscribeService.quotaOf(req.userId)
    success(res, { quota })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

/**
 * 上报一次「命中弹窗节流」，写一行 status='throttled' 的日志。
 *
 * 为什么由客户端上报：节流判定必须发生在 wx.requestSubscribeMessage 的**同步调用链**内
 * （微信硬性要求），服务端无从感知「这次点击被本地节流拦下了」。
 * 上报是尽力而为的 fire-and-forget，失败不影响任何业务。
 *
 * 入参：
 *   tplType       该触发组的首个模板类型（服务端用它落 tpl_type，白名单校验）
 *   triggerLabel  渠道文案，如「评论通知」（落在 summary 里便于阅读）
 *   used / limit  当天已弹次数与上限
 */
exports.throttled = async (req, res) => {
  try {
    const body = req.body || {}
    const tplType = String(body.tplType || '').trim()
    if (!subscribeService.TPL_TYPES.includes(tplType)) return fail(res, '缺少有效的模板类型')
    await subscribeService.logThrottleHit(req.userId, tplType, {
      label: String(body.triggerLabel || '').slice(0, 24),
      used: Number(body.used || 0),
      limit: Number(body.limit || 0)
    })
    success(res, { logged: true })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
