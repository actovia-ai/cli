import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getActoviaHome } from './paths'
import { colorEnabled, makeStyle } from './style'
import { getCurrentVersion, getLatestVersion, isNewerVersion } from './updater'

const CACHE_FILE = 'update-check.json'

/** How long a cached answer is trusted before we look again. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Hidden argv entry that puts the CLI into "just refresh the cache" mode. */
export const UPDATE_CHECK_ARG = '__update-check'

export interface UpdateCache {
  checkedAt: number
  latest: string
}

export function getUpdateCachePath(actoviaHome: string = getActoviaHome()): string {
  return join(actoviaHome, CACHE_FILE)
}

export async function readUpdateCache(
  actoviaHome: string = getActoviaHome()
): Promise<UpdateCache | null> {
  try {
    const parsed = JSON.parse(
      await readFile(getUpdateCachePath(actoviaHome), 'utf-8')
    ) as Partial<UpdateCache>
    if (typeof parsed?.checkedAt !== 'number' || typeof parsed?.latest !== 'string') return null
    return { checkedAt: parsed.checkedAt, latest: parsed.latest }
  } catch {
    // Missing or corrupt cache is not an error — it just means "check again".
    return null
  }
}

export async function writeUpdateCache(
  cache: UpdateCache,
  actoviaHome: string = getActoviaHome()
): Promise<void> {
  const path = getUpdateCachePath(actoviaHome)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(cache))
}

export function isCacheStale(cache: UpdateCache | null, now: number = Date.now()): boolean {
  if (!cache) return true
  const age = now - cache.checkedAt
  // A negative age means the clock moved backwards or the file was hand-edited;
  // re-check instead of trusting the entry until the clock catches up.
  return age < 0 || age >= CHECK_INTERVAL_MS
}

export function getUpdateNotice(current: string, cache: UpdateCache | null, color = false): string | null {
  if (!cache || !isNewerVersion(current, cache.latest)) return null
  const st = makeStyle(color)
  return `${st.yellow('!')} Actovia CLI ${cache.latest} is out (this is ${current}) ${st.dim('·')} ${st.cyan('actovia update')}`
}

/** The compact form shown inside the TUI tab bar, where space is tight. */
export function formatUpdateBadge(current: string, cache: UpdateCache | null): string | null {
  if (!cache || !isNewerVersion(current, cache.latest)) return null
  return `Update available: ${cache.latest}`
}

export async function getUpdateBadge(
  actoviaHome: string = getActoviaHome(),
  current: string = getCurrentVersion()
): Promise<string | null> {
  return formatUpdateBadge(current, await readUpdateCache(actoviaHome))
}

export function buildRefreshCommand(
  argv: string[] = process.argv,
  execPath: string = process.execPath
): string[] {
  const entry = argv[1]
  // A compiled single-file binary reports itself as both the executable and the
  // entry point, so passing the entry through would just duplicate the argument.
  if (!entry || entry === execPath) return [execPath, UPDATE_CHECK_ARG]
  return [execPath, entry, UPDATE_CHECK_ARG]
}

export async function refreshUpdateCache(
  actoviaHome: string = getActoviaHome(),
  fetchLatest: () => Promise<string> = getLatestVersion,
  now: () => number = Date.now
): Promise<void> {
  try {
    const latest = await fetchLatest()
    await writeUpdateCache({ checkedAt: now(), latest }, actoviaHome)
  } catch {
    // A launch-time check is a convenience, never a reason to fail the command
    // or to discard the previous answer. Stay quiet and try again next launch.
  }
}

/**
 * Re-invokes this CLI as a detached child that refreshes the cache and exits.
 * Doing the lookup out-of-process is what keeps the check off the critical
 * path: an in-flight fetch is a ref'd handle, so awaiting it here — or even
 * leaving it dangling — would hold the parent open until the network answers.
 */
export function spawnBackgroundRefresh(): void {
  const child = Bun.spawn({
    cmd: buildRefreshCommand(),
    stdio: ['ignore', 'ignore', 'ignore']
  })
  child.unref()
}

/**
 * Reads the cached result for the notice to show at exit, and kicks off a
 * background refresh when that result has gone stale. Never throws, never
 * blocks on the network.
 */
export async function prepareUpdateNotice(
  opts: {
    actoviaHome?: string
    current?: string
    now?: number
    spawnRefresh?: () => void
  } = {}
): Promise<string | null> {
  const {
    actoviaHome = getActoviaHome(),
    current = getCurrentVersion(),
    now = Date.now(),
    spawnRefresh = spawnBackgroundRefresh
  } = opts

  const cache = await readUpdateCache(actoviaHome)

  if (isCacheStale(cache, now)) {
    try {
      spawnRefresh()
    } catch {
      // Spawning can fail on locked-down machines. That only costs us the
      // next notice, so it must never surface to the user.
    }
  }

  return getUpdateNotice(current, cache, colorEnabled(process.stderr))
}
