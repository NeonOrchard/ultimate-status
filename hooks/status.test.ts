import { describe, expect, test } from 'claude-code/testing'
import { pathSep, prettyModel, shortenPath, splitPath } from './register'

describe('ultimate-status', () => {
  test('model ids read nicely', () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-5')).toBe('Haiku 5')
    expect(prettyModel('sonnet')).toBe('sonnet')
  })

  test('path splits into clickable folders', () => {
    expect(splitPath('/Users/me/WorkSpace/App', '/Users/me')).toEqual([
      { label: '~', path: '/Users/me' },
      { label: 'WorkSpace', path: '/Users/me/WorkSpace' },
      { label: 'App', path: '/Users/me/WorkSpace/App' },
    ])
    expect(splitPath('/opt/x', '/Users/me')).toEqual([
      { label: '/', path: '/' },
      { label: 'opt', path: '/opt' },
      { label: 'x', path: '/opt/x' },
    ])
  })
})

describe('short path', () => {
  test('long paths shrink middle folders to one letter', () => {
    const d = shortenPath(splitPath('/Users/me/WorkSpace/Projects/Something/MacForce', '/Users/me'))
    expect(d.map(x => x.label)).toEqual(['~', 'W', 'P', 'S', 'MacForce'])
    expect(d[2]?.path).toBe('/Users/me/WorkSpace/Projects')
  })
})

describe('windows paths', () => {
  test('a drive path splits on backslashes, no leading slash', () => {
    const d = splitPath('E:\\Code\\app', 'C:\\Users\\me')
    expect(d).toEqual([
      { label: 'E:', path: 'E:\\' },
      { label: 'Code', path: 'E:\\Code' },
      { label: 'app', path: 'E:\\Code\\app' },
    ])
    expect(pathSep(d)).toBe('\\')
  })

  test('the profile folder shows as ~', () => {
    expect(splitPath('C:\\Users\\me\\WorkSpace', 'C:\\Users\\me').map(x => x.label)).toEqual(['~', 'WorkSpace'])
    expect(pathSep(splitPath('/Users/me/x', '/Users/me'))).toBe('/')
  })
})
