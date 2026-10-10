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
      // The settings panel: its tab, which color is being picked ('model', 'path.2',
      // ...), the Catppuccin flavor shown, and a counter that redraws it.
      pick: string | null
      flavor: string
      tab: string
      // The open dropdown in the panel, or null.
      menu: string | null
      rev: number
    }
  }
}
