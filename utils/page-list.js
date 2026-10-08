// 小程序「可跳转页面」清单 —— 后台配跳转路径时的候选来源。
//
// 为什么要有这个文件：让管理员手打 `/pkg-feature/pages/activity/index` 这种路径本来就不合理
// （不知道前缀、容易带 .html、容易拼错）。后台改成从清单里选中文名，路径由这里统一维护。
//
// ⚠ 清单必须**覆盖 app.json 里的每一个页面** —— 要么在这里，要么在下面的 EXCLUDED 里
// 并写明理由。漏登记会让某个页面永远选不到，而这是静默的。
// 由 server/tests/miniprogram-page-list.test.js 守卫（逐项比对 app.json）。
//
// 只列「不带参数就能正常打开」的页面；详情页（需要 id / postId / url）不在此列，
// 后台保留手动输入给这类页面与外链。

const PAGE_GROUPS = [
  {
    label: '常用入口',
    pages: [
      ['首页', '/pages/index/index'],
      ['课程表', '/pages/schedule/index'],
      ['代拿跑腿', '/pages/errand/index'],
      ['我的', '/pages/user/index']
    ]
  },
  {
    label: '跑腿',
    pages: [
      ['发布跑腿', '/pages/errand-publish/index'],
      ['跑腿订单', '/pages/errand-order/index'],
      ['跑腿消息', '/pages/errand-message/index']
    ]
  },
  {
    label: '校园服务',
    pages: [
      ['全部服务', '/pkg-feature/pages/service-all/index'],
      ['校园地图', '/pkg-feature/pages/campus-map/index'],
      ['找驾校', '/pkg-feature/pages/driving-school/index'],
      ['学车指南', '/pkg-feature/pages/driving-school/guide'],
      ['校园圈学车', '/pkg-feature/pages/driving-school/landing'],
      ['校园市场', '/pkg-feature/pages/market/index'],
      ['广轻义修', '/pkg-feature/pages/repair/index'],
      ['骑手认证', '/pkg-feature/pages/rider-verify/index']
    ]
  },
  {
    label: '社区',
    pages: [
      ['每日热榜', '/pages/hot-rank/index'],
      ['发布帖子', '/pages/post-publish/index'],
      ['搜索', '/pages/search/index'],
      ['我的帖子', '/pages/my-posts/index'],
      ['我的互动', '/pages/my-interactions/index'],
      ['我的消息', '/pages/my-messages/index'],
      ['消息详情', '/pages/message-detail/index'],
      ['私信', '/pages/chat/index'],
      ['信息推送群', '/pages/push-groups/index']
    ]
  },
  {
    label: '社团与活动',
    pages: [
      ['社团&组织', '/pkg-feature/pages/club/index'],
      ['社团分类', '/pkg-feature/pages/club/detail'],
      ['申请社团', '/pkg-feature/pages/club/apply'],
      ['广轻群聊', '/pkg-feature/pages/group-chat/index'],
      ['群聊列表', '/pkg-feature/pages/group-chat/list'],
      ['申请群聊', '/pkg-feature/pages/group-chat/apply'],
      ['校园活动', '/pkg-feature/pages/activity/index'],
      ['发布活动', '/pkg-feature/pages/activity/publish'],
      ['校园评价', '/pkg-feature/pages/review/index'],
      ['评价列表', '/pkg-feature/pages/review/list'],
      ['发布评价', '/pkg-feature/pages/review/publish']
    ]
  },
  {
    label: '教务',
    pages: [
      ['教务系统', '/pkg-schedule/schedule-home/index'],
      ['校历', '/pkg-schedule/schedule-calendar/index'],
      ['考试安排', '/pkg-schedule/schedule-exam/index'],
      ['成绩查询', '/pkg-schedule/schedule-grade/index'],
      ['课表识别', '/pkg-schedule/schedule-ocr/index'],
      ['教务登录', '/pkg-schedule/schedule-login/index'],
      ['课表编辑', '/pkg-schedule/schedule-edit/index'],
      ['添加课程', '/pkg-schedule/schedule-add/index']
    ]
  },
  {
    label: '账户与设置',
    pages: [
      ['账户设置', '/pkg-user/pages/account-settings/index'],
      ['设置', '/pkg-user/pages/settings/index'],
      ['编辑资料', '/pkg-user/pages/profile-edit/index'],
      ['黑名单', '/pkg-user/pages/blacklist/index'],
      ['钱包', '/pkg-feature/pages/wallet/index'],
      ['登录', '/pages/login/index']
    ]
  },
  {
    label: '帮助与协议',
    pages: [
      ['公告', '/pkg-feature/pages/announcements/index'],
      ['关于我们', '/pkg-feature/pages/about/index'],
      ['用户协议', '/pkg-feature/pages/agreement/index'],
      ['隐私政策', '/pkg-feature/pages/privacy/index'],
      ['安全中心', '/pkg-feature/pages/security/index'],
      ['社区规范', '/pkg-feature/pages/rules/index'],
      ['意见反馈', '/pkg-feature/pages/feedback/index'],
      ['帮助中心', '/pkg-feature/pages/help/index']
    ]
  }
]

