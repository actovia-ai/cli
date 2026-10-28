import { afterEach, describe, expect, test } from 'bun:test'

import type { DesktopClient, DevicesState, PairedDevice } from '../lib/desktop-client'
import { DesktopApiError } from '../lib/desktop-client'
import { PinCancelled } from '../lib/pin-prompt'
import { printable, qrFor, runDevicesList, runDevicesRevoke, runPair } from './devices'

const phone: PairedDevice = { id: 'd1', name: 'iPhone', createdAt: '2026-10-21T00:00:00Z', lastSeenAt: null }

function fakeClient(states: DevicesState[], overrides: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = []
  let i = 0
  const client = {
    authorize: async (askPin: () => Promise<string>) => {
      const pin = await askPin()
      calls.push(`authorize ${pin}`)
      return { token: 'P', expiresAt: 0 }
    },
    devices: async () => {
      calls.push('devices')
      return states[Math.min(i++, states.length - 1)]!
    },
    openPairing: async () => {
      calls.push('openPairing')
      return { expiresAt: 120_000, link: 'actovia://pair?h=10.0.0.2&p=63129&c=C&f=F&n=Mini' }
    },
    closePairing: async () => {
      calls.push('closePairing')
    },
    revoke: async (id: string) => {
      calls.push(`revoke ${id}`)
    },
    ...overrides
  } as unknown as DesktopClient
  return { client, calls }
}

const quiet = () => {
  const lines: string[] = []
  return { lines, print: (t: string) => lines.push(t) }
}

afterEach(() => {
  process.exitCode = 0
})

