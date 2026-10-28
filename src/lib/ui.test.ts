import { describe, expect, test } from 'bun:test'

import { ago, makeUi, meter, splitHint, visibleWidth } from './ui'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('the output kit', () => {
  const ui = makeUi(false)

  test('outcomes carry one mark each', () => {
    expect(ui.done('Paired iPhone.')).toBe('✓ Paired iPhone.')
    expect(ui.warn('2.4.0 is out.')).toBe('! 2.4.0 is out.')
    expect(ui.fail('No such device.')).toBe('✗ No such device.')
  })

  test('a next step is an arrow and the command', () => {
    expect(ui.next('actovia pair')).toBe('  → actovia pair')
  })

  test('a table aligns its columns, by what shows, colour or not', () => {
    const colored = makeUi(true)
    const rows = colored.table(
      [
        ['Name', 'Paired'],
        [colored.st.bold('iPhone'), '3 days ago'],
        ['iPad of mine', 'just now']
      ],
      { header: true }
    )
    expect(rows.map(strip)).toEqual(['  Name          Paired', '  iPhone        3 days ago', '  iPad of mine  just now'])
  })

  test('a table can right-align a column and trims the last cell', () => {
    expect(ui.table([['a', '1,000'], ['bbb', '5']], { right: [1] })).toEqual(['  a    1,000', '  bbb      5'])
  })

  test('visible width ignores colour', () => {
    expect(visibleWidth('\x1b[1mabc\x1b[22m')).toBe(3)
  })

  test('colour adds escapes and nothing else', () => {
    const c = makeUi(true)
    for (const [plain, colored] of [
      [ui.done('x'), c.done('x')],
      [ui.warn('x'), c.warn('x')],
      [ui.fail('x'), c.fail('x')],
      [ui.next('x'), c.next('x')],
      [ui.title('x'), c.title('x')]
    ]) {
      expect(colored).not.toBe(plain)
      expect(strip(colored!)).toBe(plain!)
    }
  })
})

describe('ago', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  test('past and future, in the largest unit that fits', () => {
    expect(ago('2026-10-28T11:59:40Z', now)).toBe('just now')
    expect(ago('2026-10-28T11:55:00Z', now)).toBe('5 min ago')
    expect(ago('2026-10-28T09:00:00Z', now)).toBe('3 h ago')
    expect(ago('2026-10-27T10:00:00Z', now)).toBe('yesterday')
    expect(ago('2026-10-20T12:00:00Z', now)).toBe('8 days ago')
    expect(ago(now + 2 * 3_600_000, now)).toBe('in 2 h')
    expect(ago(now + 3 * 86_400_000, now)).toBe('in 3 days')
    expect(ago(null, now)).toBe('never')
  })
})

describe('meter', () => {
  test('a share as cells', () => {
    expect(meter(0.5, 10)).toBe('█████░░░░░')
    expect(meter(0, 4)).toBe('░░░░')
    expect(meter(2, 4)).toBe('████')
  })
})

describe('splitHint', () => {
  test('a command at the end of a message becomes its next step', () => {
    expect(splitHint("Actovia isn't running on this machine (nothing answered at http://127.0.0.1:60223). Open it first: actovia open")).toEqual({
      text: "Actovia isn't running on this machine (nothing answered at http://127.0.0.1:60223).",
      hint: 'actovia open'
    })
    expect(splitHint('No paired device has the id x. List them: actovia devices')).toEqual({
      text: 'No paired device has the id x.',
      hint: 'actovia devices'
    })
  })

  test('a message without one is left whole', () => {
    expect(splitHint('Wrong PIN.')).toEqual({ text: 'Wrong PIN.' })
    expect(splitHint('Settings → General: open it')).toEqual({ text: 'Settings → General: open it' })
  })
})
