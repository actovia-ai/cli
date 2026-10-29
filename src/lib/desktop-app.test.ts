import { beforeEach, describe, expect, test } from 'bun:test'
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
function fakeRun(
  opts: {
    version?: string | (() => string)
    running?: number
    codesign?: number | ((command: string[]) => number)
  } = {}
) {
  const ran: string[] = []
  const commands: string[][] = []
  let running = opts.running ?? 0
  const run: Run = async command => {
    ran.push(command[0]!)
    commands.push(command)
    switch (command[0]) {
      case 'plutil':
        return { code: 0, stdout: `${(typeof opts.version === 'function' ? opts.version() : opts.version) ?? '2.1.0'}\n` }
      case 'ditto': {
        const app = join(command[4]!, 'Actovia.app')
        await mkdir(app)
        await writeFile(join(app, 'which'), 'new')
        return { code: 0, stdout: '' }
      }
      case 'codesign':
        return { code: typeof opts.codesign === 'function' ? opts.codesign(command) : (opts.codesign ?? 0), stdout: '' }
      case 'pgrep':
        return { code: running-- > 0 ? 0 : 1, stdout: '' }
      default:
        return { code: 0, stdout: '' }
    }
  }
  return { run, ran, commands }
}

const quietClient = (calls: string[] = []) => {
  const client = {
    authorized: false,
    hostStatus: async () => ({ update: { mode: 'auto', state: 'idle', availableVersion: null } }),
    authorize: async () => {
      calls.push('authorize')
      client.authorized = true
    },
    quit: async () => calls.push('quit')
  }
  return client as unknown as DesktopClient
}

