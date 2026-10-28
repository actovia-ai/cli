import { colorEnabled } from '../lib/style'
import { makeUi, splitHint } from '../lib/ui'

/** A failure as the commands show it: `✗` and the message, then the command to run, if it names one. */
export function formatError(err: unknown, color = false): string[] {
  const ui = makeUi(color)
  const { text, hint } = splitHint(err instanceof Error ? err.message : String(err))
  return hint ? [ui.fail(text), ui.next(hint)] : [ui.fail(text)]
}

export interface ErrorOutput {
  out: (text: string) => void
  err: (text: string) => void
  color?: boolean
}

export function reportError(err: unknown, json?: boolean, output?: ErrorOutput): void {
  const out = output?.out ?? ((t: string) => console.log(t))
  const write = output?.err ?? ((t: string) => console.error(t))
  if (json) {
    out(JSON.stringify({ error: 'command_failed', message: err instanceof Error ? err.message : String(err) }))
  } else {
    for (const line of formatError(err, output?.color ?? colorEnabled(process.stderr))) write(line)
  }
  process.exitCode = 1
}
