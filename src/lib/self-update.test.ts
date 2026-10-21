import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectPackageManager, installCommand, parseChecksums, updateBinary, updatePackage } from './self-update'

describe('installing a package update', () => {
  test('uses the manager the global package lives under', () => {
    expect(detectPackageManager('/Users/me/.bun/install/global/node_modules/@actovia-ai/cli/dist/index.js')).toBe('bun')
    expect(detectPackageManager('/Users/me/Library/pnpm/global/5/node_modules/@actovia-ai/cli/dist/index.js')).toBe('pnpm')
    expect(detectPackageManager('/usr/local/lib/node_modules/@actovia-ai/cli/dist/index.js')).toBe('npm')
    expect(installCommand('bun', '2.2.0')).toEqual(['bun', 'add', '-g', '@actovia-ai/cli@2.2.0'])
    expect(installCommand('npm', '2.2.0')).toEqual(['npm', 'install', '-g', '@actovia-ai/cli@2.2.0'])
  })

  test('runs it, and says what to run when it fails', async () => {
    const ran: string[][] = []
    const lines: string[] = []
    expect(await updatePackage('2.2.0', { run: async c => (ran.push(c), 0), entry: '/x/.bun/y', print: l => lines.push(l) })).toBe(true)
    expect(ran).toEqual([['bun', 'add', '-g', '@actovia-ai/cli@2.2.0']])
    expect(await updatePackage('2.2.0', { run: async () => 243, entry: '/usr/lib/node_modules/x', print: l => lines.push(l) })).toBe(false)
    expect(lines.at(-1)).toMatch(/npm install -g @actovia-ai\/cli@2\.2\.0/)
  })
})

describe('replacing the binary', () => {
  const name = 'actovia-darwin-arm64'
  const binary = Buffer.from('#!/bin/sh\necho new\n')
  const sum = createHash('sha256').update(binary).digest('hex')

  function release(sums?: string) {
    const assets = [{ name, browser_download_url: 'https://x/bin' }]
    if (sums !== undefined) assets.push({ name: 'SHA256SUMS', browser_download_url: 'https://x/sums' })
    const fetchImpl = (async (url: string) =>
      url === 'https://x/sums' ? new Response(sums) : new Response(binary)) as unknown as typeof fetch
    return { release: { tag_name: 'v2.2.0', assets }, fetch: fetchImpl }
  }

  async function installed() {
    const dir = await mkdtemp(join(tmpdir(), 'actovia-update-'))
    const execPath = join(dir, 'actovia')
    await writeFile(execPath, 'old')
    return execPath
  }

  test('swaps in the download when it matches the checksums', async () => {
    const execPath = await installed()
    await updateBinary({ ...release(`${sum}  ${name}\n`), execPath, platform: 'darwin', arch: 'arm64', print: () => {} })
    expect((await readFile(execPath)).equals(binary)).toBe(true)
  })

  test('changes nothing when the checksum does not match', async () => {
    const execPath = await installed()
    const wrong = release(`${'0'.repeat(64)}  ${name}\n`)
    await expect(updateBinary({ ...wrong, execPath, platform: 'darwin', arch: 'arm64', print: () => {} })).rejects.toThrow(/checksum/)
    expect(await readFile(execPath, 'utf8')).toBe('old')
  })

  test('changes nothing when the release has no checksums', async () => {
    const execPath = await installed()
    await expect(updateBinary({ ...release(), execPath, platform: 'darwin', arch: 'arm64', print: () => {} })).rejects.toThrow(
      /no checksums/
    )
    expect(await readFile(execPath, 'utf8')).toBe('old')
  })

  test('changes nothing when the checksums do not list this binary', async () => {
    const execPath = await installed()
    const other = release(`${sum}  actovia-linux-x64\n`)
    await expect(updateBinary({ ...other, execPath, platform: 'darwin', arch: 'arm64', print: () => {} })).rejects.toThrow(/checksum/)
    expect(await readFile(execPath, 'utf8')).toBe('old')
  })

  test('reads sha256sum output', () => {
    expect(parseChecksums(`${sum}  ${name}\n${sum} *other\n`).get(name)).toBe(sum)
  })
})
