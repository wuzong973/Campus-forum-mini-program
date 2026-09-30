// M1c 回归：进入教务同步页不得无条件全量爬取，且自动同步遇 429 需静默。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const page = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-login', 'index.js'), 'utf8')

// 存在节流常量与时间戳存储键
assert.ok(/AUTO_SYNC_MIN_INTERVAL_MS/.test(page), '应有自动同步最小间隔常量')
assert.ok(/AUTO_SYNC_STORAGE_KEY/.test(page), '应有上次同步时间戳存储键')

// checkBinding 内自动同步必须受新鲜期门控，不再是无条件 doRefresh(true)
const check = page.slice(page.indexOf('checkBinding()'), page.indexOf('doRefresh(auto'))
assert.ok(/fresh/.test(check) && /AUTO_SYNC_MIN_INTERVAL_MS/.test(check), 'checkBinding 应按新鲜期门控自动同步')
assert.ok(!/bound[\s\S]{0,120}?this\.doRefresh\(true\);/.test(check.replace(/const fresh[\s\S]*?if \(!fresh\) \{/, '')), '不得无条件自动爬取')

// 成功同步后写入时间戳
assert.ok(/wx\.setStorageSync\(AUTO_SYNC_STORAGE_KEY, Date\.now\(\)\)/.test(page), '同步成功应记录时间戳')

// 自动同步遇 429 静默返回
assert.ok(/if \(err && err\.statusCode === 429\) return/.test(page), '自动同步遇 429 应静默跳过')

console.log('JW auto-sync throttle (M1c) test passed.')
