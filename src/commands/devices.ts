import type { Command } from 'commander'
import { renderUnicodeCompact } from 'uqr'

import {
  DesktopClient,
  type DevicesState,
  type PairedDevice,
  type PairingWindow
} from '../lib/desktop-client'
import { PinCancelled, promptPin } from '../lib/pin-prompt'
import { reportError } from './report-error'

/**
 * `actovia pair` and `actovia devices`: pairing a phone with the Actovia
 * running on this machine, from a shell — an SSH session to a homelab Mac
 * nobody looks at — instead of its Settings → Devices page. Each command asks
 * for the app-lock PIN once (it buys a short pass to the device routes).
 */

export interface DeviceDeps {
  client?: DesktopClient
  askPin?: () => Promise<string>
  print?: (text: string) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaults = (deps: DeviceDeps) => ({
  client: deps.client ?? new DesktopClient(),
  askPin: deps.askPin ?? (() => promptPin()),
  print: deps.print ?? ((text: string) => console.log(text)),
  sleep: deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms))),
  now: deps.now ?? Date.now
})

/**
 * A device's name as the terminal is to show it: the phone chose it, so any
 * control character — an escape sequence could rewrite the screen, a
 * carriage return could hide a line — is shown as `?`.
 */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '?')
}

/** How often `actovia pair` asks whether the phone has paired. */
export const PAIR_POLL_MS = 1500

/** The QR code for a terminal: light modules as blocks, for a dark background unless `invert`. */
export function qrFor(link: string, invert = false): string {
  return renderUnicodeCompact(link, { border: 2, invert })
}

export type PairOutcome =
  | { status: 'paired'; device: PairedDevice }
  | { status: 'expired' }
  | { status: 'failed' }

export async function runPair(
  opts: { invert?: boolean } = {},
  deps: DeviceDeps = {}
): Promise<PairOutcome> {
  const { client, askPin, print, sleep, now } = defaults(deps)
  let window: PairingWindow | null = null
  // Whatever ends the wait short of a pairing — Ctrl-C, an error, the code
  // running out — closes the window on the computer too: none is left open.
  const close = () => (window ? client.closePairing().catch(() => {}) : Promise.resolve())
  const onInterrupt = () => {
    void close().finally(() => process.exit(130))
  }
  const listens = deps.client === undefined
  if (listens) process.once('SIGINT', onInterrupt)
  try {
    await client.authorize(askPin)
    const before = new Set((await client.devices()).devices.map(d => d.id))
    window = await client.openPairing()
    print(qrFor(window.link, opts.invert))
    print(
      'Scan this with the Actovia app on your iPhone: Settings → Computer → Scan pairing code' +
        ' (or Pair another computer first, if the iPhone is paired with one already).'
    )
    print(`It works once and expires in ${Math.round((window.expiresAt - now()) / 1000)} seconds.\n`)

    while (now() < window.expiresAt) {
      await sleep(PAIR_POLL_MS)
      const state: DevicesState = await client.devices()
      const device = state.devices.find(d => !before.has(d.id))
      if (device) {
        print(`Paired ${printable(device.name)}.`)
        return { status: 'paired', device }
      }
      // Closed on the computer (the Devices page) or used up without a new device.
      if (!state.pairing) break
    }
    await close()
    print('The pairing code expired. Run `actovia pair` for a new one.')
    process.exitCode = 1
    return { status: 'expired' }
  } catch (err) {
    await close()
    if (!(err instanceof PinCancelled)) reportError(err)
    else process.exitCode = 1
    return { status: 'failed' }
  } finally {
    if (listens) process.off('SIGINT', onInterrupt)
  }
}

function when(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString()
}

export async function runDevicesList(
  opts: { json?: boolean } = {},
  deps: DeviceDeps = {}
): Promise<PairedDevice[] | null> {
  const { client, askPin, print } = defaults(deps)
  try {
    await client.authorize(askPin)
    const { devices, revoked = [] } = await client.devices()
    if (opts.json) {
      print(JSON.stringify({ devices, revoked }, null, 2))
      return devices
    }
    if (devices.length === 0) {
      print('No devices are paired. Pair one: actovia pair')
    } else {
      for (const d of devices) {
        print(
          `${printable(d.name)}\n  id ${printable(d.id)} · paired ${when(d.createdAt)} · last seen ${when(d.lastSeenAt)}`
        )
      }
    }
    // A phone revoked here still believes it is paired until it next connects.
    if (revoked.length > 0) {
      print('\nRevoked, not told yet (each learns it the next time it connects):')
      for (const r of revoked) print(`${printable(r.name ?? 'A device')}\n  revoked ${when(r.revokedAt)}`)
    }
    return devices
  } catch (err) {
    if (!(err instanceof PinCancelled)) reportError(err, opts.json)
    else process.exitCode = 1
    return null
  }
}

export async function runDevicesRevoke(id: string, deps: DeviceDeps = {}): Promise<boolean> {
  const { client, askPin, print } = defaults(deps)
  try {
    await client.authorize(askPin)
    const { devices } = await client.devices()
    const device = devices.find(d => d.id === id)
    if (!device) {
      reportError(new Error(`No paired device has the id ${id}. List them: actovia devices`))
      return false
    }
    await client.revoke(id)
    print(`Revoked ${printable(device.name)}. It can no longer reach this computer.`)
    return true
  } catch (err) {
    if (!(err instanceof PinCancelled)) reportError(err)
    else process.exitCode = 1
    return false
  }
}

export function registerDeviceCommands(program: Command): void {
  program
    .command('pair')
    .description('Pair a phone with the Actovia running on this machine (shows a QR code; asks for the app-lock PIN)')
    .option('--invert', 'draw the QR code for a light terminal background')
    .action(async (opts: { invert?: boolean }) => {
      await runPair(opts)
    })

  const devices = program
    .command('devices')
    .description("List the phones paired with this machine's Actovia (asks for the app-lock PIN)")
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runDevicesList(opts)
    })

  devices
    .command('revoke <id>')
    .description('Unpair a device: it can no longer reach this computer')
    .action(async (id: string) => {
      await runDevicesRevoke(id)
    })
}
