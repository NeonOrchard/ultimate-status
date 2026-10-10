// The tmux bar as blocks, like a WoW broker bar: some pinned to the left edge,
// some to the right, each its own width. Unlocked, dragging a divider resizes
// the block it belongs to and dragging a block moves it.

export type BlockId = 'model' | 'path' | 'branch' | 'ctx' | 'usage'
export type Layout = {
  left: BlockId[]
  right: BlockId[]
  // Set by dragging; a block without one takes its natural width, the path
  // whatever room is left.
  widths: Partial<Record<BlockId, number>>
}
export const DEFAULT_LAYOUT: Layout = { left: ['model', 'path'], right: ['branch', 'ctx', 'usage'], widths: {} }
const ALL: BlockId[] = ['model', 'path', 'branch', 'ctx', 'usage']

// A layout read back from the store, with anything unknown or missing fixed.
export function cleanLayout(v: unknown): Layout {
  const o = (v ?? {}) as Partial<Layout>
  const seen = new Set<BlockId>()
  const keep = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter((id): id is BlockId => ALL.includes(id) && !seen.has(id) && !!seen.add(id))
  const left = keep(o.left)
  const right = keep(o.right)
  for (const id of ALL) if (!seen.has(id)) (DEFAULT_LAYOUT.left.includes(id) ? left : right).push(id)
  const widths: Layout['widths'] = {}
  for (const id of ALL) {
    const w = (o.widths as Record<string, unknown> | undefined)?.[id]
    if (typeof w === 'number' && w >= MIN) widths[id] = Math.round(w)
  }
  return { left, right, widths }
}

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
const piecesWidth = (ps: Piece[]) => ps.reduce((n, p) => n + width(p.text), 0)

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

const MIN = 3
const SEP = '  │  '
const SEP_W = width(SEP)
// Where each block sits, for the drags to work from.
export type Geom = { id: BlockId; side: 'left' | 'right'; start: number; end: number }[]

const esc = (s: string) => s.replace(/#/g, '##')

// Draws the blocks into one tmux status line `columns` wide. `content` gives a
// block's pieces for a width (the path shrinks to fit); a block with nothing
// to show is left out.
export function renderBar(
  layout: Layout,
  columns: number,
  unlocked: boolean,
  content: (id: BlockId, max?: number) => Piece[],
  colors: { dim: string; handle: string },
): { bar: string; geom: Geom } {
  const natural = (id: BlockId) => piecesWidth(content(id))
  const shown = (ids: BlockId[]) => ids.filter(id => content(id).length > 0)
  const left = shown(layout.left)
  const right = shown(layout.right)
  const fixed = (id: BlockId) => layout.widths[id] ?? (id === 'path' ? undefined : natural(id))
  // Room the blocks have: the line less its edge spaces and the dividers.
  const dividers = Math.max(0, left.length - 1) + right.length
  const room = columns - 2 - dividers * SEP_W
  const sized = [...left, ...right].map(id => fixed(id))
  const used = sized.reduce<number>((n, w) => n + (w ?? 0), 0)
  const flex = sized.filter(w => w === undefined).length
  const share = flex ? Math.max(MIN, Math.floor((room - used) / flex)) : 0
  const w = (id: BlockId) => Math.max(MIN, fixed(id) ?? share)

  const geom: Geom = []
  const sep = (owner: BlockId) => {
    const glyph = `#[fg=${unlocked ? colors.handle : colors.dim}]${unlocked ? '  ┃  ' : SEP}`
    return unlocked ? `#[range=user|usv${owner}]${glyph}#[norange]` : glyph
  }
  const draw = (id: BlockId, cols: number, alignRight: boolean) => {
    const ps = cut(content(id, cols), cols)
    const pad = ' '.repeat(Math.max(0, cols - piecesWidth(ps)))
    const body = ps.map(p => {
      const t = `#[fg=${p.fg}]${esc(p.text)}`
      return !unlocked && p.range ? `#[range=user|us${p.range}]${t}#[norange]` : t
    }).join('')
    const inner = alignRight ? pad + body : body + pad
    return unlocked ? `#[range=user|usb${id}]${inner}#[norange]` : inner
  }

  let x = 1
  let leftText = ''
  left.forEach((id, i) => {
    if (i > 0) { leftText += sep(left[i - 1]); x += SEP_W }
    const cols = w(id)
    geom.push({ id, side: 'left', start: x, end: x + cols })
    leftText += draw(id, cols, false)
    x += cols
  })
  let rightText = ''
  let r = columns - 1
  for (let i = right.length - 1; i >= 0; i--) {
    const id = right[i]
    const cols = w(id)
    geom.push({ id, side: 'right', start: r - cols, end: r })
    rightText = sep(id) + draw(id, cols, true) + rightText
    r -= cols + SEP_W
  }
  return { bar: ` ${leftText}#[align=right]${rightText} `, geom }
}

// A divider dragged to column `x`: the block it belongs to grows or shrinks.
// A left block's divider is on its right; a right block's on its left.
export function resize(layout: Layout, geom: Geom, id: BlockId, x: number): Layout {
  const g = geom.find(b => b.id === id)
  if (!g) return layout
  const mid = Math.floor(SEP_W / 2)
  const cols = g.side === 'left' ? x - mid - g.start : g.end - (x + mid + 1)
  return { ...layout, widths: { ...layout.widths, [id]: Math.max(MIN, cols) } }
}

// A block dropped at column `x`: it goes before the block under the pointer
// (after it, past that block's middle), or to the near end of a side when
// dropped in the gap between the sides.
export function move(layout: Layout, geom: Geom, id: BlockId, x: number, columns: number): Layout {
  const left = layout.left.filter(b => b !== id)
  const right = layout.right.filter(b => b !== id)
  const hit = geom.find(b => b.id !== id && x >= b.start - 2 && x < b.end + 3)
  if (hit) {
    const list = hit.side === 'left' ? left : right
    const at = list.indexOf(hit.id) + (x >= (hit.start + hit.end) / 2 ? 1 : 0)
    list.splice(at, 0, id)
  } else if (x < columns / 2) {
    left.push(id)
  } else {
    right.unshift(id)
  }
  return { ...layout, left, right }
}
