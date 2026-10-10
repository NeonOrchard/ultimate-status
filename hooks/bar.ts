// The bar as blocks, like a WoW broker bar. Each block holds data items
// (model, speed, path, ...), is pinned to the left or right edge, and owns
// the divider on its inner side. Unlocked, dragging a resizable divider sets
// its block's width and dragging a block moves it.

export type ItemId = 'model' | 'speed' | 'path' | 'branch' | 'ctx' | 'five' | 'week'
export const ITEMS: { id: ItemId; name: string }[] = [
  { id: 'model', name: 'Model' },
  { id: 'speed', name: 'Speed' },
  { id: 'path', name: 'Path' },
  { id: 'branch', name: 'Git branch' },
  { id: 'ctx', name: 'Context' },
  { id: 'five', name: '5h usage' },
  { id: 'week', name: '7d usage' },
]
const ITEM_IDS = ITEMS.map(i => i.id)

export type Side = 'left' | 'right'
export type Block = {
  id: string
  side: Side
  items: ItemId[]
  // Columns, set by dragging; absent, the block takes its natural width, or
  // all the room left when it holds the path.
  width?: number
  // The divider glyph on the block's inner side; '' for none.
  divider: string
  // Whether dragging that divider resizes the block.
  resizable: boolean
  // What goes between the block's items.
  joiner: string
}
// Blocks in order: a side's blocks run left to right in the order listed.
// An item in no block is hidden.
export type BarConfig = { blocks: Block[] }

export const DIVIDERS = ['│', '┃', '║', '┆', '|', '·', '•', '/', '']
export const JOINERS = [' ', ' · ', '  ', ' │ ', ' / ', '']

const block = (id: string, side: Side, items: ItemId[], joiner = ' '): Block =>
  ({ id, side, items, divider: '│', resizable: true, joiner })
export const DEFAULT_BAR: BarConfig = {
  blocks: [
    block('b1', 'left', ['model', 'speed']),
    block('b2', 'left', ['path']),
    block('b3', 'right', ['branch', 'ctx'], ' · '),
    block('b4', 'right', ['five', 'week'], ' · '),
  ],
}

const MIN = 3
const str = (v: unknown, max: number) => typeof v === 'string' && [...v].length <= max

// A bar read back from the settings file, with anything unknown or broken fixed.
export function cleanBar(v: unknown): BarConfig {
  const o = (v && typeof v === 'object' ? v : {}) as { blocks?: unknown }
  if (!Array.isArray(o.blocks)) return structuredClone(DEFAULT_BAR)
  const seenItems = new Set<ItemId>()
  const seenIds = new Set<string>()
  const blocks: Block[] = []
  for (const raw of o.blocks) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    let id = typeof b.id === 'string' && /^[a-z0-9]{1,8}$/i.test(b.id) ? b.id : ''
    if (!id || seenIds.has(id)) id = nextId({ blocks }, seenIds)
    seenIds.add(id)
    const items = (Array.isArray(b.items) ? b.items : []).filter(
      (i): i is ItemId => ITEM_IDS.includes(i) && !seenItems.has(i) && !!seenItems.add(i),
    )
    blocks.push({
      id,
      side: b.side === 'right' ? 'right' : 'left',
      items,
      ...(typeof b.width === 'number' && b.width >= MIN ? { width: Math.round(b.width) } : {}),
      divider: str(b.divider, 2) ? (b.divider as string) : '│',
      resizable: b.resizable !== false,
      joiner: str(b.joiner, 4) ? (b.joiner as string) : ' ',
    })
  }
  return { blocks: sideOrder(blocks) }
}

// The older layout (one block per part, 0.3) turned into blocks.
export function fromLayout(v: unknown): BarConfig {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const parts: Record<string, ItemId[]> = {
    model: ['model', 'speed'], path: ['path'], branch: ['branch'], ctx: ['ctx'], usage: ['five', 'week'],
  }
  const seen = new Set<string>()
  const list = (x: unknown) => (Array.isArray(x) ? x : []).filter(p => p in parts && !seen.has(p) && !!seen.add(p))
  const left = list(o.left)
  const right = list(o.right)
  for (const p of Object.keys(parts)) if (!seen.has(p)) (p === 'model' || p === 'path' ? left : right).push(p)
  const widths = (o.widths && typeof o.widths === 'object' ? o.widths : {}) as Record<string, unknown>
  const blocks = [...left.map(p => [p, 'left'] as const), ...right.map(p => [p, 'right'] as const)].map(([p, side]) => {
    const b = block(p, side, parts[p]!, p === 'usage' ? ' · ' : ' ')
    if (typeof widths[p] === 'number') b.width = widths[p] as number
    return b
  })
  return cleanBar({ blocks })
}

