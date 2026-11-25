export function wordKey(word: string): string {
  return word.replace(/’/g, "'").toLowerCase().normalize('NFC')
}

export function recase(word: string, like: string): string {
  if (!/^\p{Lu}/u.test(like)) return word
  const first = [...word][0]
  return first ? first.toUpperCase() + word.slice(first.length) : word
}
