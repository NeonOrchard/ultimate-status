import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'
import { DEFAULT_BAR, fromLayout, move, renderBar, resize } from './bar'
import type { BarConfig, Geom, ItemId, Piece } from './bar'
import { panel } from './panel'
import { CTX_BARS, DEFAULTS, DEFAULT_COLORS, cleanSettings, inkColor, tmuxColor } from './settings'
import type { Colors, Settings } from './settings'

// Ultimate Status: in tmux, rows under the tabs; elsewhere, a line above the chat box.
//   left:  ◆ Model ⚡ Speed  │  ~ / WorkSpace / MacForce  │  ⎇ branch
//   right: ctx ▰▰▱▱ 42%  │  5h 77%  ·  7d 60%
// Click the model for model/speed choices, a folder for "New tab" /
// "Tab + Claude". Hover any part for what it means.

const usage = atom({ plugin: 'ultimate-status', key: 'usage' } as const, {} as Usage)
const popup = atom({ plugin: 'ultimate-status', key: 'popup' } as const, null as string | null)
const rev = atom({ plugin: 'ultimate-status', key: 'rev' } as const, 0)
const pick = atom({ plugin: 'ultimate-status', key: 'pick' } as const, null as string | null)
const flavor = atom({ plugin: 'ultimate-status', key: 'flavor' } as const, 'Macchiato')
const tab = atom({ plugin: 'ultimate-status', key: 'tab' } as const, 'blocks')
const menu = atom({ plugin: 'ultimate-status', key: 'menu' } as const, null as string | null)

// The colors, from ultimate-status.json or the defaults (see settings.ts).
let C: Colors = DEFAULT_COLORS
let pathMax = DEFAULTS.pathMax
let ctxBar = DEFAULTS.ctxBar

export function prettyModel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) return id
  const word = m[1] ?? ''
  const name = word.charAt(0).toUpperCase() + word.slice(1)
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

export function shortenPath(dirs: { label: string; path: string }[], max = 28) {
  const total = dirs.reduce((n, d) => n + d.label.length + 1, 0)
  if (total <= max) return dirs
  return dirs.map((d, i) =>
    i === 0 || i === dirs.length - 1 ? d : { ...d, label: [...d.label][0] ?? d.label },
  )
}

// Windows paths (`E:\\Code\\app`) split on backslashes, under a drive root
// (`E:`) or `~` for the user's profile folder.
const isWindowsPath = (p: string) => /^[a-z]:([\\/]|$)/i.test(p)
export const pathSep = (dirs: { path: string }[]) => (isWindowsPath(dirs[0]?.path ?? '') ? '\\' : '/')

export function splitPath(cwd: string, home: string): { label: string; path: string }[] {
  if (isWindowsPath(cwd)) {
    const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '')
    const c = norm(cwd)
    const h = isWindowsPath(home) ? norm(home) : ''
    const inHome = !!h && (c.toLowerCase() === h.toLowerCase() || c.toLowerCase().startsWith(h.toLowerCase() + '\\'))
    const base = inHome ? h : c.slice(0, 2)
    const out = [{ label: inHome ? '~' : base.toUpperCase(), path: `${base}\\` }]
    let acc = base
    for (const p of c.slice(base.length).split('\\').filter(Boolean)) {
      acc = `${acc}\\${p}`
      out.push({ label: p, path: acc })
    }
    return out
  }
  const inHome = home && (cwd === home || cwd.startsWith(home + '/'))
  const rest = inHome ? cwd.slice(home.length) : cwd
  const parts = rest.split('/').filter(Boolean)
  const out = [{ label: inHome ? '~' : '/', path: inHome ? home : '/' }]
  let acc = inHome ? home : ''
  for (const p of parts) {
    acc = `${acc}/${p}`
    out.push({ label: p, path: acc })
  }
  return out
}

