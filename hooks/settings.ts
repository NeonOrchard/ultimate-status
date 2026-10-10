import { cleanLayout } from './layout'
import type { Layout } from './layout'

// Optional settings, read from ultimate-status.json in Claude's config folder
// (~/.claude, or $CLAUDE_CONFIG_DIR). A missing file or key keeps the default;
// edits apply on the next draw, no restart. Dragging the bar saves its layout
// back into the same file.
export type Colors = {
  dim: string
  info: string
  model: string
  speed: string
  path: string[]
  branch: string
  ctxLabel: string
  ctxValue: string
  fiveLabel: string
  fiveValue: string
  weekLabel: string
  weekValue: string
}
export type Settings = {
  // Absent until set, so the older layout in the mod's store still counts.
  layout?: Layout
  colors: Colors
  // The path shrinks its middle folders past this many characters (no tmux).
  pathMax: number
}

// Catppuccin Macchiato. Left side cool, right side warm.
export const DEFAULT_COLORS: Colors = {
  dim: '#6e738d',
  info: '#a5adcb',
  model: '#c6a0f6', // mauve
  speed: '#eed49f', // yellow
  path: ['#8aadf4', '#7dc4e4', '#91d7e3', '#8bd5ca', '#b7bdf8'], // blue, sapphire, sky, teal, lavender
  branch: '#a6da95', // green
  ctxLabel: '#ed8796', // red
  ctxValue: '#ee99a0', // maroon
  fiveLabel: '#f5a97f', // peach
  fiveValue: '#eed49f', // yellow
  weekLabel: '#f5bde6', // pink
  weekValue: '#f4dbd6', // rosewater
}
export const DEFAULTS: Settings = { colors: DEFAULT_COLORS, pathMax: 28 }

const HEX = /^#[0-9a-f]{6}$/i
const isHex = (c: unknown): c is string => typeof c === 'string' && HEX.test(c)

// Settings read back from the file, with anything unknown or wrong fixed.
export function cleanSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const given = (o.colors && typeof o.colors === 'object' ? o.colors : {}) as Record<string, unknown>
  const colors: Colors = { ...DEFAULT_COLORS }
  for (const k of Object.keys(colors) as (keyof Colors)[]) {
    if (k === 'path') continue
    if (isHex(given[k])) (colors as Record<string, unknown>)[k] = given[k]
  }
  if (Array.isArray(given.path) && given.path.length > 0 && given.path.every(isHex)) colors.path = given.path
  const pathMax = typeof o.pathMax === 'number' && o.pathMax >= 8 && o.pathMax <= 200 ? Math.round(o.pathMax) : DEFAULTS.pathMax
  const out: Settings = { colors, pathMax }
  if (o.layout && typeof o.layout === 'object') out.layout = cleanLayout(o.layout)
  return out
}
