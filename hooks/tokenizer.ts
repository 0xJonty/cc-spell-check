import { wordKey } from './words'

export type Token = {
  word: string
  start: number
  end: number
  isCapitalized: boolean
}

export type Accepts = { has: (word: string) => boolean }

// Fenced blocks (``` ... ``` — an unclosed trailing fence masks to end of text)
// and inline `code` spans. Alternation order makes fences win over inline ticks.
const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

// Chunks containing any of these are never spell-checked: URLs, paths,
// snake_case, digits (versions, hex, ids).
const CHUNK_SKIP_RE = /[/\\_\p{Nd}]/u
const CHUNK_PREFIX_SKIP_RE = /^[@#/]/

const CORE_RE = /^\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*$/u
const CAPITALIZED_RE = /^\p{Lu}/u
const INTERNAL_CAPS_RE = /^.[\s\S]*\p{Lu}/u
const HEX_RE = /^[a-f]{6,}$/

function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const m of text.matchAll(CODE_RE)) {
    ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

function inRanges(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([a, b]) => start < b && end > a)
}

/**
 * Candidate words for spell checking, with UTF-16 offsets into `text`
 * (the units PromptDecoration and PromptBox.cursor use). Emits only pure
 * alphabetic lowercase or Capitalized words of 3+ characters outside code.
 */
export function tokenize(text: string): Token[] {
  const masked = codeRanges(text)
  const tokens: Token[] = []

  for (const m of text.matchAll(/\S+/g)) {
    const chunk = m[0]
    const chunkStart = m.index
    if (inRanges(masked, chunkStart, chunkStart + chunk.length)) continue
    if (CHUNK_PREFIX_SKIP_RE.test(chunk) || CHUNK_SKIP_RE.test(chunk)) continue

    // Strip edge punctuation (quotes, commas, brackets, stray apostrophes).
    const lead = /^[^\p{L}]*/u.exec(chunk)![0].length
    const core = chunk.slice(lead).replace(/[^\p{L}\p{M}]+$/u, '')
    if (!CORE_RE.test(core)) continue
    if ((core.match(/\p{L}/gu)?.length ?? 0) <= 2) continue
    if (INTERNAL_CAPS_RE.test(core)) continue
    if (HEX_RE.test(core)) continue

    tokens.push({
      word: core,
      start: chunkStart + lead,
      end: chunkStart + lead + core.length,
      isCapitalized: CAPITALIZED_RE.test(core),
    })
  }
  return tokens
}

export function accept(word: string, dict: Accepts, personal: Accepts): boolean {
  const w = wordKey(word)
  return dict.has(w) || personal.has(w)
}

export function flagged(tokens: Token[], dict: Accepts, personal: Accepts): Token[] {
  return tokens.filter(t => !accept(t.word, dict, personal))
}
