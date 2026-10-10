import type { RenderElement } from 'claude-code'

import { DEFAULT_BAR, DIVIDERS, ITEMS, JOINERS, addBlock, flipBlock, moveItem, removeBlock, setBlock, shiftBlock } from './bar'
import type { BarConfig, Block, ItemId } from './bar'
import { ANSI_NAMES, CATPPUCCIN, CTX_BARS, DEFAULT_COLORS, USAGE_SHOW, inkColor, isColor } from './settings'
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
  five: [['fiveLabel', 'Label'], ['fiveValue', 'Value']],
  week: [['weekLabel', 'Label'], ['weekValue', 'Value'], ['info', '"left"']],
}
const OTHER_COLORS: [string, string][] = [['dim', 'Dividers and joiners'], ['info', 'Notes and tips']]

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

export type PanelContext = {
  // The surface's elements, from $.ui.resolve.
  els: Record<string, unknown>
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
  save: (next: { bar?: BarConfig; colors?: Colors; ctxBar?: string; icons?: boolean; fiveShow?: string; weekShow?: string }) => Promise<void>
}

type El = (props: Record<string, unknown>, ...children: unknown[]) => RenderElement

export const TABS: [string, string][] = [['blocks', 'Blocks'], ['items', 'Items'], ['colors', 'Colors']]

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
          <Text bold color={ui.title}>{`Block ${n}  ${b.items.length ? b.items.map(itemName).join(' + ') : '(empty)'}`}</Text>
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
          btn({ key: `rsb-${b.id}`, label: b.resizable ? 'Yes' : 'No', onPress: () => setBar(setBlock(bar, b.id, { resizable: !b.resizable })) }),
          <Text key={`rsn-${b.id}`} color={ui.note}>drag its divider while unlocked</Text>)}
        {row(`w-${b.id}`, 'Width',
          <Text key={`wt-${b.id}`} color={ui.text}>{b.width === undefined ? 'auto' : `${b.width} columns`}</Text>,
          b.width !== undefined && btn({ key: `auto-${b.id}`, label: 'Back to auto', onPress: () => setBar(setBlock(bar, b.id, { width: undefined })) }))}
      </Box>
    )
  }
  const blocksTab = (
    <Box key="page-blocks" flexDirection="column">
      {note('bn', 'Left blocks pin to the left edge, right blocks to the right. Each divider sits on its block\'s inner side.')}
      {(['left', 'right'] as const).map(side => (
        <Box key={`side-${side}`} flexDirection="column" marginTop={1}>
          <Box gap={2}>
            <Text bold underline color={ui.title}>{side === 'left' ? 'Left side' : 'Right side'}</Text>
            {btn({ key: `add-${side}`, label: '+ New block', onPress: () => setBar(addBlock(bar, side)) })}
          </Box>
          {bar.blocks.filter(b => b.side === side).map(blockCard)}
        </Box>
      ))}
      <Box marginTop={1}>
        {btn({ key: 'reset-bar', label: 'Reset blocks', onPress: () => setBar(structuredClone(DEFAULT_BAR)) })}
      </Box>
    </Box>
  )

  // --- Items tab: which block each item goes in.
  const where = (id: ItemId) => bar.blocks.find(b => b.items.includes(id))?.id ?? 'hidden'
  const blockOptions = [
    ...bar.blocks.map(b => ({ value: b.id, label: `Block ${bar.blocks.indexOf(b) + 1}  (${b.side}: ${b.items.map(itemName).join(' + ') || 'empty'})` })),
    { value: 'hidden', label: 'Hidden' },
  ]
  const itemsTab = (
    <Box key="page-items" flexDirection="column">
      {note('in', 'Pick the block each item shows in. Items in the same block share it, with no divider between.')}
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map(it => row(`item-${it.id}`, it.name,
          dropdown(`in-${it.id}`, where(it.id), blockOptions, v => setBar(moveItem(bar, it.id, v === 'hidden' ? null : v)))))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {row('ctx-style', 'Context bar',
          dropdown('ctxbar', ctx.ctxBar, Object.entries(CTX_BARS).map(([id, st]) => ({ value: id, label: `${st.name}  ${st.preview ?? st.full.repeat(4) + st.empty.repeat(4)}` })),
            v => ctx.save({ ctxBar: v })))}
        {row('icons', 'Icons',
          dropdown('icons', ctx.icons ? 'on' : 'off', [{ value: 'on', label: 'On  󰧑 (Nerd Font)' }, { value: 'off', label: 'Off  ctx' }],
            v => ctx.save({ icons: v === 'on' })))}
        {row('five-show', '5h shows',
          dropdown('fiveshow', ctx.fiveShow, Object.entries(USAGE_SHOW).map(([value, label]) => ({ value, label })),
            v => ctx.save({ fiveShow: v })))}
        {row('week-show', '7d shows',
          dropdown('weekshow', ctx.weekShow, Object.entries(USAGE_SHOW).map(([value, label]) => ({ value, label })),
            v => ctx.save({ weekShow: v })))}
      </Box>
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
  const colorsTab = (
    <Box key="page-colors" flexDirection="column">
      {picker}
      {!picking && note('cn', 'Click a swatch (or press Enter on it) to change that color.')}
      <Box flexDirection="column" marginTop={1}>
        {ITEMS.map(it => colorRow(`cr-${it.id}`, it.name, ITEM_COLORS[it.id]))}
        {colorRow('cr-other', 'Other', OTHER_COLORS)}
      </Box>
      <Box marginTop={1}>
        {btn({ key: 'reset-colors', label: 'Reset colors', onPress: () => ctx.save({ colors: DEFAULT_COLORS }) })}
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2} justifyContent="space-between">
        <Text bold color={ui.title}>Ultimate Status</Text>
        <Text color={ui.note}>{menu ? '↑↓ choose · Enter picks' : 'Tab/↑↓ move · Enter acts · Esc closes'}</Text>
      </Box>
      <Box gap={1} marginTop={1}>
        {TABS.map(([id, label]) => btn({ key: `tab-${id}`, label, primary: tab === id, onPress: () => ctx.setTab(id) }))}
      </Box>
      <Text color={ui.note}>{'─'.repeat(48)}</Text>
      {tab === 'blocks' ? blocksTab : tab === 'items' ? itemsTab : colorsTab}
    </Box>
  )
}
