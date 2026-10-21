import { afterEach, describe, expect, test } from 'bun:test'

import type { DesktopClient, LogEntry } from '../lib/desktop-client'
import { formatEntry, runLogs } from './logs'

const entry = (t: string, body: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: t,
  severityText: 'WARN',
  body,
  scope: { name: 'kernel' },
  attributes: {},
  ...extra
})

afterEach(() => {
  process.exitCode = 0
})

describe('actovia logs', () => {
  test('a line per entry, its stack indented, control characters shown not obeyed', () => {
    const text = formatEntry(
      entry('2026-10-21T01:00:00Z', 'bad \u001b[2Jthing', {
        traceId: 'abcdef1234',
        attributes: { 'exception.stacktrace': 'Error: x\n  at f (src/a.ts:1:2)' }
      })
    )
    expect(text).toContain('WARN  kernel  bad ?[2Jthing  trace:abcdef12')
    expect(text).toContain('\n    Error: x\n      at f (src/a.ts:1:2)')
  })

  test('prints oldest first, then only what is new while following', async () => {
    const pages = [
      [entry('T2', 'two'), entry('T1', 'one')],
      [entry('T3', 'three'), entry('T2', 'two'), entry('T1', 'one')]
    ]
    let reads = 0
    const client = {
      authorized: false,
      logs: async () => ({ entries: [...pages[Math.min(reads++, 1)]!], total: 0 })
    } as unknown as DesktopClient
    const printed: string[] = []
    let rounds = 0
    await runLogs(
      { follow: true },
      { client, print: t => printed.push(t), sleep: async () => {}, keepFollowing: () => rounds++ < 1 }
    )
    expect(printed.map(p => p.split('kernel  ')[1])).toEqual(['one', 'two', 'three'])
  })

  test('refuses a level it does not know', async () => {
    const printed: string[] = []
    await runLogs({ level: 'loud' }, { client: {} as DesktopClient, print: t => printed.push(t) })
    expect(process.exitCode).toBe(1)
  })
})