export function nextId(bar: BarConfig, taken = new Set<string>()): string {
  for (let n = 1; ; n++) {
    const id = `b${n}`
    if (!taken.has(id) && !bar.blocks.some(b => b.id === id)) return id
  }
}

// Left blocks first, then right ones, each side keeping its order.
const sideOrder = (blocks: Block[]) => [...blocks.filter(b => b.side === 'left'), ...blocks.filter(b => b.side === 'right')]

// A run of text in one color; `range` makes it clickable when locked.
export type Piece = { fg: string; text: string; range?: string }

// Terminal columns a character takes: emoji and East Asian wide forms take two.
function cw(cp: number): number {
  if (cp === 0x26a1 || cp >= 0x1f300) return 2
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) return 2
  return 1
}
export const width = (s: string) => [...s].reduce((n, c) => n + cw(c.codePointAt(0)!), 0)
export const piecesWidth = (ps: Piece[]) => ps.reduce((n, p) => n + width(p.text), 0)

// Cut pieces to `max` columns.
export function cut(ps: Piece[], max: number): Piece[] {
  const out: Piece[] = []
  let room = max
  for (const p of ps) {
    if (room <= 0) break
    let text = ''
    for (const c of p.text) {
      const w = cw(c.codePointAt(0)!)
      if (w > room) { room = 0; break }
      text += c
      room -= w
    }
    if (text) out.push({ ...p, text })
  }
  return out
}

// A block's pieces: its items' pieces with the joiner between. `max` is the
// room the path may take.
export function blockPieces(b: Block, item: (id: ItemId, max?: number) => Piece[], joinFg: string, max?: number): Piece[] {
  const shown = b.items.filter(id => item(id).length > 0)
  // The path gets what its block's other items and joiners leave.
  const rest = shown.filter(id => id !== 'path').reduce((n, id) => n + piecesWidth(item(id)), 0) +
    Math.max(0, shown.length - 1) * width(b.joiner)
  const pathMax = max === undefined ? undefined : Math.max(MIN, max - rest)
  const parts = shown.map(id => item(id, id === 'path' ? pathMax : undefined))
  return parts.flatMap((ps, i) => (i > 0 && b.joiner ? [{ fg: joinFg, text: b.joiner }, ...ps] : ps))
}

// Where each block sits, for the drags to work from.
export type Geom = { id: string; side: Side; start: number; end: number }[]

