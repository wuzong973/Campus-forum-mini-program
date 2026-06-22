const _IMG = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?image_size=landscape_16_9&prompt='
const banners = [
  { id: 1, title: 'AI 智能课程表', subtitle: '拍照一键识别，告别手动录入', image: _IMG + 'flat%20vector%20illustration%20smartphone%20scanning%20university%20timetable%20paper%20with%20AI%20scan%20beam%2C%20calendar%20grid%20floating%20elements%2C%20blue%20%234A7AFF%20gradient%20background%2C%20minimal%20modern%20Chinese%20campus%20app%20banner%20style%2C%20clean%20UI%2C%20soft%20shadows', link: '/pages/schedule/index' },
  { id: 2, title: '代拿跑腿', subtitle: '试营业期间派单 9 折，极速送达', image: _IMG + 'flat%20vector%20illustration%20courier%20running%20with%20delivery%20box%20and%20food%20bag%20on%20campus%2C%20orange%20to%20red%20%23FF8E53%20gradient%20background%2C%20motion%20lines%2C%20minimal%20modern%20Chinese%20campus%20app%20banner%20style%2C%20clean%20UI%2C%20soft%20shadows', link: '/pages/errand/index' },
  { id: 3, title: '校园社区', subtitle: '分享生活日常，结识同好校友', image: _IMG + 'flat%20vector%20illustration%20college%20students%20chatting%20with%20speech%20bubbles%20and%20heart%20icons%2C%20purple%20%23722ED1%20gradient%20background%2C%20social%20connection%2C%20minimal%20modern%20Chinese%20campus%20app%20banner%20style%2C%20clean%20UI%2C%20soft%20shadows', link: '/pages/index/index' }
]

const homeServices = [
  { id: 1, name: '二手闲置', icon: '🛒', badge: '推荐', link: '' },
  { id: 2, name: '订水系统', icon: '💧', badge: '推荐', link: 'http://wx.dingbaoxiaoyuan.com/home' },
  { id: 3, name: '校园卡', icon: '💳', badge: '', link: '' },
  { id: 4, name: '宅印', icon: '🖨️', badge: '推荐', link: '' },
  { id: 5, name: '雨课堂', icon: '📚', badge: '推荐', link: '' },
  { id: 6, name: '校历', icon: '📅', badge: '新生', link: '' },
  { id: 7, name: '电脑义修', icon: '💻', badge: '推荐', link: '' },
  { id: 8, name: '信息门户', icon: '🏫', badge: '推荐', link: '' },
  { id: 9, name: '校园网', icon: '📶', badge: '', link: '' }
]

const allServiceSections = [
  {
    title: '平台自研',
    items: [
      { id: 101, name: '代拿跑腿', icon: '🏃', iconPath: '/assets/icons/errand-home.png', badge: '推荐' },
      { id: 102, name: '课程表', icon: '📋', iconPath: '/assets/icons/clipboard.png', badge: '推荐' },
      { id: 103, name: '社区论坛', icon: '💬', iconPath: '/assets/icons/post.png', badge: '' }
    ]
  },
  {
    title: '校园服务',
    items: homeServices
  },
  {
    title: '学习相关',
    items: [
      { id: 201, name: '图书馆', icon: '📖', badge: '' },
      { id: 202, name: '选课系统', icon: '📝', badge: '' },
      { id: 203, name: '成绩查询', icon: '📊', badge: '' },
      { id: 204, name: '考试安排', icon: '✏️', badge: '' },
      { id: 205, name: '教务系统', icon: '🎓', badge: '推荐', link: 'http://jw.gdip.edu.cn/jsxsd' }
    ]
  },
  {
    title: '生活服务',
    items: [
      { id: 301, name: '食堂菜单', icon: '🍜', badge: '推荐', miniAppId: 'wx7b3c69b4b6b348d5' },
      { id: 302, name: '校车时刻', icon: '🚌', badge: '' },
      { id: 303, name: '失物招领', icon: '🔍', badge: '' },
      { id: 304, name: '校园地图', icon: '️', badge: '新生' },
      { id: 305, name: '乘车码', icon: '🚇', badge: '推荐', miniAppId: 'wxe9f4a4df3ac90522' }
    ]
  },
  {
    title: '校园资讯',
    items: [
      { id: 401, name: '通知公告', icon: '📢', badge: '' }
    ]
  }
]

const categories = ['全部帖子', '日常分享', '旧书交易', '日常生活', '吃瓜爆料', '打听求助', '二手']

