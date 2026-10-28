import { afterEach, describe, expect, test } from 'bun:test'

import { DesktopApiError, type DesktopClient, type HostStatus } from '../lib/desktop-client'
import { HOST_ROUTES_SINCE } from '../lib/desktop-app'
import { type Check, diagnose, formatChecks, formatStatus, runDoctor, runStatus, type Snapshot, takeSnapshot } from './status'

const host: HostStatus = {
  version: '2.2.0',
  platform: 'darwin',
  arch: 'arm64',
  startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  dataDir: '/Users/me/.actovia',
  locked: false,
  pinSet: true,
  lan: { running: true, port: 63129 },
  devices: 1,
  secrets: { encryption: 'on', needsReentry: 0 },
  update: { mode: 'manual', state: 'idle', availableVersion: null }
}

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  host,
  hostTooOld: false,
  installed: { path: '/Applications/Actovia.app', version: '2.2.0' },
  latestDesktop: '2.2.0',
  cli: { updateAvailable: false, current: '2.3.0' },
  freeBytes: 50e9,
  hostError: null,
  ...over
})

const clientAnswering = (answer: () => Promise<HostStatus>) => ({ hostStatus: answer }) as unknown as DesktopClient

afterEach(() => {
  process.exitCode = 0
})

describe('takeSnapshot', () => {
  const rest = {
    installed: async () => null,
    latestDesktop: async () => '2.2.0',
    cli: async () => null,
    freeBytes: async () => null
  }

  test('nothing answering is "not running"; an answer it cannot use is an older Actovia', async () => {
    const down = await takeSnapshot({
      ...rest,
      client: clientAnswering(async () => {
        throw new DesktopApiError('x', 0, 'UNREACHABLE')
      })
    })
    expect(down.host).toBeNull()
    expect(down.hostTooOld).toBe(false)
    const old = await takeSnapshot({
      ...rest,
      client: clientAnswering(async () => {
        throw new DesktopApiError('x', 404, 'NOT_FOUND')
      })
    })
    expect(old.hostTooOld).toBe(true)
  })

  test('any other failure is not "too old": it is shown as the failure it is', async () => {
    const s = await takeSnapshot({
      ...rest,
      client: clientAnswering(async () => {
        throw new DesktopApiError('The request to http://127.0.0.1:60223 failed: 502 UNKNOWN_ERROR.', 502, 'UNKNOWN_ERROR')
      })
    })
    expect(s.hostTooOld).toBe(false)
    expect(s.hostError).toBe('The request to http://127.0.0.1:60223 failed: 502 UNKNOWN_ERROR.')
    const checks = diagnose({ ...s, installed: { path: '/Applications/Actovia.app', version: '2.2.0' }, latestDesktop: '2.2.0' })
    expect(checks.find(c => c.name === 'Running')).toMatchObject({
      level: 'fail',
      detail: 'no answer it could use: The request to http://127.0.0.1:60223 failed: 502 UNKNOWN_ERROR.'
    })
    expect(checks.find(c => c.group === 'app' && c.name === 'Version')?.detail).toBe('2.2.0 · up to date')
    expect(formatStatus({ ...s, installed: { path: '/Applications/Actovia.app', version: '2.2.0' } })[0]).toBe(
      '● Actovia 2.2.0  no answer it could use · The request to http://127.0.0.1:60223 failed: 502 UNKNOWN_ERROR.'
    )
  })

  test('a part that fails leaves the others', async () => {
    const s = await takeSnapshot({
      ...rest,
      client: clientAnswering(async () => host),
      latestDesktop: async () => {
        throw new Error('offline')
      }
    })
    expect(s.host).toEqual(host)
    expect(s.latestDesktop).toBeNull()
  })
})

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/
const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '')