// 不能做跳转目标的页面 + 理由。这些页面要么必须带参数、要么是管理/编辑用途。
const EXCLUDED = {
  '/pages/errand-detail/index': '订单详情，必须带订单 id',
  '/pages/errand-chat/index': '订单沟通，必须带订单 id',
  '/pages/errand-complete/index': '完成订单，必须带订单 id',
  '/pages/errand-cancel/index': '取消订单，必须带订单 id',
  '/pages/campus-service/index': '校园服务详情，必须带服务 id',
  '/pages/post-detail/index': '帖子详情，必须带帖子 id',
  '/pages/profile/index': '用户主页，必须带用户 id',
  '/pages/share/index': '分享落地页，必须带 postId',
  '/pages/webview/index': '网页容器，必须带 url',
  '/pkg-admin/admin/index': '管理后台，不给运营配跳转',
  '/pkg-admin/admin/edit/index': '管理编辑页，不给运营配跳转',
  '/pkg-feature/pages/driving-school/detail': '驾校详情，必须带 id',
  '/pkg-feature/pages/club/club-detail': '社团详情，必须带 id',
  '/pkg-feature/pages/group-chat/detail': '群聊详情，必须带 id',
  '/pkg-feature/pages/activity/detail': '活动详情，必须带 id',
  '/pkg-feature/pages/review/target': '评价详情，必须带 id',
  '/pkg-feature/pages/poster/index': '海报生成，必须带 postId',
  '/pkg-feature/pages/banner-detail/index': '内容编辑页，不给运营配跳转'
}

// 平铺：[{ group, name, path }]
const PAGES = PAGE_GROUPS.reduce((all, g) => {
  g.pages.forEach(([name, path]) => all.push({ group: g.label, name, path }))
  return all
}, [])

const PAGE_PATH_SET = PAGES.reduce((m, p) => { m[p.path] = true; return m }, {})

// 路径 → 中文名（后台回填时把已存的路径显示成「校园活动」而不是一长串）
const NAME_BY_PATH = PAGES.reduce((m, p) => { m[p.path] = p.name; return m }, {})

// picker 的 range（配 range-key="label" 用）
const PICKER_OPTIONS = PAGES.map((p) => ({ label: p.group + ' / ' + p.name, path: p.path }))
const PICKER_LABELS = PICKER_OPTIONS.map((o) => o.label)

// 路径是否是清单里的可选项（忽略 query：详情页带参数时不算命中）
function pageIndexOf(path) {
  const key = String(path === undefined || path === null ? '' : path).trim().split('?')[0]
  for (let i = 0; i < PICKER_OPTIONS.length; i++) {
    if (PICKER_OPTIONS[i].path === key) return i
  }
  return -1
}

function nameOf(path) {
  const key = String(path === undefined || path === null ? '' : path).trim().split('?')[0]
  return NAME_BY_PATH[key] || ''
}

// 路径是否指向一个「真的能打开」的页面。空串表示通过，否则返回给管理员看的原因。
// 判据（宽进严出，避免误伤）：
//   - 不在站内（外链等）→ 不归这里管
//   - 在清单里 → 通过
//   - 不在清单但带 query → 视为详情页（如 /pages/post-detail/index?id=3），通过
//   - 其余 → 大概率是拼错了，拦下来
function pageExistenceReason(path) {
  const v = String(path === undefined || path === null ? '' : path).trim()
  if (!v || v.charAt(0) !== '/') return ''
  const bare = v.split('?')[0].split('#')[0]
  if (PAGE_PATH_SET[bare]) return ''
  if (v.indexOf('?') > -1) return ''
  return '没找到页面「' + bare + '」：请改用「从页面列表选」，或核对路径拼写'
}

// 帖子详情页路径。详情页需要帖子 id，不在可选清单里 ——
// 后台用「选帖子」搜出来点一下就自动填好，运营不用知道 id。
function postDetailPath(id) {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return ''
  return '/pages/post-detail/index?id=' + n
}

// 按关键词过滤页面（后台搜索框用）。空关键词返回全部。
// 中文名 / 分组 / 路径 三处任一命中即可，方便「活动」「社团」「schedule」都能搜到。
//
// ⚠ 结果要**按命中位置排序**，否则分组名会把结果冲散：搜「活动」时，
// 分组名「社团与活动」整体命中，会把「校园活动」「发布活动」压到后面去。
// 排序：中文名命中 > 分组命中 > 路径命中；同档保持清单原序（稳定）。
function searchPages(keyword) {
  const kw = String(keyword === undefined || keyword === null ? '' : keyword).trim().toLowerCase()
  if (!kw) return PICKER_OPTIONS
  const scored = []
  PICKER_OPTIONS.forEach((o, i) => {
    const page = PAGES[pageIndexOf(o.path)]
    const nameHit = !!(page && page.name.toLowerCase().indexOf(kw) > -1)
    const labelHit = o.label.toLowerCase().indexOf(kw) > -1
    const pathHit = o.path.toLowerCase().indexOf(kw) > -1
    if (!nameHit && !labelHit && !pathHit) return
    scored.push({ option: o, rank: nameHit ? 0 : (labelHit ? 1 : 2), order: i })
  })
  scored.sort((a, b) => (a.rank - b.rank) || (a.order - b.order))
  return scored.map((s) => s.option)
}

module.exports = {
  PAGE_GROUPS,
  EXCLUDED,
  PAGES,
  PAGE_PATH_SET,
  NAME_BY_PATH,
  PICKER_OPTIONS,
  PICKER_LABELS,
  pageIndexOf,
  nameOf,
  pageExistenceReason,
  postDetailPath,
  searchPages
}
