import type { EngineInterface } from 'claude-code'

import { wordKey } from './words'

const LEGACY_KEY = 'personalWords'
const IMPORTED_PREFIX = 'personal.imported:'
const WORD_PREFIX = 'personal.word:'

async function entryKey(prefix: string, word: string): Promise<string> {
  // The store caps key length at 256 UTF-16 code units. Keep long words in the value.
  const literal = prefix + 'word:' + word
  if (literal.length <= 256) return literal
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(word))
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return prefix + 'sha256:' + hex
}

export async function readPersonalWords($: EngineInterface, migrate = false) {
  const legacy = await $.store.get(LEGACY_KEY)
  const legacyWords = Array.isArray(legacy)
    ? legacy.filter((word): word is string => typeof word === 'string').map(wordKey).filter(Boolean)
    : []

  const words = new Set(legacyWords)
  const keys = await $.store.keys()
  for (const key of keys) {
    if (!key.startsWith(IMPORTED_PREFIX)) continue
    const value = await $.store.get(key)
    if (typeof value === 'string') words.add(value)
  }
  for (const key of keys) {
    if (!key.startsWith(WORD_PREFIX)) continue
    const entry = await $.store.get(key)
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
    const [word, added] = entry
    if (added === true) words.add(word)
    if (added === false) words.delete(word)
  }
  let migrationFailed = false
  if (migrate && Array.isArray(legacy)) {
    try {
      // Import into a separate namespace so an overlapping startup cannot overwrite a user edit.
      for (const word of new Set(legacyWords)) {
        await $.store.set(await entryKey(IMPORTED_PREFIX, word), word)
      }
      await $.store.delete(LEGACY_KEY)
    } catch {
      // An interrupted import can be retried. Keep checking against the legacy words in this session.
      migrationFailed = true
    }
  }
  return { words, migrationFailed }
}

export async function writePersonalWord($: EngineInterface, word: string, added: boolean): Promise<void> {
  await $.store.set(await entryKey(WORD_PREFIX, word), [word, added])
}
