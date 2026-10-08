const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const subscribe = require('../../../utils/subscribe')
const { CAMPUS_GROUPS } = require('../../../utils/campus')
// 卡片动效降级开关（低端机 / 用户在设置里关闭）：命中时挂 .fx-off
const motion = require('../../../utils/motion')

const TABS = [
  { key: 'all', name: '全部活动' },
  { key: 'signing', name: '报名中' },
  { key: 'mine', name: '我的参与' }
]
const BADGE_TEXT = {
  signing: '报名中',
  notStarted: '报名未开始',
  ended: '已结束'
}

function pad2(n) { return (n < 10 ? '0' : '') + n }

// 'YYYY-MM-DD HH:mm[:ss]' → 'MM/DD'
function shortDate(value) {
  if (!value) return ''
  const m = String(value).match(/^\d{4}-(\d{2})-(\d{2})/)
  return m ? m[1] + '/' + m[2] : ''
}

// 卡片右上角校区标识：主校区直显；历史子校区归一到所属主校区；空 = 全部校区
function campusText(campus) {
  const value = String(campus || '').trim()
  if (!value) return '全部校区'
  if (CAMPUS_GROUPS.some((group) => group.name === value)) return value
  const group = CAMPUS_GROUPS.find((item) => item.subs.indexOf(value) >= 0)
  return group ? group.name : '全部校区'
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'all',
    list: [],
    loaded: false,
    page: 1,
    hasMore: false,
    loading: false,
    showModal: false,
    // 顶部「订阅活动消息提醒」入口：订阅生效（偏好开 + 微信侧已授权）后隐藏，
    // 在设置页关闭「活动订阅」后重新出现（见 refreshActivityIndexSubscribeEntry）
    showActivityIndexSubscribeEntry: false,
    activityIndexSubscribeChecked: false,
    // 动效降级：低端机或用户在「设置 → 显示 → 卡片动效」关闭时为 true，挂 .fx-off
    fxOff: false
  },

  onShow() {
    // 动效降级每次回到页面都同步：设置页刚关掉要立即生效，低端机判定不随页面变但成本极低
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    // 统一访问控制：已登录且（已登录过教务系统 或 已完成骑手认证）才加载数据
    auth.requireFeatureAccess('校园活动', { autoBack: true }).then((ok) => {
      if (!ok) return
      // 每次进入/返回都刷新（新发布/新报名即时可见）
      this.setData({ page: 1, list: [], loaded: false })
      this.loadList(1)
      // 订阅状态可能在设置页被改动（开启/关闭「活动订阅」），每次进入都重算入口显隐
      this.refreshActivityIndexSubscribeEntry()
    })
  },

  // ===== 顶部「订阅活动消息提醒」入口 =====
  // 与原「报名中」tab 点击走同一个 activityIndex 触发组（activityNew + activityJoined +
  // activitySignupNotice），逻辑复用 utils/subscribe.js 的统一封装，原有逻辑一概不动。
  // 显隐口径 entryVisible('activityIndex')：偏好已开且微信侧已授权才隐藏，
  // 因此在设置页关闭「活动订阅」后入口会自动重新出现。
  refreshActivityIndexSubscribeEntry() {
    // 本地判定为「需要引导」时直接显示（不发额外请求）；
    // 本地认为「已订阅」时再复核一次服务端额度 —— 额度是「点一次允许发一条」，
    // 高频场景（评论/私信）极易用尽；用尽后必须让入口重新出现，否则用户无从重新订阅。
    if (typeof subscribe.entryVisibleAsync === 'function') {
      subscribe.entryVisibleAsync('activityIndex')
        .then((need) => this.setData({ showActivityIndexSubscribeEntry: !!need, activityIndexSubscribeChecked: false }))
        .catch(() => {})
      return
    }
    const visible = typeof subscribe.entryVisible === 'function' ? subscribe.entryVisible('activityIndex') : false
    this.setData({ showActivityIndexSubscribeEntry: !!visible, activityIndexSubscribeChecked: false })
  },
  // 点击整行（左半区）与拨动开关走同一条路径
  onActivityIndexSubscribeTap(e) {
    // 开关被拨到「关」时不申请授权，只回正视觉状态（入口在订阅生效后本就会整体隐藏）
    if (e && e.detail && e.detail.value === false) { this.setData({ activityIndexSubscribeChecked: false }); return }
    this.setData({ activityIndexSubscribeChecked: true })
    if (typeof subscribe.requestEntryByTap !== 'function') { this.refreshActivityIndexSubscribeEntry(); return }
    // 必须在 tap 同步链内进入原生 API；requestEntryByTap = requestTriggerByTap + 允许后写偏好
    subscribe.requestEntryByTap('activityIndex')
      .then(() => this.refreshActivityIndexSubscribeEntry())
      .catch(() => this.refreshActivityIndexSubscribeEntry())
  },

  // 「报名中」tab 点击是活动订阅授权的真实用户手势入口（见 chooseTab）

  onPullDownRefresh() {
    this.loadList(1, () => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadList(this.data.page + 1)
  },

  chooseTab(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    // 「报名中」是用户明确点击的入口，在此同步申请活动订阅授权。（原有触发方式，保持不变）
    if (key === 'signing' && typeof subscribe.requestTriggerByTap === 'function') {
      subscribe.requestTriggerByTap('activityIndex')
    }
    // 「全部活动」/「我的参与」→ 申请「活动结果通知」授权（有意设置，勿删）：
    // activitySignupResult + activityStart + activitySignup，
    // 与活动详情页「报名成功」共用同一个 activitySignup 触发组。
    if ((key === 'all' || key === 'mine') && typeof subscribe.requestTriggerByTap === 'function') {
      subscribe.requestTriggerByTap('activitySignup')
    }
    if (key === this.data.activeTab) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ activeTab: key, page: 1, list: [], loaded: false })
    this.loadList(1)
  },

  loadList(page, done) {
    this.setData({ loading: true })
    // 请求序号守卫：允许新请求立即发起（递增序号使在途旧请求失效），
    // 晚到的旧响应一律丢弃，避免旧 Tab 数据覆盖/追加进当前列表，也避免快速切 Tab 时新加载被吞掉
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1)
    const currentPage = page || 1
    api.getActivities(this.data.activeTab, '', currentPage).then((res) => {
      if (seq !== this._loadSeq) return
      const list = ((res && res.list) || []).map((item) => Object.assign({}, item, {
        badgeText: BADGE_TEXT[item.badge] || '',
        campusText: campusText(item.campus),
        dateText: shortDate(item.activityStart) || shortDate(item.signupStart) || '待定',
        placeText: item.location || item.address || '待定',
        quotaText: item.remaining === null
          ? '名额不限'
          : (item.remaining > 0 ? '仅剩' + item.remaining + '个名额' : '名额已满')
      }))
      this.setData({
        list: currentPage <= 1 ? list : this.data.list.concat(list),
        page: currentPage,
        hasMore: !!(res && res.hasMore),
        loaded: true,
        loading: false
      })
      if (typeof done === 'function') done()
    }).catch(() => {
      if (seq !== this._loadSeq) return
      this.setData({ loaded: true, loading: false })
      if (typeof done === 'function') done()
    })
  },

  onActivityTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 新增触发点：点击活动卡片（进入详情）→ 申请「活动订阅」授权（activityIndex 组）。
    // 与「报名中」tab 同一个触发组，模板为 activityNew + activityJoined + activitySignupNotice。
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('activityIndex')
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pkg-feature/pages/activity/detail?id=' + id })
  },

  // 发起活动：先弹出首次入驻引导弹窗（每次点击都弹出，参照图五样式）
  onCreate() {
    // 新增触发点：点击「发起活动」浮动按钮 → 申请「活动审核通知」授权
    // （activityAudit，与发布活动成功后的触发点共用同一个 activityPublish 组）。
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('activityPublish')
    wx.vibrateShort({ type: 'light' })
    this.setData({ showModal: true })
  },

  onCloseModal() {
    this.setData({ showModal: false })
  },

  // 加入微信意见群：管理员未配置时给出提示
  onJoinOpinionGroup() {
    wx.showToast({ title: '管理员暂未配置微信意见群', icon: 'none' })
  },

  // 「稍后再说」→ 仅关闭弹窗（放弃本次发起）
  onLater() {
    this.setData({ showModal: false })
  },

  // 「我已知晓，去发起活动」→ 关闭弹窗并进入发起活动页
  onGoPublish() {
    this.setData({ showModal: false })
    wx.navigateTo({ url: '/pkg-feature/pages/activity/publish' })
  },

  noop() {}
})
