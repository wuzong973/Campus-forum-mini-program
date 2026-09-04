const SHARE_TITLE = '广轻工校园'
const HOME_PATH = '/pages/index/index'

function onShareAppMessage() {
  return {
    title: SHARE_TITLE,
    path: HOME_PATH
  }
}

function onShareTimeline() {
  return {
    title: SHARE_TITLE,
    query: ''
  }
}

module.exports = {
  onShareAppMessage,
  onShareTimeline
}
