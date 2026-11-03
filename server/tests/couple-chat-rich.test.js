/**
 * 一周CP 专用聊天页富消息护栏（2026-11-03）
 *
 * 锁住「表情 + 图片 + 撤回」这一版，避免后续改回纯文本：
 *   - 表情面板与图片发送入口存在；
 *   - 图片消息按 image 类型渲染并可预览；
 *   - 长按自己的消息可撤回，结束后只读；
 *   - 实时撤回事件能同步移除消息；
 *   - 专用聊天页被 messageStore 识别为当前会话，不会被误记未读。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

const ROOT = path.resolve(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const wxml = read('pkg-feature/pages/couple/chat.wxml')
const js = read('pkg-feature/pages/couple/chat.js')
const wxss = read('pkg-feature/pages/couple/chat.wxss')
const store = read('utils/messageStore.js')
const wechat = read('utils/wechat.js')
const messageController = read('server/controllers/messageController.js')
const uploadController = read('server/controllers/uploadController.js')
const userRoutes = read('server/routes/userRoutes.js')
const subscribeService = read('server/services/subscribeService.js')

check(() => {
  assert.ok(/activePanel === 'emoji'/.test(wxml), '缺少表情面板')
  assert.ok(/wx:for="\{\{emojiList\}\}"/.test(wxml), '表情面板未遍历 emojiList')
  assert.ok(/bindtap="onEmojiTap"/.test(wxml), '表情缺少点击事件')
  assert.ok(/emojiList:\s*\[/.test(js) && /'😀'/.test(js), '页面数据缺少表情列表')
  assert.ok(/slice\(0, 200\)/.test(js), '表情追加必须限制在输入框 200 字内')
}, 'E1. 表情面板与输入')

check(() => {
  assert.ok(/onChooseImage/.test(wxml) && /bindtap="onChooseImage"/.test(wxml), '缺少图片入口')
  assert.ok(/tool-icon-photo/.test(wxml), '图片入口缺少图标')
  assert.ok(/wx\.chooseMedia/.test(js), '未使用 chooseMedia 选图')
  assert.ok(/wechat\.uploadImages\(paths\)/.test(js), '未复用图片上传能力')
  assert.ok(/sendContent\(url, 'image'\)/.test(js), '图片未按 image 类型发送')
}, 'E2. 图片选择与上传')

check(() => {
  assert.ok(/item\.type === 'image'/.test(wxml), 'WXML 未按 image 类型渲染')
  assert.ok(/class="msg-image"/.test(wxml), '缺少图片消息样式')
  assert.ok(/catchtap="previewImage"/.test(wxml), '图片消息缺少预览')
  assert.ok(/msgType \|\| 'text'/.test(js), 'decorate 未兼容 msgType')
  assert.ok(/item\.content/.test(wxml), '图片消息未读取 content')
  assert.ok(/\.msg-image\s*\{/.test(wxss) && /\.bubble\.media-bubble\s*\{/.test(wxss), '缺少图片消息样式')
}, 'E3. 图片消息渲染')

check(() => {
  assert.ok(/bindlongpress="onRecallMessage"/.test(wxml), '缺少长按撤回')
  assert.ok(/messageStore\.recallMessage\(this\.data\.peerId/.test(js), '撤回未走 messageStore')
  assert.ok(/message\.mine/.test(js), '只允许撤回自己的消息')
  assert.ok(/this\.data\.readonly/.test(js) && /无法撤回/.test(js), '配对结束后必须禁止撤回')
  assert.ok(/messages: this\.data\.messages\.filter/.test(js), '撤回后未从本地列表移除')
}, 'E4. 撤回与只读保护')

check(() => {
  assert.ok(/payload\.type === 'message_recalled'/.test(js), '未处理实时撤回事件')
  assert.ok(/removeMessage\(payload\.data && payload\.data\.id\)/.test(js), '实时撤回未移除对应消息')
  assert.ok(/pkg-feature\/pages\/couple\/chat/.test(store), 'messageStore 未识别专用聊天页，可能误记未读')
  assert.ok(/cur\.data\.personaKey/.test(store), '专用聊天页未按 personaKey 匹配当前会话')
}, 'E5. 实时撤回与会话识别')

check(() => {
  assert.ok(/bindtap="onChooseVideo"/.test(wxml), '缺少视频入口')
  assert.ok(/tool-icon-video/.test(wxml), '缺少视频入口图标')
  assert.ok(/item\.type === 'video'/.test(wxml), 'WXML 未按 video 类型渲染')
  assert.ok(/class="msg-video"/.test(wxml), '缺少视频播放器样式')
  assert.ok(/wx\.chooseMedia/.test(js) && /mediaType:\s*\['video'\]/.test(js), '未使用 chooseMedia 选视频')
  assert.ok(/splitOverlongVideos/.test(js), '视频未校验 1 分钟时长')
  assert.ok(/wechat\.uploadVideo\(raw\.tempFilePath\)/.test(js), '视频未复用上传能力')
  assert.ok(/sendContent\(url, 'video'\)/.test(js), '视频未按 video 类型发送')
  assert.ok(/\.msg-video\s*\{/.test(wxss), '缺少视频消息样式')
}, 'E6. 视频选择、发送与播放')

check(() => {
  assert.ok(/bindtap="onToggleVoice"/.test(wxml), '缺少语音模式入口')
  assert.ok(/bindtouchstart="onVoiceStart"/.test(wxml), '缺少按住录音开始事件')
  assert.ok(/bindtouchend="onVoiceEnd"/.test(wxml), '缺少松手结束事件')
  assert.ok(/bindtouchcancel="onVoiceCancel"/.test(wxml), '缺少录音取消事件')
  assert.ok(/getRecorderManager/.test(js), '未接入录音管理器')
  assert.ok(/duration:\s*60000/.test(js) && /format:\s*'mp3'/.test(js), '录音必须限制 60 秒并使用 mp3')
  assert.ok(/wechat\.uploadAudio\(filePath\)/.test(js), '语音未调用音频上传')
  assert.ok(/sendContent\(JSON\.stringify\(\{ url, duration \}\), 'voice'\)/.test(js), '语音未按 voice 类型发送')
  assert.ok(/item\.type === 'voice'/.test(wxml) && /bindtap="playVoice"|catchtap="playVoice"/.test(wxml), '语音消息缺少播放交互')
  assert.ok(/createInnerAudioContext/.test(js), '语音缺少播放器')
  assert.ok(/\.voice-input/.test(wxss) && /\.icon-voice/.test(wxss), '缺少语音输入样式')
}, 'E7. 语音录制、上传与播放')

check(() => {
  assert.ok(/\['text', 'image', 'emoji', 'video', 'voice'\]/.test(messageController), '服务端未放行 voice 消息类型')
  assert.ok(/type === 'voice' \? '\[语音\]'/.test(messageController), '会话预览未把语音显示为 [语音]')
  assert.ok(/type === 'voice'\) return '\[语音\]'/.test(messageController), '撤回后的预览未处理语音')
  assert.ok(/uploadAudio/.test(uploadController) && /AUDIO_SIGNATURES/.test(uploadController), '缺少音频上传实现')
  assert.ok(/uploadController\.uploadAudioMiddleware/.test(userRoutes), '缺少 /user/upload/audio 中间件')
  assert.ok(/uploadController\.uploadAudio\b/.test(userRoutes), '缺少音频上传路由')
  assert.ok(/function uploadAudio|uploadAudio\s*[:=]/.test(wechat), '小程序端缺少 uploadAudio 封装')
}, 'E8. 服务端语音消息与音频上传')

check(() => {
  assert.ok(/require\('\.\.\/\.\.\/\.\.\/utils\/subscribe'\)/.test(js), '聊天页未引入订阅工具')
  assert.ok(/requestTriggerByTap\('message'\)/.test(js), '发送时未申请聊天消息订阅')
  assert.ok((js.match(/this\.requestMessageSubscribe\(\)/g) || []).length >= 3, '文字/图片/语音入口都要有订阅触发')
  assert.ok(/pkg-feature\/pages\/couple\/chat\?matchId=/.test(messageController), '一周CP推送未指向专用聊天页')
  assert.ok(/subscribeService\.pushMessage\(receiverId, \{ senderNick, digest, page: pushPage \}\)/.test(messageController), '推送调用未携带专用页参数')
  assert.ok(/page\s*\|\|\s*'pages\/my-messages\/index'/.test(subscribeService), 'pushMessage 未支持自定义落地页')
  assert.ok(/function pushMessage\(userId, \{ senderNick, digest, timeText, page \}\)/.test(subscribeService), 'pushMessage 签名未接收 page')
}, 'E9. 一周CP聊天消息推送')

console.log(testCount + ' tests passed.')
