import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import {
  readPersonalWords,
  readSuggestionOverrides,
  writePersonalWord,
  writeSuggestionOverride,
} from './hooks/personal'

function storeClient(shared: Map<string, unknown>) {
  const store: EngineInterface['store'] = {
    async get(key) { return shared.get(key) },
    async keys() { return [...shared.keys()] },
    async set(key, value) { shared.set(key, value) },
    async delete(key) { shared.delete(key) },
  }
  return { store } as EngineInterface
}

test('two initialized sessions can add different words and remove an imported word', async () => {
  const shared = new Map<string, unknown>([['personalWords', ['Zorp', 'zorp', 'Café', 9]]])
  const first = storeClient(shared)
  const second = storeClient(shared)
  const snapshots = await Promise.all([readPersonalWords(first, true), readPersonalWords(second, true)])
  for (const { words } of snapshots) expect([...words].sort()).toEqual(['café', 'zorp'])
  expect(shared.has('personalWords')).toBe(false)

  await Promise.all([writePersonalWord(first, 'firstword', true), writePersonalWord(second, 'secondword', true)])
  await writePersonalWord(first, 'zorp', false)
  await writePersonalWord(second, 'thirdword', true)
  const { words } = await readPersonalWords(storeClient(shared))
  expect([...words].sort()).toEqual(['café', 'firstword', 'secondword', 'thirdword'])
})

test('retrying a legacy import does not resurrect a word removed in another session', async () => {
  const shared = new Map<string, unknown>([['personalWords', ['zorp']]])
  const migrating = storeClient(shared)
  const editing = storeClient(shared)
  const runImport = migrating.store.set
  migrating.store.set = async (key, value) => {
    await writePersonalWord(editing, 'zorp', false)
    await runImport(key, value)
  }

  await readPersonalWords(migrating, true)
  expect(shared.has('personalWords')).toBe(false)
  expect((await readPersonalWords(editing)).words.has('zorp')).toBe(false)
})

test('a malformed legacy value does not prevent reading per-word entries', async () => {
  const shared = new Map<string, unknown>([['personalWords', { invalid: true }]])
  const client = storeClient(shared)
  await writePersonalWord(client, 'zorp', true)
  expect([...(await readPersonalWords(client, true)).words]).toEqual(['zorp'])
})

test('concurrent overrides persist independently and removals mask old values', async () => {
  const shared = new Map<string, unknown>([['suggestOverrides', { Teh: ['The'] }]])
  const first = storeClient(shared)
  const second = storeClient(shared)
  expect((await readSuggestionOverrides(first)).get('teh')).toEqual(['the'])

  await Promise.all([
    writeSuggestionOverride(first, 'teh', []),
    writeSuggestionOverride(second, 'adn', ['and']),
  ])
  await writeSuggestionOverride(first, 'recieve', ['receive'])
  const saved = await readSuggestionOverrides(storeClient(shared))
  expect(saved.size).toBe(2)
  expect(saved.get('adn')).toEqual(['and'])
  expect(saved.get('recieve')).toEqual(['receive'])
})
