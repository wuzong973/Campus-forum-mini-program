const { STAR_LABELS, formatRelativeTime, targetSubtitle, decorateTarget } = require('../../utils/review')
const api = require('../../utils/api')
const request = require('../../utils/request')
const auth = require('../../utils/auth')
const anonymousIdentity = require('../../utils/anonymousIdentity')
const wechat = require('../../utils/wechat')

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

// 把服务端的扁平列表拼成两级树（与论坛评论 buildCommentThreads 同款收口）：
// 顶层评价 + 其下全部回复；回复的父级必为顶层（服务端已收口），
// 若因分页边界导致父级缺失，则把该条降级为顶层，避免整条丢失。
function buildCommentTree(flat, expandedIds) {
  const expanded = expandedIds || {}
  const nodes = (flat || []).map(decorateComment)
  const byId = {}
  nodes.forEach((node) => { byId[node.id] = node })
  const roots = []
  nodes.forEach((node) => {
    let parent = node.parentId ? byId[node.parentId] : null
    // 防御性收口：父级本身也是回复时（历史脏数据 / 未走服务端收口的写入），
    // 上溯到其所属顶层评价，保证「只两级」且该条不会丢掉。
    if (parent && parent.parentId) parent = byId[parent.parentId] || null
    if (parent && !parent.parentId) parent.replies.push(node)
    else roots.push(node)
  })
  // 「回复 xxx」前缀只在回复「回复」时显示；直接回复顶层评价不显示（与论坛评论一致）
  nodes.forEach((node) => {
    const parent = node.parentId ? byId[node.parentId] : null
    node.replyToNick = parent && parent.parentId ? parent.nickName : ''
  })
  // 每条顶层评价的回复区：默认最多显示 2 条，超出折叠（展开态按 id 记忆，翻页/重排不丢）
  roots.forEach((root) => {
    const replies = root.replies
    root.replyCount = replies.length
    root.expandedReplies = !!expanded[root.id]
    root.visibleReplies = root.expandedReplies ? replies : replies.slice(0, 2)
    root.replies.forEach((reply, replyIndex) => { reply.replyIndex = replyIndex })
  })
  return roots
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
    commentSorts: COMMENT_SORTS,
    commentSort: 'time',
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
      this.setData({
        loading: false,
        loadFailed: false,
        target: decorated,
        subtitle: targetSubtitle(target),
        scoreText: rateable ? score : '',
        ratingCountText: rateable ? (Number(target.ratingCount) || 0) + '人评分' : '',
        myRating: Number(target.myRating) || 0,
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
        comments: buildCommentTree(flat, this.data.expandedReplyIds),
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
      ['comments[' + index + '].visibleReplies']: expanded ? item.replies : item.replies.slice(0, 2),
      ['expandedReplyIds.' + item.id]: expanded
    })
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
      comments: buildCommentTree(flat, this.data.expandedReplyIds),
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

  // 分身开关：开启后本次发布以随机分身身份展示（论坛评论同款规范）
  onToggleAnonymous() {
    if (!auth.requireLogin('发布评价需要先登录')) return
    this.setData({ commentAnonymous: !this.data.commentAnonymous })
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
          this.setData({ commentImages: this.data.commentImages.concat(uploaded).slice(0, 9) })
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
    // 分身开启时生成随机分身身份（昵称 + 头像），与论坛评论的匿名规范一致
    const anonymous = this.data.commentAnonymous ? anonymousIdentity.generate() : null
    const parentId = Number(this.data.replyTo) || 0
    const parentIdBackup = parentId
    const savedReplyToNick = this.data.replyToNick
    api.addReviewComment(this.data.targetId, content, images, anonymous, parentId).then((res) => {
      const comment = decorateComment(res && res.comment)
      // parentNickName 由服务端回传（本地只有回复当下的昵称快照）
      const flat = (this.data.commentFlat || []).concat([comment])
      this.setData({
        inputText: '',
        sending: false,
        commentImages: [],
        commentFlat: flat,
        comments: buildCommentTree(flat, this.data.expandedReplyIds),
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

  noop() {}
})
