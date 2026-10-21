import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const base = { askPin: async () => '1234', print: () => {}, platform: 'darwin' as const, arch: 'arm64', sleep: async () => {} }

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
