// 跳转路径选择器（后台通用组件）
//
// 为什么抽成组件：后台有 5 处要配跳转路径（首页轮播 / 发布横幅 / 公告右侧链接 /
// 推送群卡片 / 自定义页面底部按钮）。各写一份必然分叉 —— 之前首页轮播修好了，
// 别处还是「手打路径 + 只认 /pages/」，运营换个入口又踩同样的坑。
//
// 三个模式，都不让运营直接面对路径字符串：
//   选页面 —— 从 utils/page-list.js 的清单里搜中文名
//   选帖子 —— 搜标题/正文/作者，选中自动拼 /pages/post-detail/index?id=N
//   手动输入 —— 外链、以及清单外的带参详情页；失焦时自动纠错
//
// 对外只有一个出口：`change` 事件带 { value }，宿主把它写进自己的表单字段即可。
// 校验（格式 + 页面存在性）留给宿主在保存前做，组件只负责「选得对、填得对」。
//
// ⚠ 必须放主包 components/：pkg-admin 与 pkg-feature 都要用，
//   而分包之间不能互相引用（分包只能引主包）。
// ⚠ 组件内不得依赖 pkg-admin/utils/admin.js（子包文件，主包引不到），
//   帖子搜索直接用 utils/request 打同一个接口（与 pkg-admin/utils/admin.js 的 posts 一致）。
const pageList = require('../../utils/page-list')
const link = require('../../utils/link')
const format = require('../../utils/format')
const request = require('../../utils/request')

// 与 pkg-admin/utils/admin.js 的 `posts: (data) => get('/posts', data)` 同一接口
const POST_SEARCH_PATH = '/admin/posts'

Component({
  properties: {
    // 当前路径（宿主表单里的值）
    value: { type: String, value: '', observer: 'onValueChange' },
    placeholder: {
      type: String,
      value: '例如：/pkg-feature/pages/activity/index 或 https://...'
    },
    // 有些位置不需要「选帖子」（例如只给外部 H5 用的字段）
    postMode: { type: Boolean, value: true }
  },

  data: {
    mode: 'pick', // pick | post | manual
    // 输入框绑本地值而不是 property：直接绑 property 时，
    // 每次输入都「emit → 宿主 setData → observer 回写」，光标会被顶到末尾。
    innerValue: '',
    pageKeyword: '',
    pageResults: [],
    hint: '',
    postKeyword: '',
    postResults: [],
    postLoading: false,
    postSearched: false
  },

  lifetimes: {
    attached() {
      this.setData({
        innerValue: this.data.value || '',
        pageResults: pageList.PICKER_OPTIONS
      })
    },
    detached() {
      if (this._postTimer) clearTimeout(this._postTimer)
    }
  },

  methods: {
    onValueChange(v) {
      const next = String(v === undefined || v === null ? '' : v)
      if (next !== this.data.innerValue) this.setData({ innerValue: next })
    },

    // 统一的出口：改本地值 + 通知宿主
    emit(value) {
      this.setData({ innerValue: value })
      this.triggerEvent('change', { value })
    },

    // ===== 模式切换 =====
    onModeChange(e) {
      const raw = e.currentTarget.dataset.mode
      const mode = raw === 'manual' || raw === 'post' ? raw : 'pick'
      const current = String(this.data.innerValue || '').trim()
      const patch = { mode, hint: '' }
      if (mode === 'pick') {
        patch.pageKeyword = ''
        patch.pageResults = pageList.PICKER_OPTIONS
        if (current && !pageList.pageIndexOf(current) && !link.isWebUrl(current)) {
          patch.hint = current.indexOf('/pages/post-detail/index') === 0
            ? '当前填的是帖子详情页，用「选帖子」可以重新挑一个'
            : '当前填的是「' + current + '」，不在页面列表里（外链或详情页），请用「手动输入」'
        }
      } else if (mode === 'post') {
        if (current && current.indexOf('/pages/post-detail/index') !== 0) {
          patch.hint = '当前填的不是帖子详情页；搜索并选中一个帖子会覆盖它'
        }
      }
      this.setData(patch)
    },

    // ===== 模式一：选页面 =====
    onPageSearch(e) {
      const kw = String((e.detail && e.detail.value) || '')
      this.setData({ pageKeyword: kw, pageResults: pageList.searchPages(kw) })
    },

    // 用 data-path 传路径：列表是过滤后的，拿下标回查原清单必然错位
    onPagePickItem(e) {
      const path = String(e.currentTarget.dataset.path || '')
      if (!path) return
      const name = pageList.nameOf(path) || path
      this.setData({ hint: '已选页面：' + name })
      this.emit(path)
    },

    // ===== 模式二：选帖子 =====
    onPostSearchInput(e) {
      const kw = String((e.detail && e.detail.value) || '')
      this.setData({ postKeyword: kw })
      // 防抖：不然每敲一个字都打一次接口
      if (this._postTimer) clearTimeout(this._postTimer)
      this._postTimer = setTimeout(() => this.searchPosts(), 400)
    },

    async searchPosts() {
      const kw = String(this.data.postKeyword || '').trim()
      if (!kw) {
        this.setData({ postResults: [], postSearched: false, postLoading: false })
        return
      }
      this.setData({ postLoading: true })
      try {
        const data = await request.get(POST_SEARCH_PATH, { keyword: kw, page: 1, pageSize: 10 }, true)
        const list = (data && data.list) || []
        this.setData({
          postResults: list.map((row) => {
            const timeText = format.formatRelativeTime(row.createdAt)
            return {
              id: row.id,
              // ⚠ 不能只读 title：论坛帖 title 基本是空的（实测 353 行里 352 行为空），
              // 主字段是 content。只读 title 会满屏「（无标题）」，认不出是哪条。
              title: format.postTitle(row) || '（无内容）',
              subText: [row.nickName || '匿名', row.category, timeText].filter(Boolean).join(' · ')
            }
          }),
          postSearched: true
        })
      } catch (err) {
        this.setData({ postResults: [], postSearched: true })
        wx.showToast({ title: (err && err.message) || '搜索失败', icon: 'none' })
      } finally {
        this.setData({ postLoading: false })
      }
    },

    // 选中帖子 → 拼出详情页路径，运营不用知道帖子 id
    onPostPickItem(e) {
      const id = Number(e.currentTarget.dataset.id)
      const path = pageList.postDetailPath(id)
      if (!path) return
      const hit = this.data.postResults.filter((r) => r.id === id)[0]
      this.setData({ hint: '已选帖子：' + (hit ? hit.title : id) })
      this.emit(path)
    },

    // ===== 模式三：手动输入 =====
    onManualInput(e) {
      this.emit(String((e.detail && e.detail.value) || ''))
    },

    // 失焦归一化：.html / 缺斜杠 / 站点域名 这类写法自动修掉，
    // 并明确告诉运营改了什么（而不是默默改掉让人对不上）。
    onManualBlur(e) {
      const raw = String((e.detail && e.detail.value) || '').trim()
      const fixed = link.normalizePagePath(raw)
      if (fixed.changed) {
        this.setData({ hint: '已自动修正为 ' + fixed.value + '（' + fixed.notes.join('、') + '）' })
        this.emit(fixed.value)
        return
      }
      this.emit(raw)
      this.setData({ hint: '' })
    }
  }
})
