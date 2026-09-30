// M1d 回归：整学期课表抓取应「部分成功仍落库」，不再全有或全无；死代码已清理。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const svc = fs.readFileSync(path.join(__dirname, '..', 'services', 'jwScheduleSyncService.js'), 'utf8')

const fast = svc.slice(
  svc.indexOf('async function crawlSemesterFastWithCrawler'),
  svc.indexOf('function getCurrentWeekNumber'),
)
// 每周独立 try/catch，失败记为 error 而非抛出
assert.ok(/try \{/.test(fast) && /catch \(weekError\)/.test(fast), '每周抓取应独立 try/catch')
assert.ok(/error: String\(\(weekError/.test(fast), '周失败应记录 error 字段')
// 成功周与失败周分离，仅全失败才抛
assert.ok(/weekly\.filter\(\(item\) => !item\.error\)/.test(fast), '应筛出成功周')
assert.ok(/weekly\.filter\(\(item\) => item\.error\)/.test(fast), '应筛出失败周')
assert.ok(/if \(!weeklyResults\.length\) \{[\s\S]*throw new Error/.test(fast), '仅当全部周失败才整体抛错')
// 部分成功标记 partial 并产出告警，供前端提示与落库
assert.ok(/partial: failedWeeks\.length > 0/.test(fast), 'meta.partial 应反映部分成功')
assert.ok(/const warnings = failedWeeks\.length/.test(fast) && /warnings,/.test(fast), '应产出并返回 warnings')

// 三处调用点合并课表 warnings 与考试/成绩 warnings（不再被 extras 覆盖丢失）
const merges = (svc.match(/warnings: \[\.\.\.\(result\.warnings \|\| \[\]\), \.\.\.extras\.warnings\]/g) || []).length
assert.strictEqual(merges, 3, 'sync/refresh/captcha 三处都应合并课表与考试/成绩告警')

// 死代码：未挂接的 partial 分支与旧串行整学期抓取应已移除
assert.ok(!/function crawlInitialWeeksWithCrawler/.test(svc), 'crawlInitialWeeksWithCrawler 死代码应移除')
assert.ok(!/function crawlSemesterWithCrawler\b/.test(svc), 'crawlSemesterWithCrawler 死代码应移除')

console.log('JW partial-sync resilience (M1d) test passed.')
