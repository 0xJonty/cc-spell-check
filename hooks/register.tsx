import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptDecoration, Register } from 'claude-code'

import type { SpellActive, SpellDictStatus } from '../types'
import {
  HUNSPELL_DIC,
  parseAspellDump,
  parseHunspellDic,
  type DictData,
  type Dictionary,
} from './dictionary'
import { suggestionsFor } from './suggest'
import { flagged, tokenize, type Token } from './tokenizer'

const active = atom({ plugin: 'cc-spell-check', key: 'active' } as const, null)
const isEnabled = atom({ plugin: 'cc-spell-check', key: 'isEnabled' } as const, true)
const dictStatus = atom({ plugin: 'cc-spell-check', key: 'dictStatus' } as const, 'loading')

// Module scope: reset on hot reload; session.start re-fires then and rebuilds.
let dict: Dictionary | null = null
let contractions = new Map<string, string>()
let personal = new Set<string>()
let enabledNow = true
const suggestCache = new Map<string, string[]>()
let lastActiveKey = ''

// Above this, flagging is skipped entirely so huge pastes never lag a keystroke.
const MAX_CHARS = 10_000

// A flagged token: a plain misspelling, or a contraction missing its
// apostrophe ("dont" -> "don't"), which gets its own color and exact fix.
type Flag = Token & { kind: 'spelling' | 'contraction'; fix?: string }

const CONTRACTION_COLOR = '#ffa500'

function recase(word: string, like: string): string {
  return /^[A-Z]/.test(like) ? word.charAt(0).toUpperCase() + word.slice(1) : word
}

function classify(tokens: Token[]): Flag[] {
  return tokens.map(t => {
    const fix = contractions.get(t.word.toLowerCase())
    return fix
      ? { ...t, kind: 'contraction' as const, fix: recase(fix, t.word) }
      : { ...t, kind: 'spelling' as const }
  })
}

function pickNearest(bad: Flag[], cursor: number): Flag | null {
  let nearest: Flag | null = null
  for (const t of bad) {
    if (t.start <= cursor && cursor <= t.end) return t
    if (t.end <= cursor && (!nearest || t.end > nearest.end)) nearest = t
  }
  return nearest
}

function toDecorations(bad: Flag[]): PromptDecoration[] {
  return bad.map(t => ({
    start: t.start,
    end: t.end,
    color: t.kind === 'contraction' ? CONTRACTION_COLOR : 'red',
    underline: true,
  }))
}

function decorationsFor(text: string, cursor: number): PromptDecoration[] {
  if (!dict) return []
  const bad = classify(flagged(tokenize(text), dict, personal))
  return toDecorations(bad.filter(t => cursor < t.start || cursor > t.end))
}

async function loadDictionary(
  $: EngineInterface,
  lang: string,
): Promise<{ data: DictData | null; status: SpellDictStatus }> {
  try {
    const run = await $.process.run(['aspell', '-l', lang, 'dump', 'master'], {
      timeoutMs: 15_000,
    })
    if (run.exitCode === 0) {
      const data = parseAspellDump(run.stdout, run.isStdoutTruncated)
      if (data.dict.size > 0) return { data, status: 'ready' }
    }
  } catch {
    // aspell missing or failed to start: fall through
  }
  try {
    const data = parseHunspellDic(await $.fs.read(HUNSPELL_DIC))
    if (data.dict.size > 0) return { data, status: 'fallback' }
  } catch {
    // no hunspell wordlist either
  }
  return { data: null, status: 'missing' }
}

async function clearActive($: EngineInterface) {
  lastActiveKey = ''
  await update($, active, () => null)
}

async function applyFix($: EngineInterface, cur: NonNullable<SpellActive>, replacement: string) {
  if (!dict) return
  const box = await $.prompt.read()
  let { start, end } = cur
  if (box.text.slice(start, end) !== cur.word) {
    // The draft moved since the word was flagged: find it again.
    const again = flagged(tokenize(box.text), dict, personal).find(t => t.word === cur.word)
    if (!again) return void clearActive($)
    start = again.start
    end = again.end
  }
  const text = box.text.slice(0, start) + replacement + box.text.slice(end)
  await $.prompt.fill({ text, mode: 'replace', decorations: decorationsFor(text, text.length) })
  await clearActive($)
}

