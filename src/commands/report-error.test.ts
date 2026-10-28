import { afterEach, describe, expect, test } from 'bun:test'

import { formatError, reportError } from './report-error'

afterEach(() => {
  process.exitCode = 0
})

describe('reportError', () => {
  test('a failure mark, the message, and its command as the next step', () => {
    expect(formatError(new Error('No paired device has the id x. List them: actovia devices'))).toEqual([
      '✗ No paired device has the id x.',
      '  → actovia devices'
    ])
    expect(formatError('Wrong PIN.')).toEqual(['✗ Wrong PIN.'])
  })

  test('the same text in colour, escapes aside', () => {
    const colored = formatError(new Error('Wrong PIN.'), true)
    expect(colored[0]).toContain('\x1b[31m')
    expect(colored.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))).toEqual(['✗ Wrong PIN.'])
  })

  test('JSON stays a machine-readable object, and the exit code is 1 either way', () => {
    const lines: string[] = []
    reportError(new Error('Wrong PIN.'), true, { out: t => lines.push(t), err: t => lines.push(`err:${t}`) })
    expect(lines).toEqual([JSON.stringify({ error: 'command_failed', message: 'Wrong PIN.' })])
    expect(process.exitCode).toBe(1)
    const errs: string[] = []
    reportError(new Error('Wrong PIN.'), false, { out: () => {}, err: t => errs.push(t), color: false })
    expect(errs).toEqual(['✗ Wrong PIN.'])
  })
})
