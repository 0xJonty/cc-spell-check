import { describe, expect, test } from 'claude-code/testing'

import { flagged, tokenize } from './hooks/tokenizer'

const dict = new Set(['please', 'include', 'the', 'setup', 'steps', 'hello', 'world', "don't", 'word'])
const none = new Set<string>()

describe('tokenize', () => {
  test('flags a misspelling with exact offsets', () => {
    const tokens = tokenize('please incldue the setup')
    const bad = flagged(tokens, dict, none)
    expect(bad).toEqual([{ word: 'incldue', start: 7, end: 14, isCapitalized: false }])
  })

  test('offsets are UTF-16 code units past emoji', () => {
    const bad = flagged(tokenize('🎉🎉 teh'), dict, none)
    expect(bad).toEqual([{ word: 'teh', start: 5, end: 8, isCapitalized: false }])
  })

  test('accepts Capitalized form of a lowercase dictionary word', () => {
    const tokens = tokenize('Please include the setup')
    expect(flagged(tokens, dict, none)).toEqual([])
    expect(tokens[0]).toEqual({ word: 'Please', start: 0, end: 6, isCapitalized: true })
  })

  test('skips URLs, paths, code-ish and reference tokens', () => {
    const text =
      'claude.md src/main.rs https://x.com CamelCase SNAKE_CASE snake_case do_this @user #42 /spell 0xdeadbeef v1.2 abc123 xy'
    expect(tokenize(text)).toEqual([])
  })

  test('skips inline code and fenced blocks, including an unclosed fence', () => {
    expect(tokenize('`tyop here` hello')).toEqual([
      { word: 'hello', start: 12, end: 17, isCapitalized: false },
    ])
    expect(tokenize('hello ```\ntyop zzzqqq\n``` world').map(t => t.word)).toEqual(['hello', 'world'])
    expect(tokenize('hello ```\ntyop zzzqqq').map(t => t.word)).toEqual(['hello'])
  })

  test('strips edge punctuation and keeps internal apostrophes', () => {
    expect(tokenize('(word), "hello!"').map(t => t.word)).toEqual(['word', 'hello'])
    const bad = flagged(tokenize("don't dont'"), dict, none)
    expect(bad.map(t => t.word)).toEqual(['dont'])
  })

  test('personal dictionary words pass', () => {
    const personal = new Set(['zorp'])
    expect(flagged(tokenize('zorp Zorp'), dict, personal)).toEqual([])
  })
})