const scratchCaches = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'actovia-caches-'))
  return {
    cacheDir: join(dir, 'actovia-cli', 'desktop'),
    updaterCacheZip: join(dir, 'actovia-updater', 'update.zip'),
    updaterPendingDir: join(dir, 'actovia-updater', 'pending')
  }
}
const base = {
  askPin: async () => '1234',
  print: () => {},
  platform: 'darwin' as const,
  arch: 'arm64',
  sleep: async () => {},
  ...(await scratchCaches())
}
// A zip one test keeps must not be another's download.
beforeEach(async () => {
  Object.assign(base, await scratchCaches())
})

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
    expect(result).toEqual({ status: 'updated', from: '2.1.0', to: '2.2.0', relaunched: false, keychainPrompt: false })
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
      hostStatus: async () => {
        throw new DesktopApiError('old', 404, 'NOT_FOUND')
      },
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

  test('only replacing an app the team did not sign makes macOS ask for the keychain again', async () => {
    const requirement = '-R=anchor apple generic and certificate leaf[subject.OU] = "A542S7SY83"'
    for (const [oldSigned, prompt] of [
      [true, false],
      [false, true]
    ] as const) {
      const { appPath } = await installed()
      // The installed app is checked against the team's requirement before it is replaced.
      const { run, commands } = fakeRun({
        codesign: command => (command.includes(requirement) && command.at(-1) === appPath && !oldSigned ? 3 : 0)
      })
      const result = await updateDesktopApp({
        ...base,
        client: quietClient(),
        run,
        appPath,
        release: release(),
        fetch: fetchFor(`${sum}  ${zipName}\n`)
      })
      expect(result).toMatchObject({ status: 'updated', keychainPrompt: prompt })
      expect(commands.some(c => c.includes(requirement) && c.at(-1) === appPath)).toBe(true)
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

  test('with the app running, the PIN is asked before anything is downloaded', async () => {
    const { appPath } = await installed()
    const { run } = fakeRun({ running: 5 })
    const fetched: string[] = []
    const client = {
      authorized: false,
      hostStatus: async () => ({ update: { mode: 'auto', state: 'idle', availableVersion: null } }),
      authorize: async () => {
        throw new DesktopApiError('Wrong PIN.', 401, 'WRONG_PIN')
      }
    } as unknown as DesktopClient
    const fetchSpy = (async (url: string) => {
      fetched.push(url)
      return url === 'https://x/sums' ? new Response(`${sum}  ${zipName}\n`) : new Response(zip)
    }) as unknown as typeof fetch
    await expect(
      updateDesktopApp({ ...base, client, run, appPath, release: release(), fetch: fetchSpy })
    ).rejects.toThrow(/Wrong PIN/)
    expect(fetched).not.toContain('https://x/zip')
    expect(await readFile(join(appPath, 'which'), 'utf8')).toBe('old')
  })

  test('a download that passed its checksum is kept, so a run after a failed swap downloads nothing', async () => {
    const { appPath } = await installed()
    // First run: the app will not quit, so nothing is swapped.
    const stuck = fakeRun({ running: 1000 })
    await expect(
      updateDesktopApp({
        ...base,
        client: quietClient(),
        run: stuck.run,
        appPath,
        release: release(),
        fetch: fetchFor(`${sum}  ${zipName}\n`),
        quitTimeoutMs: -1
      })
    ).rejects.toThrow(/did not quit/)
    expect(await readFile(join(base.cacheDir, zipName))).toEqual(zip)

    const fetched: string[] = []
    const fetchSpy = (async (url: string) => {
      fetched.push(url)
      return url === 'https://x/sums' ? new Response(`${sum}  ${zipName}\n`) : new Response('not this')
    }) as unknown as typeof fetch
    const result = await updateDesktopApp({
      ...base,
      client: quietClient(),
      run: fakeRun().run,
      appPath,
      release: release(),
      fetch: fetchSpy
    })
    expect(result).toMatchObject({ status: 'updated', to: '2.2.0' })
    expect(fetched).toEqual(['https://x/sums'])
  })

  test('a kept zip that does not match the checksum is downloaded again', async () => {
    const { appPath } = await installed()
    await mkdir(base.cacheDir, { recursive: true })
    await writeFile(join(base.cacheDir, zipName), 'tampered')
    const result = await updateDesktopApp({
      ...base,
      client: quietClient(),
      run: fakeRun().run,
      appPath,
      release: release(),
      fetch: fetchFor(`${sum}  ${zipName}\n`)
    })
    expect(result).toMatchObject({ status: 'updated' })
    expect(await readFile(join(base.cacheDir, zipName))).toEqual(zip)
  })

  test('the app already holds this update: it installs its own, and nothing is downloaded', async () => {
    const { appPath } = await installed()
    let installed_ = false
    const { run } = fakeRun({ running: 1, version: () => (installed_ ? '2.2.0' : '2.1.0') })
    const calls: string[] = []
    const client = {
      authorized: false,
      hostStatus: async () => ({ update: { mode: 'auto', state: 'ready', availableVersion: '2.2.0' } }),
      authorize: async () => calls.push('authorize'),
      installUpdate: async () => {
        calls.push('installUpdate')
        installed_ = true
      }
    } as unknown as DesktopClient
    const fetchNever = (async () => {
      throw new Error('fetched')
    }) as unknown as typeof fetch
    const result = await updateDesktopApp({ ...base, client, run, appPath, release: release(), fetch: fetchNever })
    expect(result).toEqual({ status: 'handed-off', from: '2.1.0', to: '2.2.0' })
    expect(calls).toEqual(['authorize', 'installUpdate'])
  })

  test('an Actovia without the install route, or with another version ready, is updated as before', async () => {
    for (const [availableVersion, install] of [
      ['2.2.0', async () => { throw new DesktopApiError('old', 404, 'NOT_FOUND') }],
      ['2.1.5', async () => { throw new Error('not called') }]
    ] as const) {
      const { appPath } = await installed()
      const { run } = fakeRun({ running: 3 })
      const client = {
        authorized: false,
        hostStatus: async () => ({ update: { mode: 'auto', state: 'ready', availableVersion } }),
        authorize: async () => {},
        installUpdate: install,
        quit: async () => {}
      } as unknown as DesktopClient
      const result = await updateDesktopApp({ ...base, client, run, appPath, release: release(), fetch: fetchFor(`${sum}  ${zipName}\n`) })
      expect(result).toMatchObject({ status: 'updated', to: '2.2.0' })
    }
  })

  test('the status is read once the PIN is in: an app that restarted meanwhile is asked, not the one that quit', async () => {
    const { appPath } = await installed()
    const calls: string[] = []
    const client = {
      authorized: false,
      hostStatus: async () => {
        calls.push('hostStatus')
        return { update: { mode: 'auto', state: 'idle', availableVersion: null } }
      },
      authorize: async () => {
        calls.push('authorize')
        client.authorized = true
      },
      installUpdate: async () => calls.push('installUpdate'),
      quit: async () => calls.push('quit')
    }
    await updateDesktopApp({
      ...base,
      client: client as unknown as DesktopClient,
      run: fakeRun({ running: 3 }).run,
      appPath,
      release: release(),
      fetch: fetchFor(`${sum}  ${zipName}\n`)
    })
    expect(calls.slice(0, 2)).toEqual(['authorize', 'hostStatus'])
    expect(calls).not.toContain('installUpdate')
  })

  test('an app that installed the update itself while the PIN was typed: 409, and it is already there', async () => {
    const { appPath } = await installed()
    let checks = 0
    // Read 2.1.0 before the PIN, 2.2.0 once the app has put its update in.
    const { run } = fakeRun({ running: 1, version: () => (checks++ === 0 ? '2.1.0' : '2.2.0') })
    const client = {
      authorized: false,
      hostStatus: async () => ({ update: { mode: 'auto', state: 'ready', availableVersion: '2.2.0' } }),
      authorize: async () => {},
      installUpdate: async () => {
        throw new DesktopApiError('not ready', 409, 'UPDATE_NOT_READY')
      }
    } as unknown as DesktopClient
    const fetchNever = (async () => {
      throw new Error('fetched')
    }) as unknown as typeof fetch
    const result = await updateDesktopApp({ ...base, client, run, appPath, release: release(), fetch: fetchNever })
    expect(result).toEqual({ status: 'handed-off', from: '2.1.0', to: '2.2.0' })
  })

  test('409 on an app still on the old version: it is downloaded and swapped as before', async () => {
    const { appPath } = await installed()
    const client = {
      authorized: false,
      hostStatus: async () => ({ update: { mode: 'auto', state: 'ready', availableVersion: '2.2.0' } }),
      authorize: async () => {},
      installUpdate: async () => {
        throw new DesktopApiError('not ready', 409, 'UPDATE_NOT_READY')
      },
      quit: async () => {}
    } as unknown as DesktopClient
    const result = await updateDesktopApp({
      ...base,
      client,
      run: fakeRun({ running: 3 }).run,
      appPath,
      release: release(),
      fetch: fetchFor(`${sum}  ${zipName}\n`)
    })
    expect(result).toMatchObject({ status: 'updated', to: '2.2.0' })
  })

  test("the zip Actovia's own updater downloaded is used, and it says so", async () => {
    const { appPath } = await installed()
    await mkdir(base.updaterPendingDir, { recursive: true })
    await writeFile(join(base.updaterPendingDir, zipName), zip)
    const printed: string[] = []
    const fetched: string[] = []
    const fetchSumsOnly = (async (url: string) => {
      fetched.push(url)
      if (url === 'https://x/sums') return new Response(`${sum}  ${zipName}\n`)
      throw new Error('downloaded the zip')
    }) as unknown as typeof fetch
    const result = await updateDesktopApp({
      ...base,
      print: text => printed.push(text),
      client: quietClient(),
      run: fakeRun().run,
      appPath,
      release: release(),
      fetch: fetchSumsOnly
    })
    expect(result).toMatchObject({ status: 'updated', to: '2.2.0' })
    expect(fetched).toEqual(['https://x/sums'])
    expect(printed.join('\n')).toContain('Found Actovia 2.2.0 already downloaded by the app; nothing to download.')
  })

  test("so is its update.zip, once the app has copied the new version there", async () => {
    const { appPath } = await installed()
    await mkdir(join(base.updaterCacheZip, '..'), { recursive: true })
    await writeFile(base.updaterCacheZip, zip)
    const fetched: string[] = []
    const fetchSumsOnly = (async (url: string) => {
      fetched.push(url)
      if (url === 'https://x/sums') return new Response(`${sum}  ${zipName}\n`)
      throw new Error('downloaded the zip')
    }) as unknown as typeof fetch
    const result = await updateDesktopApp({ ...base, client: quietClient(), run: fakeRun().run, appPath, release: release(), fetch: fetchSumsOnly })
    expect(result).toMatchObject({ status: 'updated', to: '2.2.0' })
    expect(fetched).toEqual(['https://x/sums'])
  })

  test("a zip in the updater's folder that is not the release's is ignored", async () => {
    const { appPath } = await installed()
    await mkdir(base.updaterPendingDir, { recursive: true })
    await writeFile(join(base.updaterPendingDir, zipName), 'tampered')
    const fetched: string[] = []
    const fetchAll = (async (url: string) => {
      fetched.push(url)
      return url === 'https://x/sums' ? new Response(`${sum}  ${zipName}\n`) : new Response(zip)
    }) as unknown as typeof fetch
    const result = await updateDesktopApp({ ...base, client: quietClient(), run: fakeRun().run, appPath, release: release(), fetch: fetchAll })
    expect(result).toMatchObject({ status: 'updated', to: '2.2.0' })
    expect(fetched).toContain('https://x/zip')
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
    expect(result).toEqual({ status: 'updated', from: '2.1.0', to: '2.2.0', relaunched: false, keychainPrompt: false })
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
