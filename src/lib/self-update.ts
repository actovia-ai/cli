import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { download, type DownloadOptions } from './progress'
import { colorEnabled, makeStyle } from './style'
import { getLatestRelease, type GithubRelease, pickReleaseAssetName } from './updater'

/**
 * `actovia update` installing the new version itself, the way it was
 * installed: a global package through the same package manager, or — for a
 * standalone binary — the release asset for this platform, written over the
 * running executable.
 */

export type PackageManager = 'npm' | 'bun' | 'pnpm' | 'yarn'

const PACKAGE = '@actovia-ai/cli'

/** Which manager installed the global package, read off where it lives; npm when nothing says otherwise. */
export function detectPackageManager(entry: string = process.argv[1] ?? ''): PackageManager {
  const path = entry.replaceAll('\\', '/')
  if (path.includes('/.bun/')) return 'bun'
  if (path.includes('/pnpm/') || path.includes('/.pnpm/')) return 'pnpm'
  if (path.includes('/yarn/') || path.includes('/.yarn/')) return 'yarn'
  return 'npm'
}

export function installCommand(manager: PackageManager, version = 'latest'): string[] {
  const spec = `${PACKAGE}@${version}`
  switch (manager) {
    case 'bun':
      return ['bun', 'add', '-g', spec]
    case 'pnpm':
      return ['pnpm', 'add', '-g', spec]
    case 'yarn':
      return ['yarn', 'global', 'add', spec]
    default:
      return ['npm', 'install', '-g', spec]
  }
}

const dim = (s: string) => makeStyle(colorEnabled(process.stdout)).dim(s)

export type Run = (command: string[]) => Promise<number>

export const runInherited: Run = command =>
  new Promise(resolve => {
    const child = spawn(command[0]!, command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', () => resolve(127))
    child.on('exit', code => resolve(code ?? 1))
  })

export async function updatePackage(
  version: string,
  deps: { run?: Run; entry?: string; print?: (text: string) => void } = {}
): Promise<boolean> {
  const run = deps.run ?? runInherited
  const print = deps.print ?? console.log
  const command = installCommand(detectPackageManager(deps.entry), version)
  print(`  ${dim(`$ ${command.join(' ')}`)}`)
  const code = await run(command)
  if (code === 0) return true
  print(
    `That did not work (exit ${code}). Run it yourself${process.platform === 'win32' ? '' : ' — with sudo if the global folder needs it'}: ${command.join(' ')}`
  )
  return false
}

/** `SHA256SUMS`, as `sha256sum` writes it: `<hex>  <name>` per line. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/iu.exec(line.trim())
    if (match) sums.set(match[2]!, match[1]!.toLowerCase())
  }
  return sums
}

export interface BinaryDeps {
  fetch?: typeof fetch
  release?: GithubRelease
  execPath?: string
  platform?: NodeJS.Platform
  arch?: string
  print?: (text: string) => void
  /** The download's bar: where it is drawn, and whether. */
  progress?: Omit<DownloadOptions, 'print'>
}

/**
 * Downloads this platform's binary from the latest release and puts it where
 * the running one is: written beside it, checked against the release's
 * `SHA256SUMS` (a release without one is refused), made executable, then renamed over it (the
 * same folder, so the swap is atomic). Windows will not overwrite a running
 * executable, so there the old one is moved aside first.
 */
export async function updateBinary(deps: BinaryDeps = {}): Promise<boolean> {
  const fetchImpl = deps.fetch ?? fetch
  const print = deps.print ?? console.log
  const platform = deps.platform ?? process.platform
  const execPath = deps.execPath ?? process.execPath
  const name = pickReleaseAssetName(platform, deps.arch ?? process.arch)
  if (!name) throw new Error(`No Actovia CLI binary is built for ${platform} ${deps.arch ?? process.arch}.`)
  const release = deps.release ?? (await getLatestRelease())
  const asset = release.assets.find(a => a.name === name)
  if (!asset) throw new Error(`The ${release.tag_name} release has no ${name}.`)

  const bytes = await download(await fetchImpl(asset.browser_download_url), `${name} (${release.tag_name})`, { ...deps.progress, print })
  if (bytes.length === 0) throw new Error('Download failed: the file was empty.')

  // A release without checksums is refused, not trusted: leaving the file
  // out must not be a way around the check.
  const sumsAsset = release.assets.find(a => a.name === 'SHA256SUMS')
  if (!sumsAsset) {
    throw new Error(
      `The ${release.tag_name} release has no checksums, so ${name} cannot be checked; nothing was changed. Download it from ${asset.browser_download_url}`
    )
  }
  const sums = await fetchImpl(sumsAsset.browser_download_url)
  if (!sums.ok) throw new Error(`Could not read the release's checksums: ${sums.status}`)
  const expected = parseChecksums(await sums.text()).get(name)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (!expected || expected !== actual) {
    throw new Error(`The downloaded ${name} does not match the release's checksum; nothing was changed.`)
  }

  const next = join(dirname(execPath), `.${name}.new`)
  await writeFile(next, bytes, { mode: 0o755 })
  try {
    await chmod(next, 0o755)
    if (platform === 'win32') {
      const old = `${execPath}.old`
      await rm(old, { force: true })
      await rename(execPath, old)
    }
    await rename(next, execPath)
  } catch (err) {
    await rm(next, { force: true })
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`No permission to replace ${execPath}. Run actovia update with sudo, or download it from ${asset.browser_download_url}`)
    }
    throw err
  }
  return true
}
