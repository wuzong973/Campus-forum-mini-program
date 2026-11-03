// 一周CP 匹配算法（纯函数，不碰数据库）
//
// 规模按全校 2000 人设计：先算所有两两分数，但每名用户只保留 Top-K 候选，
// 再对候选边做贪心最大权匹配。复杂度 O(n² + n·K·logK)，避免匈牙利算法
// O(n³) 在 1000×1000 上把 Node 进程拖死。
//
// 硬约束：性别、期望校区、期望身高（对方身高已知时）、期望 MBTI（对方 MBTI 已知时）。
// 软分数：共同兴趣 IoU、同校区、年级接近、MBTI 已知信息、随机扰动。

const TOP_K = 20

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  const seen = {}
  const result = []
  tags.forEach((tag) => {
    const value = String(tag || '').trim()
    if (!value || seen[value]) return
    seen[value] = true
    result.push(value)
  })
  return result.slice(0, 8)
}

function normalizeMbtiList(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => item && item !== '不限')
    .slice(0, 4)
}

function jaccard(a, b) {
  const left = normalizeTags(a)
  const right = normalizeTags(b)
  if (!left.length || !right.length) return 0
  const set = {}
  left.forEach((item) => { set[item] = true })
  let intersection = 0
  right.forEach((item) => { if (set[item]) intersection += 1 })
  const union = new Set(left.concat(right)).size
  return union ? intersection / union : 0
}

function commonTags(a, b) {
  const right = {}
  normalizeTags(b).forEach((item) => { right[item] = true })
  return normalizeTags(a).filter((item) => right[item])
}

function gradeValue(grade) {
  const map = { 大一: 1, 大二: 2, 大三: 3, 大四: 4, 研究生: 5 }
  return map[String(grade || '').trim()] || 0
}

