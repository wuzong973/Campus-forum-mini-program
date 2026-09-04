const PANORAMA_URL = 'https://www.720yun.com/t/32c23qigylw?scene_id=982404'

const CAMPUSES = {
  foshan: {
    key: 'foshan',
    name: '佛山校区',
    fullName: '广东轻工职业技术大学（南海校区北区）',
    address: '佛山市南海区信息大道中 18 号',
    latitude: 23.1541,
    longitude: 113.0312,
    scale: 16,
    polygon: [
      { latitude: 23.1580, longitude: 113.0275 },
      { latitude: 23.1584, longitude: 113.0342 },
      { latitude: 23.1510, longitude: 113.0350 },
      { latitude: 23.1495, longitude: 113.0290 },
      { latitude: 23.1534, longitude: 113.0268 }
    ],
    places: [
      ['南海校区北区 1 号门', 23.157304, 113.031196, '校园主入口'],
      ['图书馆', 23.15435, 113.03055, '自习与借阅'],
      ['教学楼', 23.15515, 113.03210, '公共教学区'],
      ['学生食堂', 23.15290, 113.03155, '餐饮服务'],
      ['学生宿舍区', 23.15145, 113.03025, '生活区'],
      ['体育场', 23.15305, 113.03330, '运动场地']
    ]
  },
  guangzhou: {
    key: 'guangzhou',
    name: '广州校区',
    fullName: '广东轻工职业技术大学（广州新港校区）',
    address: '广州市海珠区新港西路 152 号',
    latitude: 23.091902,
    longitude: 113.307005,
    scale: 16,
    polygon: [
      { latitude: 23.094498, longitude: 113.303670 },
      { latitude: 23.094607, longitude: 113.309630 },
      { latitude: 23.089706, longitude: 113.309931 },
      { latitude: 23.089197, longitude: 113.304521 },
      { latitude: 23.091446, longitude: 113.303169 }
    ],
    places: [
      ['新港校区正门', 23.092100, 113.305623, '新港西路 152 号'],
      ['图书馆', 23.092853, 113.307526, '自习与借阅'],
      ['教学楼', 23.091554, 113.308127, '公共教学区'],
      ['学生食堂', 23.090701, 113.307025, '餐饮服务'],
      ['运动场', 23.090449, 113.305322, '运动场地'],
      ['行政办公区', 23.093201, 113.306324, '办事服务']
    ]
  }
}

function buildMarkers(campus) {
  return campus.places.map((place, index) => ({
    id: index + 1,
    latitude: place[1],
    longitude: place[2],
    width: 30,
    height: 38,
    anchor: { x: 0.5, y: 1 },
    callout: {
      content: place[0],
      color: '#1f2a44',
      fontSize: 11,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#e7edf8',
      bgColor: '#ffffff',
      padding: 5,
      display: 'BYCLICK'
    }
  }))
}

Page({
  data: {
    statusBarHeight: 20,
    campusKey: 'foshan',
    campus: CAMPUSES.foshan,
    latitude: CAMPUSES.foshan.latitude,
    longitude: CAMPUSES.foshan.longitude,
    scale: CAMPUSES.foshan.scale,
    markers: buildMarkers(CAMPUSES.foshan),
    polygons: [{ points: CAMPUSES.foshan.polygon, strokeWidth: 3, strokeColor: '#315CFF', fillColor: '#315CFF16' }],
    satellite: false,
    campusPickerVisible: false,
    selectedPlace: { name: CAMPUSES.foshan.places[0][0], latitude: CAMPUSES.foshan.places[0][1], longitude: CAMPUSES.foshan.places[0][2], detail: CAMPUSES.foshan.places[0][3] },
    locating: false
  },

  onLoad() {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    this.mapCtx = wx.createMapContext('campusMap', this)
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
  },

  goBack() { wx.navigateBack() },

  openCampusPicker() { this.setData({ campusPickerVisible: true }) },
  closeCampusPicker() { this.setData({ campusPickerVisible: false }) },

  selectCampus(e) {
    const key = e.currentTarget.dataset.key
    const campus = CAMPUSES[key]
    if (!campus || key === this.data.campusKey) return this.closeCampusPicker()
    const first = campus.places[0]
    this.setData({
      campusKey: key,
      campus,
      latitude: campus.latitude,
      longitude: campus.longitude,
      scale: campus.scale,
      markers: buildMarkers(campus),
      polygons: [{ points: campus.polygon, strokeWidth: 3, strokeColor: '#315CFF', fillColor: '#315CFF16' }],
      selectedPlace: { name: first[0], latitude: first[1], longitude: first[2], detail: first[3] },
      campusPickerVisible: false
    })
    wx.vibrateShort({ type: 'light' })
  },

  toggleCampus() {
    const nextKey = this.data.campusKey === 'foshan' ? 'guangzhou' : 'foshan'
    this.selectCampus({ currentTarget: { dataset: { key: nextKey } } })
    wx.showToast({ title: `已切换至${CAMPUSES[nextKey].name}`, icon: 'none' })
  },

  toggleSatellite() {
    this.setData({ satellite: !this.data.satellite })
    wx.vibrateShort({ type: 'light' })
  },

  onMarkerTap(e) {
    const markerId = Number(e.detail.markerId) - 1
    const place = this.data.campus.places[markerId]
    if (!place) return
    this.setData({ selectedPlace: { name: place[0], latitude: place[1], longitude: place[2], detail: place[3] } })
    wx.vibrateShort({ type: 'light' })
  },

  zoom(e) {
    const next = Math.min(19, Math.max(13, this.data.scale + Number(e.currentTarget.dataset.step)))
    this.setData({ scale: next })
  },

  locateMe() {
    if (this.data.locating) return
    this.setData({ locating: true })
    wx.getLocation({
      type: 'gcj02',
      success: (res) => this.setData({ latitude: res.latitude, longitude: res.longitude, scale: 16 }),
      fail: () => wx.showToast({ title: '定位失败，请检查定位授权', icon: 'none' }),
      complete: () => this.setData({ locating: false })
    })
  },

  openPanorama() {
    if (this.data.campusKey !== 'foshan') {
      wx.showToast({ title: '全景目前提供佛山校区', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/webview/index?title=' + encodeURIComponent('佛山校区全景') + '&url=' + encodeURIComponent(PANORAMA_URL) })
  },

  openNavigation() {
    const place = this.data.selectedPlace
    wx.openLocation({ latitude: place.latitude, longitude: place.longitude, name: place.name, address: this.data.campus.address, scale: 18 })
  }
})
