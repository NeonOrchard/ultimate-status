import type { RenderElement } from 'claude-code'

import { DEFAULT_BAR, DIVIDERS, ITEMS, JOINERS, addBlock, flipBlock, moveItem, removeBlock, setBlock, shiftBlock } from './bar'
import type { BarConfig, Block, ItemId, Piece, Side } from './bar'
import { ANSI_NAMES, CATPPUCCIN, CTX_BARS, DEFAULTS, DEFAULT_COLORS, HOVER_STYLES, USAGE_SHOW, inkColor, isColor } from './settings'
import type { Colors } from './settings'

// The settings panel: /ultimate-status config. Every change saves right away
// and redraws the bar, so the bar itself is the preview. register.tsx owns
// the engine calls and hands this what it needs.

// The colors each item uses, by key into Colors ('path.2' is the third
// folder color).
const ITEM_COLORS: Record<ItemId, [string, string][]> = {
  model: [['model', 'Model']],
  speed: [['speed', 'Speed']],
  path: [0, 1, 2, 3, 4].map(i => [`path.${i}`, `Folder ${i + 1}`]),
  branch: [['branch', 'Branch']],
  ctx: [['ctxLabel', 'Label'], ['ctxValue', 'Value']],
  five: [['fiveLabel', 'Label'], ['fiveValue', 'Time']],
  week: [['weekLabel', 'Label'], ['weekValue', 'Time']],
}
const OTHER_COLORS: [string, string][] = [
  ['dim', 'Dividers and joiners'], ['info', 'Notes and tips'],
  ['usageGood', '% plenty left'], ['usageWarn', '% getting low'], ['usageLow', '% nearly out'],
]

const getColor = (c: Colors, key: string): string =>
  key.startsWith('path.') ? c.path[Number(key.slice(5))] ?? c.path[0] ?? c.dim : (c[key as keyof Omit<Colors, 'path'>] as string)
function setColor(c: Colors, key: string, value: string): Colors {
  if (!key.startsWith('path.')) return { ...c, [key]: value }
  const path = [...c.path]
  path[Number(key.slice(5))] = value
  return { ...c, path }
}
const colorName = (key: string) =>
  [...Object.values(ITEM_COLORS).flat(), ...OTHER_COLORS].find(([k]) => k === key)?.[1] ?? key
const itemName = (id: ItemId) => ITEMS.find(i => i.id === id)!.name
const glyphLabel = (g: string) => (g === '' ? 'none' : g === ' ' ? 'space' : `"${g}"`)

// Symbols for the panel. Most are plain Unicode that any font draws; the path
// and context ones use the Nerd Font glyphs the bar itself uses when icons
// are on.
const ICON = {
  blocks: '▦', items: '≡', display: '◐', colors: '◍', reset: '↺', cycle: '⟳', changed: '●', same: '○',
  left: '◧', right: '◨',
}
const itemIcon = (id: ItemId, nerd: boolean) =>
  ({ model: '◆', speed: '⚡', path: nerd ? '󰉋' : '▸', branch: '⎇', ctx: nerd ? '󰧑' : '◔', five: '◷', week: '◷' })[id]

export type PanelContext = {
  // The surface's elements, from $.ui.resolve.
  els: Record<string, unknown>
  // The bar as it draws now, block by block, for the live preview.
  preview: { side: Side; divider: string; pieces: Piece[] }[]
  bar: BarConfig
  colors: Colors
  // The color being picked ('model', 'path.2', ...) and the flavor shown.
  picking: string | null
  shownFlavor: string
  setPick: (fn: (cur: string | null) => string | null) => void
  setFlavor: (f: string) => void
  // Which tab shows: 'blocks', 'items' or 'colors'.
  tab: string
  setTab: (t: string) => void
  // The open dropdown's key, or null; while one is open it is the only thing
  // the keys reach.
  menu: string | null
  setMenu: (key: string | null) => void
  // Moves the keyboard to the element with this key.
  focus: (key: string) => void
  toast: (text: string) => void
  ctxBar: string
  icons: boolean
  fiveShow: string
  weekShow: string
  usageCompact: boolean
  hover: string
  save: (next: { bar?: BarConfig; colors?: Colors; ctxBar?: string; icons?: boolean; fiveShow?: string; weekShow?: string; usageCompact?: boolean; hover?: string }) => Promise<void>
}

type El = (props: Record<string, unknown>, ...children: unknown[]) => RenderElement

export const TABS: [string, string, keyof typeof ICON][] = [
  ['blocks', 'Blocks', 'blocks'], ['items', 'Items', 'items'], ['display', 'Display', 'display'], ['colors', 'Colors', 'colors'],
]

