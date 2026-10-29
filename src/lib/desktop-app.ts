import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { buildFromBlockmap } from './blockmap-delta'
import { type AskPin, DesktopApiError, type DesktopClient } from './desktop-client'
import { download, type DownloadOptions } from './progress'
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
/** `codesign -R`: signed through Apple's chain by the Developer ID team every release is signed by (since 2.5). */
export const TEAM_REQUIREMENT = 'anchor apple generic and certificate leaf[subject.OU] = "A542S7SY83"'
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

// The tag is GitHub's text: shown and put in a file name, so control characters never pass.
export const versionOf = (release: GithubRelease) =>
  release.tag_name.replace(/^v/u, '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '?')

/** The release's macOS archive for this machine, as the desktop release names it. */
export function desktopZipName(version: string, arch: string): string | null {
  return arch === 'arm64' ? `Actovia-darwin-arm64-${version}.zip` : null
}

export interface DesktopUpdateDeps {
  client: DesktopClient
  askPin: AskPin
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
  /** How long to wait for the app to install the update it holds and come back. */
  installTimeoutMs?: number
  /** The download's bar: where it is drawn, and whether. */
  progress?: Omit<DownloadOptions, 'print'>
  /** Where the installed version's zip is kept for the next update. */
  cacheDir?: string
  /** electron-updater's copy of the zip it last downloaded, when the app updated itself. */
  updaterCacheZip?: string
}

const defaultCacheDir = () => join(homedir(), 'Library', 'Caches', 'actovia-cli', 'desktop')
const defaultUpdaterCacheZip = () => join(homedir(), 'Library', 'Caches', 'actovia-updater', 'update.zip')

export type DesktopUpdateResult =
  | { status: 'current'; version: string }
  /** The running app had already downloaded this version: it installed its own and restarted. */
  | { status: 'handed-off'; from: string | null; to: string }
  | {
      status: 'updated'
      from: string | null
      to: string
      relaunched: boolean
      /**
       * The replaced app was not the team's (ad-hoc, before 2.5): the Keychain
       * asks once for "Actovia Safe Storage" before the new one can read it.
       */
      keychainPrompt: boolean
    }

/**
 * Replaces the installed app with the latest release: downloaded — only the
 * blocks that changed when the installed version's zip is kept from the last
 * update (`buildFromBlockmap`), else whole — checked against the release's
 * `SHA256SUMS` (a release without them is refused) and its code signature,
 * unpacked beside the installed one, and swapped in once
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

  // A running app is quit through the API with a pass, so the PIN is asked
  // now: a typo then costs nothing, not a download thrown away. And an app
  // that already holds this version (its own updater downloaded it) is asked
  // to install that — two installers racing for one bundle is the alternative.
  let viaDock = false
  if (await isAppRunning(appPath, run)) {
    const status = await client.hostStatus().catch(() => null)
    const ready = status?.update?.state === 'ready' && status.update.availableVersion === latest
    try {
      await ensurePass(client, askPin)
    } catch (err) {
      if (!quitsLikeTheDock(err)) throw err
      viaDock = true
    }
    if (ready && !viaDock && (await handOff(appPath, latest, { client, print, run, sleep, timeoutMs: deps.installTimeoutMs }))) {
      return { status: 'handed-off', from: current, to: latest }
    }
  }

  const sums = await fetchImpl(sumsAsset.browser_download_url)
  if (!sums.ok) throw new Error(`Could not read the release's checksums: ${sums.status}`)
  const expected = parseChecksums(await sums.text()).get(name)
  const matches = (bytes: Buffer) => expected === createHash('sha256').update(bytes).digest('hex')
  const label = `Actovia ${latest}`
  const cacheDir = deps.cacheDir ?? defaultCacheDir()

  // Only the blocks that changed, from the installed version's zip if one is
  // kept; otherwise (or if that fails) the whole zip, as before.
  let bytes: Buffer | null = await readKept(join(cacheDir, name), matches)
  if (bytes) print(`Using the ${label} downloaded before.`)
  const oldName = current ? desktopZipName(current, arch) : null
  const blockmap = release.assets.find(a => a.name === `${name}.blockmap`)
  const tagSuffix = `/${release.tag_name}/${name}`
  if (!bytes && oldName && blockmap && asset.browser_download_url.endsWith(tagSuffix)) {
    const oldBlockmapUrl = `${asset.browser_download_url.slice(0, -tagSuffix.length)}/v${current}/${oldName}.blockmap`
    let failure: string | null = null
    for (const oldZip of [join(cacheDir, oldName), deps.updaterCacheZip ?? defaultUpdaterCacheZip()]) {
      if (!(await exists(oldZip))) continue
      try {
        const built = await buildFromBlockmap({
          oldZip,
          oldBlockmapUrl,
          newBlockmapUrl: blockmap.browser_download_url,
          url: asset.browser_download_url,
          fetch: fetchImpl,
          label,
          print,
          progress: deps.progress
        })
        if (!matches(built.bytes)) throw new Error('the rebuilt zip does not match the release’s checksum')
        bytes = built.bytes
        break
      } catch (err) {
        failure = (err as Error).message
      }
    }
    if (!bytes && failure) print(`Could not download only what changed (${failure}); downloading the whole app.`)
  }
  if (!bytes) {
    bytes = await download(await fetchImpl(asset.browser_download_url), label, { ...deps.progress, print })
    if (!matches(bytes)) {
      throw new Error(`The downloaded ${name} does not match the release's checksum; nothing was changed.`)
    }
  }

  // Kept now, not after the swap: if the app will not quit, the next run
  // starts from here instead of downloading it again.
  await keepZip(cacheDir, name, bytes)

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

    const keychainPrompt = (await run(['codesign', '--verify', `-R=${TEAM_REQUIREMENT}`, appPath])).code !== 0
    const wasRunning = await quitRunningApp(appPath, { client, askPin, print, run, sleep, viaDock, timeoutMs: deps.quitTimeoutMs })

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
    return { status: 'updated', from: current, to: latest, relaunched: wasRunning, keychainPrompt }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`No permission to replace ${appPath}. Download it from ${DESKTOP_RELEASES_URL} instead (not with sudo: the app would end up owned by root).`)
    }
    throw err
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * Keeps the installed version's zip for the next update's blockmap download,
 * in place of any older one. Best effort: an update without it is a whole
 * download next time, nothing worse.
 */
async function keepZip(cacheDir: string, name: string, bytes: Buffer): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true })
    for (const other of await readdir(cacheDir)) if (other !== name) await rm(join(cacheDir, other), { force: true })
    await writeFile(join(cacheDir, name), bytes)
  } catch {
    // Disk full, a read-only cache: the update itself is done.
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
    askPin: AskPin
    print: (text: string) => void
    run: Run
    sleep: (ms: number) => Promise<void>
    /** The API was found to have no way to quit it (see `quitsLikeTheDock`). */
    viaDock?: boolean
    timeoutMs?: number
  }
): Promise<boolean> {
  const { client, askPin, print, run, sleep } = deps
  if (!(await isAppRunning(appPath, run))) return false
  print('Quitting Actovia so it can be replaced…')
  let asDock = deps.viaDock ?? false
  if (!asDock) {
    try {
      await ensurePass(client, askPin)
      await client.quit()
    } catch (err) {
      if (!quitsLikeTheDock(err)) throw err
      asDock = true
    }
  }
  if (asDock) await run(['osascript', '-e', 'tell application "Actovia" to quit'])
  const deadline = Date.now() + (deps.timeoutMs ?? 60_000)
  while (await isAppRunning(appPath, run)) {
    if (Date.now() > deadline) throw new Error('Actovia did not quit; nothing was changed. Quit it and try again.')
    await sleep(500)
  }
  return true
}

