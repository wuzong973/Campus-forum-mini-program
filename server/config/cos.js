const COS = require('cos-nodejs-sdk-v5')

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY
})

const BUCKET = process.env.COS_BUCKET || ''
const REGION = process.env.COS_REGION || 'ap-guangzhou'

function putObject({ Key, Body, ContentType }) {
  return new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: BUCKET,
      Region: REGION,
      Key,
      Body,
      ContentType: ContentType || 'image/jpeg'
    }, (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })
}

// 内容安全检测判违规后删除对象（媒体检查异步回调使用）。
// 对象不存在时 COS 返回 404，同样视为删除成功，避免重复回调报错。
function deleteObject(Key) {
  return new Promise((resolve, reject) => {
    cos.deleteObject({
      Bucket: BUCKET,
      Region: REGION,
      Key
    }, (err, data) => {
      if (err) {
        if (Number(err.statusCode) === 404) return resolve(true)
        return reject(err)
      }
      resolve(data)
    })
  })
}

// 判断对象是否已存在（小程序码等生成物的缓存检查）
function headObject(Key) {
  return new Promise((resolve) => {
    cos.headObject({
      Bucket: BUCKET,
      Region: REGION,
      Key
    }, (err) => resolve(!err))
  })
}

function getPublicUrl(Key) {
  return `https://${BUCKET}.cos.${REGION}.myqcloud.com/${Key}`
}

module.exports = { cos, putObject, deleteObject, headObject, getPublicUrl, BUCKET, REGION }