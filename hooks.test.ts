import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ASPELL_OK = {
  exitCode: 0,
  stdout: 'please\ninclude\nthe\nsetup\nsteps\nhello\nworld\n',
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
}

const ASPELL_MISSING = { ...ASPELL_OK, exitCode: 1, stdout: '' }

const COMPOSER = { origin: { kind: 'composer' } as const }
const PRESENTATION = { isFullscreen: true, columns: 120 }

// The test's hooks stand for the engine: events the test engine leaves
// unimplemented get their bottom here. Op events answer { value }.
function bottoms(
  on: On,
  opts: {
    aspell?: typeof ASPELL_OK
    dicFile?: string
    onSubmit?: (text: string) => void
  } = {},
) {
  const store = new Map<string, unknown>()
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', () => ({ value: opts.aspell ?? ASPELL_OK }))
  on('fs.read', () => {
    if (opts.dicFile === undefined) throw new Error('no dic file in this test')
    return { value: opts.dicFile }
  })
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.submit', (_, e) => {
    opts.onSubmit?.(e.text)
    return { text: e.text, context: [], origin: e.origin }
  })
  return store
}

async function spell($: Engine, args: string) {
  return $.command.run({ command: 'spell', args, ...COMPOSER, presentation: PRESENTATION })
}

// The dictionary load is fire-and-forget off session.start; give its
// microtask chain (store.get -> process.run -> state.set) turns to land.
async function startWithDict($: Engine, until = 'ready') {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 20; i++) {
    const r = await spell($, 'status')
    if (r.text?.includes(until)) return r
  }
  throw new Error(`dictionary never became ${until}`)
}

function edit($: Engine, before: string, typed: string) {
  return $.prompt.edit({
    ...COMPOSER,
    text: before,
    cursor: before.length,
    start: before.length,
    end: before.length,
    inputText: typed,
  })
}

describe('cc-spell-check hooks', () => {
  test('loads the dictionary via aspell and reports status', async ($, on) => {
    bottoms(on)
    const r = await startWithDict($)
    expect(r.text).toContain('ready')
    expect(r.text).toContain('7 words')
  })

  test('underlines misspellings on prompt.edit, leaves clean text alone', async ($, on) => {
    bottoms(on)
    await startWithDict($)

    const r = await $.prompt.edit({
      ...COMPOSER,
      text: 'please incldu the setup',
      cursor: 13,
      start: 13,
      end: 13,
      inputText: 'e',
    })
    expect(r.text).toBe('please incldue the setup')
    expect(r.decorations).toEqual([{ start: 7, end: 14, color: 'red', underline: true }])

    const clean = await edit($, 'please include the setup', ' ')
    expect(clean.decorations ?? []).toEqual([])
  })

  test('falls back to hunspell parsing when aspell fails', async ($, on) => {
    bottoms(on, { aspell: ASPELL_MISSING, dicFile: '3\nhello/XY\nworld\nzebra/A\n' })
    const r = await startWithDict($, 'fallback')
    expect(r.text).toContain('3 words')
  })

  test('never rewrites the submitted prompt', async ($, on) => {
    let submitted = ''
    bottoms(on, { onSubmit: text => (submitted = text) })
    await startWithDict($)
    await $.prompt.submit({ text: 'please incldue the setup', ...COMPOSER })
    expect(submitted).toBe('please incldue the setup')
  })

  test('/spell off disables flagging, /spell add teaches a word', async ($, on) => {
    bottoms(on)
    await startWithDict($)

    await spell($, 'off')
    const off = await edit($, 'please incldu', 'e')
    expect(off.decorations ?? []).toEqual([])
    await spell($, 'on')

    await spell($, 'add zorp')
    const taught = await edit($, 'zorp hello worl', 'd')
    expect(taught.decorations ?? []).toEqual([])
    const flaggedAgain = await edit($, 'zorp hello worl', 'x')
    expect((flaggedAgain.decorations ?? []).length).toBe(1)
  })

  test('disabled by config', { options: { enabled: false } }, async ($, on) => {
    bottoms(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const r = await edit($, 'incldu', 'e')
    expect(r.decorations ?? []).toEqual([])
  })
})
