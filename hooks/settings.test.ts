import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_LAYOUT } from './layout'
import { DEFAULTS, DEFAULT_COLORS, cleanSettings } from './settings'

describe('settings', () => {
  test('a missing or broken file keeps the defaults', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULTS)
    expect(cleanSettings('nope')).toEqual(DEFAULTS)
  })

  test('good colors are kept, bad ones fall back', () => {
    const s = cleanSettings({ colors: { model: '#010203', branch: 'green', path: ['#111111', 'x'] }, pathMax: 3 })
    expect(s.colors).toEqual({ ...DEFAULT_COLORS, model: '#010203' })
    expect(s.pathMax).toBe(DEFAULTS.pathMax)
  })

  test('a layout in the file is cleaned like the stored one', () => {
    expect(cleanSettings({ layout: { left: ['usage'], right: [] } }).layout).toEqual({
      left: ['usage', 'model', 'path'],
      right: ['branch', 'ctx'],
      widths: {},
    })
    expect(cleanSettings({}).layout).toBeUndefined()
    expect(DEFAULT_LAYOUT.left).toEqual(['model', 'path'])
  })
})
