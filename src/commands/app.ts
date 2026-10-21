import type { Command } from 'commander'

import {
  appVersion,
  DESKTOP_RELEASES_URL,
  findInstalledApp,
  latestDesktopRelease,
  updateDesktopApp,
  versionOf
} from '../lib/desktop-app'
import { DesktopClient } from '../lib/desktop-client'
import { PinCancelled, promptPin } from '../lib/pin-prompt'
import { ensurePass } from '../lib/session'
import { isNewerVersion } from '../lib/updater'
import { runOpen } from './open'
import { reportError } from './report-error'

/**
 * `actovia app …`: the desktop app itself — which version, updating it, and
 * quitting or restarting it from a shell. Quit and restart ask for the
 * app-lock PIN (they act for the person at the computer).
 */

export interface AppDeps {
  client?: DesktopClient
  askPin?: () => Promise<string>
  print?: (text: string) => void
}

const defaults = (deps: AppDeps) => ({
  client: deps.client ?? new DesktopClient(),
  askPin: deps.askPin ?? (() => promptPin()),
  print: deps.print ?? ((text: string) => console.log(text))
})

function fail(err: unknown, json?: boolean): void {
  if (err instanceof PinCancelled) process.exitCode = 1
  else reportError(err, json)
}

export interface AppCheck {
  /** The running app's version, else the installed one's. */
  current: string | null
  latest: string
  updateAvailable: boolean
}

export async function runAppCheck(
  opts: { json?: boolean } = {},
  deps: AppDeps & { installedVersion?: () => Promise<string | null>; latest?: () => Promise<string> } = {}
): Promise<AppCheck | null> {
  const { client, print } = defaults(deps)
  try {
    const installedVersion =
      deps.installedVersion ??
      (async () => {
        const path = process.platform === 'darwin' ? await findInstalledApp() : null
        return path ? appVersion(path) : null
      })
    const [running, installed, latest] = await Promise.all([
      client.hostStatus().then(
        h => h.version,
        () => null
      ),
      installedVersion().catch(() => null),
      (deps.latest ?? (async () => versionOf(await latestDesktopRelease())))()
    ])
    const current = running ?? installed
    const result = { current, latest, updateAvailable: current !== null && isNewerVersion(current, latest) }
    if (opts.json) print(JSON.stringify(result))
    else if (current === null) print(`Actovia ${latest} is the latest; none is installed here (${DESKTOP_RELEASES_URL}).`)
    else if (result.updateAvailable) print(`Actovia ${latest} is out (this is ${current}). Install it: actovia app update`)
    else print(`Actovia ${current} is up to date.`)
    return result
  } catch (err) {
    fail(err, opts.json)
    return null
  }
}

export async function runAppUpdate(deps: AppDeps = {}): Promise<boolean> {
  const { client, askPin, print } = defaults(deps)
  try {
    const result = await updateDesktopApp({ client, askPin, print })
    if (result.status === 'current') {
      print(`Actovia ${result.version} is up to date.`)
      return true
    }
    print(`Updated Actovia ${result.from ?? ''}${result.from ? ' → ' : ''}${result.to}.`)
    if (result.relaunched) {
      // Until the builds are signed, every new version is a new app to the
      // Keychain; nothing can answer that dialog from here.
      print(
        'Reopened it. macOS asks once for the login password to let the new version read its keychain item ' +
          '("Actovia Safe Storage"); until someone allows it at the screen, the app waits at that prompt.'
      )
    }
    return true
  } catch (err) {
    fail(err)
    return false
  }
}

async function runAppAction(action: 'quit' | 'restart', deps: AppDeps = {}): Promise<boolean> {
  const { client, askPin, print } = defaults(deps)
  try {
    await ensurePass(client, askPin)
    if (action === 'quit') await client.quit()
    else await client.restart()
    print(action === 'quit' ? 'Actovia is quitting.' : 'Actovia is restarting.')
    return true
  } catch (err) {
    fail(err)
    return false
  }
}

export const runAppQuit = (deps?: AppDeps) => runAppAction('quit', deps)
export const runAppRestart = (deps?: AppDeps) => runAppAction('restart', deps)

export function registerAppCommand(program: Command): void {
  const app = program.command('app').description('The Actovia desktop app on this machine: check, update, open, quit, restart')

  app
    .command('check')
    .description('Say whether a newer Actovia is out')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      await runAppCheck(opts)
    })

  app
    .command('update')
    .description('Install the newest Actovia (macOS; quits and reopens it, asking for the app-lock PIN)')
    .action(async () => {
      await runAppUpdate()
    })

  app
    .command('open')
    .description('Launch the Actovia desktop app')
    .action(async () => {
      if ((await runOpen()).status === 'not-found') process.exitCode = 1
    })

  app
    .command('quit')
    .description('Quit Actovia (asks for the app-lock PIN)')
    .action(async () => {
      await runAppQuit()
    })

  app
    .command('restart')
    .description('Quit Actovia and start it again (asks for the app-lock PIN)')
    .action(async () => {
      await runAppRestart()
    })
}
