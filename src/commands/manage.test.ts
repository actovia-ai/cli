import { afterEach, describe, expect, test } from 'bun:test'

import type { DesktopClient } from '../lib/desktop-client'
import { describeQuota, runBackupList, runLock, runTasks, runUsage } from './manage'

afterEach(() => {
  process.exitCode = 0
})

describe('actovia lock', () => {
  test('a locked app is left alone: no PIN asked (it would unlock it)', async () => {
    const calls: string[] = []
    const client = {
      authorized: false,
      hostStatus: async () => ({ locked: true }),
      authorize: async () => calls.push('authorize'),
      lockNow: async () => calls.push('lockNow')
    } as unknown as DesktopClient
    const printed: string[] = []
    await runLock({ client, askPin: async () => '1', print: t => printed.push(t) })
    expect(calls).toEqual([])
    expect(printed).toEqual(['✓ Actovia is locked already.'])
  })

  test('an unlocked one is locked with a pass', async () => {
    const calls: string[] = []
    const client = {
      authorized: false,
      hostStatus: async () => ({ locked: false }),
      authorize: async (askPin: () => Promise<string>) => calls.push(`authorize ${await askPin()}`),
      lockNow: async () => (calls.push('lockNow'), { locked: true, pinSet: true })
    } as unknown as DesktopClient
    await runLock({ client, askPin: async () => '1234', print: () => {} })
    expect(calls).toEqual(['authorize 1234', 'lockNow'])
  })
})

describe('actovia backup and tasks', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  test('backups: the schedule, then a table of them', async () => {
    const client = {
      authorized: false,
      backups: async () => [{ name: 'actovia-2026-10-28.tar.gz', size: 52.3e6, createdAt: '2026-10-28T07:00:00Z' }],
      backupStatus: async () => ({ autoBackup: true, lastBackupAt: '2026-10-28T07:00:00Z' })
    } as unknown as DesktopClient
    const printed: string[] = []
    await runBackupList({}, { client, print: t => printed.push(t), now: () => now })
    expect(printed).toEqual([
      'Backups',
      '  Automatic  on, daily at 3:00 · last 5 h ago',
      '',
      '  Name                       Size     Made',
      '  actovia-2026-10-28.tar.gz  52.3 MB  5 h ago'
    ])
  })

  test('no backups yet says how to make one', async () => {
    const client = {
      authorized: false,
      backups: async () => [],
      backupStatus: async () => ({ autoBackup: false, lastBackupAt: null })
    } as unknown as DesktopClient
    const printed: string[] = []
    await runBackupList({}, { client, print: t => printed.push(t), now: () => now })
    expect(printed.slice(-2)).toEqual(['  No backups yet.', '  → actovia backup create'])
  })

  test('tasks: upcoming and recurring, each with how its last run went', async () => {
    const client = {
      authorized: false,
      tasks: async () => ({
        upcoming: [{ id: '1', title: 'Budget review', cronExpression: null, runAt: '2026-10-30T12:00:00Z', lastRunAt: null, lastRunStatus: null }],
        recurring: [
          { id: '2', title: 'Daily digest', cronExpression: '0 9 * * *', runAt: null, lastRunAt: '2026-10-28T09:00:00Z', lastRunStatus: 'completed' },
          { id: '3', title: 'Prices', cronExpression: '0 * * * *', runAt: null, lastRunAt: '2026-10-28T11:00:00Z', lastRunStatus: 'failed' }
        ]
      })
    } as unknown as DesktopClient
    const printed: string[] = []
    await runTasks({}, { client, print: t => printed.push(t), now: () => now })
    expect(printed).toEqual([
      'Upcoming',
      '  Budget review  in 2 days',
      '',
      'Recurring',
      '  Daily digest  0 9 * * *  ✓ ran 3 h ago',
      '  Prices        0 * * * *  ✗ failed 1 h ago'
    ])
  })
})

describe('actovia quota', () => {
  test('a line per window; a window past its reset says it was not read since', () => {
    const lines = describeQuota(
      {
        cli: 'claude-code',
        state: 'rejected',
        rejectedWindow: 'seven_day',
        overage: false,
        asOf: 0,
        windows: [
          { name: 'seven_day', usedPercent: 100, resetsAt: 2_000, rejected: true },
          { name: 'seven_day', model: 'opus', usedPercent: 40.4, resetsAt: 500 }
        ]
      },
      1_000
    )
    expect(lines[0]).toStartWith('Claude Code  ✗ limit reached · as of ')
    expect(lines[1]).toMatch(/^ {2}week {13}██████████  100%  stopped · resets /)
    expect(lines[2]).toBe('  opus only: week  ████░░░░░░   40%  reset since (not read again)')
  })
})

describe('actovia usage', () => {
  test('totals the recent days in tokens, and never prints money', async () => {
    const client = {
      authorized: false,
      usage: async () => ({
        totalTokens: 1_250_000,
        totalRequests: 30,
        daily: [
          { date: '2026-09-01', tokens: 1_000_000 },
          { date: '2026-10-20', tokens: 200_000 },
          { date: '2026-10-21', tokens: 50_000 }
        ],
        models: [
          {
            model: 'claude-opus-5-5',
            provider: 'anthropic',
            inputTokens: 900_000,
            outputTokens: 100_000,
            cacheReadTokens: 600_000,
            totalTokens: 1_000_000,
            requests: 20
          }
        ]
      })
    } as unknown as DesktopClient
    const printed: string[] = []
    await runUsage(
      { days: '7' },
      { client, print: t => printed.push(t), now: () => Date.parse('2026-10-21T12:00:00Z') }
    )
    expect(printed.slice(0, 3)).toEqual(['Usage', '  Last 7 days  250,000 tokens', '  All time     1,250,000 tokens · 30 requests'])
    expect(printed).toContain('  2026-10-20  ████████████████████  200,000')
    expect(printed).toContain('  2026-10-21  █████░░░░░░░░░░░░░░░   50,000')
    expect(printed).toContain('  claude-opus-5-5  anthropic  1,000,000 tokens  20 requests')
    expect(printed).toContain('By day')
    expect(printed).toContain('Top models (all time)')
    expect(printed.join('\n')).not.toMatch(/\$|NaN/u)
  })
})

describe('what the app reports', () => {
  test('is shown, never obeyed: control characters in a model name print as ?', () => {
    const lines = describeQuota(
      {
        cli: 'claude\u001b[2J',
        windows: [{ name: 'week', usedPercent: 10, resetsAt: null, model: 'opus‮' }],
        state: 'ok',
        rejectedWindow: null,
        overage: false,
        asOf: 0
      },
      0
    )
    expect(lines.join('\n')).not.toMatch(/[\u001b‮]/u)
    expect(lines[0]).toStartWith('claude?[2J  ✓ ok')
    expect(lines[1]).toStartWith('  opus? only: week')
  })
})