function left(resetsAt?: string): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - Date.now()
  if (!(ms > 0)) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h >= 24 ? ` Resets in ${Math.floor(h / 24)}d ${h % 24}h.` : ` Resets in ${h}h ${m}m.`
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Opens a terminal tab in `dir`, with Claude in it if asked: Warp through its
// warp:// links (a Tab Config runs `claude`), iTerm2 through AppleScript.
async function openTab($: EngineInterface, dir: string, withClaude: boolean) {
  const term = await $.env.get('TERM_PROGRAM')
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  if (term === 'WarpTerminal') {
    let uri = `warp://action/new_tab?path=${encodeURIComponent(dir)}`
    if (withClaude) {
      const folder = await warpTabConfigs($, windows)
      const toml = `name = "Claude here"\ntitle = "Claude"\n\n[[panes]]\nid = "main"\ntype = "terminal"\n` +
        `directory = ${JSON.stringify(dir)}\ncommands = ["claude"]\n`
      const wrote = folder && (await $.fs.write(`${folder}/ultimate_status_claude.toml`, toml).then(() => true, () => false))
      if (wrote) uri = 'warp://tab_config/ultimate_status_claude'
      else $.ui.toast('ultimate-status: could not write a Warp Tab Config, so the tab opens without Claude.')
    }
    const r = await $.process.run(windows ? ['cmd', '/c', 'start', '', uri] : [await opener($), uri]).catch(() => undefined)
    if (r?.exitCode !== 0) $.ui.toast('ultimate-status: Warp did not open the tab.')
    return
  }
  const cmd = `cd ${q(dir)}${withClaude ? ' && claude' : ''}`
  const r = await $.process.run([
    'osascript',
    '-e', 'on run argv',
    '-e', 'tell application "iTerm2"',
    '-e', 'tell current window',
    '-e', 'set t to (create tab with default profile)',
    '-e', 'tell current session of t to write text (item 1 of argv)',
    '-e', 'end tell',
    '-e', 'end tell',
    '-e', 'end run',
    cmd,
  ]).catch(() => undefined)
  // Folder tabs need Warp, or iTerm2 on macOS; say so instead of failing silently.
  if (r?.exitCode !== 0) $.ui.toast('ultimate-status: opening a tab needs Warp, or iTerm2 on macOS.')
}

// `open` on macOS, `xdg-open` elsewhere.
async function opener($: EngineInterface): Promise<string> {
  const r = await $.process.run(['uname']).catch(() => undefined)
  return r?.stdout.trim() === 'Darwin' ? 'open' : 'xdg-open'
}

// Where Warp keeps Tab Configs (Warp's docs, Stable channel); writing a file
// there makes the folder.
async function warpTabConfigs($: EngineInterface, windows: boolean): Promise<string | null> {
  let dir: string
  if (windows) {
    const appData = await $.env.get('APPDATA')
    if (!appData) return null
    dir = `${appData}\\warp\\Warp\\data\\tab_configs`
  } else if ((await opener($)) === 'open') {
    dir = `${await $.env.get('HOME')}/.warp/tab_configs`
  } else {
    const data = (await $.env.get('XDG_DATA_HOME')) || `${await $.env.get('HOME')}/.local/share`
    dir = `${data}/warp-terminal/tab_configs`
  }
  return dir
}

