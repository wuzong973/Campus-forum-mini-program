// 头像功能卡片（统一弹窗）：帖子详情页与评价详情页共用。
//
// 抽成组件的原因：这套逻辑（个人主页 / 私信 / 匿名私信分支 / 帖主标识 / 来源帖子透传）
// 原先只内联写在 pages/post-detail 里。评价详情页复刻评论区时整块漏掉，
// 导致「评价页点头像没反应」（2026-10-07 线上问题）。
// 抽成共享组件后两页用同一份实现，从根上消除第二份副本再次漂移的可能。
//
// 用法（页面 wxml 放 <avatar-sheet id="avatarSheet" />，页面 json 注册 usingComponents）：
//   this.selectComponent('#avatarSheet').open({
//     userId, nick, avatar, certLabel, isOwner, mode, allowAnonymousPm, fromPostId
//   })
//   mode: 'anon' 匿名（分身）用户 → 只给「私信」；'normal'（默认）→ 「个人主页」+「分身私信/私信」
const auth = require('../../utils/auth')
const anonymousIdentity = require('../../utils/anonymousIdentity')

Component({
  data: {
    // null = 关闭；对象 = 打开（字段见 open()）
    sheet: null
  },

  methods: {
    /**
     * 打开卡片
     * @param {object} options
     *   userId           必填，目标用户 id
     *   nick / avatar / certLabel  展示信息
     *   isOwner          是否帖主（显示「帖主 OP」角标）
     *   mode             'anon' | 'normal'
     *   allowAnonymousPm 对方是否允许分身私信（false 时按钮文案退化为「私信」并走普通私信）
     *   fromPostId       来源帖子 id，用于「个人主页 → 私信 → 回到帖子」链路透传；评价页传 0 即可
     */
    open(options) {
      const opts = options || {}
      if (!opts.userId) return
      const mode = opts.mode || 'normal'
      const fromPostId = Number(opts.fromPostId) || 0
      // 自己的头像：直接进个人主页，不弹卡片（分身/匿名分支不适用此规则）
      if (mode !== 'anon' && this.isSelfUser(opts.userId)) {
        wx.navigateTo({ url: this.profileUrl(opts.userId, fromPostId) })
        return
      }
      const allowed = opts.allowAnonymousPm !== false
      const ownerWording = opts.isOwner ? '帖主' : '对方'
      this.setData({
        sheet: {
          userId: opts.userId,
          nick: opts.nick || '校园同学',
          avatar: opts.avatar || '/assets/icons/avatar.png',
          certLabel: opts.certLabel || '',
          isOwner: !!opts.isOwner,
          mode,
          allowAnonymousPm: opts.allowAnonymousPm,
          fromPostId,
          actionLabel: allowed ? '分身私信' : '私信',
          tip: mode === 'anon'
            ? '这是一位分身用户'
            : (allowed
              ? ownerWording + '允许分身私信，进入主页可以进行普通私信'
              : ownerWording + '不允许分身私信')
        }
      })
    },

    close() {
      this.setData({ sheet: null })
    },

    // 弹层本体不响应点击（只有 mask 关闭），避免点内容区误关
    noop() {},

    onClose() {
      this.close()
    },

    isSelfUser(userId) {
      const userInfo = ((getApp().globalData || {}).userInfo) || wx.getStorageSync('userInfo') || {}
      return Number(userInfo.id) === Number(userId)
    },

    profileUrl(userId, fromPostId) {
      return '/pages/profile/index?id=' + userId + (fromPostId ? '&postId=' + fromPostId : '')
    },

    onProfile() {
      const sheet = this.data.sheet
      if (!sheet || !sheet.userId) return
      this.close()
      wx.navigateTo({ url: this.profileUrl(sheet.userId, sheet.fromPostId) })
    },

    onMessage() {
      const sheet = this.data.sheet
      if (!sheet || !sheet.userId) return
      if (!auth.requireLogin('私信需要先登录')) return
      const postSuffix = '&postId=' + (sheet.fromPostId || '')

      // 匿名（分身）用户私信：对方明确关闭时拦截
      if (sheet.mode === 'anon' && sheet.allowAnonymousPm === false) {
        this.close()
        wx.showToast({ title: '对方不允许分身私信', icon: 'none' })
        return
      }
      // 普通用户且对方关闭了分身私信 → 走普通私信渠道
      if (sheet.mode === 'normal' && sheet.allowAnonymousPm === false) {
        this.close()
        wx.navigateTo({
          url: '/pages/chat/index?peerId=' + sheet.userId +
            '&nick=' + encodeURIComponent(sheet.nick || '校园同学') +
            '&avatar=' + encodeURIComponent(sheet.avatar || '/assets/icons/avatar.png') +
            // 显式声明普通私信渠道，避免曾被匿名私信过的会话被强制切回匿名视图
            '&anonymous=0' + postSuffix
        })
        return
      }
      // 匿名（分身）私信
      wx.showModal({
        title: '分身私信',
        content: sheet.mode === 'anon'
          ? '与分身用户对话时，你也自动变为分身用户'
          : '开启对话后，你将以分身身份与对方交流',
        confirmText: '确认',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) return
          this.close()
          let extra = '&anonymous=1'
          if (sheet.mode !== 'anon') {
            // 发起方使用随机分身身份，服务端首次进入时存档，全程同一形象；
            // personaKey 以该分身头像为隔离键，不同分身各自对应独立聊天会话
            const persona = anonymousIdentity.generate()
            extra += '&personaKey=' + encodeURIComponent(persona.avatarUrl) +
              '&anonSelfNick=' + encodeURIComponent(persona.nickName) +
              '&anonSelfAvatar=' + encodeURIComponent(persona.avatarUrl)
          } else {
            // 与对方的某个分身对话：personaKey 用该分身头像作隔离键，
            // 对方其他分身（同一真实用户）的聊天记录不会出现在本会话
            extra += '&personaKey=' + encodeURIComponent(sheet.avatar || '/assets/icons/avatar.png')
          }
          wx.navigateTo({
            url: '/pages/chat/index?peerId=' + sheet.userId +
              '&nick=' + encodeURIComponent(sheet.nick || (sheet.mode === 'anon' ? '分身用户' : '校园同学')) +
              '&avatar=' + encodeURIComponent(sheet.avatar || '/assets/icons/avatar.png') +
              extra + postSuffix
          })
        }
      })
    }
  }
})
