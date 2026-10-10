import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_BAR, addBlock, cleanBar, cut, flipBlock, move, moveItem, renderBar, resize, shiftBlock, width } from './bar'
import type { ItemId, Piece } from './bar'

const text: Record<ItemId, string> = { model: 'Opus', speed: 'Fast', path: '~/Code/app/', branch: 'main', ctx: 'ctx 8%', five: '5h 90%', week: '7d 80%' }
const item = (id: ItemId, max?: number): Piece[] => cut([{ fg: '#ffffff', text: text[id] }], max ?? 99)
const paint = { dim: '#111111', handle: '#222222', tmux: (c: string) => c }

describe('bar', () => {
  test('emoji take two columns', () => {
    expect(width('⚡ Fast')).toBe(7)
    expect(cut([{ fg: '#fff', text: 'abc⚡' }], 4).map(p => p.text)).toEqual(['abc'])
  })

  test('left blocks start at the left edge, right blocks end at the right edge', () => {
    const { geom } = renderBar(DEFAULT_BAR, 80, false, item, paint)
    expect(geom.find(g => g.id === 'b1')).toMatchObject({ side: 'left', start: 1, end: 10 })
    expect(geom.find(g => g.id === 'b4')).toMatchObject({ side: 'right', end: 79 })
  })

  test('items in one block share it, with the joiner and no divider between', () => {
    const { bar } = renderBar(DEFAULT_BAR, 80, false, item, paint)
    expect(bar).toContain('main#[fg=#111111] · #[fg=#ffffff]ctx 8%')
  })

  test('a block with no divider gets a plain gap', () => {
    const bar = { blocks: DEFAULT_BAR.blocks.map(b => (b.id === 'b3' ? { ...b, divider: '' } : b)) }
    expect(renderBar(bar, 80, false, item, paint).bar).not.toContain('│  #[fg=#ffffff]main')
  })

  test('dragging a resizable divider resizes its block', () => {
    const { geom } = renderBar(DEFAULT_BAR, 80, true, item, paint)
    const b1 = geom.find(g => g.id === 'b1')!
    const wider = resize(DEFAULT_BAR, geom, 'b1', b1.end + 2 + 6)
    expect(wider.blocks[0]?.width).toBe(b1.end - b1.start + 6)
  })

  test('a divider set not to resize has no drag handle', () => {
    const bar = { blocks: DEFAULT_BAR.blocks.map(b => (b.id === 'b1' ? { ...b, resizable: false } : b)) }
    expect(renderBar(bar, 80, true, item, paint).bar).not.toContain('usvb1')
    expect(renderBar(DEFAULT_BAR, 80, true, item, paint).bar).toContain('usvb1')
  })

  test('dropping a block on the other side moves it there', () => {
    const { geom } = renderBar(DEFAULT_BAR, 80, true, item, paint)
    const b4 = geom.find(g => g.id === 'b4')!
    const moved = move(DEFAULT_BAR, geom, 'b1', b4.start, 80)
    expect(moved.blocks.map(b => `${b.side[0]}${b.id}`)).toEqual(['lb2', 'rb3', 'rb1', 'rb4'])
  })

  test('the panel moves items and blocks around', () => {
    let bar = moveItem(DEFAULT_BAR, 'speed', 'b3')
    expect(bar.blocks.find(b => b.id === 'b3')!.items).toEqual(['branch', 'ctx', 'speed'])
    bar = moveItem(bar, 'speed', null)
    expect(bar.blocks.flatMap(b => b.items)).not.toContain('speed')
    expect(shiftBlock(DEFAULT_BAR, 'b2', -1).blocks.map(b => b.id)).toEqual(['b2', 'b1', 'b3', 'b4'])
    expect(flipBlock(DEFAULT_BAR, 'b3').blocks.map(b => b.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(flipBlock(DEFAULT_BAR, 'b3').blocks[2]?.side).toBe('left')
    expect(addBlock(DEFAULT_BAR, 'left').blocks.map(b => b.id)).toEqual(['b1', 'b2', 'b5', 'b3', 'b4'])
  })

  test('a stored bar is cleaned up', () => {
    const bar = cleanBar({ blocks: [{ id: 'b1', side: 'up', items: ['model', 'model', 'nope'], width: 1 }, { id: 'b1', items: ['ctx'] }] })
    expect(bar.blocks).toEqual([
      { id: 'b1', side: 'left', items: ['model'], divider: '│', resizable: true, joiner: ' ' },
      { id: 'b2', side: 'left', items: ['ctx'], divider: '│', resizable: true, joiner: ' ' },
    ])
    expect(cleanBar(undefined)).toEqual(DEFAULT_BAR)
  })
})