// The version in the installed plugin.json.
async function version($: EngineInterface): Promise<string> {
  try {
    const text = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)
    return (JSON.parse(text as string) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function speedOf($: EngineInterface): Promise<string> {
  try {
    const row = (await $.config.list()).find(r => r.key === 'fast')
    if (row && typeof row.value === 'boolean') return row.value ? 'Fast' : 'Normal'
  } catch {}
  return 'Normal'
}

function toUsage(ctx: { percent?: number }, limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Usage {
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  return {
    ctx: ctx.percent,
    five: five?.percentUsed,
    week: week?.percentUsed,
    fiveResets: five?.resetsAt,
    weekResets: week?.resetsAt,
  }
}

// Inside tmux the bar lives in three extra status rows under the tmux tabs
// (divider, bar, divider), so it stays put while the chat scrolls. tmux draws
// the bar from a pane option, and hooks show the rows only while the active
// pane is a Claude one.
type Bar = Awaited<ReturnType<typeof gather>>

// What each item shows; the path shrinks its middle folders to fit `max`.
// A piece's range makes it clickable: the model menu, or a folder's.
function itemContent(d: Bar, id: ItemId, max?: number): Piece[] {
  switch (id) {
    case 'model':
      return [{ fg: C.model, text: `◆ ${d.model}`, range: 'model' }]
    case 'speed':
      return [{ fg: C.speed, text: `⚡ ${d.speed}`, range: 'model' }]
    case 'path': {
      const dirs = shortenPath(d.dirs, max ?? pathMax)
      const sep = pathSep(d.dirs)
      // The draw itself passes the room it has; its folders back the click menus.
      if (max !== undefined) drawnDirs = dirs
      const out: Piece[] = []
      dirs.forEach((dir, i) => {
        if (i > 0 && dirs[i - 1]?.label !== '/') out.push({ fg: C.dim, text: sep })
        out.push({ fg: C.path[i % C.path.length] ?? C.dim, text: dir.label, range: `d${i}` })
      })
      if (dirs.length > 1) out.push({ fg: C.dim, text: sep })
      return out
    }
    case 'branch':
      return d.branch ? [{ fg: C.branch, text: `⎇ ${d.branch}` }] : []
    case 'ctx':
    {
      // Filled part in the value color, the rest dim: the line style is one
      // glyph in two colors.
      const style = CTX_BARS[ctxBar] ?? CTX_BARS.line!
      return [
        { fg: C.ctxLabel, text: 'ctx ' },
        { fg: C.ctxValue, text: style.full.repeat(d.filled) },
        { fg: C.dim, text: style.empty.repeat(10 - d.filled) },
        { fg: C.ctxValue, text: ` ${pct(d.ctx)}` },
      ].filter(p => p.text)
    }
    case 'five':
      return [{ fg: C.fiveLabel, text: '5h ' }, { fg: C.fiveValue, text: leftPct(d.u.five) }]
    case 'week':
      return [{ fg: C.weekLabel, text: '7d ' }, { fg: C.weekValue, text: leftPct(d.u.week) }, { fg: C.info, text: ' left' }]
  }
}

let drawnDirs: { label: string; path: string }[] = []
let tmuxPane: string | null | undefined
let lastPush = ''
// The bar (kept in ultimate-status.json), whether it is unlocked for dragging, and
// what the last draw used, so a drag can redraw without a new render.
let bar: BarConfig = DEFAULT_BAR
let unlocked = false
let geom: Geom = []
let last: { d: Bar; columns: number } | undefined
let poll: { cancel(): void } | undefined
// Only a found pane is kept: a lookup that fails early (a resumed session
// can draw before the host is ready) is tried again on the next draw.
async function paneOf($: EngineInterface): Promise<string | null> {
  if (!tmuxPane) tmuxPane = (await $.env.get('TMUX_PANE').catch(() => undefined))?.trim() || null
  return tmuxPane
}
// The bar and what its menus need (each folder's path, the speed to switch
// to) go on the pane as options; the menus read them when clicked.
async function pushTmux($: EngineInterface, pane: string, d: Bar, columns: number) {
  last = { d, columns }
  const item = (id: ItemId, max?: number) => itemContent(d, id, max)
  const drawn = renderBar(bar, columns, unlocked, item, { dim: C.dim, handle: C.speed, tmux: tmuxColor })
  geom = drawn.geom
  const dirs = geom.length ? drawnDirs : []
  const opts: [string, string][] = [
    ['@ultimate_status', drawn.bar],
    ['@us_speed', d.speed === 'Fast' ? 'Speed: Normal' : 'Speed: ⚡ Fast'],
    ...dirs.map((dir, i): [string, string] => [`@us_d${i}`, dir.path]),
  ]
  const key = JSON.stringify(opts)
  if (key === lastPush) return
  const first = lastPush === ''
  lastPush = key
  const cmd = ['tmux', ...opts.flatMap(([k, v]) => ['set', '-p', '-t', pane, k, v, ';'])]
  if (first) cmd.push(...TMUX_SETUP.flatMap(c => [...c(pane), ';']))
  await $.process.run(cmd.slice(0, -1)).catch(() => undefined)
  if (first) await $.process.run(['tmux', 'source-file', '-'], { stdin: CLICKS }).catch(() => undefined)
}

// While unlocked, tmux notes where a drag started and where it is (see
// CLICKS); this reads that a few times a second and redraws.
async function dragTick($: EngineInterface) {
  const pane = await paneOf($)
  if (!pane || !last) return
  const r = await $.process.run(['tmux', 'display', '-p', '#{@us_down}|#{@us_drag}|#{@us_up}']).catch(() => undefined)
  const [down, drag, up] = (r?.stdout.trim() ?? '').split('|')
  const m = /^us([bv])(\w+) /.exec(down ?? '')
  if (!m) return
  const id = m[2]
  if (!id || up === undefined || drag === undefined) return
  const x = Number(up || drag)
  if (!Number.isFinite(x) || (up === '' && drag === '')) return
  if (m[1] === 'v') bar = resize(bar, geom, id, x)
  else if (up !== '') bar = move(bar, geom, id, x, last.columns)
  if (up !== '') {
    await $.process.run(['tmux', 'set', '-gu', '@us_down', ';', 'set', '-gu', '@us_drag', ';', 'set', '-gu', '@us_up']).catch(() => undefined)
    await saveSettings($, { bar })
  }
  await pushTmux($, pane, last.d, last.columns)
}

// ultimate-status.json, re-read only when it changes.
let cached: { mtime: number; value: Settings } | undefined
// The file's mtime whose bar is in use, so a later edit replaces it.
let applied: number | undefined

async function settingsPath($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  return `${dir}/ultimate-status.json`
}

async function loadSettings($: EngineInterface): Promise<Settings> {
  try {
    const path = await settingsPath($)
    const stat = await $.fs.stat(path).catch(() => undefined)
    const mtime = stat?.kind === 'file' ? stat.mtimeMs : 0
    if (cached?.mtime !== mtime) {
      const raw = mtime ? await $.fs.read(path).then(t => JSON.parse(t as string)).catch(() => undefined) : undefined
      cached = { mtime, value: cleanSettings(raw) }
    }
    return cached.value
  } catch {
    return DEFAULTS
  }
}

// Colors and path length from the file; its bar too when the file changed,
// except mid-drag.
async function useSettings($: EngineInterface) {
  const s = await loadSettings($)
  C = s.colors
  pathMax = s.pathMax
  ctxBar = s.ctxBar
  if (!unlocked && cached && cached.mtime !== applied) {
    applied = cached.mtime
    if (s.bar) bar = s.bar
  }
}

// Writes the bar and colors into the file, keeping its other keys; a key set
// to `undefined` is taken out. A file that isn't valid JSON is left alone.
export async function saveSettings($: EngineInterface, next: { bar?: BarConfig; colors?: Colors; ctxBar?: string }) {
  if ('bar' in next) bar = next.bar ?? DEFAULT_BAR
  if ('colors' in next) C = next.colors ?? DEFAULT_COLORS
  if ('ctxBar' in next) ctxBar = next.ctxBar ?? DEFAULTS.ctxBar
  try {
    const path = await settingsPath($)
    const has = await $.fs.exists(path)
    const text = has ? ((await $.fs.read(path)) as string) : '{}'
    const o = JSON.parse(text.trim() || '{}')
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object')
    for (const k of ['bar', 'colors', 'ctxBar'] as const) {
      if (!(k in next)) continue
      if (next[k]) o[k] = next[k]
      else delete o[k]
    }
    // Blocks replace the older layout key.
    if ('bar' in next) delete o.layout
    await $.fs.write(path, JSON.stringify(o, null, 2) + '\n')
    // This write is ours: the bar in memory already matches it.
    cached = undefined
    applied = (await $.fs.stat(path).catch(() => undefined))?.mtimeMs
  } catch {
    $.ui.toast('ultimate-status: could not save to ultimate-status.json; check that it is valid JSON.')
  }
  await update($, rev, n => n + 1)
  await redraw($)
}

// Draws the tmux bar again from what the last draw used.
async function redraw($: EngineInterface) {
  const pane = await paneOf($)
  if (pane && last) {
    // Run the setup again too: the divider rows carry the divider color.
    lastPush = ''
    await pushTmux($, pane, last.d, last.columns)
  }
}

async function setLocked($: EngineInterface, locked: boolean) {
  unlocked = !locked
  poll?.cancel()
  poll = undefined
  await $.process.run(locked
    ? ['tmux', 'set', '-gu', '@us_unlocked', ';', 'set', '-gu', '@us_down', ';', 'set', '-gu', '@us_drag', ';', 'set', '-gu', '@us_up']
    : ['tmux', 'set', '-g', '@us_unlocked', '1']).catch(() => undefined)
  if (!locked) poll = $.clock.every(80, () => { void dragTick($) })
  await redraw($)
}

// The rows take the terminal's own background, like the chat below them,
// not the tab row's.
const PLAIN = '#[fill=terminal bg=terminal]'
// Same dim divider as the chat box's, across the whole window.
const divider = () => `${PLAIN}#[fg=${tmuxColor(C.dim)}]#{R:─,#{window_width}}`
// Four status rows on a Claude pane, the usual one elsewhere.
const FIT = 'if -F "#{@ultimate_status}" "set status 4" "set -u status"'
const TMUX_SETUP: ((pane: string) => string[])[] = [
  // Global rows: a session-level copy would replace the whole list, tab row
  // included. Sessions with the usual one row never draw these.
  () => ['set', '-g', 'status-format[1]', divider()],
  () => ['set', '-g', 'status-format[2]', `${PLAIN}#{@ultimate_status}`],
  () => ['set', '-g', 'status-format[3]', divider()],
  ...['after-select-window', 'after-select-pane', 'client-session-changed'].map(h =>
    (p: string) => ['set-hook', '-t', p, `${h}[77]`, FIT]),
  p => ['if', '-t', p, '-F', '#{@ultimate_status}', 'set status 4'],
]

// A click on the bar opens a tmux menu by the pointer; any other click on the
// tab bar does what tmux does by default. The menus act on the active pane,
// the Claude one, since the rows only show there.
const MAX_DIRS = 16
const folderMenu = (i: number) =>
  `  if -F '#{==:#{mouse_status_range},usd${i}}' {\n` +
  `    display-menu -T '#[align=centre]#{@us_d${i}}' -x M -y S \\\n` +
  `      'New tab' n { new-window -c '#{@us_d${i}}' } \\\n` +
  `      'Tab + Claude' c { new-window -c '#{@us_d${i}}' claude }\n` +
  `  }\n`
// Unlocked, a press on a block or divider is noted instead, and so is every
// drag step and the release; dragTick turns those into a move or a resize.
export const CLICKS =
  `bind -n MouseDown1Status {\n` +
  `if -F '#{&&:#{@us_unlocked},#{m:us[bv]*,#{mouse_status_range}}}' {\n` +
  `  set -gu @us_drag\n` +
  `  set -gu @us_up\n` +
  `  set -gF @us_down '#{mouse_status_range} #{mouse_x}'\n` +
  `} {\n` +
  `if -F '#{m:us*,#{mouse_status_range}}' {\n` +
  `  if -F '#{==:#{mouse_status_range},usmodel}' {\n` +
  `    display-menu -T '#[align=centre]Model' -x M -y S \\\n` +
  `      'Model…' m { send-keys '/model' Enter } \\\n` +
  `      '#{@us_speed}' f { send-keys '/fast' Enter }\n` +
  `  }\n` +
  Array.from({ length: MAX_DIRS }, (_, i) => folderMenu(i)).join('') +
  `} {\n` +
  `  switch-client -t =\n` +
  `}\n` +
  `}\n` +
  `}\n` +
  `bind -n MouseDrag1Status if -F '#{@us_down}' { set -gF @us_drag '#{mouse_x}' }\n` +
  `bind -n MouseDragEnd1Status if -F '#{@us_down}' { set -gF @us_up '#{mouse_x}' }\n`

const PANEL = 'ultimate-status-config'

// Outside tmux the bar sits right under the chat box, in the hint line's spot, so the
// band's [-] can't collapse it away; its menus and hover tips open in the band above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function barParts($: EngineInterface, e: any, columns: number) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const d = await gather($)
  const open = await read($, popup)
  const close = () => update($, popup, () => null)
  const toggle = (id: string) => () => update($, popup, cur => (cur === id ? null : id))

  const tips: [ItemId, string][] = [
    ['model', `Model: ${d.model}. Click to change the model or the speed.`],
    ['speed', `Speed: ${d.speed}. Click to change the model or the speed.`],
    ['path', `Folder: ${d.cwd}. Click any part to open a new iTerm tab there.`],
    ['branch', `Git branch: ${d.branch || 'none'}. The branch this folder is on.`],
    ['ctx', `Context: ${pct(d.ctx)} of my working memory for this chat is used. When it fills up, older parts get summarized.`],
    ['five', `5-hour window: ${leftPct(d.u.five)} left of your usage limit for the current 5 hours.${left(d.u.fiveResets)}`],
    ['week', `7-day window: ${leftPct(d.u.week)} left of your weekly usage limit.${left(d.u.weekResets)}`],
  ]

  let popupRow = null
  if (open === 'model') {
    popupRow = (
      <Box gap={2}>
        <Button key="pick-model" label="Model…" onPress={async () => { await close(); await $.command.run({ command: 'model' }) }} />
        <Button key="pick-speed" label={d.speed === 'Fast' ? 'Speed: Normal' : 'Speed: ⚡ Fast'} onPress={async () => { await close(); await $.command.run({ command: 'fast' }) }} />
        <Button key="close" label="✕" onPress={close} />
      </Box>
    )
  } else if (open?.startsWith('dir:')) {
    const dir = open.slice(4)
    popupRow = (
      <Box gap={2}>
        <Text color={inkColor(C.info)}>{dir}</Text>
        <Button key="tab" label="New tab" onPress={async () => { await close(); await openTab($, dir, false) }} />
        <Button key="tab-claude" label="Tab + Claude" onPress={async () => { await close(); await openTab($, dir, true) }} />
        <Button key="close" label="✕" onPress={close} />
      </Box>
    )
  }

  // The same blocks as the tmux bar, drawn by Claude: each item hovers for
  // its tip, and the model and folders click open their menus.
  const dirs = shortenPath(d.dirs, pathMax)
  const drawItem = (b: { id: string }, id: ItemId) => {
    const ps = itemContent(d, id, pathMax)
    return (
      // A Box, not a Text: Buttons can't sit inside an inline element.
      <Box key={`${b.id}-${id}`}>
        {ps.map((p, i) => {
          const t = <Text key={`${id}${i}`} color={inkColor(p.fg)} hover={{ scope: id, underline: true }}>{p.text}</Text>
          if (p.range === 'model') return <Button key={`${id}b${i}`} plain onPress={toggle('model')}>{t}</Button>
          if (p.range?.startsWith('d')) {
            const dir = dirs[Number(p.range.slice(1))]
            return dir ? <Button key={`${id}b${i}`} plain onPress={toggle(`dir:${dir.path}`)}>{t}</Button> : t
          }
          return t
        })}
      </Box>
    )
  }
  const drawBlock = (b: BarConfig['blocks'][number]) => {
    const shown = b.items.filter(id => itemContent(d, id).length > 0)
    return (
      <Box key={`blk-${b.id}`}>
        {shown.map((id, i) => (
          <Box key={`${b.id}i${i}`}>
            {i > 0 && b.joiner && <Text color={inkColor(C.dim)}>{b.joiner}</Text>}
            {drawItem(b, id)}
          </Box>
        ))}
      </Box>
    )
  }
  const gap = (b: { id: string; divider: string }) =>
    <Text key={`gap-${b.id}`} color={inkColor(C.dim)}>{b.divider ? `  ${b.divider}  ` : '  '}</Text>
  const blocks = bar.blocks.filter(b => b.items.some(id => itemContent(d, id).length > 0))
  const leftBlocks = blocks.filter(b => b.side === 'left')
  const rightBlocks = blocks.filter(b => b.side === 'right')

  const tipRows = tips.map(([scope, text]) => (
    <Box key={`tip-${scope}`} display="none" hover={{ scope, display: 'flex' }}>
      <Text color={inkColor(C.info)}>{text}</Text>
    </Box>
  ))
  const barRow = (
    <Box key="bar" width={columns} justifyContent="space-between">
      <Box flexShrink={1} overflow="hidden">
        {leftBlocks.map((b, i) => (
          <Box key={`l-${b.id}`}>
            {i > 0 && gap(leftBlocks[i - 1]!)}
            {drawBlock(b)}
          </Box>
        ))}
      </Box>
      <Box flexShrink={0}>
        {rightBlocks.map(b => (
          <Box key={`r-${b.id}`}>
            {gap(b)}
            {drawBlock(b)}
          </Box>
        ))}
      </Box>
    </Box>
  )
  return { popupRow, tipRows, barRow }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'ultimate-status',
      description: 'Unlock the top bar to drag its blocks and dividers, or lock it again',
      argumentHint: 'config | unlock | lock | reset | version',
    })
    const s = await loadSettings($)
    applied = cached?.mtime
    C = s.colors
    pathMax = s.pathMax
    ctxBar = s.ctxBar
    // Before the settings file, a dragged layout lived in the mod store.
    const stored = await $.store.get('layout')
    bar = s.bar ?? (stored ? fromLayout(stored) : DEFAULT_BAR)
    try {
      const u = await $.session.usage()
      await update($, usage, () => toUsage(u.context, u.rateLimits))
    } catch {}
    return result
  })

  on('command.run', { command: 'ultimate-status' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'version') return { text: `ultimate-status ${await version($)}` }
    if (arg === 'config' || arg === '') {
      // A dropdown left open last time would leave every other button inert.
      await update($, menu, () => null)
      await $.ui.open({ id: PANEL, title: 'Ultimate Status', focus: true, closeOnEscape: true })
      return { text: 'Settings panel open. Esc closes it.' }
    }
    if (arg === 'reset') {
      await $.store.delete('layout')
      await saveSettings($, { bar: undefined })
      return { text: 'Bar back to its first layout. Colors are kept; reset those in /ultimate-status config.' }
    }
    if (!(await paneOf($))) return { text: 'ultimate-status: dragging the bar needs tmux. /ultimate-status config works anywhere.' }
    if (arg === 'unlock') {
      await setLocked($, false)
      return { text: 'Top bar unlocked. Drag a block to move it, or a ┃ divider to resize. Type /ultimate-status lock when done.' }
    }
    if (arg === 'lock') {
      await setLocked($, true)
      return { text: 'Top bar locked.' }
    }
    return { text: 'Use /ultimate-status config, unlock, lock, reset or version.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    await read($, rev)
    await useSettings($)
    return panel({
      els: $.ui.resolve(e) as unknown as Record<string, unknown>,
      bar,
      colors: C,
      ctxBar,
      picking: await read($, pick),
      shownFlavor: await read($, flavor),
      setPick: fn => { void update($, pick, fn) },
      setFlavor: f => { void update($, flavor, () => f) },
      tab: await read($, tab),
      setTab: t => { void update($, tab, () => t) },
      menu: await read($, menu),
      setMenu: k => { void update($, menu, () => k) },
      focus: key => { void $.ui.focus({ requestId: PANEL, key }).catch(() => undefined) },
      toast: text => $.ui.toast(text),
      save: next => saveSettings($, next),
    })
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    return next(e)
  })

  // Give the pane its plain border back when Claude quits.
  on('session.end', async ($, e, next) => {
    const pane = await paneOf($)
    if (pane) {
      await $.process.run(['tmux', 'set', '-pu', '-t', pane, '@ultimate_status',
        ';', 'if', '-t', pane, '-F', '#{@ultimate_status}', '', 'set -u status']).catch(() => undefined)
    }
    return next(e)
  })

  // The band above the chat box: inside tmux it pushes the top rows; outside, it
  // holds the bar's menus and hover tips (the bar itself is under the box).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await useSettings($)
    const pane = await paneOf($)
    if (pane) {
      const d = await gather($)
      // The rows span the whole tmux window, not just Claude's split.
      const r = await $.process.run(['tmux', 'display', '-p', '-t', pane, '#{window_width}']).catch(() => undefined)
      await pushTmux($, pane, d, Number(r?.stdout.trim()) || e.viewport?.columns || 120)
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    const { popupRow, tipRows } = await barParts($, e, e.props.bodyColumns)
    // Other mods' bands (image tiles and the like) draw above this one.
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {below}
        {popupRow}
        {tipRows}
      </Box>
    )
  })

  // The bar itself, outside tmux: one row right under the chat box, above Claude's
  // own hint and mode line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await useSettings($)
    if (await paneOf($)) return next(e)
    const { Box } = $.ui.resolve(e)
    const { barRow } = await barParts($, e, (e.viewport?.columns ?? 120) - 1)
    const hint = await next(e)
    return (
      <Box flexDirection="column">
        {barRow}
        {hint}
      </Box>
    )
  })
}

const pct = (n?: number) => (n === undefined ? '–' : `${Math.round(n)}%`)
const leftPct = (n?: number) => (n === undefined ? '–' : `${Math.round(100 - n)}%`)

// Everything the bar shows, read fresh on each draw.
async function gather($: EngineInterface) {
  const u = await read($, usage)
  const model = prettyModel(await $.session.model())
  const speed = await speedOf($)
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  let branch = ''
  try {
    const r = await $.process.run(['git', '--no-optional-locks', 'branch', '--show-current'], { timeoutMs: 2000 })
    if (r.exitCode === 0) branch = r.stdout.trim()
  } catch {}
  const ctx = u.ctx === undefined ? undefined : Math.round(u.ctx)
  const filled = ctx === undefined ? 0 : Math.min(10, Math.round(ctx / 10))
  return { u, model, speed, cwd, dirs: splitPath(cwd, home), branch, ctx, filled }
}
