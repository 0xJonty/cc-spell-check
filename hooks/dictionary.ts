export type Dictionary = Set<string>

export const HUNSPELL_DIC = '/usr/share/hunspell/en_US.dic'

function parseWords(lines: string[], stripFlags: boolean): Dictionary {
  const dict: Dictionary = new Set()
  for (const line of lines) {
    const word = stripFlags ? line.split('/')[0] : line
    if (word) dict.add(word.toLowerCase())
  }
  return dict
}

/** Wordlist from `aspell dump master` output, one word per line. */
export function parseAspellDump(stdout: string, isTruncated: boolean): Dictionary {
  const lines = stdout.split('\n')
  if (isTruncated) lines.pop() // last line may be cut
  return parseWords(lines, false)
}

/** Wordlist from a hunspell .dic file: count line first, `word/FLAGS` after. */
export function parseHunspellDic(text: string): Dictionary {
  const lines = text.split('\n')
  lines.shift() // first line is the entry count
  return parseWords(lines, true)
}
