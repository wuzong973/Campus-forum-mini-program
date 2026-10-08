const { STAR_LABELS, formatRelativeTime, targetSubtitle, decorateTarget } = require('../../utils/review')
const api = require('../../../utils/api')
const request = require('../../../utils/request')
const auth = require('../../../utils/auth')
const anonymousIdentity = require('../../../utils/anonymousIdentity')
const wechat = require('../../../utils/wechat')
const qr = require('../../../utils/qr')

const COMMENT_SORTS = [
  { key: 'time', label: '时间' },
  { key: 'likes', label: '赞数↓' }
]

function decorateComment(item) {
  return Object.assign({}, item, {
    timeText: formatRelativeTime(item.createdAt),
    liked: !!item.liked,
    // 评价评论支持图片（论坛评论同款）：老数据没有该字段时兜底空数组
    images: Array.isArray(item.images) ? item.images : [],
    parentId: Number(item.parentId) || 0,
    replies: [],
    replyCount: 0
  })
}

// 顶层评价排序：与「本页服务端」的 ORDER BY 完全同口径
//   服务端：time → `ORDER BY c.id DESC`；likes → `ORDER BY c.like_count DESC, c.id DESC`
// ⚠ 不能直接照搬帖子详情页的 sortComments —— 那边服务端 likes 的次级键是 created_at ASC，
//   与本页不同。客户端排序必须对齐各自服务端，否则「刷新后回到属于它的位置」会因
//   tie-break 不同而再跳一次。
function sortCommentRoots(roots, sort) {
  return roots.slice().sort((a, b) => {
    if (sort === 'time') return Number(b.id || 0) - Number(a.id || 0)
    return (b.likeCount || 0) - (a.likeCount || 0) || Number(b.id || 0) - Number(a.id || 0)
  })
}

// 把指定 id 的顶层评价移到最前（仅用于「刚提交那条」的临时置顶；已在首位或找不到则原样返回）
function moveToTopById(list, id) {
  const index = list.findIndex((item) => Number(item.id) === Number(id))
  if (index <= 0) return list
  const copy = list.slice()
  copy.unshift(copy.splice(index, 1)[0])
  return copy
}

// 把服务端的扁平列表拼成两级树（与论坛评论 buildCommentThreads 同款收口）：
// 顶层评价 + 其下全部回复；回复的父级必为顶层（服务端已收口），
// 若因分页边界导致父级缺失，则把该条降级为顶层，避免整条丢失。
//
// sort / pin 与帖子详情页同款语义（这是「评论后先显示在最上面，刷新后回到属于它的位置」的实现）：
//   · 顶层按 sort 排序，口径与服务端 ORDER BY 一致
//   · pin 只在「刚提交顶层评价」的那一次重建里生效，把它临时置顶；
//     刷新 / 翻页 / 切换排序都不传 pin，于是它回到真实排序位置
//   · 回复恒按 id 正序（= 服务端顺序）：新回复自然落在所属评价的回复列表末尾，
//     不重排任何已有回复 —— 回复不传 pin
function buildCommentTree(flat, expandedIds, sort, pin) {
  const expanded = expandedIds || {}
  const nodes = (flat || []).map(decorateComment)
  const byId = {}
  nodes.forEach((node) => { byId[node.id] = node })
  const roots = []
  // 沿父链上溯到顶层评价。
  // ⚠ parentId 存的是「实际被回复的那条」，可能是另一条回复（回复的回复），
  //   且链可以更深 —— 所以必须**循环**上溯，只往上找一层会让更深的回复掉成顶层。
  //   （与帖子详情页 buildCommentThreads 的 findRoot 同款。）
  const rootOf = (node) => {
    let current = node
    const seen = {}
    while (current && current.parentId && byId[current.parentId] && !seen[current.id]) {
      seen[current.id] = true
      current = byId[current.parentId]
    }
    return current
  }
  nodes.forEach((node) => {
    const root = rootOf(node)
    // 展示只保留两级：所有后代都平铺进所属顶层评价的 replies
    if (root && root.id !== node.id) root.replies.push(node)
    else roots.push(node)
  })
  // 「回复 xxx」前缀只在回复「回复」时显示；直接回复顶层评价不显示（与论坛评论一致）
  nodes.forEach((node) => {
    const parent = node.parentId ? byId[node.parentId] : null
    node.replyToNick = parent && parent.parentId ? parent.nickName : ''
  })

  let sortedRoots = sortCommentRoots(roots, sort)
  // pin.rootId：顶层新评价临时置顶；pin.afterId/replyId：回复子评论时临时插到被回复那条的正下方。
  // 两者都只在发布成功后的那次重建生效，刷新/翻页/切排序不带 pin，回归服务端真实排序。
  if (pin && pin.rootId) sortedRoots = moveToTopById(sortedRoots, pin.rootId)

  sortedRoots.forEach((root) => {
    // 回复按 id 正序（服务端同为 id ASC）：常规位置在列表末尾 = 被回复者之下
    const replies = root.replies.slice().sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
    // 回复子评论的乐观插入：把新回复临时挪到「被回复的那条子评论」正下方，
    // 让对话保持就近可读；刷新后不带 pin，按 id 正序回到列表末尾。
    // 只认 afterId 定位（被回复的子评论只会存在于一个顶层评价的回复列表里）。
    if (pin && pin.afterId && pin.replyId) {
      const replyIdx = replies.findIndex((r) => Number(r.id) === Number(pin.replyId))
      const afterIdx = replies.findIndex((r) => Number(r.id) === Number(pin.afterId))
      if (replyIdx > -1 && afterIdx > -1) {
        const node = replies.splice(replyIdx, 1)[0]
        replies.splice(afterIdx + 1, 0, node)
      }
    }
    root.replies = replies
    root.replyCount = replies.length
    root.expandedReplies = !!expanded[root.id]
    root.visibleReplies = root.expandedReplies ? replies : replies.slice(0, 3)
    replies.forEach((reply, replyIndex) => { reply.replyIndex = replyIndex })
  })
  return sortedRoots
}

