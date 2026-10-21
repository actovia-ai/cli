import { createHash } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DesktopApiError, type DesktopClient } from './desktop-client'
import { parseChecksums } from './self-update'
import { ensurePass } from './session'
import { getLatestRelease, type GithubRelease, isNewerVersion } from './updater'

/**
 * The Actovia desktop app installed on this machine: which version, whether a
 * newer one is out, and — on macOS — replacing it with the newer one. Windows
 * updates itself; on Linux the new package comes from the release page.
 */

export const DESKTOP_GITHUB_API = 'https://api.github.com/repos/actovia-ai/actovia'
export const DESKTOP_RELEASES_URL = 'https://github.com/actovia-ai/actovia/releases/latest'
/** The first Actovia with `/api/v1/host` (status, lock, quit, restart). */
export const HOST_ROUTES_SINCE = '2.2.0'

export type Run = (command: string[]) => Promise<{ code: number; stdout: string }>

export const runCommand: Run = async command => {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' })
  const stdout = await new Response(proc.stdout).text()
  return { code: await proc.exited, stdout }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  )

/** Where the app is installed on macOS, if it is. */
export async function findInstalledApp(home: string = homedir()): Promise<string | null> {
  for (const path of ['/Applications/Actovia.app', join(home, 'Applications', 'Actovia.app')]) {
    if (await exists(path)) return path
  }
  return null
}

/** The version an installed `Actovia.app` says it is. */
export async function appVersion(appPath: string, run: Run = runCommand): Promise<string | null> {
  const { code, stdout } = await run([
    'plutil',
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    join(appPath, 'Contents', 'Info.plist')
  ])
  const version = stdout.trim()
  return code === 0 && /^\d+\.\d+\.\d+/u.test(version) ? version : null
}

export const latestDesktopRelease = (): Promise<GithubRelease> => getLatestRelease(DESKTOP_GITHUB_API)

export const versionOf = (release: GithubRelease) => release.tag_name.replace(/^v/u, '')

/** The release's macOS archive for this machine, as the desktop release names it. */
export function desktopZipName(version: string, arch: string): string | null {
  return arch === 'arm64' ? `Actovia-darwin-arm64-${version}.zip` : null
}

export interface DesktopUpdateDeps {
  client: DesktopClient
  askPin: () => Promise<string>
  print: (text: string) => void
  fetch?: typeof fetch
  run?: Run
  release?: GithubRelease
  appPath?: string | null
  platform?: NodeJS.Platform
  arch?: string
  sleep?: (ms: number) => Promise<void>
  /** How long to wait for the running app to quit. */
  quitTimeoutMs?: number
}

export type DesktopUpdateResult =
  | { status: 'current'; version: string }
  | { status: 'updated'; from: string | null; to: string; relaunched: boolean }

/**
 * Replaces the installed app with the latest release: downloaded, checked
 * against the release's `SHA256SUMS` (a release without them is refused) and
 * its code signature, unpacked beside the installed one, and swapped in once
 * the running app has quit — through the API with the app-lock PIN, which
 * needs no permission to control another app. Reopened afterwards if it was
 * running. Nothing is changed until everything has been checked.
 */
