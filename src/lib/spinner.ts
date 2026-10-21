import { colorEnabled } from './style'

/** The frames of ink-spinner's `dots`, which the Ink screens use. */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface SpinnerStream {
  isTTY?: boolean
  write: (chunk: string) => unknown
}

export interface SpinnerOptions {
  stream?: SpinnerStream
  /** Off: the work runs with nothing drawn. Defaults to "stderr is a terminal that takes escapes". */
  enabled?: boolean
  /** Nothing is drawn for work that finishes sooner, so a quick answer does not flash. */
  delayMs?: number
  intervalMs?: number
}

/**
 * Runs `work` with a one-line spinner on stderr, erased before the result is
 * returned, so stdout stays exactly what the command prints.
 */
export async function withSpinner<T>(label: string, work: () => Promise<T>, opts: SpinnerOptions = {}): Promise<T> {
  const stream = opts.stream ?? process.stderr
  // A pipe never gets one, FORCE_COLOR or not: it would keep every frame.
  const enabled = opts.enabled ?? (stream.isTTY === true && colorEnabled(stream))
  if (!enabled) return work()

  let frame = 0
  let drawn = false
  let ticker: ReturnType<typeof setInterval> | undefined
  const draw = () => {
    stream.write(`\r\x1b[2K\x1b[36m${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]}\x1b[39m ${label}`)
    drawn = true
  }
  const starter = setTimeout(() => {
    draw()
    ticker = setInterval(draw, opts.intervalMs ?? 80)
  }, opts.delayMs ?? 100)
  try {
    return await work()
  } finally {
    clearTimeout(starter)
    if (ticker) clearInterval(ticker)
    if (drawn) stream.write('\r\x1b[2K')
  }
}
