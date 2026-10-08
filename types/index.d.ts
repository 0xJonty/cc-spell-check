export type SpellActive = {
  word: string
  start: number
  end: number
  isCapitalized: boolean
  kind: 'spelling' | 'contraction'
  fix?: string
} | null

export type SpellDictStatus = 'loading' | 'ready' | 'fallback' | 'missing'

declare module 'claude-code' {
  interface PluginState {
    'cc-spell-check': {
      active: SpellActive
      isEnabled: boolean
      dictStatus: SpellDictStatus
    }
  }
}
