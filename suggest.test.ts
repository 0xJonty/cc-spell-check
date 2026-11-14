import { describe, expect, test } from 'claude-code/testing'

import { suggestionsFor } from './hooks/suggest'

const dict = new Set(['the', 'include', 'receive', 'spelling', 'cat', 'bat', 'rat', 'mat', 'hat'])

const fresh = () => new Map<string, string[]>()

describe('suggestionsFor', () => {
  test('corrects a transposition at distance 1', () => {
    expect(suggestionsFor('teh', dict, fresh())[0]).toBe('the')
  })

  test('corrects incldue and recieve', () => {
    expect(suggestionsFor('incldue', dict, fresh())[0]).toBe('include')
    expect(suggestionsFor('recieve', dict, fresh())[0]).toBe('receive')
  })

  test('falls back to distance 2 for short words', () => {
    expect(suggestionsFor('spelng', dict, fresh())).toContain('spelling')
  })

  test('preserves capitalization', () => {
    expect(suggestionsFor('Teh', dict, fresh())[0]).toBe('The')
  })

  test('caps suggestions at 3', () => {
    expect(suggestionsFor('aat', dict, fresh()).length).toBe(3)
  })

  test('honours the requested count, capped at 9, and shares one cache', () => {
    const many = new Set(['bat', 'cat', 'eat', 'fat', 'hat', 'mat', 'pat', 'rat', 'sat', 'vat', 'oat'])
    const cache = fresh()
    expect(suggestionsFor('aat', many, cache, 5).length).toBe(5)
    expect(suggestionsFor('aat', many, cache, 1).length).toBe(1)
    expect(suggestionsFor('aat', many, cache, 50).length).toBe(9)
    expect(suggestionsFor('aat', many, cache).length).toBe(3)
  })

  test('returns nothing for long gibberish', () => {
    expect(suggestionsFor('xqzjwklpv', dict, fresh())).toEqual([])
  })

  test('serves repeat lookups from the cache', () => {
    const cache = fresh()
    suggestionsFor('teh', dict, cache)
    expect(cache.get('teh')).toEqual(['the'])
    expect(suggestionsFor('Teh', dict, cache)[0]).toBe('The')
  })
})
