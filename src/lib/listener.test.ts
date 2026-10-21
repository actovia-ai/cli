import { describe, expect, test } from 'bun:test'

import { assertListenerIsActovia, listenerExecutables, type Run } from './listener'

const APP = '/Applications/Actovia.app'
const EXE = `${APP}/Contents/MacOS/Actovia`

/** lsof as it answers: pids for the port, then each pid's executable. */
function lsof(byPid: Record<string, string>): Run {
  return async command => {
    if (command.includes('-sTCP:LISTEN')) {
      return { code: 0, stdout: Object.keys(byPid).map(p => `p${p}\n`).join('') }
    }
    const pid = command[command.indexOf('-p') + 1]!
    return { code: 0, stdout: `p${pid}\nfcwd\nn/\nftxt\nn${byPid[pid]}\nftxt\nn/usr/lib/dyld\n` }
  }
}

const darwin = (run: Run) => ({ platform: 'darwin' as const, run, appPath: APP, resolve: async (p: string) => p })

describe('who gets the PIN', () => {
  test('the installed app listening: sent', async () => {
    await assertListenerIsActovia('http://127.0.0.1:60223', darwin(lsof({ '42': EXE })))
  })

  test('a stand-in on the port: refused, naming what it is', async () => {
    const error = await assertListenerIsActovia('http://127.0.0.1:60223', darwin(lsof({ '42': EXE, '43': '/opt/homebrew/bin/python3' }))).catch(e => e)
    expect(error.code).toBe('NOT_ACTOVIA')
    expect(error.message).toContain('/opt/homebrew/bin/python3')
  })

  test('a copy named Actovia.app elsewhere: refused', async () => {
    const error = await assertListenerIsActovia('http://127.0.0.1:60223', darwin(lsof({ '42': '/tmp/x/Actovia.app/Contents/MacOS/Actovia' }))).catch(e => e)
    expect(error.code).toBe('NOT_ACTOVIA')
  })

  test('no listener of ours (another user may hold the port): refused', async () => {
    const error = await assertListenerIsActovia('http://127.0.0.1:60223', darwin(lsof({}))).catch(e => e)
    expect(error.message).toMatch(/isn't running/)
  })

  test('no installed app: refused', async () => {
    const error = await assertListenerIsActovia('http://127.0.0.1:60223', { ...darwin(lsof({ '42': EXE })), appPath: null }).catch(e => e)
    expect(error.code).toBe('NOT_ACTOVIA')
  })

  test('an address off this machine: refused on every platform', async () => {
    for (const url of ['http://10.0.0.2:60223', 'https://127.0.0.1:60223', 'http://example.com']) {
      const error = await assertListenerIsActovia(url, { platform: 'linux' }).catch(e => e)
      expect(error.code).toBe('NOT_ACTOVIA')
    }
    await assertListenerIsActovia('http://localhost:60223', { platform: 'linux' })
    await assertListenerIsActovia('http://[::1]:60223', { platform: 'linux' })
  })

  test('lsof output: one executable per pid, the first txt mapping', async () => {
    expect(await listenerExecutables(60223, lsof({ '7': EXE }))).toEqual([EXE])
  })
})
