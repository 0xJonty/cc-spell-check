import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptBox, PromptDecoration, Register } from 'claude-code'

import type { SpellActive, SpellDictStatus } from '../types'
import { loadDictionary, type LoadedDictionary } from './dictionary'
import {
  readPersonalWords,
  readSuggestionOverrides,
  writePersonalWord,
  writeSuggestionOverride,
} from './personal'
import { suggestionCount, suggestionsFor } from './suggest'
import { flagged, tokenize, type Token } from './tokenizer'
import { recase, wordKey } from './words'

const active = atom({ plugin: 'cc-spell-check', key: 'active' } as const, null)
const isEnabled = atom({ plugin: 'cc-spell-check', key: 'isEnabled' } as const, true)
const dictStatus = atom({ plugin: 'cc-spell-check', key: 'dictStatus' } as const, 'loading')

const MAX_CHARS = 10_000
const CONTRACTION_COLOR = '#ffa500'

type Flag = Token & { kind: 'spelling' | 'contraction'; fix?: string }
type Suggestion = { text: string; flag: NonNullable<SpellActive> }

function toDecorations(bad: Flag[]): PromptDecoration[] {
  return bad.map(t => ({
    start: t.start,
    end: t.end,
    color: t.kind === 'contraction' ? CONTRACTION_COLOR : 'red',
    underline: true,
  }))
}

type Session = {
  enabled: boolean
  dictionary: LoadedDictionary | null
  personal: Set<string>
  personalReady: Promise<void>
  overrides: Map<string, string[]>
  overridesReady: Promise<void>
  suggestion: Suggestion | null
  suggestionId: number
  draftRevision: number
  paintQueue: Promise<void>
  suggestCache: Map<string, string[]>
}

function scan(session: Session, { text, cursor }: PromptBox): Flag[] {
  if (!session.enabled || !session.dictionary || text.length > MAX_CHARS) return []
  const { dict, contractions } = session.dictionary
  return flagged(tokenize(text), dict, session.personal)
    .filter(t => cursor < t.start || cursor > t.end)
    .map(t => {
      const fix = contractions.get(wordKey(t.word))
      return fix
        ? { ...t, kind: 'contraction', fix: recase(fix, t.word) }
        : { ...t, kind: 'spelling' }
    })
}

async function setSuggestion(
  $: EngineInterface,
  session: Session,
  text: string,
  flag: Flag | undefined,
  force = false,
) {
  if (
    (!flag && !session.suggestion) ||
    (!force && flag && session.suggestion?.text === text && session.suggestion.flag.start === flag.start &&
      session.suggestion.flag.word === flag.word)
  ) return

  session.suggestion = flag ? { text, flag: { ...flag, id: ++session.suggestionId } } : null
  await update($, active, () => session.suggestion?.flag ?? null)
}

function refresh($: EngineInterface, session: Session, revision: number, box?: PromptBox, waitForEdit = false) {
  const run = session.paintQueue.then(async () => {
    if (revision !== session.draftRevision) return
    const current = box ?? await $.prompt.read()
    if (revision !== session.draftRevision) return

    let flags = scan(session, current)
    // Paint our own layer so it can be refreshed or removed without changing
    // decorations from the prompt.edit chain or other plugins' paint layers.
    let painted = await $.prompt.paint({ text: current.text, decorations: toDecorations(flags) })
    if (revision !== session.draftRevision) return

    if (waitForEdit && painted.text !== current.text) {
      // A rewrite from prompt.edit may land after its hook returns.
      await $.clock.sleep(1)
      if (revision !== session.draftRevision) return
      const latest = await $.prompt.read()
      if (revision !== session.draftRevision) return
      flags = scan(session, latest)
      painted = await $.prompt.paint({ text: latest.text, decorations: toDecorations(flags) })
      if (revision !== session.draftRevision || painted.text !== latest.text) return
    } else if (painted.text !== current.text) {
      return
    }

    const near = flags.findLast(t => t.end < painted.cursor)
    await setSuggestion($, session, painted.text, near)
  })
  session.paintQueue = run.catch(() => {
    $.ui.toast('cc-spell-check: could not refresh the prompt')
  })
  return session.paintQueue
}