export function panel(ctx: PanelContext): RenderElement {
  const { Box, Text, Button } = ctx.els as Record<'Box' | 'Text' | 'Button', El>
  if (!ctx.els.Input) return <Text>Open /ultimate-status config in a terminal or the desktop app to change settings.</Text>
  const { Input } = ctx.els as Record<'Input', El>
  const { bar, colors, picking, shownFlavor, menu } = ctx
  const tab = TABS.some(([t]) => t === ctx.tab) ? ctx.tab : 'blocks'
  const setBar = (next: BarConfig) => ctx.save({ bar: next })
  // Soft colors for the panel's own text, from the bar's palette.
  const ui = { title: inkColor(colors.model), key: inkColor(colors.path[0] ?? colors.info), note: inkColor(colors.dim), text: inkColor(colors.info) }
  const LABEL = 16

  // A button. Tab and the arrows walk buttons, so while a dropdown is open
  // every other button is drawn as plain text: the keys stay in the list.
  const btn = (p: { key: string; label?: string; children?: unknown; plain?: boolean; primary?: boolean; inMenu?: boolean; onPress: () => unknown }) => {
    if (menu && !p.inMenu) {
      return p.label !== undefined
        ? <Text key={p.key} color={ui.note}>{` ${p.label} `}</Text>
        : <Box key={p.key}>{p.children}</Box>
    }
    const props: Record<string, unknown> = { key: p.key, onPress: () => { void p.onPress() } }
    if (p.label !== undefined) props.label = p.label
    if (p.plain) props.plain = true
    if (p.primary !== undefined) props.variant = p.primary ? 'primary' : 'secondary'
    return p.children === undefined ? <Button {...props} /> : <Button {...props}>{p.children}</Button>
  }

  // A dropdown: closed, one button with the current choice; Enter opens the
  // list under it and puts the keys on the current choice. A pick (or Cancel)
  // closes it and puts the keys back on the button.
  const dropdown = (key: string, value: string, options: { value: string; label: string }[], onPick: (v: string) => unknown) => {
    const current = options.find(o => o.value === value)?.label ?? value
    const optKey = (v: string) => `${key}:${options.findIndex(o => o.value === v)}`
    if (menu !== key) {
      return btn({ key, label: `${current} ▾`, onPress: () => { ctx.setMenu(key); ctx.focus(optKey(options.some(o => o.value === value) ? value : options[0]!.value)) } })
    }
    const close = () => { ctx.setMenu(null); ctx.focus(key) }
    return (
      <Box key={`${key}-open`} flexDirection="column" borderStyle="round" borderColor={ui.title} paddingX={1}>
        {options.map(o => btn({
          key: optKey(o.value), inMenu: true, label: `${o.value === value ? '● ' : '  '}${o.label}`,
          onPress: async () => { close(); await onPick(o.value) },
        }))}
        {btn({ key: `${key}:cancel`, inMenu: true, label: '  Cancel', onPress: close })}
      </Box>
    )
  }

  // A choice of a few options: one click (or Enter) moves to the next.
  const cycle = (key: string, value: string, options: { value: string; label: string }[], onPick: (v: string) => unknown) => {
    const i = Math.max(0, options.findIndex(o => o.value === value))
    const next = options[(i + 1) % options.length]!
    return btn({ key, label: `${options[i]?.label ?? value}  ${ICON.cycle}`, onPress: () => onPick(next.value) })
  }

  // How far a tab is from its defaults, for its reset line.
  const status = (key: string, changed: number, what: string, onReset: () => unknown) => (
    <Box key={key} gap={2} marginTop={1}>
      <Text color={changed ? ui.title : ui.note}>
        {changed ? `${ICON.changed} ${changed} ${what} changed from default` : `${ICON.same} All ${what} at default`}
      </Text>
      {changed > 0 && btn({ key: `${key}-reset`, label: `${ICON.reset} Reset ${what}`, onPress: onReset })}
    </Box>
  )

  // One setting: a colored label in a fixed column, then its control.
  const row = (key: string, label: string, ...control: unknown[]) => (
    <Box key={key} gap={1}>
      <Box width={LABEL}><Text color={ui.key}>{label}</Text></Box>
      {control}
    </Box>
  )
  const note = (key: string, text: string) => <Text key={key} color={ui.note}>{text}</Text>
  // `where` keeps keys unique: one color can show in two rows.
  const swatch = (key: string, where: string) => btn({
    key: `sw-${where}-${key}`, plain: true, onPress: () => ctx.setPick(cur => (cur === key ? null : key)),
    children: <Text color={inkColor(getColor(colors, key))} inverse={picking === key}>{' ██ '}</Text>,
  })

  // --- Blocks tab: one card per block, left side then right side.
  const blockCard = (b: Block) => {
    const same = bar.blocks.filter(x => x.side === b.side)
    const i = same.indexOf(b)
    const n = bar.blocks.indexOf(b) + 1
    return (
      <Box key={`blk-${b.id}`} flexDirection="column" borderStyle="round" borderColor={ui.note} paddingX={1} marginTop={1}>
        <Box gap={1} justifyContent="space-between">
          <Text bold color={ui.title}>{`Block ${n}  ${b.items.length ? b.items.map(id => `${itemIcon(id, ctx.icons)} ${itemName(id)}`).join('  +  ') : '(empty)'}`}</Text>
          <Box gap={1}>
            {i > 0 && btn({ key: `up-${b.id}`, label: '◀ Move', onPress: () => setBar(shiftBlock(bar, b.id, -1)) })}
            {i < same.length - 1 && btn({ key: `dn-${b.id}`, label: 'Move ▶', onPress: () => setBar(shiftBlock(bar, b.id, 1)) })}
            {btn({ key: `flip-${b.id}`, label: b.side === 'left' ? 'To right' : 'To left', onPress: () => setBar(flipBlock(bar, b.id)) })}
            {btn({ key: `rm-${b.id}`, label: 'Remove', onPress: () => setBar(removeBlock(bar, b.id)) })}
          </Box>
        </Box>
        {row(`div-${b.id}`, 'Divider',
          dropdown(`divs-${b.id}`, b.divider, DIVIDERS.map(g => ({ value: g, label: glyphLabel(g) })),
            v => setBar(setBlock(bar, b.id, { divider: v }))))}
        {row(`join-${b.id}`, 'Between items',
          dropdown(`joins-${b.id}`, b.joiner, JOINERS.map(g => ({ value: g, label: glyphLabel(g) })),
            v => setBar(setBlock(bar, b.id, { joiner: v }))))}
        {row(`rs-${b.id}`, 'Resizable',
          cycle(`rsb-${b.id}`, b.resizable ? 'yes' : 'no', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
            v => setBar(setBlock(bar, b.id, { resizable: v === 'yes' }))),
          <Text key={`rsn-${b.id}`} color={ui.note}>drag its divider while unlocked</Text>)}
        {row(`w-${b.id}`, 'Width',
          <Text key={`wt-${b.id}`} color={ui.text}>{b.width === undefined ? 'auto' : `${b.width} columns`}</Text>,
          b.width !== undefined && btn({ key: `auto-${b.id}`, label: 'Back to auto', onPress: () => setBar(setBlock(bar, b.id, { width: undefined })) }))}
      </Box>
    )
  }
  // Blocks that differ from the default layout (added, removed, or changed).
  const blocksChanged = (() => {
    const ids = new Set([...bar.blocks, ...DEFAULT_BAR.blocks].map(b => b.id))
    let n = 0
    for (const id of ids) {
      const a = bar.blocks.find(b => b.id === id)
      const b = DEFAULT_BAR.blocks.find(x => x.id === id)
      if (JSON.stringify(a) !== JSON.stringify(b)) n++
    }
    return n || 1
  })()
  const blocksTab = (
    <Box key="page-blocks" flexDirection="column">
      {note('bn', 'Left blocks pin to the left edge, right blocks to the right. Each divider sits on its block\'s inner side.')}
      {(['left', 'right'] as const).map(side => (
        <Box key={`side-${side}`} flexDirection="column" marginTop={1}>
          <Box gap={2}>
            <Text bold underline color={ui.title}>{side === 'left' ? `${ICON.left} Left side` : `${ICON.right} Right side`}</Text>
            {btn({ key: `add-${side}`, label: '+ New block', onPress: () => setBar(addBlock(bar, side)) })}
          </Box>
          {bar.blocks.filter(b => b.side === side).map(blockCard)}
        </Box>
      ))}
      {status('st-blocks', JSON.stringify(bar) === JSON.stringify(DEFAULT_BAR) ? 0 : blocksChanged, 'blocks', () => setBar(structuredClone(DEFAULT_BAR)))}
    </Box>
  )

  // --- Items tab: which block each item goes in.
  const where = (id: ItemId) => bar.blocks.find(b => b.items.includes(id))?.id ?? 'hidden'
  const blockOptions = [
    ...bar.blocks.map(b => ({ value: b.id, label: `Block ${bar.blocks.indexOf(b) + 1}  (${b.side}: ${b.items.map(itemName).join(' + ') || 'empty'})` })),
    { value: 'hidden', label: 'Hidden' },
  ]
  const defaultWhere = (id: ItemId) => DEFAULT_BAR.blocks.find(b => b.items.includes(id))?.id ?? 'hidden'
  const itemsChanged = ITEMS.filter(it => where(it.id) !== defaultWhere(it.id)).length
  const itemsTab = (
    <Box key="page-items" flexDirection="column">
      {note('in', 'Pick the block each item shows in. Items in the same block share it, with no divider between.')}
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map(it => row(`item-${it.id}`, `${itemIcon(it.id, ctx.icons)} ${it.name}`,
          dropdown(`in-${it.id}`, where(it.id), blockOptions, v => setBar(moveItem(bar, it.id, v === 'hidden' ? null : v)))))}
      </Box>
      {status('st-items', itemsChanged, 'placements', () => setBar(structuredClone(DEFAULT_BAR)))}
    </Box>
  )

  // --- Display tab: how items look.
  const displayChanged = (['ctxBar', 'icons', 'fiveShow', 'weekShow', 'usageCompact', 'hover'] as const).filter(k => ctx[k] !== DEFAULTS[k]).length
  const usage = Object.entries(USAGE_SHOW).map(([value, label]) => ({ value, label }))
  const displayTab = (
    <Box key="page-display" flexDirection="column">
      {note('dn', 'How the items look. One click switches a choice; the bar updates right away.')}
      <Box flexDirection="column" marginTop={1}>
        {row('ctx-style', `${itemIcon('ctx', ctx.icons)} Context bar`,
          dropdown('ctxbar', ctx.ctxBar, Object.entries(CTX_BARS).map(([id, st]) => ({ value: id, label: `${st.name}  ${st.preview ?? st.full.repeat(4) + st.empty.repeat(4)}` })),
            v => ctx.save({ ctxBar: v })))}
        {row('icons', 'Icons',
          cycle('icons', ctx.icons ? 'on' : 'off', [{ value: 'on', label: 'On  󰧑 󰉋 (Nerd Font)' }, { value: 'off', label: 'Off  (words)' }],
            v => ctx.save({ icons: v === 'on' })))}
        {row('five-show', `${itemIcon('five', ctx.icons)} 5h shows`, cycle('fiveshow', ctx.fiveShow, usage, v => ctx.save({ fiveShow: v })))}
        {row('week-show', `${itemIcon('week', ctx.icons)} 7d shows`, cycle('weekshow', ctx.weekShow, usage, v => ctx.save({ weekShow: v })))}
        {row('usage-gap', 'Time spacing',
          cycle('usagegap', ctx.usageCompact ? 'compact' : 'normal', [{ value: 'normal', label: '5h 3m 95%' }, { value: 'compact', label: '5h3m 95%' }],
            v => ctx.save({ usageCompact: v === 'compact' })))}
        {row('hover-style', 'On hover',
          cycle('hoverstyle', ctx.hover, Object.entries(HOVER_STYLES).map(([value, label]) => ({ value, label })), v => ctx.save({ hover: v })))}
      </Box>
      {status('st-display', displayChanged, 'display settings', () =>
        ctx.save({ ctxBar: DEFAULTS.ctxBar, icons: DEFAULTS.icons, fiveShow: DEFAULTS.fiveShow, weekShow: DEFAULTS.weekShow, usageCompact: DEFAULTS.usageCompact, hover: DEFAULTS.hover }))}
    </Box>
  )

  // --- Colors tab: swatches per item; the picker opens above them.
  let picker: RenderElement | null = null
  if (picking) {
    const choose = async (value: string) => { await ctx.save({ colors: setColor(colors, picking, value) }) }
    const cat: Record<string, string> = CATPPUCCIN[shownFlavor] ?? CATPPUCCIN.Macchiato ?? {}
    picker = (
      <Box key="picker" flexDirection="column" borderStyle="round" borderColor={ui.title} paddingX={1} marginBottom={1}>
        <Box gap={2} justifyContent="space-between">
          <Box gap={2}>
            <Text bold color={ui.title}>{`Color: ${colorName(picking)}`}</Text>
            <Text color={inkColor(getColor(colors, picking))}>{`██  ${getColor(colors, picking)}`}</Text>
          </Box>
          {btn({ key: 'pick-done', label: 'Done', onPress: () => ctx.setPick(() => null) })}
        </Box>
        <Box marginTop={1}>{note('pt', 'Terminal theme: follows your terminal\'s own colors')}</Box>
        <Box flexWrap="wrap">
          {ANSI_NAMES.map((_, n) => btn({
            key: `ansi${n}`, plain: true, onPress: () => choose(`ansi:${n}`),
            children: <Text color={inkColor(`ansi:${n}`)}>{' ██ '}</Text>,
          }))}
        </Box>
        <Box gap={2} marginTop={1}>
          <Text color={ui.note}>Catppuccin</Text>
          {dropdown('flavor', shownFlavor, Object.keys(CATPPUCCIN).map(f => ({ value: f, label: f })), v => ctx.setFlavor(v))}
        </Box>
        <Box flexWrap="wrap">
          {Object.entries(cat).map(([name, hex]) => btn({
            key: `cat-${name}`, plain: true, onPress: () => choose(hex),
            children: <Text color={hex}>{' ██ '}</Text>,
          }))}
        </Box>
        {!menu && (
          <Box marginTop={1}>
            <Input key="hex" label="Custom" placeholder="#rrggbb" submitLabel="Use"
              onSubmit={(v: string) => (isColor(v.trim()) ? choose(v.trim().toLowerCase()) : ctx.toast('ultimate-status: use a color like #a6da95.'))} />
          </Box>
        )}
      </Box>
    )
  }
  const colorRow = (key: string, label: string, list: [string, string][]) =>
    row(key, label, ...list.map(([k, l]) => (
      <Box key={`c-${key}-${k}`}>
        {swatch(k, key)}
        <Text color={ui.text}>{l}</Text>
      </Box>
    )))
  const colorKeys = [...Object.values(ITEM_COLORS).flat(), ...OTHER_COLORS].map(([k]) => k)
  const colorsChanged = [...new Set(colorKeys)].filter(k => getColor(colors, k) !== getColor(DEFAULT_COLORS, k)).length
  const colorsTab = (
    <Box key="page-colors" flexDirection="column">
      {picker}
      {!picking && note('cn', 'Click a swatch (or press Enter on it) to change that color.')}
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map(it => colorRow(`cr-${it.id}`, `${itemIcon(it.id, ctx.icons)} ${it.name}`, ITEM_COLORS[it.id]))}
        {colorRow('cr-other', 'Other', OTHER_COLORS)}
      </Box>
      {status('st-colors', colorsChanged, 'colors', () => ctx.save({ colors: DEFAULT_COLORS }))}
    </Box>
  )

  // Live preview: the bar as it draws now, updated with every change. One
  // line that cuts off at the panel's edge, so a narrow panel never wraps it.
  const gapText = (divider: string) => (divider ? `  ${divider}  ` : '  ')
  const previewRuns: { fg: string; text: string }[] = []
  const leftBlocks = ctx.preview.filter(b => b.side === 'left')
  const rightBlocks = ctx.preview.filter(b => b.side === 'right')
  leftBlocks.forEach((b, i) => {
    if (i > 0) previewRuns.push({ fg: colors.dim, text: gapText(leftBlocks[i - 1]!.divider) })
    previewRuns.push(...b.pieces)
  })
  rightBlocks.forEach(b => {
    previewRuns.push({ fg: colors.dim, text: gapText(b.divider || '│') })
    previewRuns.push(...b.pieces)
  })
  const preview = (
    <Box key="preview" flexDirection="column" borderStyle="round" borderColor={ui.note} paddingX={1} marginTop={1}>
      <Text color={ui.note}>Preview</Text>
      <Text wrap="truncate-end">
        {previewRuns.map((r, i) => <Text key={`pv-${i}`} color={inkColor(r.fg)}>{r.text}</Text>)}
      </Text>
    </Box>
  )

  const pages: Record<string, RenderElement> = { blocks: blocksTab, items: itemsTab, display: displayTab, colors: colorsTab }
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2} justifyContent="space-between">
        <Text bold color={ui.title}>Ultimate Status</Text>
        <Text color={ui.note}>{menu ? '↑↓ choose · Enter picks' : 'Tab/↑↓ move · Enter acts · Esc closes'}</Text>
      </Box>
      {preview}
      <Box gap={1} marginTop={1}>
        {TABS.map(([id, label, icon]) => btn({ key: `tab-${id}`, label: `${ICON[icon]} ${label}`, primary: tab === id, onPress: () => ctx.setTab(id) }))}
      </Box>
      <Text color={ui.note}>{'─'.repeat(48)}</Text>
      {pages[tab] ?? blocksTab}
    </Box>
  )
}
