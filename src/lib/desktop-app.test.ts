import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { type Run, updateDesktopApp } from './desktop-app'
import { DesktopApiError, type DesktopClient } from './desktop-client'

const zipName = 'Actovia-darwin-arm64-2.2.0.zip'
const zip = Buffer.from('zip bytes')
const sum = createHash('sha256').update(zip).digest('hex')

function release(sums: string | null = `${sum}  ${zipName}\n`) {
  const assets = [{ name: zipName, browser_download_url: 'https://x/zip' }]
  if (sums !== null) assets.push({ name: 'SHA256SUMS', browser_download_url: 'https://x/sums' })
  return { tag_name: 'v2.2.0', assets }
}

const fetchFor = (sums: string) =>
  (async (url: string) => (url === 'https://x/sums' ? new Response(sums) : new Response(zip))) as unknown as typeof fetch

async function installed() {
  const dir = await mkdtemp(join(tmpdir(), 'actovia-apps-'))
  const appPath = join(dir, 'Actovia.app')
  await mkdir(appPath)
  await writeFile(join(appPath, 'which'), 'old')
  return { dir, appPath }
}

/** plutil, ditto, codesign, pgrep and open, as the update calls them. */
function fakeRun(opts: { version?: string; running?: number; codesign?: number } = {}) {
  const ran: string[] = []
  let running = opts.running ?? 0
  const run: Run = async command => {
    ran.push(command[0]!)
    switch (command[0]) {
      case 'plutil':
        return { code: 0, stdout: `${opts.version ?? '2.1.0'}\n` }
      case 'ditto': {
        const app = join(command[4]!, 'Actovia.app')
        await mkdir(app)
        await writeFile(join(app, 'which'), 'new')
        return { code: 0, stdout: '' }
      }
      case 'codesign':
        return { code: opts.codesign ?? 0, stdout: '' }
      case 'pgrep':
        return { code: running-- > 0 ? 0 : 1, stdout: '' }
      default:
        return { code: 0, stdout: '' }
    }
  }
  return { run, ran }
}

const quietClient = (calls: string[] = []) =>
  ({
    authorized: false,
    authorize: async () => calls.push('authorize'),
    quit: async () => calls.push('quit')
  }) as unknown as DesktopClient

const scratchCaches = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'actovia-caches-'))
  return { cacheDir: join(dir, 'actovia-cli', 'desktop'), updaterCacheZip: join(dir, 'actovia-updater', 'update.zip') }
}
const base = {
  askPin: async () => '1234',
  print: () => {},
  platform: 'darwin' as const,
  arch: 'arm64',
  sleep: async () => {},
  ...(await scratchCaches())
}

