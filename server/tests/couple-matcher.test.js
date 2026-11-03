// 一周CP 匹配算法单元测试（纯函数，无需数据库）
const assert = require('assert')
const matcher = require('../services/coupleMatcher')

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('PASS:', name)
  } catch (error) {
    console.error('FAILED:', name)
    throw error
  }
}

function person(overrides) {
  return Object.assign({
    id: 1,
    userId: 1,
    gender: 1,
    campus: '广州·新港',
    grade: '大二',
    height: 175,
    mbti: 'INTJ',
    tags: ['音乐', '电影'],
    expectGender: 0,
    expectCampus: '',
    expectHeightMin: 0,
    expectHeightMax: 0,
    expectMbti: []
  }, overrides)
}

check('性别期望双向满足时才可配对', () => {
  const a = person({ userId: 1, gender: 1, expectGender: 2 })
  const b = person({ userId: 2, gender: 2, expectGender: 1 })
  const c = person({ userId: 3, gender: 1, expectGender: 1 })
  assert.strictEqual(matcher.isEligiblePair(a, b), true)
  assert.strictEqual(matcher.isEligiblePair(a, c), false)
})

check('期望校区不匹配时不可配对', () => {
  const a = person({ userId: 1, expectCampus: '广州·新港' })
  const b = person({ userId: 2, campus: '佛山·南海南' })
  assert.strictEqual(matcher.isEligiblePair(a, b), false)
})

check('身高已知时按区间过滤，未知时不硬拦', () => {
  const a = person({ userId: 1, expectHeightMin: 160, expectHeightMax: 170 })
  const b = person({ userId: 2, gender: 2, height: 165 })
  const c = person({ userId: 3, gender: 2, height: 180 })
  const d = person({ userId: 4, gender: 2, height: 0 })
  assert.strictEqual(matcher.isEligiblePair(a, b), true)
  assert.strictEqual(matcher.isEligiblePair(a, c), false)
  assert.strictEqual(matcher.isEligiblePair(a, d), true)
})

check('期望 MBTI 在对方已知时生效，未知时放行', () => {
  const a = person({ userId: 1, expectMbti: ['ENFJ'] })
  const b = person({ userId: 2, gender: 2, mbti: 'ENFJ' })
  const c = person({ userId: 3, gender: 2, mbti: 'ISTJ' })
  const d = person({ userId: 4, gender: 2, mbti: '' })
  assert.strictEqual(matcher.isEligiblePair(a, b), true)
  assert.strictEqual(matcher.isEligiblePair(a, c), false)
  assert.strictEqual(matcher.isEligiblePair(a, d), true)
})

check('同一用户只出现一次，且不重复配对', () => {
  const signups = [
    person({ userId: 1, gender: 1, expectGender: 2, tags: ['音乐', '电影'] }),
    person({ userId: 2, gender: 2, expectGender: 1, tags: ['音乐', '电影'] }),
    person({ userId: 3, gender: 1, expectGender: 2, campus: '佛山·南海南', tags: ['游戏'] }),
    person({ userId: 4, gender: 2, expectGender: 1, campus: '佛山·南海南', tags: ['游戏'] })
  ]
  const result = matcher.buildMatches(signups, { seed: 7 })
  const ids = []
  result.pairs.forEach((pair) => {
    ids.push(pair.a.userId, pair.b.userId)
  })
  assert.strictEqual(new Set(ids).size, ids.length, '同一用户不能在多对中出现')
  assert.ok(result.pairs.length >= 1, '应至少匹配出一对')
})

check('blockedPairs 可阻止历史已配对的人再次匹配', () => {
  const signups = [
    person({ userId: 1, gender: 1, expectGender: 2 }),
    person({ userId: 2, gender: 2, expectGender: 1 })
  ]
  const result = matcher.buildMatches(signups, { seed: 1, blockedPairs: { '1:2': true } })
  assert.strictEqual(result.pairs.length, 0)
})

check('相同 seed 输出稳定', () => {
  const signups = []
  for (let i = 1; i <= 10; i += 1) {
    signups.push(person({
      id: i,
      userId: i,
      gender: i % 2 === 1 ? 1 : 2,
      expectGender: i % 2 === 1 ? 2 : 1,
      campus: i <= 5 ? '广州·新港' : '佛山·南海南',
      tags: i <= 5 ? ['音乐', '电影'] : ['游戏', '旅行']
    }))
  }
  const first = matcher.buildMatches(signups, { seed: 42 })
  const second = matcher.buildMatches(signups, { seed: 42 })
  const firstIds = first.pairs.map((pair) => pair.a.userId + '-' + pair.b.userId)
  const secondIds = second.pairs.map((pair) => pair.a.userId + '-' + pair.b.userId)
  assert.deepStrictEqual(firstIds, secondIds)
})

check('共同标签和分数在合理范围', () => {
  const a = person({ userId: 1 })
  const b = person({ userId: 2, gender: 2, tags: ['音乐', '摄影'] })
  const scored = matcher.scorePair(a, b, () => 0.5)
  assert.deepStrictEqual(scored.commonTags, ['音乐'])
  assert.ok(scored.score > 0 && scored.score <= 99)
})

console.log(passed + ' tests passed.')
