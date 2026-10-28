import { colorEnabled, makeStyle } from './style'

/** Sizes as a person reads them: decimal units, like Finder. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e3) return `${Math.round(bytes)} B`
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}

/** `bytes` in the unit `formatBytes(reference)` uses, number only: "94.1" of "180.3 MB". */
function inUnitOf(bytes: number, reference: number): string {
  if (reference < 1e3) return String(Math.round(bytes))
  if (reference < 1e6) return String(Math.round(bytes / 1e3))
  if (reference < 1e9) return (bytes / 1e6).toFixed(1)
  return (bytes / 1e9).toFixed(2)
}

/** The bar's width: as wide as fits, up to the most, and not drawn under the least. */
const BAR_CELLS = { most: 24, least: 10 }

export interface ProgressState {
  label: string
  received: number
  /** The response's Content-Length; null when the server did not say. */
  total: number | null
  /** Bytes a second so far; null until there is enough to tell. */
  rate: number | null
}

/**
 * One line of a download in progress. It never reaches the terminal's last
 * column, so it can be redrawn in place: on a narrow terminal the bar goes
 * first, then the speed, then the numbers.
 */
export function formatProgress(p: ProgressState, opts: { columns?: number; color?: boolean } = {}): string {
  const st = makeStyle(opts.color ?? false)
  // A pty with no size reports 0 columns.
  const max = (opts.columns || 80) - 1
  const head = `Downloading ${p.label}`
  const rate = p.rate === null ? '' : `${formatBytes(p.rate)}/s`
  let numbers: string
  let pct = ''
  let share = 0
  if (p.total && p.total > 0) {
    share = Math.min(1, p.received / p.total)
    pct = `${Math.floor(share * 100)}%`
    numbers = `${inUnitOf(p.received, p.total)} / ${formatBytes(p.total)}`
  } else numbers = formatBytes(p.received)

  const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  const join = (...parts: string[]) => parts.filter(Boolean).join('  ')
  const candidates: string[] = []
  if (pct) {
    // Room is measured with the widest the numbers will get, so the bar does
    // not change width as they grow.
    const widest = `${inUnitOf(p.total!, p.total!)} / ${formatBytes(p.total!)}`
    const room = max - join(head, ' 100%', widest, '999.9 MB/s').length
    const cells = Math.min(BAR_CELLS.most, room)
    if (cells >= BAR_CELLS.least) {
      const filled = Math.floor(share * cells)
      const bar = st.cyan('█'.repeat(filled)) + st.dim('░'.repeat(cells - filled))
      candidates.push(join(head, `${bar} ${pct.padStart(4)}`, numbers, rate))
    }
  }
  candidates.push(join(head, pct, numbers, rate), join(head, pct, numbers), join(head, pct))
  for (const line of candidates) if (plain(line).length <= max) return line
  return head.slice(0, Math.max(0, max))
}

export interface ProgressStream {
  isTTY?: boolean
  columns?: number
  write: (chunk: string) => unknown
}

export interface DownloadOptions {
  /** Where the lines that stay go: what is downloaded, and that it is done. */
  print: (text: string) => void
  /** Where the bar is drawn; stderr by default, so stdout stays the command's own. */
  stream?: ProgressStream
  /** Off: one "Downloading …" line and no bar. Defaults to "the stream is a terminal that takes escapes". */
  enabled?: boolean
  color?: boolean
  now?: () => number
  intervalMs?: number
}

/**
 * Reads a download whole, with a bar on the terminal while it comes in:
 * redrawn in place at most every `intervalMs`, erased at the end and replaced
 * by one line saying what was downloaded. Off a terminal it prints the
 * "Downloading …" line alone, so a log keeps no frames.
 */
export async function download(res: Response, label: string, opts: DownloadOptions): Promise<Buffer> {
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const stream = opts.stream ?? process.stderr
  const enabled = opts.enabled ?? (stream.isTTY === true && colorEnabled(stream))
  if (!enabled || !res.body) {
    opts.print(`Downloading ${label}…`)
    return Buffer.from(await res.arrayBuffer())
  }

  const now = opts.now ?? Date.now
  const interval = opts.intervalMs ?? 100
  const color = opts.color ?? colorEnabled(stream)
  const length = Number(res.headers.get('content-length'))
  const total = Number.isFinite(length) && length > 0 ? length : null
  const start = now()
  let lastDraw = -Infinity
  let received = 0
  const chunks: Uint8Array[] = []

  const draw = (at: number) => {
    const elapsed = (at - start) / 1000
    const rate = elapsed >= 0.3 ? received / elapsed : null
    stream.write(`\r\x1b[2K${formatProgress({ label, received, total, rate }, { columns: stream.columns, color })}`)
    lastDraw = at
  }

  const reader = res.body.getReader()
  try {
    draw(start)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      const at = now()
      if (at - lastDraw >= interval) draw(at)
    }
    draw(now())
  } finally {
    stream.write('\r\x1b[2K')
  }
  opts.print(`Downloaded ${label} · ${formatBytes(received)}`)
  return Buffer.concat(chunks)
}
