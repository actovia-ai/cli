/**
 * Terminal styling for the plain (non-Ink) commands: a few SGR codes, on only
 * when the output is a terminal that wants them. NO_COLOR (https://no-color.org)
 * and TERM=dumb turn them off; FORCE_COLOR turns them on for a pipe.
 */

export interface Stream {
  isTTY?: boolean
}

export function colorEnabled(stream: Stream = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR) return false
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true
  if (env.TERM === 'dumb') return false
  return stream.isTTY === true
}

export interface Style {
  bold: (s: string) => string
  dim: (s: string) => string
  green: (s: string) => string
  yellow: (s: string) => string
  red: (s: string) => string
  cyan: (s: string) => string
}

const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`

const COLORED: Style = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  red: sgr(31, 39),
  cyan: sgr(36, 39)
}

const id = (s: string) => s
const PLAIN: Style = { bold: id, dim: id, green: id, yellow: id, red: id, cyan: id }

export function makeStyle(color: boolean): Style {
  return color ? COLORED : PLAIN
}
