// 「关于我们」页底部「开发人员」模块的数据源。
// 需要修改姓名 / 邮箱 / 技术栈时，只改这一处即可，WXML 会自动渲染。
const DEVELOPER = {
  // TODO: 替换为你的真实姓名（头像里的首字母会由 name 自动截取）
  name: 'Twelve',
  role: '全栈开发 · 微信小程序 / Node.js',
  skills: [
    '微信小程序',
    'JavaScript / TypeScript',
    'Node.js / Express',
    'MySQL',
    'Redis',
    'Nginx / Linux 运维',
    'OCR 验证码识别'
  ],
  experience: [
    '校园论坛小程序：独立完成微信小程序端（60+ 页面）与 Node.js 服务端的整体设计与实现，覆盖论坛发帖、跑腿代取、社团群聊、活动报名、钱包与提现等核心模块。',
    '平台与运维：接入微信登录 / 微信支付 / 订阅消息，搭建 RBAC 权限管理后台与操作日志审计，并完成单机多实例部署、Nginx 反向代理与线上问题排查。',
    '备注：有任何技术上的问题 / 关于开发 / 服务器部署 / AI方面不懂的问题均可联系开发人员，解答你的一切问题',
  ],
  contacts: [
    // TODO: 邮箱建议替换为你自己的常用邮箱
    { key: '联系方式', value: '19867363523', copy: '19867363523' },
    { key: '邮箱', value: '3181035374@qq.com', copy: '3181035374@qq.com' }
  ]
}

Page({
  data: {
    developer: Object.assign({}, DEVELOPER, {
      initial: String(DEVELOPER.name || '?').slice(0, 1).toUpperCase()
    })
  },

  // 点击联系方式复制到剪贴板
  // 微信在复制成功后会自己弹「内容已复制」，这里不再重复 showToast（参见 pages/repair/index.js）
  onCopyContact(e) {
    const value = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.value : ''
    if (!value) return
    wx.setClipboardData({ data: String(value) })
  }
})