async function applyFix($: EngineInterface, session: Session, selected: Suggestion, replacement: string) {
  if (!session.enabled || session.suggestion !== selected || !session.dictionary) return
  const revision = session.draftRevision
  const box = await $.prompt.read()
  if (revision !== session.draftRevision || session.suggestion !== selected || !session.enabled) return

  const { start, end, word } = selected.flag
  const matches = box.text === selected.text &&
    flagged(tokenize(box.text), session.dictionary.dict, session.personal).some(t =>
      t.start === start && t.end === end && t.word === word,
    )
  if (!matches) {
    await refresh($, session, ++session.draftRevision, box)
    return
  }

  const text = box.text.slice(0, start) + replacement + box.text.slice(end)
  const cursor = box.cursor <= start
    ? box.cursor
    : box.cursor >= end
      ? box.cursor + replacement.length - (end - start)
      : start + Math.min(box.cursor - start, replacement.length)
  const clear = setSuggestion($, session, '', undefined)
  try {
    const filled = await $.prompt.fill({ text, cursor, mode: 'replace' })
    if (revision === session.draftRevision) await refresh($, session, ++session.draftRevision, filled)
  } finally {
    await clear
  }
}

async function changeWords($: EngineInterface, session: Session, input: string[], added: boolean) {
  await session.personalReady
  const words = [...new Set(input.map(wordKey))]
  const saved: string[] = []
  const failed: string[] = []
  for (const word of words) {
    try {
      await writePersonalWord($, word, added)
      if (added) session.personal.add(word)
      else session.personal.delete(word)
      saved.push(word)
    } catch {
      failed.push(word)
    }
  }
  await refresh($, session, ++session.draftRevision)
  const verb = added ? 'Added to' : 'Removed from'
  return [
    saved.length ? verb + ' personal dictionary: ' + saved.join(', ') : '',
    failed.length ? 'Could not save personal dictionary changes for: ' + failed.join(', ') : '',
  ].filter(Boolean).join('\n')
}

async function renderNewSuggestions($: EngineInterface, session: Session) {
  if (session.suggestion) {
    const { text, flag } = session.suggestion
    await setSuggestion($, session, text, flag, true)
  }
}

async function changeOverrides($: EngineInterface, session: Session, typos: string[], corrections: string[]) {
  await session.overridesReady
  const saved: string[] = []
  const failed: string[] = []
  for (const typo of new Set(typos.map(wordKey))) {
    try {
      await writeSuggestionOverride($, typo, corrections)
      if (corrections.length) session.overrides.set(typo, corrections)
      else session.overrides.delete(typo)
      saved.push(typo)
    } catch {
      failed.push(typo)
    }
  }
  if (saved.length) await renderNewSuggestions($, session)
  const messages: string[] = []
  if (saved.length) {
    messages.push(corrections.length
      ? 'Suggestion overrides for ' + saved.join(', ') + ': ' + corrections.join(', ')
      : 'Removed suggestion overrides: ' + saved.join(', '))
  }
  if (failed.length) messages.push('Could not save suggestion overrides for: ' + failed.join(', '))
  return messages.join('\n')
}

async function listPreferences($: EngineInterface): Promise<string> {
  try {
    const [{ words }, overrides] = await Promise.all([readPersonalWords($), readSuggestionOverrides($)])
    const dictionary = words.size
      ? 'Personal dictionary (' + words.size + '): ' + [...words].sort().join(', ')
      : 'Personal dictionary is empty.'
    const fixes = [...overrides.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([typo, corrections]) => typo + ' -> ' + corrections.join(', '))
    return dictionary + '\n' + (fixes.length ? 'Suggestion overrides:\n' + fixes.join('\n') : 'No suggestion overrides.')
  } catch {
    return 'Could not read the personal dictionary and suggestion overrides.'
  }
}

