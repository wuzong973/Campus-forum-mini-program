const mock = require('./mock')

const THEME_ASSETS = {
  schedule: {
    id: 'schedule',
    tag: '课表助手',
    image: '/assets/banners/banner-schedule.png',
    accent: '#4A7AFF',
    link: '/pages/schedule/index'
  },
  community: {
    id: 'community',
    tag: '校园社区',
    image: '/assets/banners/banner-community.png',
    accent: '#7A5AF8',
    link: '/pages/index/index'
  },
  errand: {
    id: 'errand',
    tag: '生活互助',
    image: '/assets/banners/banner-errand.png',
    accent: '#FA8C16',
    link: '/pages/errand/index'
  }
}

function getPeriodLabel(date) {
  const hour = date.getHours()
  if (hour < 11) return '早八不慌'
  if (hour < 14) return '午间整理'
  if (hour < 18) return '下午安排'
  return '晚间校园'
}

function getNextCourse(courses, now) {
  const weekDay = now.getDay() === 0 ? 7 : now.getDay()
  const minutes = now.getHours() * 60 + now.getMinutes()
  return (courses || [])
    .filter((course) => course.weekDay === weekDay)
    .filter((course) => {
      const parts = String(course.startTime || '00:00').split(':').map(Number)
      return parts[0] * 60 + parts[1] >= minutes
    })
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')))[0]
}

function pickHotPost(posts) {
  return (posts || [])
    .slice()
    .sort((a, b) => {
      const scoreA = (a.likeCount || 0) * 2 + (a.commentCount || 0) * 3 + (a.shareCount || 0)
      const scoreB = (b.likeCount || 0) * 2 + (b.commentCount || 0) * 3 + (b.shareCount || 0)
      return scoreB - scoreA
    })[0]
}

function buildScheduleBanner(courses, now) {
  const next = getNextCourse(courses, now)
  const base = THEME_ASSETS.schedule
  if (next) {
    return Object.assign({}, base, {
      id: 'schedule-next',
      title: '下一节：' + next.name,
      subtitle: (next.startTime || '') + ' 上课' + (next.location ? ' · ' + next.location : ''),
      tag: getPeriodLabel(now)
    })
  }
  return Object.assign({}, base, {
    title: 'AI 课表助手',
    subtitle: '上传完整课表截图，自动拆解课程并按类型着色'
  })
}

function buildCommunityBanner(posts) {
  const hot = pickHotPost(posts)
  const base = THEME_ASSETS.community
  if (hot) {
    return Object.assign({}, base, {
      id: 'community-hot-' + hot.id,
      title: hot.title || '校园热帖正在发酵',
      subtitle: (hot.nickName || '同学') + ' · ' + (hot.commentCount || 0) + ' 条讨论',
      link: '/pages/post-detail/index?id=' + hot.id
    })
  }
  return Object.assign({}, base, {
    title: '有温度的校园社区',
    subtitle: '发现同校同好，发帖互动并一键发起私信'
  })
}

function buildErrandBanner(services) {
  const hasErrand = (services || []).some((item) => item.name === '代拿跑腿')
  return Object.assign({}, THEME_ASSETS.errand, {
    title: hasErrand ? '校园即时互助' : '生活服务入口',
    subtitle: hasErrand ? '课后取件、代拿跑腿、生活小事快速解决' : '订水、校园卡、教务系统，一屏直达',
    tag: hasErrand ? '跑腿服务' : '校园服务'
  })
}

function buildHomeBanners(options) {
  const now = options && options.now ? options.now : new Date()
  const banners = [
    buildScheduleBanner((options && options.courses) || [], now),
    buildCommunityBanner((options && options.posts) || []),
    buildErrandBanner((options && options.services) || mock.homeServices)
  ]
  return banners.map((item, index) => Object.assign({ order: index }, item))
}

module.exports = {
  buildHomeBanners
}