const posts = [
  { id: 1, userId: 1, nickName: '青山', avatarUrl: '', gender: 'male', category: '日常分享', content: '线上兼职 每天210左右 一单一结 平时和假期都可以', images: [], viewCount: 6, likeCount: 0, commentCount: 0, favoriteCount: 0, isLiked: false, isFavorited: false, createdAt: '2026-06-11T10:30:00' },
  { id: 2, userId: 2, nickName: '等春天', avatarUrl: '', gender: 'female', category: '日常分享', content: '现在到暑假都要人\n\n假都要人（主要负责线上事宜\n者暑假/课余时间都可以，\n天200左右，可保证收益\n291', images: [], viewCount: 4, likeCount: 0, commentCount: 0, favoriteCount: 0, isLiked: false, isFavorited: false, createdAt: '2026-06-11T09:15:00' },
  { id: 3, userId: 3, nickName: '乐乐的大米', avatarUrl: '', gender: 'male', category: '旧书交易', content: '收栗娟老师的世界旅游地理，2本', images: [], viewCount: 11, likeCount: 1, commentCount: 0, favoriteCount: 0, isLiked: false, isFavorited: false, createdAt: '2026-06-10T20:00:00' },
  { id: 4, userId: 4, nickName: 'hhhhhh_', avatarUrl: '', gender: 'female', category: '日常分享', content: '下周有一个校外礼仪活动，还缺6个女生，头发不能是浅色，正式活动是下周四（6月25日）下午2:30，周三下午3：00需要来彩排，外出车费学校报销，可以请公假，加学时（活动花了多少时间就加几个）\n感兴趣的同学可以联系我哦', images: [], viewCount: 245, likeCount: 0, commentCount: 0, favoriteCount: 0, isLiked: false, isFavorited: false, createdAt: '2026-06-10T15:39:00' },
  { id: 5, userId: 5, nickName: '11', avatarUrl: '', gender: 'male', category: '日常分享', content: '谁偷了我的寿司', images: [], viewCount: 361, likeCount: 0, commentCount: 2, favoriteCount: 0, isLiked: false, isFavorited: false, createdAt: '2026-06-10T14:21:00' }
]

const errandOrders = [
  { id: 1, type: '快递', campus: '佛山校区', title: '帮取菜鸟驿站快递', desc: '一个小包裹，不重', reward: 5, pickupAddr: '菜鸟驿站A区', deliveryAddr: '6号宿舍楼', status: 'pending', publisherName: '张同学', createdAt: '2026-06-17T11:00:00', itemCount: 1, timeLimit: '不限时间', genderReq: '不限性别', noUpstairs: false },
  { id: 2, type: '外卖', campus: '广州校区', title: '帮取外卖到图书馆', desc: '麦当劳，已付款', reward: 8, pickupAddr: '北门外卖柜', deliveryAddr: '图书馆3楼', status: 'pending', publisherName: '李同学', createdAt: '2026-06-17T10:45:00', itemCount: 2, timeLimit: '1小时内', genderReq: '不限性别', noUpstairs: false },
  { id: 3, type: '代办', campus: '佛山校区', title: '帮打印论文并送到办公室', desc: '黑白打印约20页', reward: 10, pickupAddr: '打印店', deliveryAddr: '行政楼201', status: 'pending', publisherName: '王同学', createdAt: '2026-06-17T09:30:00', itemCount: 1, timeLimit: '今天内', genderReq: '不限性别', noUpstairs: true }
]

// 我发布的订单
const myPublishedOrders = [
  { id: 101, type: '快递', campus: '广州校区', title: '帮取顺丰快递', desc: '中等箱子，需搬上3楼', reward: 6, pickupAddr: '顺丰营业点', deliveryAddr: '8栋302', status: 'accepted', publisherName: '我', accepterName: '陈同学', createdAt: '2026-06-16T15:00:00', itemCount: 1, timeLimit: '今天内', genderReq: '仅限男生', noUpstairs: false, role: 'publisher' },
  { id: 102, type: '外卖', campus: '广州校区', title: '代取奶茶', desc: '一点喜茶，已下单', reward: 4, pickupAddr: '喜茶(广州店)', deliveryAddr: '图书馆2楼', status: 'done', publisherName: '我', accepterName: '林同学', createdAt: '2026-06-15T14:20:00', itemCount: 2, timeLimit: '1小时内', genderReq: '不限性别', noUpstairs: false, role: 'publisher' },
  { id: 103, type: '快递', campus: '佛山校区', title: '取京东快递', desc: '小件', reward: 3, pickupAddr: '京东自提柜', deliveryAddr: '5栋101', status: 'pending', publisherName: '我', accepterName: '', createdAt: '2026-06-17T08:00:00', itemCount: 1, timeLimit: '不限时间', genderReq: '不限性别', noUpstairs: true, role: 'publisher' }
]

// 我接的订单
const myAcceptedOrders = [
  { id: 201, type: '快递', campus: '广州校区', title: '帮取菜鸟驿站大件', desc: '一个行李箱大小', reward: 12, pickupAddr: '菜鸟驿站B区', deliveryAddr: '12栋505', status: 'accepted', publisherName: '赵同学', accepterName: '我', createdAt: '2026-06-17T10:00:00', itemCount: 1, timeLimit: '2小时内', genderReq: '仅限男生', noUpstairs: false, role: 'accepter' },
  { id: 202, type: '代办', campus: '佛山校区', title: '代买教材', desc: '书店选购两本教材', reward: 8, pickupAddr: '校园书店', deliveryAddr: '教学楼A', status: 'done', publisherName: '孙同学', accepterName: '我', createdAt: '2026-06-14T09:30:00', itemCount: 2, timeLimit: '今天内', genderReq: '不限性别', noUpstairs: false, role: 'accepter' }
]

const courseColors = ['#4A7AFF', '#52C41A', '#FAAD14', '#FF4D4F', '#722ED1', '#13C2C2', '#EB2F96', '#FA8C16', '#2F54EB', '#A0D911', '#F759AB', '#36CFC9']

module.exports = {
  banners, homeServices, allServiceSections, categories, posts, errandOrders, myPublishedOrders, myAcceptedOrders, courseColors
}
