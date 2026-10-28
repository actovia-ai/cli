import { describe, expect, test } from 'bun:test'

import { runCli, wantsUpdateNotice } from './cli'
import { UPDATE_CHECK_ARG } from './lib/update-notifier'

const ARGV = (...args: string[]) => ['/bin/bun', '/app/dist/index.js', ...args]

function runtime(overrides: Parameters<typeof runCli>[1] = {}) {
  const calls = { parsed: [] as string[][], notices: [] as string[], refreshes: 0, prepared: 0 }
  const deps = {
    parse: async (argv: string[]) => {
      calls.parsed.push(argv)
    },
    prepareNotice: async () => {
      calls.prepared++
      return null
    },
    refreshCache: async () => {
      calls.refreshes++
    },
    writeNotice: (message: string) => {
      calls.notices.push(message)
    },
    ...overrides
  }
  return { calls, deps }
}

describe('wantsUpdateNotice', () => {
  test('stays quiet for the update command, which reports versions itself', () => {
    expect(wantsUpdateNotice(ARGV('update'))).toBe(false)
  })

  test('stays quiet for status and doctor, which show the CLI version themselves', () => {
    expect(wantsUpdateNotice(ARGV('status'))).toBe(false)
    expect(wantsUpdateNotice(ARGV('doctor'))).toBe(false)
  })

  test('stays quiet during a background refresh run', () => {
    expect(wantsUpdateNotice(ARGV(UPDATE_CHECK_ARG))).toBe(false)
  })

  test('applies to ordinary commands', () => {
    expect(wantsUpdateNotice(ARGV('open'))).toBe(true)
    expect(wantsUpdateNotice(ARGV('skills'))).toBe(true)
  })

  test('applies when no command was given at all', () => {
    expect(wantsUpdateNotice(ARGV())).toBe(true)
  })
})

describe('runCli in background refresh mode', () => {
  test('refreshes the cache instead of running a command', async () => {
    const { calls, deps } = runtime()
    await runCli(ARGV(UPDATE_CHECK_ARG), deps)
    expect(calls.refreshes).toBe(1)
    expect(calls.parsed).toEqual([])
  })

  test('prints nothing, because it runs detached behind the user', async () => {
    const { calls, deps } = runtime()
    await runCli(ARGV(UPDATE_CHECK_ARG), deps)
    expect(calls.notices).toEqual([])
  })
})

describe('runCli notice handling', () => {
  test('runs the requested command', async () => {
    const { calls, deps } = runtime()
    const argv = ARGV('open')
    await runCli(argv, deps)
    expect(calls.parsed).toEqual([argv])
  })

  test('prints a pending notice once the command is done', async () => {
    const { calls, deps } = runtime({ prepareNotice: async () => 'Update available: 1.0.0 → 1.1.0' })
    await runCli(ARGV('open'), deps)
    expect(calls.notices).toEqual(['Update available: 1.0.0 → 1.1.0'])
  })

  test('prints the notice after the command output, not before it', async () => {
    const order: string[] = []
    const { deps } = runtime({
      prepareNotice: async () => 'notice',
      parse: async () => {
        order.push('command')
      },
      writeNotice: () => {
        order.push('notice')
      }
    })
    await runCli(ARGV('open'), deps)
    expect(order).toEqual(['command', 'notice'])
  })

  test('prints nothing when no update is pending', async () => {
    const { calls, deps } = runtime()
    await runCli(ARGV('open'), deps)
    expect(calls.notices).toEqual([])
  })

  test('skips the notice entirely for the update command', async () => {
    const { calls, deps } = runtime({ prepareNotice: async () => 'Update available: 1.0.0 → 1.1.0' })
    await runCli(ARGV('update'), deps)
    expect(calls.prepared).toBe(0)
    expect(calls.notices).toEqual([])
  })

  test('still shows the notice when the command itself failed', async () => {
    const { calls, deps } = runtime({
      prepareNotice: async () => 'notice',
      parse: async () => {
        throw new Error('boom')
      }
    })
    await expect(runCli(ARGV('open'), deps)).rejects.toThrow('boom')
    expect(calls.notices).toEqual(['notice'])
  })

  test('a failure while preparing the notice never breaks the command', async () => {
    const { calls, deps } = runtime({
      prepareNotice: async () => {
        throw new Error('cache unreadable')
      }
    })
    await runCli(ARGV('open'), deps)
    expect(calls.parsed.length).toBe(1)
    expect(calls.notices).toEqual([])
  })
})

describe('runCli background refresh timeout', () => {
  test('gives up on a refresh that hangs instead of orphaning the process', async () => {
    let exited = 0
    await runCli(ARGV(UPDATE_CHECK_ARG), {
      refreshCache: () => new Promise<void>(() => {}),
      timeoutMs: 5,
      exit: () => {
        exited++
      }
    })
    expect(exited).toBe(1)
  })

  test('does not kill a refresh that finishes in time', async () => {
    let exited = 0
    await runCli(ARGV(UPDATE_CHECK_ARG), {
      refreshCache: async () => {},
      timeoutMs: 5_000,
      exit: () => {
        exited++
      }
    })
    expect(exited).toBe(0)
  })
})