const GAP = 5 // two spaces, the glyph, two spaces
const esc = (s: string) => s.replace(/#/g, '##')
export type Paint = { dim: string; handle: string; tmux: (c: string) => string }

// Draws the blocks into one tmux status line `columns` wide. Empty blocks are
// left out. Unlocked, every divider is a handle: `┃` where it resizes.
export function renderBar(
  bar: BarConfig,
  columns: number,
  unlocked: boolean,
  item: (id: ItemId, max?: number) => Piece[],
  paint: Paint,
): { bar: string; geom: Geom } {
  const pieces = (b: Block, max?: number) => blockPieces(b, item, paint.dim, max)
  const shown = bar.blocks.filter(b => pieces(b).length > 0)
  const left = shown.filter(b => b.side === 'left')
  const right = shown.filter(b => b.side === 'right')
  const gapOf = (b: Block) => (unlocked || b.divider ? GAP : 2)
  const gaps = left.slice(0, -1).reduce((n, b) => n + gapOf(b), 0) + right.reduce((n, b) => n + gapOf(b), 0)
  const fixed = (b: Block) => b.width ?? (b.items.includes('path') ? undefined : piecesWidth(pieces(b)))
  const room = columns - 2 - gaps
  const sized = shown.map(fixed)
  const used = sized.reduce<number>((n, w) => n + (w ?? 0), 0)
  const flex = sized.filter(w => w === undefined).length
  const share = flex ? Math.max(MIN, Math.floor((room - used) / flex)) : 0
  const w = (b: Block) => Math.max(MIN, fixed(b) ?? share)

  const gap = (b: Block) => {
    if (!unlocked) return b.divider ? `#[fg=${paint.tmux(paint.dim)}]  ${esc(b.divider)}  ` : '  '
    const glyph = b.resizable ? `#[fg=${paint.tmux(paint.handle)}]  ┃  ` : `#[fg=${paint.tmux(paint.dim)}]  ${esc(b.divider || '·')}  `
    return b.resizable ? `#[range=user|usv${b.id}]${glyph}#[norange]` : glyph
  }
  const draw = (b: Block, cols: number, alignRight: boolean) => {
    const ps = cut(pieces(b, cols), cols)
    const pad = ' '.repeat(Math.max(0, cols - piecesWidth(ps)))
    const body = ps.map(p => {
      const t = `#[fg=${paint.tmux(p.fg)}]${esc(p.text)}`
      return !unlocked && p.range ? `#[range=user|us${p.range}]${t}#[norange]` : t
    }).join('')
    const inner = alignRight ? pad + body : body + pad
    return unlocked ? `#[range=user|usb${b.id}]${inner}#[norange]` : inner
  }

  const geom: Geom = []
  let x = 1
  let leftText = ''
  left.forEach((b, i) => {
    const prev = left[i - 1]
    if (prev) { leftText += gap(prev); x += gapOf(prev) }
    const cols = w(b)
    geom.push({ id: b.id, side: 'left', start: x, end: x + cols })
    leftText += draw(b, cols, false)
    x += cols
  })
  let rightText = ''
  let r = columns - 1
  for (const b of [...right].reverse()) {
    const cols = w(b)
    geom.push({ id: b.id, side: 'right', start: r - cols, end: r })
    rightText = gap(b) + draw(b, cols, true) + rightText
    r -= cols + gapOf(b)
  }
  return { bar: ` ${leftText}#[align=right]${rightText} `, geom }
}

const withBlock = (bar: BarConfig, id: string, fn: (b: Block) => Block): BarConfig =>
  ({ blocks: bar.blocks.map(b => (b.id === id ? fn(b) : b)) })

// A resizable divider dragged to column `x` (unlocked, so every gap is GAP
// wide with the glyph in its middle).
export function resize(bar: BarConfig, geom: Geom, id: string, x: number): BarConfig {
  const g = geom.find(b => b.id === id)
  if (!g) return bar
  const mid = Math.floor(GAP / 2)
  const cols = g.side === 'left' ? x - mid - g.start : g.end - (x + mid + 1)
  return withBlock(bar, id, b => ({ ...b, width: Math.max(MIN, cols) }))
}

// A block dropped at column `x`: before the block under the pointer (after it,
// past its middle), or at the near end of a side when dropped in the gap.
export function move(bar: BarConfig, geom: Geom, id: string, x: number, columns: number): BarConfig {
  const moving = bar.blocks.find(b => b.id === id)
  if (!moving) return bar
  const rest = bar.blocks.filter(b => b.id !== id)
  const hit = geom.find(b => b.id !== id && x >= b.start - 2 && x < b.end + 3)
  const side: Side = hit ? hit.side : x < columns / 2 ? 'left' : 'right'
  const placed = { ...moving, side }
  let at: number
  if (hit) at = rest.findIndex(b => b.id === hit.id) + (x >= (hit.start + hit.end) / 2 ? 1 : 0)
  else if (side === 'left') at = rest.filter(b => b.side === 'left').length
  else at = rest.findIndex(b => b.side === 'right') === -1 ? rest.length : rest.findIndex(b => b.side === 'right')
  rest.splice(at, 0, placed)
  return { blocks: sideOrder(rest) }
}

// Edits the config panel makes.
export function moveItem(bar: BarConfig, item: ItemId, to: string | null): BarConfig {
  const blocks = bar.blocks.map(b => ({ ...b, items: b.items.filter(i => i !== item) }))
  const target = blocks.find(b => b.id === to)
  if (target) target.items.push(item)
  return { blocks }
}
export function shiftBlock(bar: BarConfig, id: string, by: -1 | 1): BarConfig {
  const b = bar.blocks.find(x => x.id === id)
  if (!b) return bar
  const same = bar.blocks.filter(x => x.side === b.side)
  const i = same.indexOf(b)
  const j = i + by
  if (j < 0 || j >= same.length) return bar
  ;[same[i], same[j]] = [same[j]!, b]
  const other = bar.blocks.filter(x => x.side !== b.side)
  return { blocks: sideOrder([...same, ...other]) }
}
export function flipBlock(bar: BarConfig, id: string): BarConfig {
  const b = bar.blocks.find(x => x.id === id)
  if (!b) return bar
  const rest = bar.blocks.filter(x => x.id !== id)
  // To the inner end of the other side: last of the left, first of the right.
  const moved: Block = { ...b, side: b.side === 'left' ? 'right' : 'left' }
  return { blocks: [...rest.filter(x => x.side === 'left'), moved, ...rest.filter(x => x.side === 'right')] }
}
export function addBlock(bar: BarConfig, side: Side): BarConfig {
  return { blocks: sideOrder([...bar.blocks, block(nextId(bar), side, [])]) }
}
export function removeBlock(bar: BarConfig, id: string): BarConfig {
  return { blocks: bar.blocks.filter(b => b.id !== id) }
}
export function setBlock(bar: BarConfig, id: string, change: Partial<Omit<Block, 'id'>>): BarConfig {
  return withBlock(bar, id, b => {
    const next = { ...b, ...change }
    if (change.width === undefined && 'width' in change) delete next.width
    return next
  })
}
