import { describe, expect, test } from 'claude-code/testing'

import { suggestionsFor } from './hooks/suggest'

const dict = new Set(['the', 'include', 'receive', 'spelling', 'cat', 'bat', 'rat', 'mat', 'hat'])

const fresh = () => new Map<string, string[]>()

describe('suggestionsFor', () => {
  test('corrects a transposition at distance 1', () => {
    expect(suggestionsFor('teh', dict, fresh())[0]).toBe('the')
  })

  test('prioritizes adjacent swaps among equally close words', () => {
    const crowded = new Set(['tea', 'ted', 'tee', 'ten', 'the', 'ada', 'adc', 'add', 'and'])
    expect(suggestionsFor('teh', crowded, fresh())[0]).toBe('the')
    expect(suggestionsFor('adn', crowded, fresh())[0]).toBe('and')
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

  test('uses the same cache across limits and caps suggestions at nine', () => {
    const many = new Set(['bat', 'cat', 'eat', 'fat', 'hat', 'mat', 'pat', 'rat', 'sat', 'vat', 'oat'])
    const cache = fresh()
    expect(suggestionsFor('aat', many, cache, 1)).toHaveLength(1)
    expect(suggestionsFor('aat', many, cache, 5)).toHaveLength(5)
    expect(suggestionsFor('aat', many, cache, 50)).toHaveLength(9)
    expect(suggestionsFor('aat', many, cache)).toHaveLength(3)
  })

  test('returns nothing for long gibberish', () => {
    expect(suggestionsFor('xqzjwklpv', dict, fresh())).toEqual([])
  })

  test('skips candidate generation and caching for a very long pasted word', () => {
    const cache = fresh()
    const long = 'z'.repeat(2000)
    expect(suggestionsFor(long, new Set([long.slice(1)]), cache)).toEqual([])
    expect(cache.size).toBe(0)
  })

  test('serves repeat lookups from the cache', () => {
    const cache = fresh()
    suggestionsFor('teh', dict, cache)
    expect(cache.get('teh')).toEqual(['the'])
    expect(suggestionsFor('Teh', dict, cache)[0]).toBe('The')
  })
})
