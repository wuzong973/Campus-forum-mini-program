// 单个社团详情页：分类页「代表社团」点击某个社团后进入
// 数据全部来自 GET /club/detail/:id（按社团唯一标识 id 匹配）
// 三种状态：loading 骨架 / notFound 空态 / loadError 可重试的失败态
const api = require('../../utils/api')
const { themeFromColor } = require('../../utils/club-data')

// 服务端 DATETIME 约定为 'YYYY-MM-DD HH:mm:ss' 字符串，只做展示裁剪；
// 若上游仍返回 UTC ISO 串（…T12:14:37.000Z），先换算成本地时区再格式化，避免差 8 小时
function pad2(n) { return (n < 10 ? '0' : '') + n }

function fmtDateTime(value) {
  if (!value) return ''
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw)
    if (!isNaN(date.getTime())) {
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
        + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())
    }
  }
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!matched) return raw
  return matched[1] + '-' + matched[2] + '-' + matched[3] + ' ' + matched[4] + ':' + matched[5]
}

// 'YYYY-MM-DD HH:mm[:ss]' → 'MM-DD HH:mm'（ISO 输入同样先换算本地时区）
function fmtShort(value) {
  if (!value) return '时间待定'
  const full = fmtDateTime(value)
  const matched = full.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/)
  if (!matched) return full
  return matched[2] + '-' + matched[3] + ' ' + matched[4] + ':' + matched[5]
}

Page({
  data: {
    loading: true,
    notFound: false,
    loadError: false,
    club: null,
    media: null,
    theme: null,
    creation: null,
    members: [],
    activities: [],
    campusText: '',
    createdText: ''
  },

  onLoad(options) {
    // 唯一标识：社团 id（路由参数可能是字符串，统一转成数字再判空）
    this.clubId = Number((options && options.id) || 0)
    // 列表页顺带带入社团名，先占住导航栏标题，避免请求返回前一直显示「社团详情」
    const name = options && options.name
    if (name) {
      try {
        wx.setNavigationBarTitle({ title: decodeURIComponent(name) })
      } catch (e) {
        // 名称解码失败不影响主流程（请求回来后还会用服务端名称再设一次）
      }
    }
    this.loadDetail()
  },

  onPullDownRefresh() {
    if (this.data.notFound) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadDetail(() => wx.stopPullDownRefresh())
  },

  loadDetail(done) {
    const finish = typeof done === 'function' ? done : function () {}
    // 没有 id 就不必请求，直接判定不存在（避免请求 /club/detail/NaN）
    if (!this.clubId) {
      this.setData({ loading: false, notFound: true, loadError: false })
      finish()
      return
    }
    this.setData({ loading: true, notFound: false, loadError: false })
    api.getClubDetail(this.clubId).then((res) => {
      const club = (res && res.club) || null
      if (!club || !club.id) {
        // 接口成功但没带社团数据：同样按不存在处理，不留白屏
        this.setData({ loading: false, notFound: true, loadError: false })
        finish()
        return
      }
      const rawCreation = (res && res.creation) || {}
      const creation = {
        appliedText: fmtDateTime(rawCreation.appliedAt),
        approvedText: fmtDateTime(rawCreation.approvedAt),
        reviewNote: rawCreation.reviewNote || '',
        creator: rawCreation.creator || null,
        reviewer: rawCreation.reviewer || null
      }
      // 预计算首字符：模板里不能做 charAt，头像缺失时用它兜底
      const members = ((res && res.members) || []).map((member) => Object.assign({}, member, {
        char: (member.nickName || '友').charAt(0)
      }))
      // 与「申请创建社团」页同名的媒体字段：头像 / 社团二维码 / 负责人微信 / 公众号二维码 / 图片介绍
      const rawImages = Array.isArray(club.images) ? club.images : []
      const media = {
        avatarUrl: club.avatarUrl || '',
        qrcodeUrl: club.qrcodeUrl || '',
        adminQrcodeUrl: club.adminQrcodeUrl || '',
        gzhQrcodeUrl: club.gzhQrcodeUrl || '',
        images: rawImages.filter((url) => typeof url === 'string' && !!url)
      }
      const activities = ((res && res.activities) || []).map((activity) => Object.assign({}, activity, {
        timeText: fmtShort(activity.activityStart),
        signupText: activity.capacity > 0
          ? activity.signupCount + '/' + activity.capacity + ' 人已报名'
          : activity.signupCount + ' 人已报名'
      }))
      this.setData({
        loading: false,
        notFound: false,
        loadError: false,
        club: Object.assign({}, club, {
          char: (club.name || '社').charAt(0),
          // tags 形如 "武术 · 散打 · 传统套路"，拆成数组供 wx:for 渲染（wxml 不能直接迭代字符串）
          tagList: String(club.tags || '').split('·').map((t) => t.trim()).filter((t) => !!t)
        }),
        media,
        theme: themeFromColor(club.categoryColor),
        creation,
        members,
        activities,
        // 空校区 = 全部校区可见（与列表页 filter 语义一致）
        campusText: club.campus || '全部校区',
        createdText: fmtDateTime(club.createdAt)
      })
      wx.setNavigationBarTitle({ title: club.name || '社团详情' })
      finish()
    }).catch((err) => {
      if (err && err.statusCode === 404) {
        // 已删除 / 已下架 / id 不存在：展示空态并给出返回入口，
        // 不自动跳走（用户可能是从旧分享链接进来的，被"甩"回去更困惑）
        this.setData({ loading: false, notFound: true, loadError: false })
      } else {
        this.setData({ loading: false, loadError: true })
        wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
      }
      finish()
    })
  },

  onRetry() {
    wx.vibrateShort({ type: 'light' })
    this.loadDetail()
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/club/index' })
    })
  },

  onActivityTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/activity/detail?id=' + id })
  },

  // 二维码 / 头像 / 图片介绍：单图预览，gallery 场景带上全部图片可左右滑
  onPreview(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const list = e.currentTarget.dataset.urls
    const urls = Array.isArray(list) && list.length ? list : [url]
    wx.previewImage({ urls, current: url })
  },

  onCopyIntro() {
    const club = this.data.club
    if (!club || !club.intro) return
    wx.setClipboardData({
      data: club.name + '\n' + club.intro,
      success() {
        wx.showToast({ title: '社团介绍已复制', icon: 'none' })
      }
    })
  }
})
