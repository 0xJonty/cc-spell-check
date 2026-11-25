import { describe, expect, test } from 'claude-code/testing'
import type { Engine, EngineCall } from 'claude-code/testing'
import type { On, ProcessRunResult, PromptBox, PromptDecoration } from 'claude-code'

const ASPELL_OK = {
  exitCode: 0,
  stdout: "please\ninclude\nthe\nsetup\nsteps\nhello\nworld\ndon't\nforget\n",
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
}

const ASPELL_MISSING = { ...ASPELL_OK, exitCode: 1, stdout: '' }
const COMPOSER = { origin: { kind: 'composer' } as const }
const PRESENTATION = { isFullscreen: true, columns: 120 }
const SESSION = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const BOLD = { start: 0, end: 5, bold: true }

type Options = {
  run?: (argv: readonly string[]) => ProcessRunResult | Promise<ProcessRunResult>
  store?: Map<string, unknown>
  storeReadFails?: boolean
  onSubmit?: (text: string) => void
}

// The test engine dispatches both events, but its generated prompt type omits them.
type TestPrompt = Engine['prompt'] & {
  edit: EngineCall<'prompt.edit'>
  change: EngineCall<'prompt.change'>
}

function harness($: Engine, on: On, options: Options = {}) {
  const store = options.store ?? new Map<string, unknown>()
  let box: PromptBox = { text: '', cursor: 0 }
  let painted: PromptDecoration[] = []
  let filled = 0
  let paintCount = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => {
    if (options.storeReadFails) throw new Error('store read failed')
    return { value: store.get(e.key) }
  })
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('process.run', async (_, e) => ({ value: await (options.run?.(e.argv) ?? ASPELL_OK) }))
  on('prompt.read', () => ({ value: box }))
  on('prompt.paint', (_, e) => {
    const isPainted = e.text === box.text
    if (isPainted) {
      painted = e.decorations
      paintCount++
    }
    return { value: { ...box, isPainted } }
  })
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    box = { text, cursor: e.start + e.inputText.length }
    return { ...box, decorations: text.startsWith('hello') ? [BOLD] : [] }
  })
  on('prompt.change', (_, e) => ({ text: e.text, cursor: e.cursor, origin: e.origin }))
  on('prompt.fill', (_, e) => {
    filled++
    box = { text: e.text, cursor: e.cursor ?? e.text.length }
    return { ...box, isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    options.onSubmit?.(e.text)
    return { text: e.text, context: [], origin: e.origin }
  })

  return {
    async edit(before: string, typed: string) {
      const prev = paintCount
      const result = await ($.prompt as TestPrompt).edit({
        ...COMPOSER,
        text: before,
        cursor: before.length,
        start: before.length,
        end: before.length,
        inputText: typed,
      })
      await until($, () => paintCount > prev)
      return result
    },
    draft(text: string, cursor = text.length) { box = { text, cursor } },
    get box() { return box },
    get painted() { return painted },
    get fillCount() { return filled },
  }
}

function spell($: Engine, args: string) {
  return $.command.run({ command: 'spell', args, ...COMPOSER, presentation: PRESENTATION })
}

async function until<T>($: Engine, check: () => T | Promise<T>): Promise<NonNullable<T>> {
  for (let i = 0; i < 40; i++) {
    const result = await check()
    if (result) return result
    await spell($, 'status')
  }
  throw new Error('Expected plugin state did not arrive')
}

async function startWithDict($: Engine, status = 'ready') {
  await $.session.start(SESSION)
  return until($, async () => {
    const result = await spell($, 'status')
    return result.text?.includes('dict: ' + status) ? result.text : undefined
  })
}

function mount($: Engine) {
  return $.ui.mount({
    plugin: 'cc-spell-check',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 8,
      bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} },
  })
}

