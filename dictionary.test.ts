import { describe, expect, test } from 'claude-code/testing'

import { parseAspellDump, parseHunspellDic } from './hooks/dictionary'

describe('dictionary parsing', () => {
  test('aspell dump with Windows CRLF line endings keeps clean words', () => {
    const { dict } = parseAspellDump('the\r\ncat\r\ndog\r\n', false)
    expect(dict.has('the')).toBe(true)
    expect(dict.has('cat')).toBe(true)
    expect(dict.has('the\r')).toBe(false)
  })

  test('hunspell .dic with CRLF line endings keeps clean words', () => {
    const { dict } = parseHunspellDic('3\r\nthe/S\r\ncat\r\ndog/M\r\n')
    expect(dict.has('the')).toBe(true)
    expect(dict.has('dog')).toBe(true)
    expect(dict.has('dog\r')).toBe(false)
  })
})
