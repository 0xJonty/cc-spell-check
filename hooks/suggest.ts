const LETTERS = "abcdefghijklmnopqrstuvwxyz'"
const MAX_SUGGESTIONS = 3
const MAX_EDITS2_HITS = 10
const MAX_EDITS2_LENGTH = 8
export const SUGGEST_CACHE_CAP = 500

function edits1(word: string): string[] {
  const out: string[] = []
  for (let i = 0; i <= word.length; i++) {
    const left = word.slice(0, i)
    const right = word.slice(i)
    if (right) out.push(left + right.slice(1)) // delete
    if (right.length > 1) out.push(left + right[1] + right[0] + right.slice(2)) // transpose
    for (const c of LETTERS) {
      if (right) out.push(left + c + right.slice(1)) // replace
      out.push(left + c + right) // insert
    }
  }
  return out
}

function rank(word: string, candidates: Map<string, number>): string[] {
  return [...candidates.entries()]
    .sort(([a, da], [b, db]) => {
      if (da !== db) return da - db
      const fa = a[0] === word[0] ? 0 : 1
      const fb = b[0] === word[0] ? 0 : 1
      if (fa !== fb) return fa - fb
      const la = Math.abs(a.length - word.length)
      const lb = Math.abs(b.length - word.length)
      if (la !== lb) return la - lb
      return a < b ? -1 : 1
    })
    .map(([w]) => w)
    .slice(0, MAX_SUGGESTIONS)
}

/**
 * Up to 3 corrections for a flagged word: dictionary words at edit distance 1,
 * falling back to distance 2 for short words. Cached per lowercased word.
 */
export function suggestionsFor(
  word: string,
  dict: Set<string>,
  cache: Map<string, string[]>,
): string[] {
  const lower = word.toLowerCase()
  const cached = cache.get(lower)
  if (cached) return recase(cached, word)

  const candidates = new Map<string, number>()
  const e1 = edits1(lower)
  for (const c of e1) {
    if (dict.has(c)) candidates.set(c, 1)
  }
  if (candidates.size === 0 && lower.length <= MAX_EDITS2_LENGTH) {
    outer: for (const c1 of e1) {
      for (const c2 of edits1(c1)) {
        if (dict.has(c2) && !candidates.has(c2)) {
          candidates.set(c2, 2)
          if (candidates.size >= MAX_EDITS2_HITS) break outer
        }
      }
    }
  }

  const ranked = rank(lower, candidates)
  if (cache.size >= SUGGEST_CACHE_CAP) cache.clear()
  cache.set(lower, ranked)
  return recase(ranked, word)
}

function recase(suggestions: string[], word: string): string[] {
  if (!/^[A-Z]/.test(word)) return suggestions
  return suggestions.map(s => s[0].toUpperCase() + s.slice(1))
}