function hashSeed(value) {
  let seed = Number(value) || 0
  return function random() {
    seed += 0x6D2B79F5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function heightAllowed(signup, other) {
  const min = Number(signup.expectHeightMin) || 0
  const max = Number(signup.expectHeightMax) || 0
  const height = Number(other.height) || 0
  if (!min && !max) return true
  // 对方没填身高时不做硬性拦截，避免因为资料缺失把所有人挡在门外
  if (!height) return true
  if (min && height < min) return false
  if (max && height > max) return false
  return true
}

function mbtiAllowed(signup, other) {
  const expected = normalizeMbtiList(signup.expectMbti)
  const mbti = String(other.mbti || '').trim().toUpperCase()
  if (!expected.length) return true
  if (!mbti) return true
  return expected.indexOf(mbti) > -1
}

function genderAllowed(signup, other) {
  if (![1, 2].includes(Number(signup.gender)) || ![1, 2].includes(Number(other.gender))) return false
  const expect = Number(signup.expectGender) || 0
  if (expect && expect !== Number(other.gender)) return false
  return true
}

function campusAllowed(signup, other) {
  const expect = String(signup.expectCampus || '').trim()
  if (!expect) return true
  return expect === String(other.campus || '').trim()
}

function isEligiblePair(a, b) {
  if (!a || !b || Number(a.userId) === Number(b.userId)) return false
  return genderAllowed(a, b) &&
    genderAllowed(b, a) &&
    campusAllowed(a, b) &&
    campusAllowed(b, a) &&
    heightAllowed(a, b) &&
    heightAllowed(b, a) &&
    mbtiAllowed(a, b) &&
    mbtiAllowed(b, a)
}

function scorePair(a, b, random) {
  const shared = commonTags(a.tags, b.tags)
  let score = 50
  score += Math.round(jaccard(a.tags, b.tags) * 25)
  if (a.campus && a.campus === b.campus) score += 10
  const ga = gradeValue(a.grade)
  const gb = gradeValue(b.grade)
  if (ga && gb) {
    const diff = Math.abs(ga - gb)
    if (diff === 0) score += 8
    else if (diff === 1) score += 4
  }
  if (a.mbti && b.mbti) score += 4
  if (heightAllowed(a, b) && heightAllowed(b, a)) score += 4
  score += Math.round((random ? random() : 0.5) * 3)
  return {
    score: Math.max(1, Math.min(99, score)),
    commonTags: shared
  }
}

function insertTop(list, entry) {
  let index = list.length
  while (index > 0 && list[index - 1].score < entry.score) index -= 1
  if (index >= TOP_K) return
  list.splice(index, 0, entry)
  if (list.length > TOP_K) list.pop()
}

function buildMatches(signups, options) {
  const input = Array.isArray(signups) ? signups.filter((item) => item && item.userId) : []
  const opts = options || {}
  const blocked = opts.blockedPairs || {}
  const random = hashSeed(opts.seed === undefined ? Date.now() : opts.seed)
  const tops = input.map(() => [])
  const used = input.map(() => false)

  for (let i = 0; i < input.length; i += 1) {
    for (let j = i + 1; j < input.length; j += 1) {
      if (!isEligiblePair(input[i], input[j])) continue
      const aId = Math.min(Number(input[i].userId), Number(input[j].userId))
      const bId = Math.max(Number(input[i].userId), Number(input[j].userId))
      if (blocked[aId + ':' + bId]) continue
      const scored = scorePair(input[i], input[j], random)
      const entry = { i, j, score: scored.score, commonTags: scored.commonTags }
      insertTop(tops[i], entry)
      insertTop(tops[j], entry)
    }
  }

  const edgeMap = {}
  tops.forEach((list) => {
    list.forEach((entry) => {
      const key = Math.min(entry.i, entry.j) + ':' + Math.max(entry.i, entry.j)
      if (!edgeMap[key] || edgeMap[key].score < entry.score) edgeMap[key] = entry
    })
  })
  const edges = Object.keys(edgeMap).map((key) => edgeMap[key])
  edges.sort((a, b) => (b.score - a.score) || (a.i - b.i) || (a.j - b.j))

  const pairs = []
  edges.forEach((edge) => {
    if (used[edge.i] || used[edge.j]) return
    used[edge.i] = true
    used[edge.j] = true
    pairs.push({
      a: input[edge.i],
      b: input[edge.j],
      score: edge.score,
      commonTags: edge.commonTags
    })
  })

  // Top-K 边集只能保证「每人保留 20 个候选」，分数接近时后排用户可能
  // 不在任何人的 Top-K 里，从而明明有合适对象却落单。对剩余用户再做一轮
  // 用户视角贪心（每人挑当前最高分的可配对象），把覆盖率补回来。
  const leftover = input.filter((item, index) => !used[index])
  const pool = leftover.slice()
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = pool[i]
    pool[i] = pool[j]
    pool[j] = temp
  }
  const taken = new Set()
  for (let i = 0; i < pool.length; i += 1) {
    if (taken.has(i)) continue
    const a = pool[i]
    let best = -1
    let bestScore = 0
    let bestCommon = []
    for (let j = 0; j < pool.length; j += 1) {
      if (i === j || taken.has(j)) continue
      const b = pool[j]
      if (!isEligiblePair(a, b)) continue
      const aId = Math.min(Number(a.userId), Number(b.userId))
      const bId = Math.max(Number(a.userId), Number(b.userId))
      if (blocked[aId + ':' + bId]) continue
      const scored = scorePair(a, b, random)
      if (scored.score > bestScore) {
        best = j
        bestScore = scored.score
        bestCommon = scored.commonTags
      }
    }
    if (best > -1) {
      taken.add(i)
      taken.add(best)
      pairs.push({
        a: pool[i],
        b: pool[best],
        score: bestScore,
        commonTags: bestCommon
      })
    }
  }

  const unmatched = pool.filter((item, index) => !taken.has(index))
  const averageScore = pairs.length
    ? Math.round(pairs.reduce((sum, pair) => sum + pair.score, 0) / pairs.length)
    : 0
  const male = input.filter((item) => Number(item.gender) === 1).length
  const female = input.filter((item) => Number(item.gender) === 2).length

  return {
    pairs,
    unmatched,
    stats: {
      eligible: input.length,
      matchedPairs: pairs.length,
      matchedUsers: pairs.length * 2,
      unmatched: unmatched.length,
      averageScore,
      male,
      female
    }
  }
}

module.exports = {
  TOP_K,
  normalizeTags,
  normalizeMbtiList,
  jaccard,
  commonTags,
  gradeValue,
  isEligiblePair,
  scorePair,
  buildMatches
}
