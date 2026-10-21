import type { Command } from 'commander'

import { type CliQuota, DesktopClient, type ScheduledTask } from '../lib/desktop-client'
import { PinCancelled, promptPin } from '../lib/pin-prompt'
import { ensurePass, whileUnlocked } from '../lib/session'
import { printable } from './devices'
import { reportError } from './report-error'

/**
 * `actovia lock`, `backup`, `tasks`, `quota`, `usage`: what the desktop app's
 * Settings show, from a shell. Reads ask for the PIN only when the app is
 * locked (a correct one unlocks it); `lock` always does.
 */

export interface ManageDeps {
  client?: DesktopClient
  askPin?: () => Promise<string>
  print?: (text: string) => void
  now?: () => number
}

const defaults = (deps: ManageDeps) => ({
  client: deps.client ?? new DesktopClient(),
  askPin: deps.askPin ?? (() => promptPin()),
  print: deps.print ?? ((text: string) => console.log(text)),
  now: deps.now ?? Date.now
})

async function guarded<T>(json: boolean | undefined, body: () => Promise<T>): Promise<T | null> {
  try {
    return await body()
  } catch (err) {
    if (err instanceof PinCancelled) process.exitCode = 1
    else reportError(err, json)
    return null
  }
}

const when = (iso: string | number | null) => (iso === null ? '—' : new Date(iso).toLocaleString())

export function runLock(deps: ManageDeps = {}): Promise<boolean | null> {
  const { client, askPin, print } = defaults(deps)
  return guarded(false, async () => {
    // Already locked: nothing to ask for (a PIN would unlock it first).
    const status = await client.hostStatus().catch(() => null)
    if (status?.locked) {
      print('Actovia is locked already.')
      return true
    }
    await ensurePass(client, askPin)
    const result = await client.lockNow()
    if (!result.pinSet) throw new Error('Set an app-lock PIN in Actovia first (Settings → General → Lock & Privacy).')
    print('Actovia is locked.')
    return result.locked
  })
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`

export function runBackupList(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print } = defaults(deps)
  return guarded(opts.json, async () => {
    const [backups, status] = await whileUnlocked(client, askPin, () =>
      Promise.all([client.backups(), client.backupStatus()])
    )
    if (opts.json) {
      print(JSON.stringify({ ...status, backups }, null, 2))
      return backups
    }
    print(`Automatic backups: ${status.autoBackup ? 'on, daily at 3:00' : 'off'} · last ${when(status.lastBackupAt)}`)
    if (backups.length === 0) print('No backups yet. Make one: actovia backup create')
    for (const b of backups) print(`${b.name}  ${mb(b.size)}  ${when(b.createdAt)}`)
    return backups
  })
}

export function runBackupCreate(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print } = defaults(deps)
  return guarded(opts.json, async () => {
    const { filePath } = await whileUnlocked(client, askPin, () => client.backupNow())
    print(opts.json ? JSON.stringify({ filePath }) : `Backed up to ${filePath}`)
    return filePath
  })
}

function describeTask(t: ScheduledTask): string {
  const schedule = t.cronExpression ? `cron ${t.cronExpression}` : `at ${when(t.runAt)}`
  const last = t.lastRunAt ? ` · last ran ${when(t.lastRunAt)}${t.lastRunStatus ? ` (${t.lastRunStatus})` : ''}` : ''
  return `${printable(t.title)}\n  ${schedule}${last}`
}

export function runTasks(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print } = defaults(deps)
  return guarded(opts.json, async () => {
    const tasks = await whileUnlocked(client, askPin, () => client.tasks())
    if (opts.json) {
      print(JSON.stringify(tasks, null, 2))
      return tasks
    }
    if (tasks.upcoming.length + tasks.recurring.length === 0) print('No scheduled Philharmonic tasks.')
    if (tasks.upcoming.length > 0) {
      print('Upcoming:')
      for (const t of tasks.upcoming) print(describeTask(t))
    }
    if (tasks.recurring.length > 0) {
      print(tasks.upcoming.length > 0 ? '\nRecurring:' : 'Recurring:')
      for (const t of tasks.recurring) print(describeTask(t))
    }
    return tasks
  })
}

/** One CLI's quota as a line per window; a window past its reset says so. */
export function describeQuota(q: CliQuota, now: number): string[] {
  const verdict = q.state === 'rejected' ? 'LIMIT REACHED' : q.state === 'warning' ? 'warning' : 'ok'
  const lines = [`${q.cli}: ${verdict}${q.overage ? ' (overage allowed)' : ''} · as of ${when(q.asOf)}`]
  for (const w of q.windows) {
    const reset =
      w.resetsAt === null ? '' : w.resetsAt <= now ? ' · reset since (not read again)' : ` · resets ${when(w.resetsAt)}`
    lines.push(`  ${w.model ? `${w.model} only: ` : ''}${w.name}  ${Math.round(w.usedPercent)}%${w.rejected ? ' · stopped' : ''}${reset}`)
  }
  return lines
}

export function runQuota(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, now } = defaults(deps)
  return guarded(opts.json, async () => {
    const quotas = await whileUnlocked(client, askPin, () => client.quota())
    if (opts.json) print(JSON.stringify(quotas, null, 2))
    else if (quotas.length === 0) print('No quota reported yet: it comes with the first Claude Code or Codex run.')
    else for (const q of quotas) for (const line of describeQuota(q, now())) print(line)
    return quotas
  })
}

const usd = (n: number) => `$${n.toFixed(2)}`

export function runUsage(opts: { json?: boolean; days?: string } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, now } = defaults(deps)
  return guarded(opts.json, async () => {
    const usage = await whileUnlocked(client, askPin, () => client.usage())
    const days = Math.max(1, Number(opts.days) || 30)
    const from = new Date(now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
    const recent = usage.daily.filter(d => d.date >= from)
    if (opts.json) {
      print(JSON.stringify({ ...usage, daily: recent }, null, 2))
      return usage
    }
    const recentCost = recent.reduce((sum, d) => sum + d.cost, 0)
    print(`Last ${days} days: ${usd(recentCost)} · all time ${usd(usage.totalCost)} over ${usage.totalRequests} requests`)
    for (const d of recent.slice(-7)) print(`  ${d.date}  ${usd(d.cost)}  ${d.tokens.toLocaleString()} tokens`)
    if (usage.models.length > 0) {
      print('Top models (all time):')
      for (const m of usage.models.slice(0, 5)) print(`  ${m.model} (${m.provider})  ${usd(m.cost)}  ${m.requests} requests`)
    }
    return usage
  })
}

export function registerManageCommands(program: Command): void {
  program
    .command('lock')
    .description('Lock the desktop app now (asks for the app-lock PIN)')
    .action(async () => {
      await runLock()
    })

  const backup = program
    .command('backup')
    .description("List the desktop app's database backups")
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runBackupList(opts)
    })
  backup
    .command('create')
    .description('Back up the database now')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runBackupCreate(opts)
    })

  program
    .command('tasks')
    .description("List Philharmonic's scheduled tasks")
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runTasks(opts)
    })

  program
    .command('quota')
    .description('Show what Claude Code and Codex last reported of your plan quota')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runQuota(opts)
    })

  program
    .command('usage')
    .description('What the models have cost: recent days, all time, top models')
    .option('--days <n>', 'how many recent days to total', '30')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean; days?: string }) => {
      await runUsage(opts)
    })
}
