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

function getPublicUrl(Key) {
  return `https://${BUCKET}.cos.${REGION}.myqcloud.com/${Key}`
}

module.exports = { cos, putObject, getPublicUrl, BUCKET, REGION }
