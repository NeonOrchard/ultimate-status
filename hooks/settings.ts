import { cleanBar, fromLayout } from './bar'
import type { BarConfig } from './bar'

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
  // The pop-up menus' and tips' card background.
  menu: string
}
export type Settings = {
  // The blocks; absent until set, so the older layout in the mod's store
  // still counts. A file's older `layout` key is read as blocks.
  bar?: BarConfig
  colors: Colors
  // The path shrinks its middle folders past this many characters (no tmux).
  pathMax: number
  // How the context bar is drawn; see CTX_BARS.
  ctxBar: string
  // Nerd Font icons for labels (󰧑 for context); off shows the words instead.
  icons: boolean
  // What 5h and 7d show: the percent left, or the time until the window resets.
  fiveShow: string
  weekShow: string
  // How hovered items change color; see HOVER_STYLES.
  hover: string
  // What a folder click starts in its new tab.
  claudeCmd: string
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
  menu: '#363a4f', // surface0
}
// Context bar styles: the filled and empty glyph. `line` is one glyph in two
// colors, so no font can draw gaps or overlaps into it.
export const CTX_BARS: Record<string, { name: string; full: string; empty: string; preview?: string }> = {
  line: { name: 'Line', full: '━', empty: '━' },
  shade: { name: 'Shade', full: '█', empty: '░' },
  // Nerd Font progress glyphs (U+EE00-EE05): rounded ends, centered on the text.
  // Drawn cap by cap in itemContent; full/empty here are the middle pieces.
  progress: { name: 'Progress (Nerd Font)', full: '\uee04', empty: '\uee01', preview: '\uee03\uee04\uee04\uee01\uee01\uee02' },
}
export const USAGE_SHOW: Record<string, string> = { percent: 'Percent left', time: 'Time until reset' }
export const DEFAULTS: Settings = { colors: DEFAULT_COLORS, pathMax: 0, ctxBar: 'progress', icons: true, fiveShow: 'percent', weekShow: 'percent', hover: 'complement', claudeCmd: 'claude' }

// A color is a hex string, or `ansi:0` to `ansi:15`: one of the terminal
// theme's own 16 colors, so it follows whatever theme the terminal has.
const COLOR = /^(#[0-9a-f]{6}|ansi:(1[0-5]|[0-9]))$/i
export const isColor = (c: unknown): c is string => typeof c === 'string' && COLOR.test(c)
const isHex = isColor

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
export const ANSI_NAMES = [...ANSI, ...ANSI.map(n => `bright ${n}`)]
// For tmux: colour0 to colour15 are the terminal's own.
export const tmuxColor = (c: string) => (c.startsWith('ansi:') ? `colour${c.slice(5)}` : c)
// For Claude's own drawing (Ink names).
const INK = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
// A brighter version of a color, for hover: hex mixed halfway to white, a
// terminal theme color swapped for its bright twin.
export function brighten(c: string): string {
  if (c.startsWith('ansi:')) {
    const n = Number(c.slice(5))
    return n < 8 ? `ansi:${n + 8}` : 'ansi:15'
  }
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return c
  const v = parseInt(m[1]!, 16)
  const mix = (x: number) => Math.round(x + (255 - x) * 0.5).toString(16).padStart(2, '0')
  return `#${mix(v >> 16)}${mix((v >> 8) & 255)}${mix(v & 255)}`
}

// The opposite color on the wheel, same lightness and softness: hue turned
// 180 degrees. Terminal theme colors swap with their opposite (red and cyan,
// green and magenta, yellow and blue), staying normal or bright.
const ANSI_OPPOSITE = [7, 6, 5, 4, 3, 2, 1, 0]
export function complement(c: string): string {
  if (c.startsWith('ansi:')) {
    const n = Number(c.slice(5))
    return `ansi:${(n >= 8 ? 8 : 0) + ANSI_OPPOSITE[n % 8]!}`
  }
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return c
  const v = parseInt(m[1]!, 16)
  const [r, g, b] = [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return c
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 180 + 360) % 360
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

// How a hovered item changes color.
export const HOVER_STYLES: Record<string, string> = { complement: 'Opposite color', brighter: 'Brighter' }
export const hoverColor = (c: string, style: string) => (style === 'brighter' ? brighten(c) : complement(c))

export const inkColor = (c: string) => {
  if (!c.startsWith('ansi:')) return c
  const n = Number(c.slice(5))
  return n < 8 ? INK[n] : n === 8 ? 'gray' : `${INK[n - 8]}Bright`
}

// Catppuccin flavors, offered as ready picks.
const CAT_NAMES = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender', 'text', 'subtext1', 'subtext0', 'overlay2', 'overlay1', 'overlay0', 'surface2', 'surface1', 'surface0', 'base', 'mantle', 'crust']
const cat = (hex: string) => Object.fromEntries(hex.split(' ').map((h, i) => [CAT_NAMES[i], `#${h}`]))
export const CATPPUCCIN: Record<string, Record<string, string>> = {
  Frappé: cat('f2d5cf eebebe f4b8e4 ca9ee6 e78284 ea999c ef9f76 e5c890 a6d189 81c8be 99d1db 85c1dc 8caaee babbf1 c6d0f5 b5bfe2 a5adce 949cbb 838ba7 737994 626880 51576d 414559 303446 292c3c 232634'),
  Macchiato: cat('f4dbd6 f0c6c6 f5bde6 c6a0f6 ed8796 ee99a0 f5a97f eed49f a6da95 8bd5ca 91d7e3 7dc4e4 8aadf4 b7bdf8 cad3f5 b8c0e0 a5adcb 939ab7 8087a2 6e738d 5b6078 494d64 363a4f 24273a 1e2030 181926'),
  Mocha: cat('f5e0dc f2cdcd f5c2e7 cba6f7 f38ba8 eba0ac fab387 f9e2af a6e3a1 94e2d5 89dceb 74c7ec 89b4fa b4befe cdd6f4 bac2de a6adc8 9399b2 7f849c 6c7086 585b70 45475a 313244 1e1e2e 181825 11111b'),
}

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
  // 0 (the default) means no cap: the path shrinks only when the bar is full.
  const pathMax = typeof o.pathMax === 'number' && o.pathMax >= 8 && o.pathMax <= 200 ? Math.round(o.pathMax) : DEFAULTS.pathMax
  const icons = typeof o.icons === 'boolean' ? o.icons : DEFAULTS.icons
  // Not picked yet: the Nerd Font progress bar with icons on, the plain line without.
  const ctxBar = typeof o.ctxBar === 'string' && o.ctxBar in CTX_BARS ? o.ctxBar : icons ? 'progress' : 'line'
  const show = (v: unknown) => (typeof v === 'string' && v in USAGE_SHOW ? v : 'percent')
  const out: Settings = { colors, pathMax, ctxBar, icons, fiveShow: show(o.fiveShow), weekShow: show(o.weekShow), hover: typeof o.hover === 'string' && o.hover in HOVER_STYLES ? o.hover : DEFAULTS.hover,
    claudeCmd: typeof o.claudeCmd === 'string' && o.claudeCmd.trim() && !/[\n\r]/.test(o.claudeCmd) ? o.claudeCmd.trim() : DEFAULTS.claudeCmd }
  if (o.bar && typeof o.bar === 'object') out.bar = cleanBar(o.bar)
  else if (o.layout && typeof o.layout === 'object') out.bar = fromLayout(o.layout)
  return out
}
