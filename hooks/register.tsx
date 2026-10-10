import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'
import { DEFAULT_LAYOUT, cleanLayout, move, renderBar, resize } from './layout'
import type { BlockId, Geom, Layout, Piece } from './layout'
import { DEFAULTS, DEFAULT_COLORS, cleanSettings } from './settings'
import type { Colors, Settings } from './settings'

// Ultimate Status: in tmux, rows under the tabs; elsewhere, a line above the chat box.
//   left:  ◆ Model ⚡ Speed  │  ~ / WorkSpace / MacForce  │  ⎇ branch
//   right: ctx ▰▰▱▱ 42%  │  5h 77%  ·  7d 60%
// Click the model for model/speed choices, a folder for "New tab" /
// "Tab + Claude". Hover any part for what it means.

const usage = atom({ plugin: 'ultimate-status', key: 'usage' } as const, {} as Usage)
const popup = atom({ plugin: 'ultimate-status', key: 'popup' } as const, null as string | null)

// The colors, from ultimate-status.json or the defaults (see settings.ts).
let C: Colors = DEFAULT_COLORS
let pathMax = DEFAULTS.pathMax

export function prettyModel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) return id
  const name = m[1][0].toUpperCase() + m[1].slice(1)
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

export function shortenPath(dirs: { label: string; path: string }[], max = 28) {
  const total = dirs.reduce((n, d) => n + d.label.length + 1, 0)
  if (total <= max) return dirs
  return dirs.map((d, i) =>
    i === 0 || i === dirs.length - 1 ? d : { ...d, label: [...d.label][0] ?? d.label },
  )
}

