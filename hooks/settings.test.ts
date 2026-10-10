import { describe, expect, test } from 'claude-code/testing'
import { DEFAULTS, DEFAULT_COLORS, cleanSettings, inkColor, tmuxColor } from './settings'

describe('settings', () => {
  test('a missing or broken file keeps the defaults', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULTS)
    expect(cleanSettings('nope')).toEqual(DEFAULTS)
  })

  test('good colors are kept, bad ones fall back', () => {
    const s = cleanSettings({ colors: { model: '#010203', speed: 'ansi:11', branch: 'green', path: ['#111111', 'x'] }, pathMax: 3 })
    expect(s.colors).toEqual({ ...DEFAULT_COLORS, model: '#010203', speed: 'ansi:11' })
    expect(s.pathMax).toBe(DEFAULTS.pathMax)
  })

  test('terminal theme colors draw in tmux and in Claude', () => {
    expect(tmuxColor('ansi:3')).toBe('colour3')
    expect(inkColor('ansi:3')).toBe('yellow')
    expect(inkColor('ansi:8')).toBe('gray')
    expect(inkColor('ansi:12')).toBe('blueBright')
    expect(inkColor('#abcdef')).toBe('#abcdef')
  })

  test('an older layout in the file becomes blocks', () => {
    const bar = cleanSettings({ layout: { left: ['usage'], right: [], widths: { usage: 12 } } }).bar!
    expect(bar.blocks.map(b => [b.side, b.items])).toEqual([
      ['left', ['five', 'week']],
      ['left', ['model', 'speed']],
      ['left', ['path']],
      ['right', ['branch']],
      ['right', ['ctx']],
    ])
    expect(bar.blocks[0]?.width).toBe(12)
    expect(cleanSettings({}).bar).toBeUndefined()
  })
})
