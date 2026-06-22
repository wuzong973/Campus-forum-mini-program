const request = require('../../utils/request')

Page({
  data: { imageUrl: '' },

  onUpload() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath
        this.setData({ imageUrl: path })
        wx.showLoading({ title: '识别中...', mask: true })
        if (request.USE_MOCK) {
          setTimeout(() => {
            const courses = [
              { id: Date.now(), name: '高等数学', location: '教学楼A101', teacher: '张老师', weekDay: 1, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, color: '#4A7AFF' },
              { id: Date.now() + 1, name: '大学英语', location: '教学楼B203', teacher: '李老师', weekDay: 3, startTime: '10:00', endTime: '10:55', startWeek: 1, endWeek: 16, color: '#52C41A' }
            ]
            const existing = wx.getStorageSync('schedule_courses') || []
            wx.setStorageSync('schedule_courses', existing.concat(courses))
            wx.hideLoading()
            wx.showModal({
              title: '识别完成',
              content: '已识别 ' + courses.length + ' 门课程并导入课表',
              showCancel: false,
              success: () => wx.switchTab({ url: '/pages/schedule/index' })
            })
          }, 1500)
          return
        }
        request.post('/schedule/ocr', { image: path }, true).then((data) => {
          const courses = (data.courses || []).map((c, i) => Object.assign({ id: Date.now() + i }, c))
          const existing = wx.getStorageSync('schedule_courses') || []
          wx.setStorageSync('schedule_courses', existing.concat(courses))
          wx.hideLoading()
          wx.showModal({
            title: '识别完成',
            content: '已导入 ' + courses.length + ' 门课程',
            showCancel: false,
            success: () => wx.switchTab({ url: '/pages/schedule/index' })
          })
        }).catch(() => wx.hideLoading())
      }
    })
  }
})