/**
 * No way to quit it through the API: an Actovia without the route (or
 * without the pass route, which a locked one answers as APP_LOCKED), or no
 * PIN set. It is asked the way the Dock asks instead.
 */
function quitsLikeTheDock(err: unknown): boolean {
  return (
    err instanceof DesktopApiError &&
    (err.status === 404 || ['UNREACHABLE', 'PIN_NOT_SET', 'APP_LOCKED'].includes(err.code))
  )
}

/**
 * Asks the running app to install the update its own updater downloaded
 * (Squirrel, which checked the team's signature) and waits until the
 * installed app is that version. False when this Actovia has no such route,
 * so the update goes on as before.
 */
async function handOff(
  appPath: string,
  latest: string,
  deps: {
    client: DesktopClient
    print: (text: string) => void
    run: Run
    sleep: (ms: number) => Promise<void>
    timeoutMs?: number
  }
): Promise<boolean> {
  const { client, print, run, sleep } = deps
  try {
    await client.installUpdate()
  } catch (err) {
    if (err instanceof DesktopApiError && err.status === 404) return false
    throw err
  }
  print(`Actovia had already downloaded ${latest}; it is installing it and will reopen…`)
  const deadline = Date.now() + (deps.timeoutMs ?? 180_000)
  while ((await appVersion(appPath, run)) !== latest) {
    if (Date.now() > deadline) {
      throw new Error(`Actovia was asked to install ${latest} but is not on it yet. Check Settings → About.`)
    }
    await sleep(1000)
  }
  return true
}

/** A zip kept by an earlier run, when it is the one the release names. */
async function readKept(path: string, matches: (bytes: Buffer) => boolean): Promise<Buffer | null> {
  try {
    const bytes = await readFile(path)
    return matches(bytes) ? bytes : null
  } catch {
    return null
  }
}