Page({
  data: {
    targetId: 0,
    loading: true,
    loadFailed: false,
    notFound: false,
    target: null,
    subtitle: '',
    scoreText: '暂无',
    ratingCountText: '0人评分',
    stars: [1, 2, 3, 4, 5],
    myRating: 0,
    starLabels: STAR_LABELS,
    // ===== 多维度评分（食堂 / 商圈）=====
    // dimensions 为服务端下发的维度定义（含 weight 与分类措辞）；课程评分下发 []，端上走单一星级分支
    dimensions: [],
    dimsSupported: false,
    // 本次待提交的维度分 {taste:4, env:5, ...}；重新评分时由 myDims 回填
    myDims: {},
    // 四维是否都已选（控制「提交评分」按钮可用）
    dimsReady: false,
    dimSubmitting: false,
    // 渲染用扁平行（WXML 不做动态键取值，统一在 JS 里拼好）
    dimRows: [],
    // 各维度均分（服务端下发；无维度明细时为 null）
    dimAverages: null,
    commentSorts: COMMENT_SORTS,
    // 默认按赞数排序（热度优先），与帖子详情页口径一致
    commentSort: 'likes',
    comments: [],
    commentPage: 1,
    commentHasMore: true,
    commentLoading: false,
    inputText: '',
    sending: false,
    // 评论发布：图片（论坛评论同款，最多9张）与分身开关
    commentImages: [],
    commentAnonymous: false,
    liked: false,
    likeCount: 0,
    commentCount: 0,
    // 回复态：replyTo = 被回复的评论 id，replyToNick = 展示用昵称；0/'' 表示发顶层评价
    replyTo: 0,
    replyToNick: '',
    inputFocus: false,
    // 回复折叠记忆：{ [顶层评价id]: true } 表示已展开全部回复
    expandedReplyIds: {},
    // 表情面板（与帖子详情页同款表情组）
    showEmojiPanel: false,
    emojis: [
      '😀', '😂', '😍', '🥰', '😎', '😭', '👍', '👏',
      '🙏', '🔥', '❤️', '🎉', '🤔', '😋', '😴', '💪',
      '🌟', '😅', '🤝', '✨'
    ],
    // 当前登录用户 id：用于判断「这条评价是不是我自己发的」，
    // 是则展示「编辑 / 删除」行（与帖子详情页同款），否则走「…」菜单。
    currentUserId: 0,
    // 编辑评价弹窗
    showEditModal: false,
    editCommentId: 0,
    editContent: '',
    // 与服务端同构的扁平列表（跨页累积后整体拼树，避免回复与父级错位）
    commentFlat: []
  },

  onLoad(options) {
    const id = Number(options.id) || 0
    if (!id) {
      this.setData({ loading: false, loadFailed: true, notFound: true })
      return
    }
    this.setData({ targetId: id, currentUserId: Number(this.currentUserInfo().id) || 0 })
    this.loadDetail()
    this.reloadComments()
  },

  // 登录态可能在别的页面变化（登录/退出），回到本页时刷新一次，
  // 否则「编辑 / 删除」行的显隐会停留在旧状态。
  onShow() {
    this.setData({ currentUserId: Number(this.currentUserInfo().id) || 0 })
  },

  onPullDownRefresh() {
    Promise.all([this.loadDetail(), this.reloadComments()]).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadComments()
  },

  loadDetail() {
    return api.getReviewTargetDetail(this.data.targetId).then((res) => {
      const target = res && res.target
      if (!target || !target.id) {
        this.setData({ loading: false, loadFailed: true, notFound: true })
        return
      }
        const decorated = decorateTarget(target)
        // 根级食堂 / 商圈是容器（挂档口 / 店铺），本身不可评分：不显示分数与评分人数
        const rateable = target.rateable !== false
        const score = rateable && Number(target.ratingCount) > 0 ? Number(target.ratingAvg).toFixed(1) : '暂无'
        // 多维度评分（食堂 / 商圈）：服务端下发维度定义（含权重与分类措辞）与各维度均分；
        // 课程评分下发 []，端上走原来的单一星级分支。
        const dimensions = rateable && Array.isArray(target.dimensions) ? target.dimensions : []
        const myDims = (target.myDims && typeof target.myDims === 'object') ? target.myDims : {}
        this.setData({
          loading: false,
          loadFailed: false,
          target: decorated,
          subtitle: targetSubtitle(target),
          scoreText: rateable ? score : '',
          ratingCountText: rateable ? (Number(target.ratingCount) || 0) + '人评分' : '',
          myRating: Number(target.myRating) || 0,
          dimensions,
          dimsSupported: dimensions.length > 0,
          myDims,
          dimAverages: target.dimAverages || null,
          dimsReady: dimensions.length > 0 && dimensions.every((d) => Number(myDims[d.key]) >= 1),
          dimRows: this.buildDimRows(dimensions, myDims, target.dimAverages),
          liked: !!target.liked,
          likeCount: Number(target.likeCount) || 0,
          commentCount: Number(target.commentCount) || 0
        })
      wx.setNavigationBarTitle({ title: target.name || '评分详情' })
    }).catch((err) => {
      const notFound = err && (err.statusCode === 404)
      this.setData({ loading: false, loadFailed: true, notFound: !!notFound })
    })
  },

  // ===== 我的评分：再次点击可重新评分 =====
  onStarTap(e) {
    const score = Number(e.currentTarget.dataset.score)
    if (!score) return
    if (!auth.requireLogin('评分需要先登录')) return
    if (this.data.sending) return
    if (score === this.data.myRating) {
      wx.showToast({ title: '已评过 ' + score + ' 星，可点击其他星重新评分', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    wx.vibrateShort({ type: 'light' })
    api.rateReviewTarget(this.data.targetId, score).then((res) => {
      const ratingCount = Number((res && res.ratingCount) || 0)
      const ratingAvg = Number((res && res.ratingAvg) || 0)
      this.setData({
        myRating: score,
        sending: false,
        scoreText: ratingCount > 0 ? ratingAvg.toFixed(1) : '暂无',
        ratingCountText: ratingCount + '人评分',
        target: this.data.target
          ? Object.assign({}, this.data.target, { ratingAvg: ratingAvg, ratingCount: ratingCount })
          : this.data.target
      })
      wx.showToast({ title: STAR_LABELS[score - 1] + '！已打 ' + score + ' 星', icon: 'none' })
    }).catch(() => {
      this.setData({ sending: false })
    })
  },

  // ===== 多维度评分（食堂 / 商圈）=====
  // 把「维度定义 + 我的选择 + 各维度均分」拼成扁平行，避免在 WXML 里做动态键取值。
  buildDimRows(dimensions, myDims, dimAverages) {
    const dims = Array.isArray(dimensions) ? dimensions : []
    const mine = myDims || {}
    const avg = (dimAverages && typeof dimAverages === 'object') ? dimAverages : null
    return dims.map((d) => ({
      key: d.key,
      label: d.label,
      weight: d.weight,
      my: Number(mine[d.key]) || 0,
      // 该维度暂无带明细的评分时为 null，端上显示「—」
      avg: avg && avg[d.key] != null ? Number(avg[d.key]) : null
    }))
  },

  // 点某一维度的星：只更新该维度；四维齐了「提交评分」才可点
  onDimStarTap(e) {
    const ds = e.currentTarget.dataset
    const dim = String(ds.dim || '')
    const value = Number(ds.score)
    if (!dim || !value) return
    if (!auth.requireLogin('评分需要先登录')) return
    if (this.data.dimSubmitting) return
    const myDims = Object.assign({}, this.data.myDims, { [dim]: value })
    const dimensions = this.data.dimensions || []
    const dimsReady = dimensions.length > 0 && dimensions.every((d) => Number(myDims[d.key]) >= 1)
    wx.vibrateShort({ type: 'light' })
    this.setData({
      myDims,
      dimsReady,
      dimRows: this.buildDimRows(dimensions, myDims, this.data.dimAverages)
    })
  },

  // 提交多维度评分：四维一次性提交，服务端按权重算综合分
  onSubmitDims() {
    if (this.data.dimSubmitting) return
    if (!this.data.dimsReady) {
      wx.showToast({ title: '请把四项都选好', icon: 'none' })
      return
    }
    if (!auth.requireLogin('评分需要先登录')) return
    const dims = {}
    ;(this.data.dimensions || []).forEach((d) => { dims[d.key] = Number(this.data.myDims[d.key]) })
    this.setData({ dimSubmitting: true })
    api.rateReviewTarget(this.data.targetId, dims).then((res) => {
      const ratingCount = Number((res && res.ratingCount) || 0)
      const ratingAvg = Number((res && res.ratingAvg) || 0)
      const savedDims = (res && res.dims) || dims
      const dimAverages = (res && res.dimAverages) || this.data.dimAverages
      this.setData({
        dimSubmitting: false,
        myRating: Number((res && res.score) || 0),
        myDims: savedDims,
        dimAverages,
        dimRows: this.buildDimRows(this.data.dimensions, savedDims, dimAverages),
        scoreText: ratingCount > 0 ? ratingAvg.toFixed(1) : '暂无',
        ratingCountText: ratingCount + '人评分',
        target: this.data.target
          ? Object.assign({}, this.data.target, { ratingAvg: ratingAvg, ratingCount: ratingCount })
          : this.data.target
      })
      wx.showToast({ title: '已提交，综合分 ' + Number((res && res.score) || 0).toFixed(1), icon: 'none' })
    }).catch((err) => {
      this.setData({ dimSubmitting: false })
      wx.showToast({ title: (err && err.message) || '评分失败', icon: 'none' })
    })
  },

  // ===== 评价列表（两级树：顶层评价 + 其下回复）=====
  reloadComments() {
    this.setData({ commentPage: 1, comments: [], commentFlat: [], commentHasMore: true })
    return this.loadComments()
  },

  loadComments() {
    if (this.data.commentLoading || !this.data.commentHasMore) return Promise.resolve()
    this.setData({ commentLoading: true })
    const page = this.data.commentPage
    return api.getReviewComments(this.data.targetId, this.data.commentSort, page).then((res) => {
      // 累积扁平列表后再整体拼树：跨页返回时回复不会与父级错位
      const flat = (this.data.commentFlat || []).concat((res && res.list) || [])
      this.setData({
        commentFlat: flat,
        comments: buildCommentTree(flat, this.data.expandedReplyIds, this.data.commentSort),
        commentPage: page + 1,
        commentHasMore: !!(res && res.hasMore),
        commentLoading: false,
        // 计数一律以服务端为准（旧实现本地 +1，会与服务端真实值漂移）
        commentCount: Number((res && res.total) || 0) || this.data.commentCount
      })
    }).catch(() => {
      this.setData({ commentLoading: false, commentHasMore: false })
    })
  },

  onCommentSortTap(e) {
    const sort = e.currentTarget.dataset.sort
    if (!sort || sort === this.data.commentSort) return
    this.setData({ commentSort: sort })
    this.reloadComments()
  },

  // ===== 点赞：顶层与回复共用，需要按 id 在两级树里定位 =====
  // 定位评论在 comments 树中的路径下标（'comments[i]' 或 'comments[i].replies[j]'）
  locateComment(id) {
    const comments = this.data.comments || []
    for (let i = 0; i < comments.length; i += 1) {
      if (Number(comments[i].id) === Number(id)) return 'comments[' + i + ']'
      const replies = comments[i].replies || []
      for (let j = 0; j < replies.length; j += 1) {
        if (Number(replies[j].id) === Number(id)) return 'comments[' + i + '].replies[' + j + ']'
      }
    }
    return ''
  },

  findCommentById(id) {
    const comments = this.data.comments || []
    for (let i = 0; i < comments.length; i += 1) {
      if (Number(comments[i].id) === Number(id)) return comments[i]
      const hit = (comments[i].replies || []).find((r) => Number(r.id) === Number(id))
      if (hit) return hit
    }
    return null
  },

  onCommentLikeTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    if (!auth.requireLogin('点赞需要先登录')) return
    const path = this.locateComment(id)
    const item = this.findCommentById(id)
    if (!path || !item) return
    // 乐观更新，失败回滚
    const nextLiked = !item.liked
    const patch = {}
    patch[path + '.liked'] = nextLiked
    patch[path + '.likeCount'] = Math.max(0, Number(item.likeCount) + (nextLiked ? 1 : -1))
    this.setData(patch)
    api.likeReviewComment(id).then((res) => {
      this.setData({
        [path + '.liked']: !!(res && res.liked),
        [path + '.likeCount']: Number((res && res.likeCount) || 0)
      })
    }).catch(() => {
      this.setData({
        [path + '.liked']: item.liked,
        [path + '.likeCount']: item.likeCount
      })
    })
  },

  // ===== 回复某条评价（与论坛评论一致：点评论内容区进入回复态） =====
  onReplyComment(e) {
    if (!auth.requireLogin('回复需要先登录')) return
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    const nick = e.currentTarget.dataset.nick || ''
    this.setData({ replyTo: id, replyToNick: nick, inputFocus: true })
  },

  onCancelReply() {
    this.setData({ replyTo: 0, replyToNick: '', inputFocus: false })
  },

  // 展开/收起某条顶层评价的回复（只定点更新该条的展示字段，不整表重建）
  onToggleReplies(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = (this.data.comments || [])[index]
    if (!item) return
    const expanded = !item.expandedReplies
    this.setData({
      ['comments[' + index + '].expandedReplies']: expanded,
      ['comments[' + index + '].visibleReplies']: expanded ? item.replies : item.replies.slice(0, 3),
      ['expandedReplyIds.' + item.id]: expanded
    })
  },

  // 沿 parentId 上溯到顶层评价 id（服务端已收口为两级，但历史脏数据可能更深）。
  // 用途：回复提交后自动展开「所属顶层评价」的回复列表，让新回复立即可见。
  findCommentRootId(id) {
    const byId = {}
    ;(this.data.commentFlat || []).forEach((c) => { byId[Number(c.id)] = c })
    let current = byId[Number(id)]
    let guard = 0
    while (current && current.parentId && byId[Number(current.parentId)] && guard < 10) {
      current = byId[Number(current.parentId)]
      guard += 1
    }
    return current ? Number(current.id) : 0
  },

  // ===== 评论「…」更多菜单（与帖子详情页同款四项：隐藏 / 举报 / 拉黑 / 删除）=====
  // 权限口径与 post-detail 的 canDeleteOtherComment 对齐，但收紧了一档：
  // 评分对象是公共条目、没有「帖子作者」这一角色，因此不开放
  // 「条目创建者可删他人评论」。删除权只给「管理员」与「评论作者本人」。
  currentUserInfo() {
    const app = getApp()
    return ((app.globalData || {}).userInfo) || wx.getStorageSync('userInfo') || {}
  },

  canManageComments() {
    return ['super_admin', 'content_admin'].indexOf(this.currentUserInfo().role) > -1
  },

  onCommentMore(e) {
    if (!auth.requireLogin('操作评论需要先登录')) return
    const ds = e.currentTarget.dataset
    const commentId = Number(ds.id) || 0
    const userId = Number(ds.userid) || 0
    const nick = ds.nick || '该用户'
    if (!commentId) return

    // 自己的评价不提供举报/拉黑/删除：正文下方已有「编辑 / 删除」入口，
    // 两个入口语义重叠会让人困惑（与帖子详情页同款收口）。
    // 注意：内层 item 的 userId 必须真的带上，否则 isOwner 恒为 false。
    const isOwner = userId > 0 && userId === Number(this.data.currentUserId)
    const base = isOwner ? ['隐藏'] : ['隐藏', '举报', '拉黑']
    const itemList = (this.canManageComments() && !isOwner) ? ['删除'].concat(base) : base

    wx.showActionSheet({
      itemList,
      success: (res) => {
        const selected = itemList[res.tapIndex]
        if (selected === '删除') this.deleteCommentAsModerator(commentId)
        else if (selected === '隐藏') this.hideComment(commentId)
        else if (selected === '举报') this.reportComment(commentId)
        else if (selected === '拉黑') this.blockCommentAuthor(userId, nick)
      }
    })
  },

  // ===== 自己的评价：编辑 / 删除（对应正文下方的两个入口）=====
  onEditComment(e) {
    if (!auth.requireLogin('编辑需要先登录')) return
    const ds = e.currentTarget.dataset
    const id = Number(ds.id) || 0
    if (!id) return
    this.setData({
      showEditModal: true,
      editCommentId: id,
      editContent: String(ds.content || '')
    })
  },

  onEditContentInput(e) {
    this.setData({ editContent: e.detail.value })
  },

  onCloseEditModal() {
    this.setData({ showEditModal: false, editCommentId: 0, editContent: '' })
  },

  onConfirmEdit() {
    const content = String(this.data.editContent || '').trim()
    if (!content) {
      wx.showToast({ title: '内容不能为空', icon: 'none' })
      return
    }
    const id = Number(this.data.editCommentId) || 0
    if (!id) return
    api.updateReviewComment(id, content).then(() => {
      // 定点更新该条内容（不整表重拉，避免打断滚动位置与展开态）
      const path = this.locateComment(id)
      if (path) this.setData({ [path + '.content']: content })
      const flat = (this.data.commentFlat || []).map((c) =>
        Number(c.id) === id ? Object.assign({}, c, { content }) : c)
      this.setData({ commentFlat: flat })
      this.onCloseEditModal()
      wx.showToast({ title: '编辑成功', icon: 'success' })
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || '编辑失败', icon: 'none' })
    })
  },

  // 删除自己的评价：服务端会连带删掉其下回复，本地也要一并移除，
  // 否则会残留「已被删除的回复」。确认文案按是否有回复区分。
  onDeleteComment(e) {
    const id = Number(e.currentTarget.dataset.id) || 0
    if (!id) return
    const removed = this.collectRemovableComments(this.data.commentFlat, [id])
    const replyCount = Math.max(0, removed.length - 1)
    wx.showModal({
      title: '确认删除',
      content: replyCount > 0
        ? '确定要删除这条评价吗？其下的 ' + replyCount + ' 条回复会一并删除。'
        : '确定要删除这条评价吗？',
      success: (res) => {
        if (!res.confirm) return
        api.deleteReviewComment(id).then((r) => {
          this.applyCommentRemoval(removed, id)
          if (r && Number(r.commentCount) >= 0) this.setData({ commentCount: Number(r.commentCount) })
          wx.showToast({ title: '删除成功', icon: 'success' })
        }).catch((err) => {
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
        })
      }
    })
  },

  // 本机隐藏：只影响当前设备展示，不落库（与帖子详情页一致）
  hideComment(commentId) {
    this.applyCommentRemoval(this.collectRemovableComments(this.data.commentFlat, [commentId]), commentId)
    wx.showToast({ title: '已隐藏该评价', icon: 'success' })
  },

  async reportComment(commentId) {
    if (!await this.confirmAction('举报评价', '确认提交举报吗？管理员将收到评价编号、举报人和提交时间。')) return
    try {
      await api.reportComment(commentId)
      wx.showToast({ title: '举报已提交', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '举报失败', icon: 'none' })
    }
  },

  async blockCommentAuthor(userId, nick) {
    if (!userId) return
    if (!await this.confirmAction('拉黑用户', '将拉黑「' + nick + '」并隐藏其全部评价与私信，确认继续吗？')) return
    try {
      await request.post('/message/block', { peerId: Number(userId) }, true)
      const blockedIds = (wx.getStorageSync('blocked_user_ids') || []).map(Number)
      if (blockedIds.indexOf(Number(userId)) === -1) {
        blockedIds.push(Number(userId))
        wx.setStorageSync('blocked_user_ids', blockedIds)
      }
      const seedIds = (this.data.commentFlat || [])
        .filter((comment) => Number(comment.userId) === Number(userId))
        .map((comment) => comment.id)
      this.applyCommentRemoval(this.collectRemovableComments(this.data.commentFlat, seedIds))
      wx.showToast({ title: '已拉黑', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '设置失败', icon: 'none' })
    }
  },

  // 删除评价评论（落库软删）：管理员可删他人；作者本人可删自己的。
  // 顶层评价连带其下回复，因此本地也按 collectRemovableComments 一并摘掉，避免留下孤儿。
  async deleteCommentAsModerator(commentId) {
    if (!await this.confirmAction('删除评价', '删除后该评价将不再展示（含其下回复），确认删除吗？')) return
    try {
      const res = await api.deleteReviewComment(commentId)
      this.applyCommentRemoval(this.collectRemovableComments(this.data.commentFlat, [commentId]), commentId)
      if (res && Number(res.commentCount) >= 0) this.setData({ commentCount: Number(res.commentCount) })
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
    }
  },

  // 收集「因移除某条而需要一并摘掉」的全部 id：
  // 摘顶层评价时连带其回复；摘回复时只摘自身。（与帖子详情页同款收口）
  collectRemovableComments(flat, seedIds) {
    const seeds = (seedIds || []).map(Number).filter(Boolean)
    if (!seeds.length) return []
    const all = flat || []
    const removed = seeds.slice()
    all.forEach((comment) => {
      const parentId = Number(comment.parentId) || 0
      const id = Number(comment.id) || 0
      if (parentId && seeds.indexOf(parentId) > -1 && removed.indexOf(id) === -1) removed.push(id)
    })
    return removed
  },

  // 本地摘除：同步维护 commentFlat / comments / commentCount，保持树与计数一致
  applyCommentRemoval(removeIds, anchorId) {
    const ids = (removeIds || []).map(Number).filter(Boolean)
    if (!ids.length) return
    const flat = (this.data.commentFlat || []).filter((c) => ids.indexOf(Number(c.id)) === -1)
    this.setData({
      commentFlat: flat,
      comments: buildCommentTree(flat, this.data.expandedReplyIds, this.data.commentSort),
      commentCount: Math.max(0, Number(this.data.commentCount || 0) - ids.length)
    })
    // 被移除的是当前回复目标时，退回顶层评价态，避免回复指向不存在的评论
    if (anchorId && Number(this.data.replyTo) === Number(anchorId)) {
      this.setData({ replyTo: 0, replyToNick: '' })
    }
  },

  confirmAction(title, content) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },

  // ===== 对象点赞 =====
  onTargetLikeTap() {
    if (!auth.requireLogin('点赞需要先登录')) return
    const prevLiked = this.data.liked
    const prevCount = this.data.likeCount
    this.setData({ liked: !prevLiked, likeCount: Math.max(0, prevCount + (prevLiked ? -1 : 1)) })
    api.likeReviewTarget(this.data.targetId).then((res) => {
      this.setData({
        liked: !!(res && res.liked),
        likeCount: Number((res && res.likeCount) || 0)
      })
    }).catch(() => {
      this.setData({ liked: prevLiked, likeCount: prevCount })
    })
  },

  // ===== 发布评价 =====
  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  // ===== 表情面板（与帖子详情页同款）=====
  toggleEmojiPanel() {
    if (!auth.requireLogin('发布评价需要先登录')) return
    this.setData({ showEmojiPanel: !this.data.showEmojiPanel, inputFocus: false })
  },

  onEmojiTap(e) {
    const emoji = e.currentTarget.dataset.emoji || ''
    if (!emoji) return
    this.setData({ inputText: (this.data.inputText || '') + emoji })
  },

  // 分身开关：开启后本次发布以随机分身身份展示（论坛评论同款规范）
  onToggleAnonymous() {
    if (!auth.requireLogin('发布评价需要先登录')) return
    this.setData({ commentAnonymous: !this.data.commentAnonymous })
  },

  // ===== 评论区分身身份一致性 =====
  // 同一评分对象内复用同一个分身身份：本地按对象缓存（第一次用哪个，之后都是哪个），
  // 服务端还会按存档兜底（换设备时以服务端存档为准），与帖子评论页同款。
  loadReviewPersonaMap() {
    try { return wx.getStorageSync('anon_review_personas') || {} } catch (e) { return {} }
  },

  getOrCreateReviewPersona() {
    const map = this.loadReviewPersonaMap()
    const existing = map[this.data.targetId]
    if (existing && existing.nickName && existing.avatarUrl) return existing
    const persona = anonymousIdentity.generate()
    map[this.data.targetId] = persona
    try { wx.setStorageSync('anon_review_personas', map) } catch (e) {}
    return persona
  },

  saveReviewPersona(persona) {
    if (!persona || !persona.nickName || !persona.avatarUrl) return
    const map = this.loadReviewPersonaMap()
    map[this.data.targetId] = persona
    try { wx.setStorageSync('anon_review_personas', map) } catch (e) {}
  },

  // 选择评价配图：本地压缩上传，最多 9 张（与论坛评论一致）
  onPickCommentImage() {
    if (!auth.requireLogin('发布评价需要先登录')) return
    const left = 9 - this.data.commentImages.length
    if (left <= 0) {
      wx.showToast({ title: '最多上传9张图片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((file) => file.tempFilePath).filter(Boolean)
        if (!paths.length) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages(paths).then((urls) => {
          wx.hideLoading()
          const uploaded = (urls || []).filter(Boolean)
          this.setData({ commentImages: this.data.commentImages.concat(uploaded).slice(0, 9), showEmojiPanel: false })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        })
      }
    })
  },

  onRemoveCommentImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.commentImages.slice()
    if (index < 0 || index >= images.length) return
    images.splice(index, 1)
    this.setData({ commentImages: images })
  },

  onPreviewCommentImage(e) {
    const { url, urls } = e.currentTarget.dataset
    if (!url || !urls || !urls.length) return
    wx.previewImage({ current: url, urls })
  },

  // 长按评论图：识别二维码 / 保存图片（与帖子详情页同款）
  onImageQrScan(e) {
    const { url, urls } = e.currentTarget.dataset
    qr.recognize(url, urls)
  },

  onSend() {
    const content = String(this.data.inputText || '').trim()
    const images = this.data.commentImages
    if (!content && !images.length) {
      wx.showToast({ title: '说点什么再发布吧', icon: 'none' })
      return
    }
    if (!auth.requireLogin('评价需要先登录')) return
    if (this.data.sending) return
    this.setData({ sending: true })
    // 分身开启时取（或生成）本对象的固定分身身份：第一次用哪个，之后都是哪个
    const anonymous = this.data.commentAnonymous ? this.getOrCreateReviewPersona() : null
    const parentId = Number(this.data.replyTo) || 0
    const parentIdBackup = parentId
    const savedReplyToNick = this.data.replyToNick
    api.addReviewComment(this.data.targetId, content, images, anonymous, parentId).then((res) => {
      const comment = decorateComment(res && res.comment)
      // 服务端按评分对象存档复用分身身份：返回的身份与本地缓存不一致时（如换设备），以服务端为准
      const effectivePersona = (res && res.anonymousIdentity) || anonymous
      if (effectivePersona && anonymous) this.saveReviewPersona(effectivePersona)
      // parentNickName 由服务端回传（本地只有回复当下的昵称快照）
      const flat = (this.data.commentFlat || []).concat([comment])
      // 乐观定位（仅本次重建生效，刷新/翻页/切排序回归服务端真实排序）：
      // - 顶层新评价：置顶到评论区最上面（pin.rootId 触发 moveToTopById）；
      // - 回复顶层评价：不 pin，按 id 正序落在所属评价的回复列表末尾（被回复者之下）；
      // - 回复子评论：临时插到「被回复的那条子评论」正下方（afterId 锚点），就近可读。
      const parentComment = (this.data.commentFlat || []).find((c) => Number(c.id) === Number(parentId))
      const parentIsReply = !!(parentComment && Number(parentComment.parentId))
      const replyRootId = parentId ? this.findCommentRootId(parentId) : 0
      const expandedReplyIds = Object.assign({}, this.data.expandedReplyIds)
      if (replyRootId) expandedReplyIds[replyRootId] = true
      let pin = null
      if (!parentId) pin = { rootId: Number(comment.id) }
      else if (parentIsReply) pin = { afterId: Number(parentId), replyId: Number(comment.id) }
      this.setData({
        inputText: '',
        sending: false,
        commentImages: [],
        commentFlat: flat,
        expandedReplyIds,
        comments: buildCommentTree(flat, expandedReplyIds, this.data.commentSort, pin),
        // 计数以服务端重算结果为准，避免本地 +1 与服务端漂移
        commentCount: Number((res && res.commentCount) || this.data.commentCount + 1),
        replyTo: 0,
        replyToNick: '',
        inputFocus: false
      })
      wx.showToast({ title: parentIdBackup ? '已回复' : '已发布', icon: 'success' })
    }).catch(() => {
      this.setData({ sending: false, replyTo: parentIdBackup, replyToNick: savedReplyToNick })
    })
  },

  onAvatarError(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    this.setData({ [path + '.avatarUrl']: '' })
  },

  // 评论 / 回复头像：弹「个人主页 / 分身私信」卡片。
  // 卡片是共享组件 components/avatar-sheet（与帖子详情页同一份实现），
  // 这里只负责把 dataset 转成 open() 的参数 —— 不要再在本页另写一套弹层。
  onCommentAvatarTap(e) {
    const ds = e.currentTarget.dataset
    if (!ds.userid) return
    const sheet = this.selectComponent('#avatarSheet')
    if (!sheet) return
    sheet.open({
      userId: ds.userid,
      nick: ds.nick,
      avatar: ds.avatar,
      isOwner: ds.isowner,
      // 匿名（分身）用户只给「私信」；普通用户给「个人主页」+「分身私信/私信」
      mode: ds.anonymous ? 'anon' : 'normal',
      allowAnonymousPm: ds.allowpm,
      // 评价页没有「来源帖子」，个人主页→私信链路不带 postId
      fromPostId: 0
    })
  },

  noop() {}
})