async function addWord($: EngineInterface, word: string) {
  const w = word.toLowerCase()
  personal.add(w)
  await $.store.set('personalWords', [...personal].sort())
  await clearActive($)
  $.ui.toast(`"${w}" added to dictionary`)
}

export const register: Register = (on, options) => {
  const lang = () => String(options.lang ?? 'en_AU')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spell',
      description: 'Spell check: toggle, status, personal dictionary',
      argumentHint: '[on|off|status|add <word>|remove <word>]',
    })
    enabledNow = options.enabled !== false
    void update($, isEnabled, () => enabledNow)
    // Dictionary load runs off the critical path; no flagging until it lands.
    void (async () => {
      personal = new Set(((await $.store.get('personalWords')) as string[] | undefined) ?? [])
      const loaded = await loadDictionary($, lang())
      dict = loaded.data?.dict ?? null
      contractions = loaded.data?.contractions ?? new Map()
      await update($, dictStatus, () => loaded.status)
      if (loaded.status === 'missing') {
        $.ui.toast('cc-spell-check: no dictionary found (sudo apt install aspell aspell-en)')
      } else if (loaded.status === 'fallback') {
        $.ui.toast('cc-spell-check: aspell missing, using hunspell en_US wordlist')
      }
    })()
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (!enabledNow || !dict) return r
    if (r.text.length > MAX_CHARS) {
      if (lastActiveKey !== '') void clearActive($)
      return r
    }
    const bad = classify(flagged(tokenize(r.text), dict, personal))
    // A word still under the cursor is mid-typing: flag it only once the
    // cursor has moved past it (space, punctuation, click elsewhere).
    const settled = bad.filter(t => r.cursor < t.start || r.cursor > t.end)
    const near = pickNearest(settled, r.cursor)
    const key = near ? `${near.word}:${near.start}` : ''
    if (key !== lastActiveKey) {
      lastActiveKey = key
      void update($, active, () => near)
    }
    if (settled.length === 0) return r
    return { ...r, decorations: toDecorations(settled) }
  })

  on('prompt.submit', ($, e, next) => {
    // Visual only: the submitted prompt is never rewritten.
    void clearActive($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const cur = await read($, active)
    if (!cur || !dict || !(await read($, isEnabled))) return next(e)

    const sugg =
      cur.kind === 'contraction' && cur.fix
        ? [cur.fix]
        : suggestionsFor(cur.word, dict, suggestCache)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color={cur.kind === 'contraction' ? CONTRACTION_COLOR : 'red'}>✗ {cur.word} </Text>
        {sugg.map((s, i) => (
          <Button
            key={`fix-${i}`}
            hotkey={String(i + 1)}
            label={s}
            variant={i === 0 ? 'primary' : 'secondary'}
            onPress={() => void applyFix($, cur, s)}
          />
        ))}
        {sugg.length === 0 && <Text dimColor>no suggestions </Text>}
        <Button key="add" hotkey="a" label="+dict" onPress={() => void addWord($, cur.word)} />
        <Button key="dismiss" role="dismiss" label="x" onPress={() => void clearActive($)} />
      </Box>
    )
  })

  on('command.run', { command: 'spell' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    switch (verb) {
      case 'on':
      case 'off': {
        enabledNow = verb === 'on'
        await update($, isEnabled, () => enabledNow)
        if (!enabledNow) await clearActive($)
        return { text: `Spell check ${verb} (this session; use /config for the permanent default).` }
      }
      case 'add': {
        if (rest.length === 0) return { text: 'Usage: /spell add <word> [...]' }
        for (const w of rest) personal.add(w.toLowerCase())
        await $.store.set('personalWords', [...personal].sort())
        return { text: `Added to personal dictionary: ${rest.join(', ')}` }
      }
      case 'remove': {
        if (rest.length === 0) return { text: 'Usage: /spell remove <word> [...]' }
        for (const w of rest) personal.delete(w.toLowerCase())
        await $.store.set('personalWords', [...personal].sort())
        return { text: `Removed from personal dictionary: ${rest.join(', ')}` }
      }
      default: {
        const status = await read($, dictStatus)
        return {
          text:
            `Spell check: ${enabledNow ? 'on' : 'off'} | dict: ${status}` +
            ` (${dict?.size ?? 0} words, lang ${lang()}) | personal: ${personal.size}`,
        }
      }
    }
  })
}
