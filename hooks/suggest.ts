import { recase, wordKey } from './words'

const LETTERS = "abcdefghijklmnopqrstuvwxyz'"
export const DEFAULT_SUGGESTIONS = 3
export const MAX_SUGGESTIONS = 9
const MAX_EDITS2_HITS = 10
const MAX_EDITS2_LENGTH = 8
const MAX_SUGGESTION_LENGTH = 32
export const SUGGEST_CACHE_CAP = 500

export function suggestionCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_SUGGESTIONS
  return Math.min(Math.floor(value), MAX_SUGGESTIONS)
}

function edits1(word: string, swaps?: Set<string>): string[] {
  const out: string[] = []
  const letters = [...word]
  for (let i = 0; i <= letters.length; i++) {
    const left = letters.slice(0, i).join('')
    const right = letters.slice(i).join('')
    const afterFirst = letters.slice(i + 1).join('')
    if (right) out.push(left + afterFirst) // delete
    if (i + 1 < letters.length) {
      const transposed = left + letters[i + 1] + letters[i] + letters.slice(i + 2).join('')
      out.push(transposed)
      swaps?.add(transposed)
    }
    for (const c of LETTERS) {
      if (right) out.push(left + c + afterFirst) // replace
      out.push(left + c + right) // insert
    }
  }
  return out
}

function rank(word: string, candidates: Map<string, number>, swaps: Set<string>): string[] {
  return [...candidates.entries()]
    .sort(([a, da], [b, db]) => {
      if (da !== db) return da - db
      const bySwap = Number(swaps.has(b)) - Number(swaps.has(a))
      if (bySwap) return bySwap
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
 * Prefer adjacent swaps within the same edit distance. Cache up to nine ranked
 * candidates so callers can change the displayed count without recomputing.
 */
export function suggestionsFor(
  word: string,
  dict: Set<string>,
  cache: Map<string, string[]>,
  limit = DEFAULT_SUGGESTIONS,
): string[] {
  if (word.length > MAX_SUGGESTION_LENGTH) return []
  const count = suggestionCount(limit)
  const lower = wordKey(word)
  const cached = cache.get(lower)
  if (cached) return cached.slice(0, count).map(s => recase(s, word))

  const candidates = new Map<string, number>()
  const swaps = new Set<string>()
  const e1 = edits1(lower, swaps)
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

  const ranked = rank(lower, candidates, swaps)
  if (cache.size >= SUGGEST_CACHE_CAP) cache.clear()
  cache.set(lower, ranked)
  return ranked.slice(0, count).map(s => recase(s, word))
}