describe('actovia app update', () => {
  test('swaps the new app in once it is checked, leaving nothing behind', async () => {
    const { dir, appPath } = await installed()
    const { run, ran } = fakeRun()
    const result = await updateDesktopApp({
      ...base,
      client: quietClient(),
      run,
      appPath,
      release: release(),
      fetch: fetchFor(`${sum}  ${zipName}\n`)
    })
    expect(result).toEqual({ status: 'updated', from: '2.1.0', to: '2.2.0', relaunched: false })
    expect(await readFile(join(appPath, 'which'), 'utf8')).toBe('new')
    expect(await readdir(dir)).toEqual(['Actovia.app'])
    expect(ran).not.toContain('open')
  })

  test('the download draws its bar on the terminal and says when it is done', async () => {
    const { appPath } = await installed()
    const { run } = fakeRun()
    const printed: string[] = []
    const written: string[] = []
    await updateDesktopApp({
      ...base,
      print: t => printed.push(t),
      progress: { stream: { isTTY: true, columns: 120, write: c => written.push(c) }, enabled: true, color: false },
      client: quietClient(),
      run,
      appPath,
      release: release(),
      fetch: fetchFor(`${sum}  ${zipName}\n`)
    })
    expect(written.some(w => w.includes('Downloading Actovia 2.2.0'))).toBe(true)
    expect(printed[0]).toStartWith('Downloaded Actovia 2.2.0 · ')
  })

  test('quits the running app through the API first, and reopens it', async () => {
    const { appPath } = await installed()
    const { run, ran } = fakeRun({ running: 3 })
    const calls: string[] = []
    const result = await updateDesktopApp({
      ...base,
      client: quietClient(calls),
      run,
      appPath,
      release: release(),
      fetch: fetchFor(`${sum}  ${zipName}\n`)
    })
    expect(calls).toEqual(['authorize', 'quit'])
    expect(result).toMatchObject({ status: 'updated', relaunched: true })
    expect(ran.at(-1)).toBe('open')
  })

  test('an Actovia without the quit route is asked the way the Dock asks', async () => {
    const { appPath } = await installed()
    const { run, ran } = fakeRun({ running: 2 })
    const client = {
      authorized: false,
      authorize: async () => {
        throw new DesktopApiError('old', 404, 'NOT_FOUND')
      }
    } as unknown as DesktopClient
    await updateDesktopApp({ ...base, client, run, appPath, release: release(), fetch: fetchFor(`${sum}  ${zipName}\n`) })
    expect(ran).toContain('osascript')
  })

  test('changes nothing without checksums, with a wrong one, or with a broken signature', async () => {
    for (const [rel, sums, codesign, message] of [
      [release(null), '', 0, /no checksums/],
      [release(), `${'0'.repeat(64)}  ${zipName}\n`, 0, /checksum/],
      [release(), `${sum}  ${zipName}\n`, 1, /signature/]
    ] as const) {
      const { dir, appPath } = await installed()
      const { run } = fakeRun({ codesign })
      await expect(
        updateDesktopApp({ ...base, client: quietClient(), run, appPath, release: rel, fetch: fetchFor(sums) })
      ).rejects.toThrow(message)
      expect(await readFile(join(appPath, 'which'), 'utf8')).toBe('old')
      expect(await readdir(dir)).toEqual(['Actovia.app'])
    }
  })

  test('up to date: nothing is downloaded', async () => {
    const { appPath } = await installed()
    const { run } = fakeRun({ version: '2.2.0' })
    const fetchNever = (async () => {
      throw new Error('fetched')
    }) as unknown as typeof fetch
    expect(
      await updateDesktopApp({ ...base, client: quietClient(), run, appPath, release: release(), fetch: fetchNever })
    ).toEqual({ status: 'current', version: '2.2.0' })
  })

  test('elsewhere it says where the update comes from', async () => {
    await expect(updateDesktopApp({ ...base, client: quietClient(), platform: 'win32' })).rejects.toThrow(/updates itself/)
    await expect(updateDesktopApp({ ...base, client: quietClient(), platform: 'linux' })).rejects.toThrow(/releases/)
  })
})

