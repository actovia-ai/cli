import type { Command } from 'commander'

import { DesktopClient, type LogEntry, type LogQuery } from '../lib/desktop-client'
import { PinCancelled, promptPin } from '../lib/pin-prompt'
import { whileUnlocked } from '../lib/session'
import { reportError } from './report-error'

/**
 * `actovia logs`: the desktop app's log (Settings → Logger) in a terminal,
 * filtered the same way, and `--follow` to keep printing what comes in.
 */

export interface LogsOptions {
  date?: string
  level?: string
  scope?: string
  trace?: string
  query?: string
  lines?: string
  follow?: boolean
  json?: boolean
}

export interface LogsDeps {
  client?: DesktopClient
  askPin?: () => Promise<string>
  print?: (text: string) => void
  sleep?: (ms: number) => Promise<void>
  /** Stops `--follow` (tests); runs until interrupted otherwise. */
  keepFollowing?: () => boolean
}

/** How often `--follow` asks for new lines. */
export const FOLLOW_POLL_MS = 2000

const LEVELS = ['debug', 'info', 'warn', 'error']

// The log's text is the app's own, but it can quote what a model or a phone
// sent: control characters are shown, never obeyed (as with device names).
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/gu, '?')

export function formatEntry(e: LogEntry): string {
  const time = new Date(e.timestamp).toLocaleTimeString()
  const level = clean(e.severityText).padEnd(5)
  const trace = e.traceId ? `  trace:${clean(e.traceId.slice(0, 8))}` : ''
  const lines = [`${time} ${level} ${clean(e.scope.name)}  ${clean(e.body)}${trace}`]
  const stack = e.attributes['exception.stacktrace']
  if (typeof stack === 'string') lines.push(...clean(stack).split('\n').map(l => `    ${l}`))
  return lines.join('\n')
}

/** Identity of an entry, for not printing it twice while following. */
const keyOf = (e: LogEntry) => `${e.timestamp}|${e.scope.name}|${e.body}`

export async function runLogs(opts: LogsOptions = {}, deps: LogsDeps = {}): Promise<LogEntry[] | null> {
  const client = deps.client ?? new DesktopClient()
  const askPin = deps.askPin ?? (() => promptPin())
  const print = deps.print ?? ((text: string) => console.log(text))
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const keepFollowing = deps.keepFollowing ?? (() => true)
  const emit = (e: LogEntry) => print(opts.json ? JSON.stringify(e) : formatEntry(e))
  try {
    if (opts.level && !LEVELS.includes(opts.level)) throw new Error(`--level is one of ${LEVELS.join(', ')}.`)
    if (opts.date && !/^\d{4}-\d{2}-\d{2}$/u.test(opts.date)) throw new Error('--date is YYYY-MM-DD.')
    if (opts.follow && opts.date) throw new Error('--follow reads today; leave out --date.')
    const lines = Math.min(500, Math.max(1, Number(opts.lines) || 50))
    const query: LogQuery = {
      date: opts.date,
      level: opts.level,
      scope: opts.scope,
      traceId: opts.trace,
      q: opts.query,
      pageSize: lines
    }
    // The route answers newest first; a terminal reads oldest first.
    const read = async () => (await whileUnlocked(client, askPin, () => client.logs(query))).entries.reverse()

    const first = await read()
    first.forEach(emit)
    if (!opts.follow) return first

    const seen = new Set(first.map(keyOf))
    while (keepFollowing()) {
      await sleep(FOLLOW_POLL_MS)
      for (const e of await read()) {
        if (seen.has(keyOf(e))) continue
        seen.add(keyOf(e))
        emit(e)
      }
    }
    return first
  } catch (err) {
    if (err instanceof PinCancelled) process.exitCode = 1
    else reportError(err, opts.json)
    return null
  }
}

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description("Print the desktop app's log (Settings → Logger), oldest first")
    .option('-n, --lines <n>', 'how many of the newest lines (at most 500)', '50')
    .option('-f, --follow', 'keep printing new lines as they come')
    .option('--level <level>', 'that level and above: debug, info, warn, error')
    .option('--scope <name>', 'one scope only, e.g. app or kernel')
    .option('--trace <id>', 'one trace only (a request, a job)')
    .option('-q, --query <words>', 'the Logger search syntax: words, -word, scope:, trace:')
    .option('--date <YYYY-MM-DD>', "another day's log")
    .option('--json', 'one JSON record per line')
    .action(async (opts: LogsOptions) => {
      await runLogs(opts)
    })
}
