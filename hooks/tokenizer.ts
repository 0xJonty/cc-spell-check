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
const CHUNK_SKIP_RE = /[/\\_\d]/
const CHUNK_PREFIX_SKIP_RE = /^[@#/]/

const CORE_RE = /^[A-Za-z]+(?:'[A-Za-z]+)*$/
const ALLCAPS_RE = /^[A-Z]+$/
const INTERNAL_CAPS_RE = /[A-Z]/
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
    const lead = /^[^A-Za-z]*/.exec(chunk)![0].length
    const core = chunk.slice(lead).replace(/[^A-Za-z]+$/, '')
    if (core.length <= 2) continue
    if (!CORE_RE.test(core)) continue
    if (ALLCAPS_RE.test(core)) continue
    if (INTERNAL_CAPS_RE.test(core.slice(1))) continue
    if (HEX_RE.test(core)) continue

    tokens.push({
      word: core,
      start: chunkStart + lead,
      end: chunkStart + lead + core.length,
      isCapitalized: /^[A-Z]/.test(core),
    })
  }
  return tokens
}

export function accept(word: string, dict: Accepts, personal: Accepts): boolean {
  const w = word.toLowerCase()
  return dict.has(w) || personal.has(w)
}

export function flagged(tokens: Token[], dict: Accepts, personal: Accepts): Token[] {
  return tokens.filter(t => !accept(t.word, dict, personal))
}