describe('actovia app update, only what changed', () => {
  const tag = (v: string) => `https://github.com/actovia-ai/actovia/releases/download/v${v}`
  const oldName = 'Actovia-darwin-arm64-2.1.0.zip'
  /** Two zips sharing their first 6000 bytes, cut into 1000-byte blocks. */
  const oldZip = Buffer.alloc(8000, 1)
  const newZip = Buffer.concat([oldZip.subarray(0, 6000), Buffer.alloc(2000, 2)])
  /** Blockmaps naming each 1000-byte block; the zips share their first six. */
  const blockmap = (checksums: string[]) =>
    gzipSync(
      JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums, sizes: checksums.map(() => 1000) }] })
    )
  const shared = ['a', 'b', 'c', 'd', 'e', 'f']
  const oldMap = blockmap([...shared, 'old-g', 'old-h'])
  const newMap = blockmap([...shared, 'new-g', 'new-h'])
  const newSum = createHash('sha256').update(newZip).digest('hex')

  const deltaRelease = () => ({
    tag_name: 'v2.2.0',
    assets: [
      { name: zipName, browser_download_url: `${tag('2.2.0')}/${zipName}` },
      { name: `${zipName}.blockmap`, browser_download_url: `${tag('2.2.0')}/${zipName}.blockmap` },
      { name: 'SHA256SUMS', browser_download_url: `${tag('2.2.0')}/SHA256SUMS` }
    ]
  })

  /** GitHub's release host: explicit ranges only; every request recorded. */
  function host(opts: { sums?: string } = {}) {
    const asked: { url: string; range: string | null }[] = []
    const files: Record<string, Buffer> = {
      [`${tag('2.2.0')}/${zipName}`]: newZip,
      [`${tag('2.2.0')}/${zipName}.blockmap`]: newMap,
      [`${tag('2.1.0')}/${oldName}.blockmap`]: oldMap,
      [`${tag('2.2.0')}/SHA256SUMS`]: Buffer.from(opts.sums ?? `${newSum}  ${zipName}\n`)
    }
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')
      asked.push({ url, range })
      const body = files[url]
      if (!body) return new Response('', { status: 404 })
      if (!range) return new Response(body)
      const [a, b] = range.slice(6).split('-').map(Number) as [number, number]
      const headers = { 'content-range': `bytes ${a}-${b}/${body.length}` }
      return new Response(body.subarray(a, b + 1), { status: 206, headers })
    }) as unknown as typeof fetch
    return { fetchImpl, asked }
  }

  const update = (
    appPath: string,
    caches: { cacheDir: string; updaterCacheZip: string },
    fetchImpl: typeof fetch,
    printed: string[] = []
  ) =>
    updateDesktopApp({
      ...base,
      ...caches,
      print: t => printed.push(t),
      client: quietClient(),
      run: fakeRun().run,
      appPath,
      release: deltaRelease(),
      fetch: fetchImpl
    })

  async function withKeptZip(where: 'cli' | 'updater') {
    const caches = await scratchCaches()
    const path = where === 'cli' ? join(caches.cacheDir, oldName) : caches.updaterCacheZip
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, oldZip)
    return caches
  }

  test('with the installed version’s zip kept, only the changed blocks are downloaded', async () => {
    const { dir, appPath } = await installed()
    const caches = await withKeptZip('cli')
    const { run } = fakeRun()
    const { fetchImpl, asked } = host()
    const printed: string[] = []
    const result = await updateDesktopApp({
      ...base,
      ...caches,
      print: t => printed.push(t),
      client: quietClient(),
      run,
      appPath,
      release: deltaRelease(),
      fetch: fetchImpl
    })
    expect(result).toEqual({ status: 'updated', from: '2.1.0', to: '2.2.0', relaunched: false })
    expect(await readFile(join(appPath, 'which'), 'utf8')).toBe('new')
    expect(await readdir(dir)).toEqual(['Actovia.app'])
    const zipAsks = asked.filter(a => a.url.endsWith(zipName))
    expect(zipAsks).toEqual([{ url: `${tag('2.2.0')}/${zipName}`, range: 'bytes=6000-7999' }])
    expect(printed.some(p => p.startsWith('Only what changed: 2 KB of 8 KB'))).toBe(true)
    // The new version's zip is kept for the next update, in place of the old one.
    expect(await readdir(caches.cacheDir)).toEqual([zipName])
    expect(Buffer.compare(await readFile(join(caches.cacheDir, zipName)), newZip)).toBe(0)
  })

  test('the app’s own updater cache serves as the old zip too', async () => {
    const { appPath } = await installed()
    const caches = await withKeptZip('updater')
    const { fetchImpl, asked } = host()
    await update(appPath, caches, fetchImpl)
    expect(asked.filter(a => a.url.endsWith(zipName)).map(a => a.range)).toEqual(['bytes=6000-7999'])
  })

  test('nothing kept: the whole zip, and it is kept for next time', async () => {
    const { appPath } = await installed()
    const caches = await scratchCaches()
    const { fetchImpl, asked } = host()
    const printed: string[] = []
    await update(appPath, caches, fetchImpl, printed)
    expect(asked.filter(a => a.url.endsWith(zipName)).map(a => a.range)).toEqual([null])
    expect(printed.some(p => /whole app/.test(p))).toBe(false)
    expect(await readdir(caches.cacheDir)).toEqual([zipName])
  })

  test('a rebuilt zip that fails the checksum is dropped for the whole download, which must pass it', async () => {
    const { dir, appPath } = await installed()
    const caches = await withKeptZip('cli')
    // The kept zip is the right length but not the right bytes.
    await writeFile(join(caches.cacheDir, oldName), Buffer.alloc(8000, 9))
    const { fetchImpl, asked } = host()
    const printed: string[] = []
    await update(appPath, caches, fetchImpl, printed)
    expect(printed.some(p => /checksum.*whole app/.test(p))).toBe(true)
    expect(asked.filter(a => a.url.endsWith(zipName)).map(a => a.range)).toEqual(['bytes=6000-7999', null])
    expect(await readdir(dir)).toEqual(['Actovia.app'])
  })
})
