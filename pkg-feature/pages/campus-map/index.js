const { runPullDownRefresh } = require('../../../utils/refresh')

const PANORAMA_URL = 'https://www.720yun.com/t/32c23qigylw?scene_id=982404'

const CAMPUSES = {
  foshan: {
    key: 'foshan',
    name: '佛山校区',
    fullName: '广东轻工职业技术大学（南海校区北区）',
    address: '佛山市南海区信息大道中 18 号',
    // 中心与围栏按腾讯地图官方 POI 数据校准（学校主体 23.158393,113.034639；
    // 1号门 23.15728,113.031209 / 2号门 23.155882,113.032223 /
    // 3号门 23.15768,113.03638 / 4号门 23.160352,113.029824）
    // 取景区中心 = AOI 质心；scale 15 可完整容纳南北 1265m 的校区（与图二取景一致）
    latitude: 23.159443,
    longitude: 113.035028,
    scale: 15,
    // 边界（58 个顶点）取自腾讯地图该校区 AOI 轮廓：以图二（腾讯地图截图）中
    // 4 个校门标记的像素位置 ↔ 官方坐标做线性标定（残差 <0.2px，等效 ~1.6m/px），
    // 再对虚线边界做提取、去毛刺、2-opt 消除自交，并把 4 个校门坐标吸附为顶点。
    // 校验：面积 ≈62.2 万㎡（933 亩），南北 1265m / 东西 1083m，无自交，
    // 四个校门均落在轮廓线上（0~1.3m）。改动请同步跑 campus-map-boundary 测试。
    polygon: [
      { latitude: 23.160025, longitude: 113.034852 },
      { latitude: 23.160687, longitude: 113.035694 },
      { latitude: 23.162002, longitude: 113.035653 },
      { latitude: 23.162447, longitude: 113.035872 },
      { latitude: 23.162968, longitude: 113.035818 },
      { latitude: 23.164267, longitude: 113.035006 },
      { latitude: 23.164809, longitude: 113.034815 },
      { latitude: 23.165084, longitude: 113.034923 },
      { latitude: 23.165142, longitude: 113.035232 },
      { latitude: 23.165111, longitude: 113.0364 },
      { latitude: 23.164937, longitude: 113.036698 },
      { latitude: 23.163531, longitude: 113.038113 },
      { latitude: 23.163023, longitude: 113.038125 },
      { latitude: 23.162159, longitude: 113.039195 },
      { latitude: 23.161878, longitude: 113.03935 },
      { latitude: 23.161183, longitude: 113.040243 },
      { latitude: 23.160985, longitude: 113.040335 },
      { latitude: 23.160767, longitude: 113.04026 },
      { latitude: 23.160189, longitude: 113.039694 },
      { latitude: 23.15936, longitude: 113.039314 },
      { latitude: 23.159299, longitude: 113.038918 },
      { latitude: 23.158783, longitude: 113.038498 },
      { latitude: 23.158446, longitude: 113.038407 },
      { latitude: 23.158438, longitude: 113.037639 },
      { latitude: 23.158663, longitude: 113.037367 },
      { latitude: 23.158677, longitude: 113.037039 },
      { latitude: 23.158095, longitude: 113.037024 },
      { latitude: 23.157825, longitude: 113.03638 },
      { latitude: 23.156651, longitude: 113.036274 },
      { latitude: 23.155626, longitude: 113.036259 },
      { latitude: 23.15494, longitude: 113.036624 },
      { latitude: 23.154276, longitude: 113.035755 },
      { latitude: 23.153812, longitude: 113.035389 },
      { latitude: 23.153743, longitude: 113.035 },
      { latitude: 23.153952, longitude: 113.034833 },
      { latitude: 23.155006, longitude: 113.035013 },
      { latitude: 23.15511, longitude: 113.034414 },
      { latitude: 23.154535, longitude: 113.034347 },
      { latitude: 23.154272, longitude: 113.032749 },
      { latitude: 23.155882, longitude: 113.032221 },
      { latitude: 23.156095, longitude: 113.031615 },
      { latitude: 23.157277, longitude: 113.031201 },
      { latitude: 23.157934, longitude: 113.030156 },
      { latitude: 23.15942, longitude: 113.029751 },
      { latitude: 23.15961, longitude: 113.02972 },
      { latitude: 23.160352, longitude: 113.029824 },
      { latitude: 23.160372, longitude: 113.030497 },
      { latitude: 23.160327, longitude: 113.031235 },
      { latitude: 23.160139, longitude: 113.031863 },
      { latitude: 23.160412, longitude: 113.032417 },
      { latitude: 23.160572, longitude: 113.032584 },
      { latitude: 23.161095, longitude: 113.032275 },
      { latitude: 23.161454, longitude: 113.032341 },
      { latitude: 23.162458, longitude: 113.033165 },
      { latitude: 23.162405, longitude: 113.033588 },
      { latitude: 23.162082, longitude: 113.033771 },
      { latitude: 23.161362, longitude: 113.033935 },
      { latitude: 23.160545, longitude: 113.033795 },
    ],
    gates: [
      { name: '1号门', latitude: 23.15728, longitude: 113.031209 },
      { name: '2号门', latitude: 23.155882, longitude: 113.032223 },
      { name: '3号门', latitude: 23.15768, longitude: 113.03638 },
      { name: '4号门', latitude: 23.160352, longitude: 113.029824 }
    ],
    // 校内建筑标注依赖 enable-poi 的腾讯原生 POI（位置准确）；校门位置使用官方坐标补齐
  },
  guangzhou: {
    key: 'guangzhou',
    name: '广州校区',
    fullName: '广东轻工职业技术大学（广州新港校区）',
    address: '广州市海珠区新港西路 152 号',
    latitude: 23.091902,
    longitude: 113.307005,
    scale: 16,
    // 边界（10 个顶点）取自腾讯地图该校区 AOI 轮廓（图一截图）：
    // 以「既有声明中心 (23.091902, 113.307005) = 新港西路152号」为锚点，
    // 尺度按既有围栏东西跨度 / AOI 像素宽推定，纵向按墨卡托约束
    // （lat/px = lng/px ÷ cos(lat)）校正——旧围栏自身长宽比与 AOI 相差约 15%，已一并纠正。
    // 校验：面积 ≈42.2 万㎡，东西 690m / 南北 705m，无自交，声明中心在界内。
    // 注：广州校区暂无官方校门坐标，故未做绝对地理标定；如需与佛山同等精度，
    // 提供 2 个参考点坐标（如 1 号门 / 新海医院）即可按同一流程重标。
    polygon: [
      { latitude: 23.091303, longitude: 113.303624 },
      { latitude: 23.089477, longitude: 113.304524 },
      { latitude: 23.08877, longitude: 113.304914 },
      { latitude: 23.088726, longitude: 113.305122 },
      { latitude: 23.088747, longitude: 113.305357 },
      { latitude: 23.08932, longitude: 113.310386 },
      { latitude: 23.095078, longitude: 113.310101 },
      { latitude: 23.094773, longitude: 113.304594 },
      { latitude: 23.095012, longitude: 113.304353 },
      { latitude: 23.095012, longitude: 113.304112 },
    ],
    // 同上：标注走原生 POI
  }
}