describe('actovia status', () => {
  test('a count that is not a number is shown as ?, never printed as it came', () => {
    const evil = '\x1b]52;c;cHduZWQ=\x07' as unknown as number
    const out = formatStatus(
      snapshot({ host: { ...host, devices: evil, lan: { running: true, port: evil }, secrets: { encryption: 'on', needsReentry: evil } } }),
      { color: true }
    ).join('\n')
    expect(out).not.toContain('\x1b]')
    expect(out).not.toContain('\x07')
    expect(strip(out)).toContain('? paired')
    expect(strip(out)).toContain('port ?')
  })

  test('names the version, lock, phones, keys and both updates, labels aligned', () => {
    const lines = formatStatus(
      snapshot({
        latestDesktop: '2.3.0',
        host: { ...host, secrets: { encryption: 'on', needsReentry: 2 } },
        cli: { updateAvailable: true, current: '2.2.0', latest: '2.3.0' }
      })
    )
    expect(lines[0]).toBe('● Actovia 2.2.0  running · unlocked · up 3 h')
    expect(lines).toContain('  Update    2.3.0 is out · actovia app update')
    expect(lines).toContain('  Phones    1 paired · listener on, port 63129')
    expect(lines).toContain('  Keys      encrypted · 2 to enter again in Settings')
    expect(lines).toContain('  App lock  PIN set')
    expect(lines).toContain('  Data      /Users/me/.actovia · 50.0 GB free')
    expect(lines.at(-2)).toBe('')
    expect(lines.at(-1)).toBe('CLI 2.2.0 · 2.3.0 is out · actovia update')
  })

  test('an old build still running after a newer one was installed: said as that, not as a contradiction', () => {
    const lines = formatStatus(
      snapshot({ host: null, hostTooOld: true, installed: { path: '/Applications/Actovia.app', version: HOST_ROUTES_SINCE }, latestDesktop: HOST_ROUTES_SINCE })
    )
    expect(lines[0]).toBe(`● Actovia  running an older build than the installed ${HOST_ROUTES_SINCE} · actovia app restart`)
  })

  test('plain unless asked for colour: no escape anywhere', () => {
    expect(formatStatus(snapshot()).some(l => ANSI.test(l))).toBe(false)
  })

  test('in colour: a state dot, dim labels, green for good, yellow for warnings, red for problems', () => {
    const good = formatStatus(snapshot(), { color: true })
    expect(good[0]).toStartWith('\x1b[32m●\x1b[39m \x1b[1mActovia 2.2.0\x1b[22m')
    expect(good.find(l => strip(l).includes('Keys'))).toContain('\x1b[2mKeys    \x1b[22m  \x1b[32mencrypted\x1b[39m')
    expect(good.at(-1)).toBe('\x1b[2mCLI 2.3.0\x1b[22m')
    // Colour changes nothing but the escapes.
    expect(good.map(strip)).toEqual(formatStatus(snapshot()))

    const locked = formatStatus(
      snapshot({ host: { ...host, locked: true, secrets: { encryption: 'on', needsReentry: 1 } } }),
      { color: true }
    )
    expect(locked[0]).toStartWith('\x1b[33m●')
    expect(locked[0]).toContain('\x1b[33mlocked\x1b[39m')
    expect(locked.find(l => strip(l).includes('Keys'))).toContain('\x1b[33m1 to enter again in Settings\x1b[39m')

    const bad = formatStatus(
      snapshot({ host: { ...host, secrets: { encryption: 'unavailable', needsReentry: 0 }, lan: { running: false, port: 63129 } } }),
      { color: true }
    )
    expect(bad.find(l => strip(l).includes('Keys'))).toContain('\x1b[31mnot encrypted (keychain unavailable)\x1b[39m')
    expect(bad.find(l => strip(l).includes('Phones'))).toContain('\x1b[31mlistener off\x1b[39m')
  })

  test('what the app sends is made printable before it is styled', () => {
    const lines = formatStatus(snapshot({ host: { ...host, version: '2.2.0\x1b[2J' } }), { color: true })
    expect(lines[0]).not.toContain('\x1b[2J')
    expect(lines[0]).toContain('2.2.0?[2J')
  })

  test('not running: the installed version and how to start it', () => {
    expect(formatStatus(snapshot({ host: null }))[0]).toBe('● Actovia 2.2.0  not running · actovia open')
    expect(formatStatus(snapshot({ host: null }), { color: true })[0]).toStartWith('\x1b[31m●')
    expect(formatStatus(snapshot({ host: null, installed: null, latestDesktop: null }))[0]).toBe(
      '● Actovia  not running here'
    )
  })

  const deps = {
    client: clientAnswering(async () => host),
    installed: async () => ({ path: '/Applications/Actovia.app', version: '2.2.0' }),
    latestDesktop: async () => '2.2.0',
    cli: async () => ({ updateAvailable: false as const, current: '2.3.0' }),
    freeBytes: async () => 50e9
  }

  test('--json prints the snapshot as it was, with no spinner and no colour', async () => {
    const out: string[] = []
    const err: string[] = []
    const s = await runStatus(
      { json: true },
      {
        ...deps,
        color: true,
        print: t => out.push(t),
        spinner: { enabled: true, delayMs: 0, stream: { isTTY: true, write: c => err.push(c) } }
      }
    )
    expect(out).toEqual([JSON.stringify(s, null, 2)])
    expect(JSON.parse(out[0]!)).toEqual(snapshot())
    expect(err).toEqual([])
  })

  test('a pipe gets plain lines and no spinner', async () => {
    const out: string[] = []
    const err: string[] = []
    await runStatus(
      {},
      { ...deps, color: false, print: t => out.push(t), spinner: { stream: { isTTY: false, write: c => err.push(c) } } }
    )
    expect(out[0]).toBe('● Actovia 2.2.0  running · unlocked · up 3 h')
    expect(out.some(l => ANSI.test(l))).toBe(false)
    expect(err).toEqual([])
  })
})

