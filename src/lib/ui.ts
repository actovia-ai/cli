import { colorEnabled, makeStyle, type Style } from './style'

/**
 * The look every plain command shares, so they read as one tool:
 *
 *   ✓ green   something was done, or is as it should be
 *   ! yellow  worth a look, nothing broken
 *   ✗ red     failed, or broken
 *   → cyan    the command to run next, on a line of its own
 *
 * Titles are bold, labels and secondary text dim, tables aligned by what
 * shows on screen. Colour is the only difference between a terminal and a
 * pipe: the text is the same.
 */

const SGR = /\x1b\[[0-9;]*m/g

/** How many columns a string takes, its colour escapes left out. */
export function visibleWidth(s: string): number {
  return s.replace(SGR, '').length
}

export interface TableOptions {
  /** The first row names the columns: drawn dim. */
  header?: boolean
  /** Columns aligned to the right (numbers). */
  right?: number[]
  indent?: number
}

export interface Ui {
  st: Style
  done: (text: string) => string
  warn: (text: string) => string
  fail: (text: string) => string
  title: (text: string) => string
  /** A command to run next: `  → actovia pair`. */
  next: (command: string) => string
  /** Aligned columns, two spaces apart. */
  table: (rows: string[][], opts?: TableOptions) => string[]
}

export function makeUi(color: boolean): Ui {
  const st = makeStyle(color)
  return {
    st,
    done: text => `${st.green('✓')} ${text}`,
    warn: text => `${st.yellow('!')} ${text}`,
    fail: text => `${st.red('✗')} ${text}`,
    title: text => st.bold(text),
    next: command => `  ${st.dim('→')} ${st.cyan(command)}`,
    table: (rows, opts = {}) => {
      const right = new Set(opts.right ?? [])
      const columns = Math.max(0, ...rows.map(r => r.length))
      const widths = Array.from({ length: columns }, (_, i) => Math.max(0, ...rows.map(r => visibleWidth(r[i] ?? ''))))
      const pad = ' '.repeat(opts.indent ?? 2)
      return rows.map((row, r) => {
        const cells = row.map((cell, i) => {
          const gap = ' '.repeat(widths[i]! - visibleWidth(cell))
          if (right.has(i)) return gap + cell
          return i === row.length - 1 ? cell : cell + gap
        })
        const line = pad + cells.join('  ')
        return opts.header && r === 0 ? pad + st.dim(cells.join('  ')) : line
      })
    }
  }
}

/** The kit for a command's stdout: colour when it is a terminal that wants it. */
export function stdoutUi(color?: boolean): Ui {
  return makeUi(color ?? colorEnabled(process.stdout))
}

/** "5 min ago", "in 2 h", "yesterday": a time as a person says it. */
export function ago(when: string | number | null, now: number = Date.now()): string {
  if (when === null) return 'never'
  const ms = (typeof when === 'number' ? when : Date.parse(when)) - now
  if (!Number.isFinite(ms)) return '?'
  const future = ms > 0
  const s = Math.abs(ms) / 1000
  if (s < 45) return future ? 'in a moment' : 'just now'
  const say = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`)
  const min = Math.round(s / 60)
  if (min < 60) return say(min, 'min')
  const h = Math.round(s / 3600)
  if (h < 24) return say(h, 'h')
  const days = Math.floor(s / 86_400)
  if (days === 1) return future ? 'tomorrow' : 'yesterday'
  return say(days, 'days')
}

/** A share as a small bar: `█████░░░░░`. */
export function meter(share: number, cells = 10): string {
  const filled = Math.round(Math.min(1, Math.max(0, share)) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/**
 * An error's message with the command it ends on taken off, so the command
 * can be shown as the next step: "… Open it first: actovia open".
 */
export function splitHint(message: string): { text: string; hint?: string } {
  const m = /^(.*[.)])\s+[^.:]*:\s+(actovia [a-z][a-z0-9 <>-]*)\.?$/s.exec(message)
  return m ? { text: m[1]!, hint: m[2]! } : { text: message }
}

/**
 * The kit for a command given its deps: a test's own `print` gets plain text
 * unless it asks for colour, so a run in a terminal tests the same strings.
 */
export function uiFor(deps: { print?: unknown; color?: boolean }): Ui {
  return makeUi(deps.color ?? (deps.print ? false : colorEnabled(process.stdout)))
}
