import { statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Command } from 'commander'

import { appVersion, findInstalledApp, HOST_ROUTES_SINCE, latestDesktopRelease, versionOf } from '../lib/desktop-app'
import { DesktopApiError, DesktopClient, type HostStatus } from '../lib/desktop-client'
import { checkForUpdate, getCurrentVersion, isNewerVersion, type UpdateCheckResult } from '../lib/updater'
import { type SpinnerOptions, withSpinner } from '../lib/spinner'
import { colorEnabled, makeStyle } from '../lib/style'
import { printable } from './devices'

/**
 * `actovia status` and `actovia doctor`: the desktop app on this machine at a
 * glance, and what is wrong with it — for a computer reached only over SSH.
 * Neither asks for the PIN: the status route answers while the app is locked.
 */

export interface Snapshot {
  /** The running app's own answer; null when nothing answered. */
  host: HostStatus | null
  /** Something answered, but it is an Actovia older than the status route. */
  hostTooOld: boolean
  installed: { path: string; version: string | null } | null
  latestDesktop: string | null
  cli: UpdateCheckResult | null
  /** Free bytes on the data directory's volume. */
  freeBytes: number | null
}

export interface SnapshotDeps {
  client?: DesktopClient
  installed?: () => Promise<Snapshot['installed']>
  latestDesktop?: () => Promise<string | null>
  cli?: () => Promise<UpdateCheckResult | null>
  freeBytes?: (dir: string) => Promise<number | null>
}

async function localInstall(): Promise<Snapshot['installed']> {
  if (process.platform !== 'darwin') return null
  const path = await findInstalledApp()
  return path ? { path, version: await appVersion(path) } : null
}

