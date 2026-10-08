export type Dictionary = Set<string>

/** Accept set plus a map of de-apostrophized contractions: "dont" -> "don't". */
export type DictData = { dict: Dictionary; contractions: Map<string, string> }

export const HUNSPELL_DIC = '/usr/share/hunspell/en_US.dic'

function parseWords(lines: string[], stripFlags: boolean): DictData {
  const dict: Dictionary = new Set()
  const contractions = new Map<string, string>()
  for (const line of lines) {
    const word = stripFlags ? line.split('/')[0] : line
    if (!word) continue
    const w = word.toLowerCase()
    dict.add(w)
    if (w.includes("'")) {
      const bare = w.replace(/'/g, '')
      if (bare.length > 2 && !contractions.has(bare)) contractions.set(bare, w)
    }
  }
  return { dict, contractions }
}

/** Wordlist from `aspell dump master` output, one word per line. */
export function parseAspellDump(stdout: string, isTruncated: boolean): DictData {
  const lines = stdout.split('\n')
  if (isTruncated) lines.pop() // last line may be cut
  return parseWords(lines, false)
}

/** Wordlist from a hunspell .dic file: count line first, `word/FLAGS` after. */
export function parseHunspellDic(text: string): DictData {
  const lines = text.split('\n')
  lines.shift() // first line is the entry count
  return parseWords(lines, true)
}
