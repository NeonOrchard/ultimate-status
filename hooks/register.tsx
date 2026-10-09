import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'

// Ultimate Status: a bar on the hint line under the chat box.
//   left:  ◆ Model ⚡ Speed  │  ~ / WorkSpace / MacForce  │  ⎇ branch
//   right: ctx ▰▰▱▱ 42%  │  5h 77%  ·  7d 60%
// Click the model for model/speed choices, a folder for "New tab" /
// "Tab + Claude". Hover any part for what it means.

const usage = atom({ plugin: 'ultimate-status', key: 'usage' } as const, {} as Usage)
const mode = atom({ plugin: 'ultimate-status', key: 'mode' } as const, 'default')
const popup = atom({ plugin: 'ultimate-status', key: 'popup' } as const, null as string | null)

// Catppuccin Macchiato. Left side cool, right side warm.
const C = {
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
  await $.process.run([
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
  ])
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

// Hooks carry the permission mode; keep it so the bar can size itself.
async function track($: EngineInterface, e: { permission_mode?: string }) {
  if (e.permission_mode) await update($, mode, () => e.permission_mode as string)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const u = await $.session.usage()
      await update($, usage, () => toUsage(u.context, u.rateLimits))
    } catch {}
    return result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => { await track($, e); return next(e) })
  on('classic.PreToolUse', async ($, e, next) => { await track($, e); return next(e) })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    return next(e)
  })

  // The bar itself: the hint line under the chat box.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const d = await gather($)
    const toggle = (id: string) => () => update($, popup, cur => (cur === id ? null : id))
    const sep = <Text color={C.dim}>{'  │  '}</Text>
    // The engine keeps its mode pill ("▸▸ auto mode on") at the start of this
    // line, so the bar gets the columns left after it.
    const width = e.viewport ? e.viewport.columns - pillWidth(await read($, mode), e.props.hint) - 4 : undefined

    return (
      <Box width={width} justifyContent="space-between">
        <Box flexShrink={1} overflow="hidden">
          <Button key="model" plain hover={{ scope: 'model', underline: true }} onPress={toggle('model')}>
            <Text color={C.model}>{`◆ ${d.model} `}</Text>
            <Text color={C.speed}>{`⚡ ${d.speed}`}</Text>
          </Button>
          {sep}
          {d.dirs.map((dir, i) => (
            <Box key={`d${i}`}>
              {i > 0 && d.dirs[i - 1].label !== '/' && <Text color={C.dim}>{'/'}</Text>}
              <Button key={`dir${i}`} plain hover={{ scope: 'dir', underline: true }} onPress={toggle(`dir:${dir.path}`)}>
                <Text color={C.path[i % C.path.length]}>{dir.label}</Text>
              </Button>
            </Box>
          ))}
          {d.dirs.length > 1 && <Text color={C.dim}>{'/'}</Text>}
          {d.branch && sep}
          {d.branch && <Text color={C.branch} hover={{ scope: 'branch', underline: true }}>{`⎇ ${d.branch}`}</Text>}
        </Box>
        <Box flexShrink={0} marginLeft={2}>
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
    )
  })

  // Popups and hover info: just above the chat box, only when needed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const d = await gather($)
    const open = await read($, popup)
    const close = () => update($, popup, () => null)

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

    return (
      <Box flexDirection="column">
        {popupRow}
        {tips.map(([scope, text]) => (
          <Box key={`tip-${scope}`} display="none" hover={{ scope, display: 'flex' }}>
            <Text color={C.info}>{text}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}

// The engine's mode pill ("▸▸ auto mode on · ") sits before the bar.
const PILL: Record<string, string> = {
  auto: 'auto mode on',
  plan: 'plan mode on',
  acceptEdits: 'accept edits on',
  bypassPermissions: 'bypass permissions on',
}
export function pillWidth(m: string, hint: string): number {
  const label = PILL[m] ?? (/shift\+tab/.test(hint) ? PILL.auto : '')
  return label ? label.length + 6 : 0 // "▸▸ " before it, " · " after
}

const pct = (n?: number) => (n === undefined ? '–' : `${Math.round(n)}%`)
const leftPct = (n?: number) => (n === undefined ? '–' : `${Math.round(100 - n)}%`)

// Everything the bar shows, read fresh on each draw.
async function gather($: EngineInterface) {
  const u = await read($, usage)
  const model = prettyModel(await $.session.model())
  const speed = await speedOf($)
  const cwd = await $.session.cwd()
  const home = (await $.process.run(['printenv', 'HOME'])).stdout.trim()
  let branch = ''
  try {
    const r = await $.process.run(['git', '--no-optional-locks', 'branch', '--show-current'], { timeoutMs: 2000 })
    if (r.exitCode === 0) branch = r.stdout.trim()
  } catch {}
  const ctx = u.ctx === undefined ? undefined : Math.round(u.ctx)
  const filled = ctx === undefined ? 0 : Math.min(10, Math.round(ctx / 10))
  const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled)
  return { u, model, speed, cwd, dirs: shortenPath(splitPath(cwd, home)), branch, ctx, bar }
}