export async function updateDesktopApp(deps: DesktopUpdateDeps): Promise<DesktopUpdateResult> {
  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  const run = deps.run ?? runCommand
  const fetchImpl = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const { client, askPin, print } = deps

  if (platform === 'win32') throw new Error('On Windows Actovia updates itself: Settings → About.')
  if (platform !== 'darwin') {
    throw new Error(`Install the new package from ${DESKTOP_RELEASES_URL}`)
  }
  const appPath = deps.appPath === undefined ? await findInstalledApp() : deps.appPath
  if (!appPath) throw new Error(`Actovia is not installed in /Applications. Download it: ${DESKTOP_RELEASES_URL}`)

  const current = await appVersion(appPath, run)
  const release = deps.release ?? (await latestDesktopRelease())
  const latest = versionOf(release)
  if (current && !isNewerVersion(current, latest)) return { status: 'current', version: current }

  const name = desktopZipName(latest, arch)
  const asset = name ? release.assets.find(a => a.name === name) : undefined
  if (!name || !asset) throw new Error(`The ${release.tag_name} release has no macOS build for ${arch}.`)
  const sumsAsset = release.assets.find(a => a.name === 'SHA256SUMS')
  if (!sumsAsset) {
    throw new Error(
      `The ${release.tag_name} release has no checksums, so ${name} cannot be checked; nothing was changed. Download it from ${DESKTOP_RELEASES_URL}`
    )
  }

  print(`Downloading Actovia ${latest}…`)
  const res = await fetchImpl(asset.browser_download_url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const sums = await fetchImpl(sumsAsset.browser_download_url)
  if (!sums.ok) throw new Error(`Could not read the release's checksums: ${sums.status}`)
  const expected = parseChecksums(await sums.text()).get(name)
  if (!expected || expected !== createHash('sha256').update(bytes).digest('hex')) {
    throw new Error(`The downloaded ${name} does not match the release's checksum; nothing was changed.`)
  }

  // Unpacked beside the installed app, so the swap is a rename on one volume.
  const work = join(dirname(appPath), `.actovia-update-${process.pid}`)
  const old = `${appPath}.old`
  try {
    await rm(work, { recursive: true, force: true })
    await mkdir(work)
    const zip = join(work, name)
    await writeFile(zip, bytes)
    if ((await run(['ditto', '-x', '-k', zip, work])).code !== 0) throw new Error(`Could not unpack ${name}.`)
    const fresh = join(work, 'Actovia.app')
    if (!(await exists(fresh))) throw new Error(`${name} holds no Actovia.app.`)
    if ((await run(['codesign', '--verify', '--deep', '--strict', fresh])).code !== 0) {
      throw new Error(`The downloaded Actovia.app fails its signature check; nothing was changed.`)
    }

    const wasRunning = await quitRunningApp(appPath, { client, askPin, print, run, sleep, timeoutMs: deps.quitTimeoutMs })

    await rm(old, { recursive: true, force: true })
    await rename(appPath, old)
    try {
      await rename(fresh, appPath)
    } catch (err) {
      await rename(old, appPath)
      throw err
    }
    await rm(old, { recursive: true, force: true })

    if (wasRunning) await run(['open', appPath])
    return { status: 'updated', from: current, to: latest, relaunched: wasRunning }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`No permission to replace ${appPath}. Run it with sudo, or download it from ${DESKTOP_RELEASES_URL}`)
    }
    throw err
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Whether the app's executable is running. */
export async function isAppRunning(appPath: string, run: Run = runCommand): Promise<boolean> {
  return (await run(['pgrep', '-f', join(appPath, 'Contents', 'MacOS') + '/'])).code === 0
}

/**
 * Asks the running app to quit and waits until it has. Through the API with
 * a pass (an Actovia older than the host routes has none: it is asked to quit
 * the way the Dock does). Answers whether it was running.
 */
async function quitRunningApp(
  appPath: string,
  deps: {
    client: DesktopClient
    askPin: () => Promise<string>
    print: (text: string) => void
    run: Run
    sleep: (ms: number) => Promise<void>
    timeoutMs?: number
  }
): Promise<boolean> {
  const { client, askPin, print, run, sleep } = deps
  if (!(await isAppRunning(appPath, run))) return false
  print('Quitting Actovia…')
  try {
    await ensurePass(client, askPin)
    await client.quit()
  } catch (err) {
    // No way through the API: an Actovia without the route (or without the
    // pass route, which a locked one answers as APP_LOCKED), or no PIN set.
    const asDock =
      err instanceof DesktopApiError &&
      (err.status === 404 || ['UNREACHABLE', 'PIN_NOT_SET', 'APP_LOCKED'].includes(err.code))
    if (!asDock) throw err
    await run(['osascript', '-e', 'tell application "Actovia" to quit'])
  }
  const deadline = Date.now() + (deps.timeoutMs ?? 60_000)
  while (await isAppRunning(appPath, run)) {
    if (Date.now() > deadline) throw new Error('Actovia did not quit; nothing was changed. Quit it and try again.')
    await sleep(500)
  }
  return true
}