// 校区地图标注策略：完全依赖 enable-poi 的腾讯原生 POI（校门/停车场/建筑位置准确，
// 与参照图一致）；自定义坐标点未经实测校准不再上图，避免「详细位置显示不对」。
// 底部卡片改为校区概览 + 路线导航（openLocation 到校区中心，可在腾讯地图内选具体门）。
function buildMarkers(campus) {
  return (campus.gates || []).map((gate, index) => ({
    id: index + 1,
    latitude: gate.latitude,
    longitude: gate.longitude,
    iconPath: '/assets/icons/svc-map.png',
    width: 18,
    height: 18,
    anchor: { x: 0.5, y: 0.5 },
    label: {
      content: gate.name,
      color: '#1F2A44',
      bgColor: '#FFFFFFF2',
      borderColor: '#D6E0FF',
      borderWidth: 1,
      borderRadius: 6,
      padding: 5,
      fontSize: 11,
      anchorX: 0,
      anchorY: 0
    }
  }))
}

// 微信 map 的 polygon 虚线在不同机型上不稳定；参照腾讯地图的校区 AOI（深蓝虚线包围校区），
// 用原生地图绿地 + 透明 polygon 做范围，另用 polyline 画稳定的深蓝虚线边界。
function buildCampusOverlays(campus) {
  return {
    polygons: [],
    polylines: [{
      points: campus.polygon,
      color: '#2B5FD9E6',
      width: 3,
      dottedLine: true,
      arrowLine: false
    }]
  }
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
    polygons: [],
    polylines: buildCampusOverlays(CAMPUSES.foshan).polylines,
    satellite: false,
    campusPickerVisible: false,
    selectedPlace: { name: CAMPUSES.foshan.fullName, latitude: CAMPUSES.foshan.latitude, longitude: CAMPUSES.foshan.longitude, detail: CAMPUSES.foshan.address },
    locating: false
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
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
    this.setData({
      campusKey: key,
      campus,
      latitude: campus.latitude,
      longitude: campus.longitude,
      scale: campus.scale,
      markers: buildMarkers(campus),
      ...buildCampusOverlays(campus),
      selectedPlace: { name: campus.fullName, latitude: campus.latitude, longitude: campus.longitude, detail: campus.address },
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
    // 经自建 H5 中转页（payun01.cn/embed.html，已配业务域名）内嵌 720yun 全景：
    // 业务域名只校验 web-view 初始 src，页面内部 iframe 不受白名单限制。
    // 中转页只允许嵌 720yun 链接（防跳板），加载失败时有复制链接兜底。
    const h5 = 'https://payun01.cn/embed.html?src=' + encodeURIComponent(PANORAMA_URL)
    wx.navigateTo({ url: '/pages/webview/index?title=' + encodeURIComponent('佛山校区全景') + '&url=' + encodeURIComponent(h5) })
  },

  // 点击校区门/POI 标记：把底部「选中地点」卡片切到该标记，并轻微移动到该点，
  // 使「路线」按钮（openNavigation 读 selectedPlace）可导航到具体校门。
  onMarkerTap(e) {
    const markerId = e && e.detail && e.detail.markerId
    const gates = (this.data.campus && this.data.campus.gates) || []
    const gate = gates[Number(markerId) - 1]
    if (!gate) return
    this.setData({
      selectedPlace: { name: gate.name, latitude: gate.latitude, longitude: gate.longitude, detail: this.data.campus.name + ' · 校门' },
      latitude: gate.latitude,
      longitude: gate.longitude,
    })
    if (this.mapCtx && typeof this.mapCtx.moveToLocation === 'function') {
      this.mapCtx.moveToLocation({ latitude: gate.latitude, longitude: gate.longitude }).catch(() => {})
    }
    wx.vibrateShort({ type: 'light' })
  },

  openNavigation() {
    const place = this.data.selectedPlace
    wx.openLocation({ latitude: place.latitude, longitude: place.longitude, name: place.name, address: this.data.campus.address, scale: 18 })
  }
})
