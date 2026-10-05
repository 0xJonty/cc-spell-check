import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isEnabled = atom({ plugin: 'cc-spell-check', key: 'isEnabled' } as const, true)
const dictStatus = atom({ plugin: 'cc-spell-check', key: 'dictStatus' } as const, 'loading')

let enabledNow = true

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spell',
      description: 'Spell check: toggle, status, personal dictionary',
      argumentHint: '[on|off|status|add <word>|remove <word>]',
    })
    enabledNow = options.enabled !== false
    void update($, isEnabled, () => enabledNow)
    return next(e)
  })

  on('command.run', { command: 'spell' }, async ($, e) => {
    const [verb] = e.args.trim().split(/\s+/).filter(Boolean)
    switch (verb) {
      case 'on':
      case 'off': {
        enabledNow = verb === 'on'
        await update($, isEnabled, () => enabledNow)
        return { text: `Spell check ${verb} (this session; use /config for the permanent default).` }
      }
      default: {
        const status = await read($, dictStatus)
        return {
          text: `Spell check: ${enabledNow ? 'on' : 'off'} | dict: ${status} | lang: ${String(options.lang ?? 'en_AU')}`,
        }
      }
    }
  })
}
