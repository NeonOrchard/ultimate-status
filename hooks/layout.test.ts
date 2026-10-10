import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_LAYOUT, cleanLayout, cut, move, renderBar, resize, width } from './layout'
import type { BlockId, Piece } from './layout'

const text: Record<BlockId, string> = { model: 'Opus', path: '~/Code/app/', branch: 'main', ctx: 'ctx 8%', usage: '5h 90%' }
const content = (id: BlockId, max?: number): Piece[] => cut([{ fg: '#fff', text: text[id] }], max ?? 99)
const colors = { dim: '#111', handle: '#222' }

describe('layout', () => {
  test('emoji take two columns', () => {
    expect(width('⚡ Fast')).toBe(7)
    expect(cut([{ fg: '#fff', text: 'abc⚡' }], 4).map(p => p.text)).toEqual(['abc'])
  })

  test('left blocks start at the left edge, right blocks end at the right edge', () => {
    const { geom } = renderBar(DEFAULT_LAYOUT, 80, false, content, colors)
    expect(geom.find(g => g.id === 'model')).toMatchObject({ side: 'left', start: 1 })
    expect(geom.find(g => g.id === 'usage')).toMatchObject({ side: 'right', end: 79 })
  })

  test('dragging a divider resizes its block', () => {
    const { geom } = renderBar(DEFAULT_LAYOUT, 80, true, content, colors)
    const model = geom.find(g => g.id === 'model')!
    const wider = resize(DEFAULT_LAYOUT, geom, 'model', model.end + 2 + 6)
    expect(wider.widths.model).toBe(model.end - model.start + 6)
  })

  test('dropping a block on the other side moves it there', () => {
    const { geom } = renderBar(DEFAULT_LAYOUT, 80, true, content, colors)
    const ctx = geom.find(g => g.id === 'ctx')!
    const moved = move(DEFAULT_LAYOUT, geom, 'model', ctx.start, 80)
    expect(moved.left).toEqual(['path'])
    expect(moved.right).toEqual(['branch', 'model', 'ctx', 'usage'])
  })

  test('a stored layout is cleaned up', () => {
    expect(cleanLayout({ left: ['ctx', 'bogus'], widths: { ctx: 1, path: 20 } })).toEqual({
      left: ['ctx', 'model', 'path'],
      right: ['branch', 'usage'],
      widths: { path: 20 },
    })
  })
})