async function freeOn(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

/** Everything the two commands show, each part read on its own: one failing leaves the rest. */
export async function takeSnapshot(deps: SnapshotDeps = {}): Promise<Snapshot> {
  const client = deps.client ?? new DesktopClient()
  const [hostResult, installed, latestDesktop, cli] = await Promise.all([
    client.hostStatus().then(
      host => ({ host, tooOld: false }),
      (err: unknown) => ({
        host: null,
        tooOld: err instanceof DesktopApiError && err.code !== 'UNREACHABLE'
      })
    ),
    (deps.installed ?? localInstall)().catch(() => null),
    (deps.latestDesktop ?? (async () => versionOf(await latestDesktopRelease())))().catch(() => null),
    (deps.cli ?? checkForUpdate)().catch(() => null)
  ])
  const dataDir = hostResult.host?.dataDir ?? join(homedir(), '.actovia')
  const freeBytes = await (deps.freeBytes ?? freeOn)(dataDir)
  return { host: hostResult.host, hostTooOld: hostResult.tooOld, installed, latestDesktop, cli, freeBytes }
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

function since(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} days`
}

/** The desktop version this machine has: the running app's, else the installed one's. */
function desktopVersion(s: Snapshot): string | null {
  return s.host?.version ?? s.installed?.version ?? null
}

export interface FormatOptions {
  /** ANSI colour and weight; off gives the same text, plain. */
  color?: boolean
}

/** The data directory as a person writes it: `~/.actovia` under the home folder. */
function tildePath(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function formatStatus(s: Snapshot, opts: FormatOptions = {}): string[] {
  const st = makeStyle(opts.color ?? false)
  // Versions and paths come from the app and from GitHub: shown, never obeyed —
  // so each is made printable before any escape of ours is put round it.
  const p = printable
  // Counts are typed as numbers but the JSON is not checked, so a count that
  // is not one is shown as "?", never printed as it came.
  const n = (v: unknown) => (Number.isFinite(v) ? String(v) : '?')
  const lines: string[] = []
  const version = desktopVersion(s)
  const name = st.bold(`Actovia${version ? ` ${p(version)}` : ''}`)

  if (s.host) {
    const h = s.host
    const state = h.locked ? st.yellow('locked') : st.green('unlocked')
    const dot = h.locked ? st.yellow('●') : st.green('●')
    lines.push(`${dot} ${name}  ${st.green('running')} ${st.dim('·')} ${state} ${st.dim(`· up ${since(h.startedAt)}`)}`)
  } else if (s.hostTooOld) {
    lines.push(`${st.yellow('●')} ${name}  ${st.yellow('running')} ${st.dim(`· update it to ${HOST_ROUTES_SINCE} or later for its status`)}`)
  } else if (s.installed) {
    lines.push(`${st.red('●')} ${name}  ${st.red('not running')} ${st.dim('· actovia open')}`)
  } else {
    lines.push(`${st.red('●')} ${name}  ${st.red('not running here')}`)
  }

  const rows: [label: string, value: string][] = []
  if (version && s.latestDesktop && isNewerVersion(version, s.latestDesktop)) {
    rows.push(['Update', `${st.yellow(`${p(s.latestDesktop)} is out`)} ${st.dim('· actovia app update')}`])
  }
  if (s.host) {
    const h = s.host
    const listener = h.lan.running ? `listener on, port ${n(h.lan.port)}` : 'listener off'
    const listenerBad = h.devices > 0 && !h.lan.running
    rows.push(['Phones', `${n(h.devices)} paired ${st.dim('·')} ${listenerBad ? st.red(listener) : listener}`])
    const keys = h.secrets.encryption === 'on' ? st.green('encrypted') : st.red('not encrypted (keychain unavailable)')
    rows.push([
      'Keys',
      keys + (h.secrets.needsReentry > 0 ? ` ${st.dim('·')} ${st.yellow(`${n(h.secrets.needsReentry)} to enter again in Settings`)}` : '')
    ])
    rows.push(['App lock', h.pinSet ? st.green('PIN set') : st.yellow('no PIN (pair, devices and lock need one)')])
    const free = s.freeBytes === null ? '' : ` ${st.dim('·')} ${s.freeBytes < 2e9 ? st.yellow(`${gb(s.freeBytes)} free`) : `${gb(s.freeBytes)} free`}`
    rows.push(['Data', `${p(tildePath(h.dataDir))}${free}`])
  }
  const width = Math.max(0, ...rows.map(([label]) => label.length))
  for (const [label, value] of rows) lines.push(`  ${st.dim(label.padEnd(width))}  ${value}`)

  const cli = s.cli
    ? s.cli.updateAvailable
      ? `${st.dim(`CLI ${p(s.cli.current)} ·`)} ${st.yellow(`${p(s.cli.latest)} is out`)} ${st.dim('· actovia update')}`
      : st.dim(`CLI ${p(s.cli.current)}`)
    : st.dim(`CLI ${getCurrentVersion()}`)
  lines.push('', cli)
  return lines
}

export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface Check {
  level: CheckLevel
  label: string
  /** What to do about it. */
  fix?: string
}

/** What `actovia doctor` checks, in order, from one snapshot. */
export function diagnose(s: Snapshot): Check[] {
  const checks: Check[] = []
  const version = desktopVersion(s)

  if (process.platform === 'darwin' || s.installed) {
    checks.push(
      s.installed
        ? { level: 'ok', label: `Installed: ${s.installed.path}${s.installed.version ? ` (${s.installed.version})` : ''}` }
        : { level: 'fail', label: 'Actovia is not installed in /Applications', fix: 'https://actovia.yancey.app' }
    )
  }

  if (s.host) checks.push({ level: 'ok', label: `Running: Actovia ${s.host.version}` })
  else if (s.hostTooOld)
    checks.push({
      level: 'warn',
      label: `Running, but older than ${HOST_ROUTES_SINCE}: the CLI cannot read its status`,
      fix: 'actovia app update'
    })
  else checks.push({ level: 'fail', label: 'Actovia is not running', fix: 'actovia open' })

  if (version && s.latestDesktop) {
    checks.push(
      isNewerVersion(version, s.latestDesktop)
        ? { level: 'warn', label: `Actovia ${s.latestDesktop} is out (this is ${version})`, fix: 'actovia app update' }
        : { level: 'ok', label: 'Actovia is up to date' }
    )
  }
  if (s.installed?.version && s.host && s.installed.version !== s.host.version) {
    checks.push({
      level: 'warn',
      label: `The running app (${s.host.version}) is not the installed one (${s.installed.version})`,
      fix: 'actovia app restart'
    })
  }

  if (s.host) {
    const h = s.host
    checks.push(
      h.pinSet
        ? { level: 'ok', label: 'App-lock PIN is set' }
        : {
            level: 'warn',
            label: 'No app-lock PIN: pair, devices, lock, quit and restart need one',
            fix: 'Settings → General → Lock & Privacy'
          }
    )
    checks.push(
      h.secrets.encryption === 'on'
        ? { level: 'ok', label: 'Keys are encrypted at rest' }
        : { level: 'fail', label: 'The keychain is unavailable: keys are not encrypted', fix: 'Open Actovia on the screen once and allow its keychain access' }
    )
    if (h.secrets.needsReentry > 0) {
      checks.push({
        level: 'warn',
        label: `${h.secrets.needsReentry} key${h.secrets.needsReentry === 1 ? '' : 's'} to enter again (the app reads them as unset)`,
        fix: 'Settings on the phone or the computer'
      })
    }
    if (h.devices > 0 && !h.lan.running) {
      checks.push({ level: 'fail', label: `${h.devices} phone(s) paired but the network listener is off`, fix: 'actovia app restart' })
    } else {
      checks.push({
        level: 'ok',
        label: h.devices > 0 ? `${h.devices} phone(s) paired, network listener on` : 'No phones paired (actovia pair)'
      })
    }
    if (h.update.state === 'error') {
      checks.push({ level: 'warn', label: "The app's own update check failed", fix: 'actovia app check' })
    }
  }

  if (s.freeBytes !== null) {
    checks.push(
      s.freeBytes < 2e9
        ? { level: 'warn', label: `Only ${gb(s.freeBytes)} free for the data directory` }
        : { level: 'ok', label: `${gb(s.freeBytes)} free for the data directory` }
    )
  }

  if (s.cli) {
    checks.push(
      s.cli.updateAvailable
        ? { level: 'warn', label: `CLI ${s.cli.latest} is out (this is ${s.cli.current})`, fix: 'actovia update' }
        : { level: 'ok', label: 'The CLI is up to date' }
    )
  }
  return checks
}

const MARK: Record<CheckLevel, string> = { ok: '✓', warn: '!', fail: '✗' }

export function formatChecks(checks: Check[]): string[] {
  return checks.map(c => `${MARK[c.level]} ${printable(c.label)}${c.fix ? `\n    → ${printable(c.fix)}` : ''}`)
}

export interface OutputDeps extends SnapshotDeps {
  print?: (text: string) => void
  /** Colour for the status lines; defaults to whether stdout is a terminal that wants it. */
  color?: boolean
  /** The loading spinner; JSON output never gets one. */
  spinner?: SpinnerOptions
}

function spinnerFor(opts: { json?: boolean }, deps: OutputDeps): SpinnerOptions {
  return opts.json ? { ...deps.spinner, enabled: false } : (deps.spinner ?? {})
}

export async function runStatus(opts: { json?: boolean } = {}, deps: OutputDeps = {}): Promise<Snapshot> {
  const print = deps.print ?? ((text: string) => console.log(text))
  const s = await withSpinner('Checking Actovia…', () => takeSnapshot(deps), spinnerFor(opts, deps))
  if (opts.json) print(JSON.stringify(s, null, 2))
  else for (const line of formatStatus(s, { color: deps.color ?? colorEnabled(process.stdout) })) print(line)
  return s
}

export async function runDoctor(opts: { json?: boolean } = {}, deps: OutputDeps = {}): Promise<Check[]> {
  const print = deps.print ?? ((text: string) => console.log(text))
  const checks = diagnose(await withSpinner('Checking Actovia…', () => takeSnapshot(deps), spinnerFor(opts, deps)))
  if (opts.json) print(JSON.stringify(checks, null, 2))
  else for (const line of formatChecks(checks)) print(line)
  if (checks.some(c => c.level === 'fail')) process.exitCode = 1
  return checks
}

export function registerStatusCommands(program: Command): void {
  program
    .command('status')
    .description("The desktop app on this machine at a glance: version, lock, phones, keys, updates")
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runStatus(opts)
    })

  program
    .command('doctor')
    .description('Check the desktop app and the CLI on this machine, and say how to fix what is wrong')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runDoctor(opts)
    })
}