describe('actovia pair', () => {
  test('shows the QR code and waits until a new device appears', async () => {
    const none: DevicesState = { devices: [], pairing: { expiresAt: 120_000, link: 'x' }, lanRunning: true }
    const { client, calls } = fakeClient([none, none, none, { devices: [phone], pairing: null, lanRunning: true }])
    const out = quiet()
    let t = 0
    const outcome = await runPair(
      {},
      { client, askPin: async () => '1234', print: out.print, sleep: async ms => void (t += ms), now: () => t }
    )
    expect(outcome).toEqual({ status: 'paired', device: phone })
    expect(calls.slice(0, 3)).toEqual(['authorize 1234', 'devices', 'openPairing'])
    expect(out.lines[0]).toBe(qrFor('actovia://pair?h=10.0.0.2&p=63129&c=C&f=F&n=Mini'))
    expect(out.lines.at(-1)).toBe('✓ Paired iPhone.')
    expect(out.lines.slice(1)).toContain('  Settings → Computer → Scan pairing code')
    expect(out.lines.slice(1)).toContain('  It works once and expires in 2 min.')
  })

  test('a device paired before does not count; the window running out does', async () => {
    const old = { devices: [phone], pairing: { expiresAt: 120_000, link: 'x' }, lanRunning: true }
    const { client } = fakeClient([old])
    let t = 0
    const out = quiet()
    const outcome = await runPair(
      {},
      { client, askPin: async () => '1', print: out.print, sleep: async ms => void (t += ms), now: () => t }
    )
    expect(outcome).toEqual({ status: 'expired' })
    expect(out.lines.slice(-2)).toEqual(['✗ The pairing code expired.', '  → actovia pair'])
    expect(process.exitCode).toBe(1)
  })

  test('a code that runs out is closed on the computer too', async () => {
    const open = { devices: [], pairing: { expiresAt: 120_000, link: 'x' }, lanRunning: true }
    const { client, calls } = fakeClient([open])
    let t = 0
    await runPair({}, { client, askPin: async () => '1', print: () => {}, sleep: async ms => void (t += ms), now: () => t })
    expect(calls.at(-1)).toBe('closePairing')
  })

  test("a device's name cannot drive the terminal", async () => {
    const evil = { ...phone, name: 'iPhone\u001b[2J\u001b]0;pwned\u0007\r' }
    const { client } = fakeClient([
      { devices: [], pairing: { expiresAt: 120_000, link: 'x' }, lanRunning: true },
      { devices: [evil], pairing: null, lanRunning: true }
    ])
    const out = quiet()
    let t = 0
    await runPair({}, { client, askPin: async () => '1', print: out.print, sleep: async ms => void (t += ms), now: () => t })
    expect(out.lines.at(-1)).toBe('✓ Paired iPhone?[2J?]0;pwned??.')
    expect(printable('a\u202eb')).toBe('a?b')
  })

  test('a wrong PIN opens no window and says so', async () => {
    const { client, calls } = fakeClient([], {
      authorize: async () => {
        throw new DesktopApiError('Wrong PIN.', 401, 'WRONG_PIN')
      }
    })
    const errors: string[] = []
    const original = console.error
    console.error = (m: string) => void errors.push(m)
    const outcome = await runPair({}, { client, askPin: async () => '0', print: () => {} })
    console.error = original
    expect(outcome).toEqual({ status: 'failed' })
    expect(calls).not.toContain('openPairing')
    expect(errors.map(e => e.replace(/\x1b\[[0-9;]*m/g, ''))).toEqual(['✗ Wrong PIN.'])
    expect(process.exitCode).toBe(1)
  })

  test('a failure after the window opened closes it again', async () => {
    let n = 0
    const { client, calls } = fakeClient([], {
      devices: async () => {
        if (n++ === 0) return { devices: [], pairing: null, lanRunning: true }
        throw new DesktopApiError('gone', 0, 'UNREACHABLE')
      }
    })
    const original = console.error
    console.error = () => {}
    await runPair({}, { client, askPin: async () => '1', print: () => {}, sleep: async () => {}, now: () => 0 })
    console.error = original
    expect(calls).toContain('closePairing')
  })

  test('cancelling the PIN prompt does nothing', async () => {
    const { client, calls } = fakeClient([])
    const outcome = await runPair(
      {},
      {
        client,
        askPin: async () => {
          throw new PinCancelled()
        },
        print: () => {}
      }
    )
    expect(outcome).toEqual({ status: 'failed' })
    expect(calls).toEqual([])
  })
})

describe('actovia devices', () => {
  test('lists, as JSON on request', async () => {
    const { client } = fakeClient([{ devices: [phone], pairing: null, lanRunning: true }])
    const out = quiet()
    expect(await runDevicesList({ json: true }, { client, askPin: async () => '1', print: out.print })).toEqual([
      phone
    ])
    expect(JSON.parse(out.lines[0]!)).toEqual({ devices: [phone], revoked: [] })
  })

  test('lists the devices revoked here that have not been told yet', async () => {
    const { client } = fakeClient([
      { devices: [], pairing: null, lanRunning: true, revoked: [{ name: 'Old\u001b[2JiPad', revokedAt: '2026-10-20T00:00:00Z' }] }
    ])
    const out = quiet()
    await runDevicesList({}, { client, askPin: async () => '1', print: out.print })
    expect(out.lines.join('\n')).toMatch(/Revoked, not told yet/)
    expect(out.lines.join('\n')).toMatch(/Old\?\[2JiPad/)
    expect(out.lines.slice(0, 2)).toEqual(['No devices paired yet.', '  → actovia pair'])
  })

  test('a table of the paired devices, then how to unpair one', async () => {
    const now = Date.parse('2026-10-28T00:00:00Z')
    const tablet: PairedDevice = { id: 'd2-long-id', name: 'iPad mini', createdAt: '2026-10-27T00:00:00Z', lastSeenAt: '2026-10-27T23:55:00Z' }
    const { client } = fakeClient([{ devices: [phone, tablet], pairing: null, lanRunning: true }])
    const out = quiet()
    await runDevicesList({}, { client, askPin: async () => '1', print: out.print, now: () => now })
    expect(out.lines).toEqual([
      'Paired devices',
      '',
      '  Name       Paired      Last seen  ID',
      '  iPhone     7 days ago  never      d1',
      '  iPad mini  yesterday   5 min ago  d2-long-id',
      '',
      '  → actovia devices revoke <id>  to unpair one'
    ])
  })

  test('revoke checks the id exists first', async () => {
    const { client, calls } = fakeClient([{ devices: [phone], pairing: null, lanRunning: true }])
    const out = quiet()
    expect(await runDevicesRevoke('d1', { client, askPin: async () => '1', print: out.print })).toBe(true)
    expect(calls).toContain('revoke d1')
    expect(out.lines).toEqual(['✓ Revoked iPhone. It can no longer reach this computer.'])

    const original = console.error
    console.error = () => {}
    expect(await runDevicesRevoke('nope', { client, askPin: async () => '1', print: () => {} })).toBe(false)
    console.error = original
    expect(calls).not.toContain('revoke nope')
  })
})
