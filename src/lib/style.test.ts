import { describe, expect, test } from 'bun:test'

import { colorEnabled, makeStyle } from './style'

describe('colorEnabled', () => {
  test('a terminal gets colour; a pipe does not', () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true)
    expect(colorEnabled({ isTTY: false }, {})).toBe(false)
  })

  test('NO_COLOR and TERM=dumb turn it off; FORCE_COLOR turns it on for a pipe', () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false)
    expect(colorEnabled({ isTTY: true }, { TERM: 'dumb' })).toBe(false)
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true)
    expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: '0' })).toBe(true)
    expect(colorEnabled({ isTTY: false }, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false)
  })
})

test('plain style leaves text as it is', () => {
  const st = makeStyle(false)
  expect(st.green(st.bold('x'))).toBe('x')
  expect(makeStyle(true).green('x')).toBe('\x1b[32mx\x1b[39m')
})
