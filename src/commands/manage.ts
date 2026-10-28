import { homedir } from 'node:os'

import type { Command } from 'commander'

import { type CliQuota, DesktopClient, type ScheduledTask } from '../lib/desktop-client'
import { PinCancelled, promptPin } from '../lib/pin-prompt'
import { ensurePass, whileUnlocked } from '../lib/session'
import { withSpinner } from '../lib/spinner'
import { ago, makeUi, meter, type Ui, uiFor } from '../lib/ui'
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
  color?: boolean
}

const defaults = (deps: ManageDeps) => ({
  client: deps.client ?? new DesktopClient(),
  askPin: deps.askPin ?? (() => promptPin()),
  print: deps.print ?? ((text: string) => console.log(text)),
  now: deps.now ?? Date.now,
  ui: uiFor(deps)
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

export function runLock(deps: ManageDeps = {}): Promise<boolean | null> {
  const { client, askPin, print, ui } = defaults(deps)
  return guarded(false, async () => {
    // Already locked: nothing to ask for (a PIN would unlock it first).
    const status = await client.hostStatus().catch(() => null)
    if (status?.locked) {
      print(ui.done('Actovia is locked already.'))
      return true
    }
    await ensurePass(client, askPin)
    const result = await client.lockNow()
    if (!result.pinSet) throw new Error('Set an app-lock PIN in Actovia first (Settings → General → Lock & Privacy).')
    print(ui.done('Actovia is locked.'))
    return result.locked
  })
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`

/** A path under the home folder as a person writes it: `~/.actovia/…`. */
const tilde = (path: string) => {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function runBackupList(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, now, ui } = defaults(deps)
  return guarded(opts.json, async () => {
    const [backups, status] = await whileUnlocked(client, askPin, () =>
      Promise.all([client.backups(), client.backupStatus()])
    )
    if (opts.json) {
      print(JSON.stringify({ ...status, backups }, null, 2))
      return backups
    }
    const t = now()
    print(ui.title('Backups'))
    const automatic = status.autoBackup ? `on, daily at 3:00 · last ${ago(status.lastBackupAt, t)}` : ui.st.yellow('off')
    print(`  ${ui.st.dim('Automatic')}  ${automatic}`)
    print('')
    if (backups.length === 0) {
      print('  No backups yet.')
      print(ui.next('actovia backup create'))
      return backups
    }
    const rows = backups.map(b => [printable(b.name), mb(b.size), ago(b.createdAt, t)])
    for (const line of ui.table([['Name', 'Size', 'Made'], ...rows], { header: true })) print(line)
    return backups
  })
}

export function runBackupCreate(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, ui } = defaults(deps)
  return guarded(opts.json, async () => {
    const { filePath } = await withSpinner('Backing up…', () => whileUnlocked(client, askPin, () => client.backupNow()), {
      enabled: opts.json ? false : undefined
    })
    print(opts.json ? JSON.stringify({ filePath }) : ui.done(`Backed up to ${printable(tilde(filePath))}`))
    return filePath
  })
}

export function runTasks(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, now, ui } = defaults(deps)
  return guarded(opts.json, async () => {
    const tasks = await whileUnlocked(client, askPin, () => client.tasks())
    if (opts.json) {
      print(JSON.stringify(tasks, null, 2))
      return tasks
    }
    const t = now()
    if (tasks.upcoming.length + tasks.recurring.length === 0) {
      print('No scheduled Philharmonic tasks.')
      return tasks
    }
    const lastRun = (task: ScheduledTask) => {
      if (!task.lastRunAt) return ui.st.dim('not run yet')
      if (task.lastRunStatus === 'failed') return ui.fail(`failed ${ago(task.lastRunAt, t)}`)
      return ui.done(`ran ${ago(task.lastRunAt, t)}`)
    }
    if (tasks.upcoming.length > 0) {
      print(ui.title('Upcoming'))
      for (const line of ui.table(tasks.upcoming.map(task => [printable(task.title), ago(task.runAt, t)]))) print(line)
    }
    if (tasks.recurring.length > 0) {
      if (tasks.upcoming.length > 0) print('')
      print(ui.title('Recurring'))
      const rows = tasks.recurring.map(task => [printable(task.title), printable(task.cronExpression ?? ''), lastRun(task)])
      for (const line of ui.table(rows)) print(line)
    }
    return tasks
  })
}

const CLI_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const WINDOW_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'week' }

/** One CLI's quota: a verdict line, then a meter per window; a window past its reset says so. */
export function describeQuota(q: CliQuota, now: number, ui: Ui = makeUi(false)): string[] {
  const st = ui.st
  const verdict =
    q.state === 'rejected' ? ui.fail('limit reached') : q.state === 'warning' ? ui.warn('near the limit') : ui.done('ok')
  const name = CLI_NAMES[q.cli] ?? printable(q.cli)
  const lines = [`${ui.title(name)}  ${verdict}${q.overage ? ' (overage allowed)' : ''} ${st.dim(`· as of ${ago(q.asOf, now)}`)}`]
  const rows = q.windows.map(w => {
    const label = `${w.model ? `${printable(w.model)} only: ` : ''}${WINDOW_NAMES[w.name] ?? printable(w.name)}`
    const used = Number.isFinite(w.usedPercent) ? w.usedPercent : 0
    const tint = w.rejected || used >= 90 ? st.red : used >= 70 ? st.yellow : st.green
    const reset =
      w.resetsAt === null ? '' : w.resetsAt <= now ? 'reset since (not read again)' : `resets ${ago(w.resetsAt, now)}`
    const note = [w.rejected ? 'stopped' : '', reset].filter(Boolean).join(' · ')
    return [label, tint(meter(used / 100)), `${Math.round(used)}%`, st.dim(note)]
  })
  return [...lines, ...ui.table(rows, { right: [2] }).map(l => l.trimEnd())]
}

export function runQuota(opts: { json?: boolean } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, now, ui } = defaults(deps)
  return guarded(opts.json, async () => {
    const quotas = await whileUnlocked(client, askPin, () => client.quota())
    if (opts.json) print(JSON.stringify(quotas, null, 2))
    else if (quotas.length === 0) print('No quota reported yet: it comes with the first Claude Code or Codex run.')
    else
      quotas.forEach((q, i) => {
        if (i > 0) print('')
        for (const line of describeQuota(q, now(), ui)) print(line)
      })
    return quotas
  })
}

/** The app counts tokens, never money (desktop ISSUE-235). */
const count = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '?')

export function runUsage(opts: { json?: boolean; days?: string } = {}, deps: ManageDeps = {}) {
  const { client, askPin, print, now, ui } = defaults(deps)
  return guarded(opts.json, async () => {
    const usage = await whileUnlocked(client, askPin, () => client.usage())
    const days = Math.max(1, Number(opts.days) || 30)
    const from = new Date(now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
    const recent = usage.daily.filter(d => d.date >= from)
    if (opts.json) {
      print(JSON.stringify({ ...usage, daily: recent }, null, 2))
      return usage
    }
    const st = ui.st
    const recentTokens = recent.reduce((sum, d) => sum + d.tokens, 0)
    print(ui.title('Usage'))
    const totals = ui.table([
      [st.dim(`Last ${days} days`), `${count(recentTokens)} tokens`],
      [st.dim('All time'), `${count(usage.totalTokens)} tokens · ${count(usage.totalRequests)} requests`]
    ])
    for (const line of totals) print(line)

    const shown = recent.slice(-7)
    if (shown.length > 0) {
      const most = Math.max(...shown.map(d => d.tokens))
      print('')
      print(ui.title('By day'))
      const rows = shown.map(d => [printable(d.date), st.cyan(meter(most > 0 ? d.tokens / most : 0, 20)), count(d.tokens)])
      for (const line of ui.table(rows, { right: [2] })) print(line)
    }
    if (usage.models.length > 0) {
      print('')
      print(ui.title('Top models (all time)'))
      const rows = usage.models
        .slice(0, 5)
        .map(m => [printable(m.model), st.dim(printable(m.provider)), `${count(m.totalTokens)} tokens`, `${count(m.requests)} requests`])
      for (const line of ui.table(rows, { right: [2, 3] })) print(line)
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
    .description('How many tokens the models have used: recent days, all time, top models')
    .option('--days <n>', 'how many recent days to total', '30')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean; days?: string }) => {
      await runUsage(opts)
    })
}
