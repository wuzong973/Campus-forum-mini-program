const { STAR_LABELS, formatRelativeTime, targetSubtitle, decorateTarget } = require('../../utils/review')
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const COMMENT_SORTS = [
  { key: 'time', label: '时间' },
  { key: 'likes', label: '赞数↓' }
]

function decorateComment(item) {
  return Object.assign({}, item, {
    timeText: formatRelativeTime(item.createdAt),
    liked: !!item.liked
  })
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
    liked: false,
    likeCount: 0,
    commentCount: 0
  },

  onLoad(options) {
    const id = Number(options.id) || 0
    if (!id) {
      this.setData({ loading: false, loadFailed: true, notFound: true })
      return
    }
    this.setData({ targetId: id })
    this.loadDetail()
    this.reloadComments()
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
      const score = Number(target.ratingCount) > 0 ? Number(target.ratingAvg).toFixed(1) : '暂无'
      this.setData({
        loading: false,
        loadFailed: false,
        target: decorated,
        subtitle: targetSubtitle(target),
        scoreText: score,
        ratingCountText: (Number(target.ratingCount) || 0) + '人评分',
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

  // ===== 评价列表 =====
  reloadComments() {
    this.setData({ commentPage: 1, comments: [], commentHasMore: true })
    return this.loadComments()
  },

  loadComments() {
    if (this.data.commentLoading || !this.data.commentHasMore) return Promise.resolve()
    this.setData({ commentLoading: true })
    const page = this.data.commentPage
    return api.getReviewComments(this.data.targetId, this.data.commentSort, page).then((res) => {
      const items = ((res && res.list) || []).map(decorateComment)
      this.setData({
        comments: this.data.comments.concat(items),
        commentPage: page + 1,
        commentHasMore: !!(res && res.hasMore),
        commentLoading: false
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

  onCommentLikeTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    if (!auth.requireLogin('点赞需要先登录')) return
    const index = this.data.comments.findIndex((item) => item.id === id)
    if (index < 0) return
    // 乐观更新，失败回滚
    const item = this.data.comments[index]
    const nextLiked = !item.liked
    const patch = {}
    patch['comments[' + index + '].liked'] = nextLiked
    patch['comments[' + index + '].likeCount'] = Math.max(0, Number(item.likeCount) + (nextLiked ? 1 : -1))
    this.setData(patch)
    api.likeReviewComment(id).then((res) => {
      this.setData({
        ['comments[' + index + '].liked']: !!(res && res.liked),
        ['comments[' + index + '].likeCount']: Number((res && res.likeCount) || 0)
      })
    }).catch(() => {
      this.setData({
        ['comments[' + index + '].liked']: item.liked,
        ['comments[' + index + '].likeCount']: item.likeCount
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

  onSend() {
    const content = String(this.data.inputText || '').trim()
    if (!content) {
      wx.showToast({ title: '说点什么再发布吧', icon: 'none' })
      return
    }
    if (!auth.requireLogin('评价需要先登录')) return
    if (this.data.sending) return
    this.setData({ sending: true })
    api.addReviewComment(this.data.targetId, content).then((res) => {
      const comment = decorateComment(res && res.comment)
      const comments = this.data.commentSort === 'time' ? [comment].concat(this.data.comments) : this.data.comments
      this.setData({
        inputText: '',
        sending: false,
        comments,
        commentCount: this.data.commentCount + 1,
        commentHasMore: this.data.commentHasMore
      })
      wx.showToast({ title: '已发布', icon: 'success' })
    }).catch(() => {
      this.setData({ sending: false })
    })
  },

  onAvatarError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || !this.data.comments[index]) return
    this.setData({ ['comments[' + index + '].avatarUrl']: '' })
  },

  noop() {}
})
