// 一周CP 匹配任务（管理员在服务器上执行，或由后台接口触发）
//
// 用法：
//   node scripts/couple-match.js --dry-run
//   node scripts/couple-match.js
//   node scripts/couple-match.js --activity-id=3 --dry-run

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
const pool = require('../config/pool')
const coupleService = require('../services/coupleService')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const activityArg = args.find((arg) => arg.indexOf('--activity-id=') === 0)
const activityId = activityArg ? Number(activityArg.split('=')[1]) : 0

;(async () => {
  const result = await coupleService.runMatch(activityId, dryRun)
  console.log(JSON.stringify(result, null, 2))
  if (result.error) process.exitCode = 1
})()
  .catch((error) => {
    console.error('[couple-match]', error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
