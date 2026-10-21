import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Who the PIN is about to be sent to. Anything running as this user can
 * listen on the app's port while the app is not (or after killing it) and
 * answer "locked" to every request, so that the CLI asks for the PIN: before
 * it is sent, the address must be this machine's, and — on macOS — the
 * program listening on it the installed Actovia.app. This raises the bar from
 * a five-line server to replacing the app itself.
 */

export type Run = (command: string[]) => Promise<{ code: number; stdout: string }>

const run: Run = async command => {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' })
  const stdout = await new Response(proc.stdout).text()
  return { code: await proc.exited, stdout }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export class ListenerError extends Error {
  readonly code = 'NOT_ACTOVIA'
}

/** The executables of the processes listening on `port` (via lsof: what each process mapped, not its argv). */
export async function listenerExecutables(port: number, runner: Run = run): Promise<string[]> {
  const pids = await runner(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
  const ids = [...new Set(pids.stdout.split('\n').flatMap(l => (/^p(\d+)$/u.exec(l) ? [l.slice(1)] : [])))]
  const paths: string[] = []
  for (const pid of ids) {
    const txt = await runner(['lsof', '-nP', '-p', pid, '-a', '-d', 'txt', '-Fn'])
    // -F output is a field per line: `f<fd>` then `n<name>`; the first txt mapping is the executable.
    const lines = txt.stdout.split('\n')
    const first = lines.find((l, i) => l.startsWith('n') && lines[i - 1] === 'ftxt')
    // A process whose executable cannot be read is not one we can vouch for.
    paths.push(first ? first.slice(1) : `(pid ${pid})`)
  }
  return paths
}

export interface ListenerCheckDeps {
  platform?: NodeJS.Platform
  run?: Run
  /** The installed app's bundle; looked up when not given. */
  appPath?: string | null
  resolve?: (path: string) => Promise<string>
}

export async function assertListenerIsActovia(baseUrl: string, deps: ListenerCheckDeps = {}): Promise<void> {
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) {
    throw new ListenerError(`Not sending the PIN to ${url.host}: the CLI talks only to Actovia on this machine.`)
  }
  if ((deps.platform ?? process.platform) !== 'darwin') return
  const resolve = deps.resolve ?? ((p: string) => realpath(p).catch(() => p))
  const port = Number(url.port || 80)
  const executables = await listenerExecutables(port, deps.run)
  // lsof shows only this user's processes: a listener it cannot see may be another user's.
  if (executables.length === 0) {
    throw new ListenerError(
      `Actovia isn't running on this machine (nothing of yours listens at ${url.host}). Open it first: actovia open`
    )
  }
  const appPath =
    deps.appPath !== undefined ? deps.appPath : await (await import('./desktop-app')).findInstalledApp()
  const expected = appPath ? await resolve(join(appPath, 'Contents', 'MacOS', 'Actovia')) : null
  for (const exe of executables) {
    if (expected === null || (await resolve(exe)) !== expected) {
      throw new ListenerError(
        `What answers at ${url.host} is not the installed Actovia (${exe.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '?')}). ` +
          'Not sending the PIN. Quit it, open Actovia (actovia open), and try again.'
      )
    }
  }
}
