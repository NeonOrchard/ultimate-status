export type Usage = {
  ctx?: number
  five?: number
  week?: number
  fiveResets?: string
  weekResets?: string
}

declare module 'claude-code' {
  interface PluginState {
    'ultimate-status': {
      usage: Usage
      // Which popup is open: 'model', 'dir:<absolute path>', or null.
      popup: string | null
      // The permission mode, as hooks report it (default, auto, plan, ...).
      mode: string
    }
  }
}