export const register: Register = (on, options) => {
  const lang = String(options.lang ?? 'en_AU')
  const maxSuggestions = suggestionCount(options.maxSuggestions)
  const session: Session = {
    enabled: options.enabled !== false,
    dictionary: null,
    personal: new Set(),
    personalReady: Promise.resolve(),
    overrides: new Map(),
    overridesReady: Promise.resolve(),
    suggestion: null,
    suggestionId: 0,
    draftRevision: 0,
    paintQueue: Promise.resolve(),
    suggestCache: new Map(),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spell',
      description: 'Spell check: toggle, status, personal dictionary',
      argumentHint: '[on|off|status|list|add <word>|remove <word>|fix <typo> <fix>|unfix <typo>]',
    })
    await update($, isEnabled, () => session.enabled)
    await update($, active, () => null)
    await update($, dictStatus, () => 'loading')

    session.personalReady = readPersonalWords($, true).then(({ words, migrationFailed }) => {
      session.personal = words
      if (migrationFailed) $.ui.toast('cc-spell-check: could not migrate the personal dictionary')
      void refresh($, session, ++session.draftRevision)
    }).catch(() => {
      $.ui.toast('cc-spell-check: could not load the personal dictionary')
    })

    session.overridesReady = readSuggestionOverrides($).then(async overrides => {
      session.overrides = overrides
      await renderNewSuggestions($, session)
    }).catch(() => {
      $.ui.toast('cc-spell-check: could not load suggestion overrides')
    })

    void loadDictionary($, lang).then(async loaded => {
      session.dictionary = loaded
      const status = !loaded ? 'missing' : loaded.source === 'hunspell' ? 'fallback' : 'ready'
      await update($, dictStatus, () => status)
      void refresh($, session, ++session.draftRevision)
      if (session.enabled && !loaded) {
        $.ui.toast('cc-spell-check: no complete dictionary for ' + lang + ' (see /spell status)')
      }
    }).catch(() => {
      $.ui.toast('cc-spell-check: could not report dictionary status')
    })

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const revision = ++session.draftRevision
    const result = await next(e)
    void refresh($, session, revision, result, true)
    return result
  })

  on('prompt.change', ($, e, next) => {
    void setSuggestion($, session, '', undefined).catch(() => {})
    void refresh($, session, ++session.draftRevision, e)
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    ++session.draftRevision
    void setSuggestion($, session, '', undefined).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const cur = await read($, active)
    const selected = session.suggestion
    if (!cur || !selected || cur.id !== selected.flag.id || !session.dictionary ||
        !(await read($, isEnabled))) return next(e)

    const own = (session.overrides.get(wordKey(cur.word)) ?? [])
      .slice(0, maxSuggestions)
      .map(word => recase(word, cur.word))
    const automatic = cur.fix
      ? [cur.fix]
      : suggestionsFor(cur.word, session.dictionary.dict, session.suggestCache, maxSuggestions)
    const sugg = [...new Set([...own, ...automatic])].slice(0, maxSuggestions)
    const { Box, Button, Text } = $.ui.resolve(e)
    const name = cur.word.length > 48 ? cur.word.slice(0, 48) + '…' : cur.word
    return (
      <Box>
        <Text color={cur.kind === 'contraction' ? CONTRACTION_COLOR : 'red'}>✗ {name} </Text>
        {sugg.map((s, i) => (
          <Button
            key={`fix-${cur.id}-${i}`}
            hotkey={String(i + 1)}
            label={s}
            variant={i === 0 ? 'primary' : 'secondary'}
            onPress={async () => {
              try {
                await applyFix($, session, selected, s)
              } catch {
                $.ui.toast('cc-spell-check: could not apply the correction')
              }
            }}
          />
        ))}
        {sugg.length === 0 && <Text dimColor>no suggestions </Text>}
        <Button
          key="add"
          hotkey="a"
          label="+dict"
          onPress={async () => {
            if (session.enabled && session.suggestion === selected) {
              $.ui.toast(await changeWords($, session, [cur.word], true))
            }
          }}
        />
        <Button
          key="dismiss"
          role="dismiss"
          label="x"
          onPress={() => setSuggestion($, session, '', undefined)}
        />
      </Box>
    )
  })

  on('command.run', { command: 'spell' }, async ($, e) => {
    const [verb, ...words] = e.args.trim().split(/\s+/).filter(Boolean)
    switch (verb) {
      case 'on':
      case 'off': {
        session.enabled = verb === 'on'
        await update($, isEnabled, () => session.enabled)
        await refresh($, session, ++session.draftRevision)
        return { text: 'Spell check ' + verb + ' for this session. Use /config for the default.' }
      }
      case 'add':
      case 'remove': {
        if (!words.length) return { text: 'Usage: /spell ' + verb + ' <word> [...]' }
        return { text: await changeWords($, session, words, verb === 'add') }
      }
      case 'list':
        return { text: await listPreferences($) }
      case 'fix': {
        const [typo, ...corrections] = words
        if (!typo || !corrections.length) return { text: 'Usage: /spell fix <typo> <correction> [...]' }
        return { text: await changeOverrides($, session, [typo], [...new Set(corrections.map(wordKey))]) }
      }
      case 'unfix': {
        if (!words.length) return { text: 'Usage: /spell unfix <typo> [...]' }
        return { text: await changeOverrides($, session, words, []) }
      }
      default: {
        const status: SpellDictStatus = await read($, dictStatus)
        const source = session.dictionary
          ? session.dictionary.source + ' ' + session.dictionary.lang + ', ' + session.dictionary.dict.size + ' words'
          : 'requested ' + lang
        return {
          text: 'Spell check: ' + (session.enabled ? 'on' : 'off') + ' | dict: ' + status +
            ' (' + source + ') | personal: ' + session.personal.size,
        }
      }
    }
  })
}
