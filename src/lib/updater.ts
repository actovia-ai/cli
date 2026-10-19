import { version as currentVersion } from '../../package.json'
import { DIST_CHANNEL } from './dist-channel'

export { DIST_CHANNEL }

export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'
export const DEFAULT_GITHUB_API = 'https://api.github.com/repos/actovia-ai/cli'

export function getCurrentVersion(): string {
  return currentVersion
}

export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

export function pickReleaseAssetName(platform: NodeJS.Platform, arch: string): string | null {
  const platformName = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : null
  if (!platformName) return null
  if (arch !== 'x64' && arch !== 'arm64') return null
  const suffix = platform === 'win32' ? '.exe' : ''
  return `actovia-${platformName}-${arch}${suffix}`
}

export async function getLatestNpmVersion(
  baseUrl: string = DEFAULT_NPM_REGISTRY
): Promise<string> {
  const res = await fetch(`${baseUrl}/@actovia-ai%2Fcli/latest`)
  if (!res.ok) throw new Error(`npm registry lookup failed: ${res.status}`)
  const body = (await res.json()) as { version: string }
  return body.version
}

export interface GithubReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GithubRelease {
  tag_name: string
  assets: GithubReleaseAsset[]
}

export async function getLatestRelease(
  baseUrl: string = DEFAULT_GITHUB_API
): Promise<GithubRelease> {
  const res = await fetch(`${baseUrl}/releases/latest`)
  if (!res.ok) throw new Error(`GitHub releases lookup failed: ${res.status}`)
  return (await res.json()) as GithubRelease
}

export type UpdateCheckResult =
  | { updateAvailable: false; current: string }
  | { updateAvailable: true; current: string; latest: string }

/** The newest published version for whichever channel this build ships on. */
export async function getLatestVersion(): Promise<string> {
  return DIST_CHANNEL === 'npm'
    ? await getLatestNpmVersion()
    : (await getLatestRelease()).tag_name.replace(/^v/, '')
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = getCurrentVersion()
  const latest = await getLatestVersion()
  if (!isNewerVersion(current, latest)) {
    return { updateAvailable: false, current }
  }
  return { updateAvailable: true, current, latest }
}
