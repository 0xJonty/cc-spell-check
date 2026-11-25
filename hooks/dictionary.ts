import type { EngineInterface } from 'claude-code'

import { wordKey } from './words'

export type DictData = { dict: Set<string>; contractions: Map<string, string> }
export type LoadedDictionary = DictData & { source: 'aspell' | 'hunspell'; lang: string }

function parseWordList(stdout: string): DictData {
  const dict = new Set<string>()
  const contractions = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const word = wordKey(line.trim())
    if (!word) continue
    dict.add(word)
    if (word.includes("'")) {
      const bare = word.replace(/'/g, '')
      if (bare.length > 2 && !contractions.has(bare)) contractions.set(bare, word)
    }
  }
  return { dict, contractions }
}

async function readWordList($: EngineInterface, argv: string[]): Promise<DictData | null> {
  try {
    const run = await $.process.run(argv, { timeoutMs: 15_000 })
    if (run.exitCode !== 0 || run.isStdoutTruncated || run.stdout.includes('\uFFFD')) return null
    const data = parseWordList(run.stdout)
    return data.dict.size > 0 ? data : null
  } catch {
    return null
  }
}

export async function loadDictionary($: EngineInterface, lang: string): Promise<LoadedDictionary | null> {
  const aspell = await readWordList($, ['aspell', '-l', lang, '--encoding=utf-8', 'dump', 'master'])
  if (aspell) return { ...aspell, source: 'aspell', lang }

  // Hunspell dictionary filenames usually use an underscore before the region.
  const locale = lang.replace(/-/g, '_')
  if (!/^[a-z]{2,3}(?:_[a-z]{4})?(?:_(?:[a-z]{2}|\d{3}))?$/i.test(locale)) return null
  for (const dir of ['/usr/share/hunspell', '/usr/local/share/hunspell', '/opt/homebrew/share/hunspell']) {
    const base = `${dir}/${locale}`
    const hunspell = await readWordList($, ['unmunch', `${base}.dic`, `${base}.aff`])
    if (hunspell) return { ...hunspell, source: 'hunspell', lang: locale }
  }
  return null
}
