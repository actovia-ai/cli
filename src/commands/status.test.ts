import { afterEach, describe, expect, test } from 'bun:test'

import { DesktopApiError, type DesktopClient, type HostStatus } from '../lib/desktop-client'
import { diagnose, formatStatus, runDoctor, type Snapshot, takeSnapshot } from './status'

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

describe('actovia status', () => {
  test('names the version, lock, phones, keys and both updates', () => {
    const lines = formatStatus(
      snapshot({
        latestDesktop: '2.3.0',
        host: { ...host, secrets: { encryption: 'on', needsReentry: 2 } },
        cli: { updateAvailable: true, current: '2.2.0', latest: '2.3.0' }
      })
    )
    expect(lines[0]).toMatch(/^Actovia 2\.2\.0 — running for 3 h, unlocked$/)
    expect(lines).toContain('  Update: 2.3.0 is out (actovia app update)')
    expect(lines).toContain('  Phones: 1 paired · network listener on (port 63129)')
    expect(lines).toContain('  Keys: encrypted · 2 to enter again in Settings')
    expect(lines.at(-1)).toBe('CLI 2.2.0 — 2.3.0 is out (actovia update)')
  })

  test('not running: the installed version and how to start it', () => {
    expect(formatStatus(snapshot({ host: null }))[0]).toBe('Actovia 2.2.0 — not running (actovia open)')
  })
})

describe('actovia doctor', () => {
  test('all well is all ticks', () => {
    expect(diagnose(snapshot()).every(c => c.level === 'ok')).toBe(true)
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
    const by = (text: RegExp) => checks.find(c => text.test(c.label))
    expect(by(/2\.2\.0 is out/)).toMatchObject({ level: 'warn', fix: 'actovia app update' })
    expect(by(/not the installed one/)).toMatchObject({ fix: 'actovia app restart' })
    expect(by(/No app-lock PIN/)?.level).toBe('warn')
    expect(by(/keychain is unavailable/)?.level).toBe('fail')
    expect(by(/network listener is off/)?.level).toBe('fail')
    expect(by(/Only 1\.0 GB/)?.level).toBe('warn')
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