describe('cc-spell-check hooks', () => {
  test('loads the dictionary via aspell and reports status', async ($, on) => {
    harness($, on)
    expect(await startWithDict($)).toContain('aspell en_AU, 9 words')
  })

  test('recognizes words in CRLF dictionary output', async ($, on) => {
    const term = harness($, on, { run: () => ({ ...ASPELL_OK, stdout: 'hello\r\nworld\r\n' }) })
    expect(await startWithDict($)).toContain('2 words')
    await term.edit('hello world', ' ')
    expect(term.painted).toEqual([])
  })

  test('paints an apostrophe-less contraction orange and accepts a curly apostrophe', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('dont forget the setu', 'p')
    expect(term.painted).toEqual([{ start: 0, end: 4, color: '#ffa500', underline: true }])
    await term.edit('don’t forget the setu', 'p')
    expect(term.painted).toEqual([])
  })

  test('underlines a settled misspelling without replacing other prompt decorations', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    const result = await term.edit('hello incldue the setu', 'p')
    expect(result.text).toBe('hello incldue the setup')
    expect(result.decorations).toEqual([BOLD])
    expect(term.painted).toEqual([{ start: 6, end: 13, color: 'red', underline: true }])
    await term.edit('hello include the setup', ' ')
    expect(term.painted).toEqual([])
  })

  test('does not flag the word still being typed', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('please incld', 'u')
    expect(term.painted).toEqual([])
    await term.edit('please incldu', ' ')
    expect(term.painted).toHaveLength(1)
  })

  test('rejects truncated Aspell output and uses the expanded Hunspell locale', {
    options: { lang: 'en-GB' },
  }, async ($, on) => {
    const hunspellCalls: (readonly string[])[] = []
    const term = harness($, on, { run: argv => {
      if (argv[0] === 'aspell') return { ...ASPELL_OK, isStdoutTruncated: true }
      hunspellCalls.push(argv)
      return { ...ASPELL_OK, stdout: 'hello\nwalk\nwalked\nwalks\n' }
    } })
    expect(await startWithDict($, 'fallback')).toContain('hunspell en_GB, 4 words')
    expect(hunspellCalls[0]).toEqual(['unmunch', '/usr/share/hunspell/en_GB.dic', '/usr/share/hunspell/en_GB.aff'])
    await term.edit('hello walked walks', ' ')
    expect(term.painted).toEqual([])
  })

  test('reports missing when neither dictionary is usable', async ($, on) => {
    harness($, on, { run: () => ASPELL_MISSING })
    expect(await startWithDict($, 'missing')).toContain('requested en_AU')
  })

  test('still loads Aspell when the personal store rejects reads', async ($, on) => {
    harness($, on, { storeReadFails: true })
    expect(await startWithDict($)).toContain('aspell en_AU, 9 words')
  })

  test('repaints a draft typed while the dictionary was loading', async ($, on) => {
    let finishLoad: (result: ProcessRunResult) => void = () => {}
    const load = new Promise<ProcessRunResult>(resolve => { finishLoad = resolve })
    const term = harness($, on, { run: () => load })
    await $.session.start(SESSION)
    await term.edit('please incldue', ' ')
    expect(term.painted).toEqual([])
    finishLoad(ASPELL_OK)
    await until($, () => term.painted.length === 1)
  })

  test('a stale button never replaces a matching substring in another draft', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('teh', ' ')
    const ui = await mount($)
    const button = await until($, async () => {
      await ui.redraw()
      return ui.find({ type: 'Button', text: 'the' })
    })
    expect(button.key).toBeDefined()
    term.draft('tehnique', 2)
    await ui.press({ key: button.key! })
    expect(term.box.text).toBe('tehnique')
    expect(term.fillCount).toBe(0)
  })

  test('recalling a draft replaces its suggestion and a correction preserves the caret', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('teh', ' ')
    const ui = await mount($)
    await until($, async () => {
      await ui.redraw()
      return ui.find({ type: 'Button', text: 'the' })
    })
    term.draft('dont forget the setup', 5)
    await ($.prompt as TestPrompt).change({ ...term.box, origin: { kind: 'history' } })
    const button = await until($, async () => {
      await ui.redraw()
      return ui.find({ type: 'Button', text: "don't" })
    })
    expect(button.key).toBeDefined()
    await ui.press({ key: button.key! })
    expect(term.box).toEqual({ text: "don't forget the setup", cursor: 6 })
  })

  test('never rewrites the submitted prompt', async ($, on) => {
    let submitted = ''
    harness($, on, { onSubmit: text => (submitted = text) })
    await startWithDict($)
    await $.prompt.submit({ text: 'please incldue the setup', wait: false, ...COMPOSER })
    expect(submitted).toBe('please incldue the setup')
  })

  test('toggles, teaches, and removes words from the existing draft', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('zorp', ' ')
    expect(term.painted).toHaveLength(1)
    await spell($, 'off')
    expect(term.painted).toEqual([])
    await spell($, 'on')
    expect(term.painted).toHaveLength(1)
    await spell($, 'add zorp')
    expect(term.painted).toEqual([])
    await spell($, 'remove zorp')
    expect(term.painted).toHaveLength(1)
  })

  test('supports adding long words through the suggestion band', async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('z'.repeat(2000), ' ')
    expect(term.painted).toHaveLength(1)
    const ui = await mount($)
    await until($, async () => {
      await ui.redraw()
      return ui.find({ key: 'add' })
    })
    await ui.press({ key: 'add' })
    expect(term.painted).toEqual([])
  })

  test('disabled by config', { options: { enabled: false } }, async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    await term.edit('incldue the setu', 'p')
    expect(term.painted).toEqual([])
  })

  test('lists, displays and removes custom corrections', { options: { maxSuggestions: 2 } }, async ($, on) => {
    const term = harness($, on)
    await startWithDict($)
    expect((await spell($, 'fix teh')).text).toContain('Usage')
    await spell($, 'add zorp')
    await term.edit('Teh', ' ')
    const ui = await mount($)
    await spell($, 'fix teh TEST the Then')
    expect((await spell($, 'list')).text).toContain('teh -> test, the, then')
    expect((await spell($, 'list')).text).toContain('zorp')
    const fixes = async () => {
      await ui.redraw()
      return (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('fix-'))
    }
    const shown = await until($, async () => {
      const buttons = await fixes()
      return buttons.length === 2 ? buttons : undefined
    })
    expect(shown.map(button => button.text)).toEqual(['Test', 'The'])
    await spell($, 'unfix TEH')
    expect((await spell($, 'list')).text).toContain('No suggestion overrides.')
    expect((await fixes()).map(button => button.text)).toEqual(['The'])
  })
})