export function splitPath(cwd: string, home: string): { label: string; path: string }[] {
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

async function openTab($: EngineInterface, dir: string, withClaude: boolean) {
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
  // Folder tabs need macOS and iTerm2; say so instead of failing silently.
  if (r?.exitCode !== 0) $.ui.toast('ultimate-status: opening a tab needs iTerm2 on macOS.')
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

// What each block shows; the path shrinks its middle folders to fit `max`.
function blockContent(d: Bar, id: BlockId, max?: number): Piece[] {
  const dot: Piece = { fg: C.dim, text: ' · ' }
  switch (id) {
    case 'model':
      return [{ fg: C.model, text: `◆ ${d.model} `, range: 'model' }, { fg: C.speed, text: `⚡ ${d.speed}`, range: 'model' }]
    case 'path': {
      const dirs = max === undefined ? d.dirs : shortenPath(d.dirs, max)
      const out: Piece[] = []
      dirs.forEach((dir, i) => {
        if (i > 0 && dirs[i - 1].label !== '/') out.push({ fg: C.dim, text: '/' })
        out.push({ fg: C.path[i % C.path.length], text: dir.label, range: `d${i}` })
      })
      if (dirs.length > 1) out.push({ fg: C.dim, text: '/' })
      return out
    }
    case 'branch':
      return d.branch ? [{ fg: C.branch, text: `⎇ ${d.branch}` }] : []
    case 'ctx':
      return [{ fg: C.ctxLabel, text: 'ctx ' }, { fg: C.ctxValue, text: `${d.bar} ${pct(d.ctx)}` }]
    case 'usage':
      return [
        { fg: C.fiveLabel, text: '5h ' }, { fg: C.fiveValue, text: leftPct(d.u.five) }, dot,
        { fg: C.weekLabel, text: '7d ' }, { fg: C.weekValue, text: leftPct(d.u.week) }, { fg: C.info, text: ' left' },
      ]
  }
}

let tmuxPane: string | null | undefined
let lastPush = ''
// The layout (kept in the store), whether it is unlocked for dragging, and
// what the last draw used, so a drag can redraw without a new render.
let layout: Layout = DEFAULT_LAYOUT
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
  const drawn = renderBar(layout, columns, unlocked, (id, max) => blockContent(d, id, max), { dim: C.dim, handle: C.speed })
  geom = drawn.geom
  const pathCols = geom.find(g => g.id === 'path')
  const dirs = pathCols ? shortenPath(d.dirs, pathCols.end - pathCols.start) : []
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
  const id = m[2] as BlockId
  const x = Number(up || drag)
  if (!Number.isFinite(x) || (up === '' && drag === '')) return
  if (m[1] === 'v') layout = resize(layout, geom, id, x)
  else if (up !== '') layout = move(layout, geom, id, x, last.columns)
  if (up !== '') {
    await $.process.run(['tmux', 'set', '-gu', '@us_down', ';', 'set', '-gu', '@us_drag', ';', 'set', '-gu', '@us_up']).catch(() => undefined)
    await saveLayout($, layout)
  }
  await pushTmux($, pane, last.d, last.columns)
}

// ultimate-status.json, re-read only when it changes.
let cached: { mtime: number; value: Settings } | undefined
// The file's mtime whose layout is in use, so a later edit replaces it.
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

// Colors and path length from the file; its layout too when the file changed,
// except mid-drag.
async function useSettings($: EngineInterface) {
  const s = await loadSettings($)
  C = s.colors
  pathMax = s.pathMax
  if (!unlocked && cached && cached.mtime !== applied) {
    applied = cached.mtime
    if (s.layout) layout = s.layout
  }
}

// Writes the layout into the file, keeping its other keys; `undefined` takes
// it out. A file that isn't valid JSON is left alone and the store keeps it.
async function saveLayout($: EngineInterface, next: Layout | undefined) {
  try {
    const path = await settingsPath($)
    const has = await $.fs.exists(path)
    if (!has && !next) return
    const text = has ? ((await $.fs.read(path)) as string) : '{}'
    const o = JSON.parse(text.trim() || '{}')
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object')
    if (next) o.layout = next
    else delete o.layout
    await $.fs.write(path, JSON.stringify(o, null, 2) + '\n')
  } catch {
    if (!next) return
    await $.store.set('layout', next)
    $.ui.toast('ultimate-status: could not save to ultimate-status.json, so the layout stays in the mod store.')
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
  const pane = await paneOf($)
  if (pane && last) await pushTmux($, pane, last.d, last.columns)
}

// The rows take the terminal's own background, like the chat below them,
// not the tab row's.
const PLAIN = '#[fill=terminal bg=terminal]'
// Same dim divider as the chat box's, across the whole window.
const divider = () => `${PLAIN}#[fg=${C.dim}]#{R:─,#{window_width}}`
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'ultimate-status',
      description: 'Unlock the top bar to drag its blocks and dividers, or lock it again',
      argumentHint: 'unlock | lock | reset',
    })
    const s = await loadSettings($)
    applied = cached?.mtime
    layout = s.layout ?? cleanLayout(await $.store.get('layout'))
    try {
      const u = await $.session.usage()
      await update($, usage, () => toUsage(u.context, u.rateLimits))
    } catch {}
    return result
  })

  on('command.run', { command: 'ultimate-status' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (!(await paneOf($))) return { text: 'ultimate-status: the movable bar needs tmux.' }
    if (arg === 'unlock') {
      await setLocked($, false)
      return { text: 'Top bar unlocked. Drag a block to move it, or a ┃ divider to resize. Type /ultimate-status lock when done.' }
    }
    if (arg === 'lock') {
      await setLocked($, true)
      return { text: 'Top bar locked.' }
    }
    if (arg === 'reset') {
      layout = DEFAULT_LAYOUT
      await $.store.delete('layout')
      await saveLayout($, undefined)
      await setLocked($, !unlocked)
      return { text: 'Top bar back to its first layout.' }
    }
    return { text: 'Use /ultimate-status unlock, lock or reset.' }
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

  // The band above the chat box. The bar is its last row, so it always sits
  // directly on top of the box; popups and hover info open above it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    await useSettings($)
    const d = await gather($)
    const pane = await paneOf($)
    if (pane) {
      // The rows span the whole tmux window, not just Claude's split.
      const r = await $.process.run(['tmux', 'display', '-p', '-t', pane, '#{window_width}']).catch(() => undefined)
      await pushTmux($, pane, d, Number(r?.stdout.trim()) || e.viewport?.columns || 120)
      return next(e)
    }
    const open = await read($, popup)
    const close = () => update($, popup, () => null)
    const toggle = (id: string) => () => update($, popup, cur => (cur === id ? null : id))
    const sep = <Text color={C.dim}>{'  │  '}</Text>
    // A fixed width: the band's own columns, which leave room for its "[-]".
    const width = e.props.bodyColumns
    const dirs = shortenPath(d.dirs, pathMax)

    const tips: [string, string][] = [
      ['model', `Model: ${d.model}. Speed: ${d.speed}. Click to change the model or the speed.`],
      ['dir', `Folder: ${d.cwd}. Click any part to open a new iTerm tab there.`],
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
          <Text color={C.info}>{dir}</Text>
          <Button key="tab" label="New tab" onPress={async () => { await close(); await openTab($, dir, false) }} />
          <Button key="tab-claude" label="Tab + Claude" onPress={async () => { await close(); await openTab($, dir, true) }} />
          <Button key="close" label="✕" onPress={close} />
        </Box>
      )
    }

    // Other mods' bands (image tiles and the like) draw above this one.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {below}
        {popupRow}
        {tips.map(([scope, text]) => (
          <Box key={`tip-${scope}`} display="none" hover={{ scope, display: 'flex' }}>
            <Text color={C.info}>{text}</Text>
          </Box>
        ))}
        <Box key="bar" width={width} justifyContent="space-between">
          <Box flexShrink={1} overflow="hidden">
            <Button key="model" plain hover={{ scope: 'model', underline: true }} onPress={toggle('model')}>
              <Text color={C.model}>{`◆ ${d.model} `}</Text>
              <Text color={C.speed}>{`⚡ ${d.speed}`}</Text>
            </Button>
            {sep}
            {dirs.map((dir, i) => (
              <Box key={`d${i}`}>
                {i > 0 && dirs[i - 1].label !== '/' && <Text color={C.dim}>{'/'}</Text>}
                <Button key={`dir${i}`} plain hover={{ scope: 'dir', underline: true }} onPress={toggle(`dir:${dir.path}`)}>
                  <Text color={C.path[i % C.path.length]}>{dir.label}</Text>
                </Button>
              </Box>
            ))}
            {dirs.length > 1 && <Text color={C.dim}>{'/'}</Text>}
          </Box>
          <Box flexShrink={0}>
            {sep}
            {d.branch && <Text color={C.branch} hover={{ scope: 'branch', underline: true }}>{`⎇ ${d.branch}`}</Text>}
            {d.branch && <Text color={C.dim}>{' · '}</Text>}
            <Text hover={{ scope: 'ctx', underline: true }}>
              <Text color={C.ctxLabel}>{'ctx '}</Text>
              <Text color={C.ctxValue}>{`${d.bar} ${pct(d.ctx)}`}</Text>
            </Text>
            {sep}
            <Text hover={{ scope: 'five', underline: true }}>
              <Text color={C.fiveLabel}>{'5h '}</Text>
              <Text color={C.fiveValue}>{leftPct(d.u.five)}</Text>
            </Text>
            <Text color={C.dim}>{' · '}</Text>
            <Text hover={{ scope: 'week', underline: true }}>
              <Text color={C.weekLabel}>{'7d '}</Text>
              <Text color={C.weekValue}>{leftPct(d.u.week)}</Text>
              <Text color={C.info}>{' left'}</Text>
            </Text>
          </Box>
        </Box>
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
  const home = (await $.env.get('HOME')) ?? ''
  let branch = ''
  try {
    const r = await $.process.run(['git', '--no-optional-locks', 'branch', '--show-current'], { timeoutMs: 2000 })
    if (r.exitCode === 0) branch = r.stdout.trim()
  } catch {}
  const ctx = u.ctx === undefined ? undefined : Math.round(u.ctx)
  const filled = ctx === undefined ? 0 : Math.min(10, Math.round(ctx / 10))
  const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled)
  return { u, model, speed, cwd, dirs: splitPath(cwd, home), branch, ctx, bar }
}