describe('actovia doctor', () => {
  const find = (checks: Check[], group: string, name: string) => checks.find(c => c.group === group && c.name === name)

  test('all well is all ticks', () => {
    expect(diagnose(snapshot()).every(c => c.level === 'ok')).toBe(true)
  })

  test('checks come in groups, in a fixed order', () => {
    const groups = diagnose(snapshot()).map(c => c.group)
    expect([...new Set(groups)]).toEqual(['app', 'security', 'phones', 'computer', 'cli'])
  })

  test('says what is wrong and how to fix it', () => {
    const checks = diagnose(
      snapshot({
        host: {
          ...host,
          version: '2.1.9',
          pinSet: false,
          lan: { running: false, port: 63129 },
          secrets: { encryption: 'unavailable', needsReentry: 1 }
        },
        latestDesktop: '2.2.0',
        freeBytes: 1e9
      })
    )
    expect(find(checks, 'app', 'Version')).toMatchObject({ level: 'warn', detail: '2.1.9 · 2.2.0 is out', fix: 'actovia app update' })
    expect(find(checks, 'app', 'Running')).toMatchObject({ level: 'warn', fix: 'actovia app restart' })
    expect(find(checks, 'app', 'Running')?.detail).toContain('not the installed 2.2.0')
    expect(find(checks, 'security', 'App lock')?.level).toBe('warn')
    expect(find(checks, 'security', 'Keys')?.level).toBe('fail')
    expect(find(checks, 'phones', 'Paired')).toMatchObject({ level: 'fail', fix: 'actovia app restart' })
    expect(find(checks, 'computer', 'Disk')).toMatchObject({ level: 'warn', detail: '1.0 GB free for /Users/me/.actovia' })
  })

  test('an app too old to report and out of date is one check with one fix', () => {
    const checks = diagnose(
      snapshot({
        host: null,
        hostTooOld: true,
        installed: { path: '/Applications/Actovia.app', version: '2.1.0' },
        latestDesktop: '2.4.0',
        cli: { updateAvailable: true, current: '2.3.1', latest: '2.4.0' }
      })
    )
    expect(checks.filter(c => c.fix === 'actovia app update')).toHaveLength(1)
    expect(find(checks, 'app', 'Version')?.detail).toBe(`2.1.0 · 2.4.0 is out; the CLI needs ${HOST_ROUTES_SINCE} or later to read it`)
    expect(find(checks, 'app', 'Running')).toMatchObject({ level: 'ok' })
    expect(find(checks, 'cli', 'Version')).toMatchObject({ level: 'warn', detail: '2.3.1 · 2.4.0 is out', fix: 'actovia update' })
  })

  test('an old build still running after a newer one was installed is said as that, not as a contradiction', () => {
    const base = { host: null, hostTooOld: true, installed: { path: '/Applications/Actovia.app', version: HOST_ROUTES_SINCE } }
    const stale = diagnose(snapshot({ ...base, latestDesktop: '9.0.0' }))
    expect(find(stale, 'app', 'Version')?.detail).toBe(`${HOST_ROUTES_SINCE} · 9.0.0 is out`)
    expect(find(stale, 'app', 'Running')).toEqual({
      level: 'warn',
      group: 'app',
      name: 'Running',
      detail: `an Actovia older than the installed ${HOST_ROUTES_SINCE} · the update restarts it`
    })
    const current = diagnose(snapshot({ ...base, latestDesktop: HOST_ROUTES_SINCE }))
    expect(find(current, 'app', 'Version')?.level).toBe('ok')
    expect(find(current, 'app', 'Running')).toMatchObject({ level: 'warn', fix: 'actovia app restart' })
    expect(formatChecks(current)).toContain('Security and phones are checked once the CLI can read the app.')
  })

  test('not running is a failure with its fix, and nothing is said about what it cannot see', () => {
    const checks = diagnose(snapshot({ host: null }))
    expect(find(checks, 'app', 'Running')).toMatchObject({ level: 'fail', fix: 'actovia open' })
    expect(checks.some(c => c.group === 'security' || c.group === 'phones')).toBe(false)
  })

  test('the report: a title, groups, names aligned, the fix under its value, a summary', () => {
    const lines = formatChecks(
      diagnose(
        snapshot({
          host: null,
          hostTooOld: true,
          installed: { path: '/Applications/Actovia.app', version: '2.1.0' },
          latestDesktop: '2.4.0',
          cli: { updateAvailable: true, current: '2.3.1', latest: '2.4.0' }
        })
      )
    )
    expect(lines).toEqual([
      'Actovia doctor',
      '',
      'App',
      '  ✓ Installed  /Applications/Actovia.app',
      `  ! Version    2.1.0 · 2.4.0 is out; the CLI needs ${HOST_ROUTES_SINCE} or later to read it`,
      '               → actovia app update',
      `  ✓ Running    yes · its state needs ${HOST_ROUTES_SINCE} or later`,
      '',
      'This computer',
      '  ✓ Disk       50.0 GB free for ~/.actovia',
      '',
      'CLI',
      '  ! Version    2.3.1 · 2.4.0 is out',
      '               → actovia update',
      '',
      'Security and phones are checked once the CLI can read the app.',
      '',
      '2 to look at · 3 fine',
      'Start with: actovia app update'
    ])
  })

  test('the summary puts a failure first and says when all is well', () => {
    const failing = formatChecks(diagnose(snapshot({ host: null, latestDesktop: '2.3.0' })))
    expect(failing.at(-2)).toBe('1 to fix · 1 to look at · 3 fine')
    expect(failing.at(-1)).toBe('Start with: actovia open')
    expect(formatChecks(diagnose(snapshot())).at(-1)).toBe('All 8 checks pass.')
  })

  test('colour only adds escapes; text from the app is made printable', () => {
    const checks = diagnose(snapshot({ host: null, latestDesktop: '2.3.0' }))
    const colored = formatChecks(checks, { color: true })
    expect(colored.some(l => ANSI.test(l))).toBe(true)
    expect(colored.map(strip)).toEqual(formatChecks(checks))
    const evil = formatChecks(diagnose(snapshot({ installed: { path: '/A\x1b]52;c;x\x07pp', version: '2.2.0' } })), { color: true }).join('\n')
    expect(evil).not.toContain('\x1b]')
  })

  test('exits 1 when something fails', async () => {
    await runDoctor(
      {},
      {
        print: () => {},
        client: clientAnswering(async () => {
          throw new DesktopApiError('x', 0, 'UNREACHABLE')
        }),
        installed: async () => null,
        latestDesktop: async () => null,
        cli: async () => null,
        freeBytes: async () => null
      }
    )
    expect(process.exitCode).toBe(1)
  })
})
