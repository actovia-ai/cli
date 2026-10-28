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
  /** Something answered, but it is an Actovia older than the status route (a 404). */
  hostTooOld: boolean
  /** The request failed some other way: what went wrong, as said. Never read as "too old". */
  hostError: string | null
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
      host => ({ host, tooOld: false, error: null }),
      (err: unknown) => {
        const answered = err instanceof DesktopApiError && err.code !== 'UNREACHABLE'
        // Only a missing route means an older Actovia; anything else is a
        // failure to show as it is.
        const tooOld = answered && err.status === 404
        return { host: null, tooOld, error: answered && !tooOld ? err.message : null }
      }
    ),
    (deps.installed ?? localInstall)().catch(() => null),
    (deps.latestDesktop ?? (async () => versionOf(await latestDesktopRelease())))().catch(() => null),
    (deps.cli ?? checkForUpdate)().catch(() => null)
  ])
  const dataDir = hostResult.host?.dataDir ?? join(homedir(), '.actovia')
  const freeBytes = await (deps.freeBytes ?? freeOn)(dataDir)
  return { host: hostResult.host, hostTooOld: hostResult.tooOld, hostError: hostResult.error, installed, latestDesktop, cli, freeBytes }
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

function since(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} days`
}

/**
 * Too old to answer, yet the installed app is new enough: what runs is an
 * older build that was never restarted after an update.
 */
function staleProcess(s: Snapshot): boolean {
  return Boolean(s.hostTooOld && s.installed?.version && !isNewerVersion(s.installed.version, HOST_ROUTES_SINCE))
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
  } else if (s.hostError) {
    lines.push(`${st.red('●')} ${name}  ${st.red('no answer it could use')} ${st.dim(`· ${p(s.hostError)}`)}`)
  } else if (staleProcess(s)) {
    lines.push(
      `${st.yellow('●')} ${st.bold('Actovia')}  ${st.yellow(`running an older build than the installed ${p(s.installed?.version ?? '')}`)} ${st.dim('·')} ${st.cyan('actovia app restart')}`
    )
  } else if (s.hostTooOld) {
    lines.push(`${st.yellow('●')} ${name}  ${st.yellow('running')} ${st.dim(`· update it to ${HOST_ROUTES_SINCE} or later for its status`)}`)
  } else if (s.installed) {
    lines.push(`${st.red('●')} ${name}  ${st.red('not running')} ${st.dim('·')} ${st.cyan('actovia open')}`)
  } else {
    lines.push(`${st.red('●')} ${name}  ${st.red('not running here')}`)
  }

  const rows: [label: string, value: string][] = []
  if (version && s.latestDesktop && isNewerVersion(version, s.latestDesktop)) {
    rows.push(['Update', `${st.yellow(`${p(s.latestDesktop)} is out`)} ${st.dim('·')} ${st.cyan('actovia app update')}`])
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
      ? `${st.dim(`CLI ${p(s.cli.current)} ·`)} ${st.yellow(`${p(s.cli.latest)} is out`)} ${st.dim('·')} ${st.cyan('actovia update')}`
      : st.dim(`CLI ${p(s.cli.current)}`)
    : st.dim(`CLI ${getCurrentVersion()}`)
  lines.push('', cli)
  return lines
}

export type CheckLevel = 'ok' | 'warn' | 'fail'

/** The sections of the report, in the order they are printed. */
export const CHECK_GROUPS = ['app', 'security', 'phones', 'computer', 'cli'] as const
export type CheckGroup = (typeof CHECK_GROUPS)[number]

const GROUP_TITLES: Record<CheckGroup, string> = {
  app: 'App',
  security: 'Security',
  phones: 'Phones',
  computer: 'This computer',
  cli: 'CLI'
}

export interface Check {
  level: CheckLevel
  group: CheckGroup
  /** A short name, the report's left column: "Version", "Keys". */
  name: string
  /** What was found. */
  detail: string
  /** What to do about it: a command, or where to go. */
  fix?: string
}

/**
 * What `actovia doctor` checks, from one snapshot. One thing wrong is one
 * check with one fix — an app that is both out of date and too old for the
 * status route is the Version check alone.
 */
export function diagnose(s: Snapshot): Check[] {
  const checks: Check[] = []
  const add = (group: CheckGroup, level: CheckLevel, name: string, detail: string, fix?: string) =>
    checks.push(fix ? { level, group, name, detail, fix } : { level, group, name, detail })
  const n = (v: unknown) => (Number.isFinite(v) ? String(v) : '?')
  const version = desktopVersion(s)
  const h = s.host

  if (process.platform === 'darwin' || s.installed) {
    if (s.installed) add('app', 'ok', 'Installed', s.installed.path)
    else add('app', 'fail', 'Installed', 'not in /Applications', 'https://actovia.yancey.app')
  }

  const stale = staleProcess(s)
  const outOfDate = Boolean(version && s.latestDesktop && isNewerVersion(version, s.latestDesktop))
  if (version || s.hostTooOld) {
    const parts = [version ?? `older than ${HOST_ROUTES_SINCE}`]
    if (outOfDate) parts.push(`${s.latestDesktop} is out`)
    else if (version && s.latestDesktop) parts.push('up to date')
    let detail = parts.join(' · ')
    if (s.hostTooOld && !stale && version) detail += `; the CLI needs ${HOST_ROUTES_SINCE} or later to read it`
    if (outOfDate || (s.hostTooOld && !stale)) add('app', 'warn', 'Version', detail, 'actovia app update')
    else add('app', 'ok', 'Version', detail)
  }

  if (h) {
    const state = `${h.locked ? 'locked' : 'unlocked'} · up ${since(h.startedAt)}`
    if (s.installed?.version && s.installed.version !== h.version) {
      add('app', 'warn', 'Running', `${h.version}, not the installed ${s.installed.version}`, 'actovia app restart')
    } else add('app', 'ok', 'Running', state)
    if (h.update.state === 'error') add('app', 'warn', 'Updater', "the app's own update check failed", 'actovia app check')
  } else if (s.hostError) {
    add('app', 'fail', 'Running', `no answer it could use: ${s.hostError}`)
  } else if (stale) {
    const detail = `an Actovia older than the installed ${s.installed?.version}`
    if (outOfDate) add('app', 'warn', 'Running', `${detail} · the update restarts it`)
    else add('app', 'warn', 'Running', detail, 'actovia app restart')
  } else if (s.hostTooOld) {
    add('app', 'ok', 'Running', `yes · its state needs ${HOST_ROUTES_SINCE} or later`)
  } else {
    add('app', 'fail', 'Running', 'no', s.installed || process.platform !== 'darwin' ? 'actovia open' : undefined)
  }

  if (h) {
    if (h.pinSet) add('security', 'ok', 'App lock', 'PIN set')
    else add('security', 'warn', 'App lock', 'no PIN · pair, devices, lock, quit and restart need one', 'Settings → General → Lock & Privacy')

    const reentry = h.secrets.needsReentry > 0 ? ` · ${n(h.secrets.needsReentry)} to enter again` : ''
    if (h.secrets.encryption !== 'on') {
      add('security', 'fail', 'Keys', `not encrypted · the keychain is unavailable${reentry}`, 'Open Actovia on the screen once and allow its keychain access')
    } else if (reentry) {
      add('security', 'warn', 'Keys', `encrypted${reentry} (read as unset until then)`, 'Settings on the phone or the computer')
    } else add('security', 'ok', 'Keys', 'encrypted at rest')

    if (h.devices > 0 && !h.lan.running) add('phones', 'fail', 'Paired', `${n(h.devices)} · the network listener is off`, 'actovia app restart')
    else if (h.devices > 0) add('phones', 'ok', 'Paired', `${n(h.devices)} · listener on, port ${n(h.lan.port)}`)
    else add('phones', 'ok', 'Paired', 'none yet · actovia pair')
  }

  if (s.freeBytes !== null) {
    const detail = `${gb(s.freeBytes)} free for ${tildePath(h?.dataDir ?? join(homedir(), '.actovia'))}`
    add('computer', s.freeBytes < 2e9 ? 'warn' : 'ok', 'Disk', detail)
  }

  if (s.cli) {
    if (s.cli.updateAvailable) add('cli', 'warn', 'Version', `${s.cli.current} · ${s.cli.latest} is out`, 'actovia update')
    else add('cli', 'ok', 'Version', `${s.cli.current} · up to date`)
  }
  return checks.sort((a, b) => CHECK_GROUPS.indexOf(a.group) - CHECK_GROUPS.indexOf(b.group))
}

/** The report: a title, one section per group, the fix under what it fixes, a summary. */
export function formatChecks(checks: Check[], opts: FormatOptions = {}): string[] {
  const st = makeStyle(opts.color ?? false)
  // Paths and versions come from the app and from GitHub: shown, never obeyed.
  const p = printable
  const mark: Record<CheckLevel, string> = { ok: st.green('✓'), warn: st.yellow('!'), fail: st.red('✗') }
  const width = Math.max(0, ...checks.map(c => c.name.length))
  const lines = [st.bold('Actovia doctor')]

  for (const group of CHECK_GROUPS) {
    const own = checks.filter(c => c.group === group)
    if (own.length === 0) continue
    lines.push('', st.bold(GROUP_TITLES[group]))
    for (const c of own) {
      lines.push(`  ${mark[c.level]} ${st.dim(p(c.name).padEnd(width))}  ${p(c.detail)}`)
      if (c.fix) lines.push(`${' '.repeat(width + 6)}${st.dim('→')} ${st.cyan(p(c.fix))}`)
    }
  }

  if (!checks.some(c => c.group === 'security')) {
    const running = checks.find(c => c.group === 'app' && c.name === 'Running')
    lines.push(
      '',
      st.dim(`Security and phones are checked once ${running?.level !== 'fail' ? 'the CLI can read the app' : 'Actovia is running'}.`)
    )
  }

  const fails = checks.filter(c => c.level === 'fail')
  const warns = checks.filter(c => c.level === 'warn')
  lines.push('')
  if (fails.length === 0 && warns.length === 0) {
    lines.push(st.green(`All ${checks.length} checks pass.`))
    return lines
  }
  const parts: string[] = []
  if (fails.length) parts.push(st.red(`${fails.length} to fix`))
  if (warns.length) parts.push(st.yellow(`${warns.length} to look at`))
  parts.push(`${checks.length - fails.length - warns.length} fine`)
  lines.push(parts.join(st.dim(' · ')))
  const first = [...fails, ...warns].find(c => c.fix)
  if (first?.fix) lines.push(`Start with: ${st.cyan(p(first.fix))}`)
  return lines
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
  else for (const line of formatChecks(checks, { color: deps.color ?? colorEnabled(process.stdout) })) print(line)
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
