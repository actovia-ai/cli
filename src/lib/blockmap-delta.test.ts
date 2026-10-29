import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { type Blockmap, buildFromBlockmap, parseBlockmap, planBlocks } from './blockmap-delta'

/** A blockmap as app-builder writes one (fixed-size blocks here; app-builder cuts them by content). */
function blockmapOf(bytes: Buffer, blockSize = 1000): Blockmap {
  const checksums: string[] = []
  const sizes: number[] = []
  for (let at = 0; at < bytes.length; at += blockSize) {
    const block = bytes.subarray(at, at + blockSize)
    checksums.push(createHash('sha256').update(block).digest('base64').slice(0, 24))
    sizes.push(block.length)
  }
  return { version: '2', files: [{ name: 'file', offset: 0, checksums, sizes }] }
}
const gz = (map: Blockmap) => gzipSync(JSON.stringify(map))

const random = (n: number, seed: number) => {
  const out = Buffer.alloc(n)
  let x = seed
  for (let i = 0; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24
  return out
}

/** Old and new zips that share all but two blocks, one of which moved. */
function zips() {
  const old = random(10_000, 1)
  const fresh = Buffer.concat([old.subarray(0, 3000), random(1000, 2), old.subarray(4000, 9000), random(1000, 3)])
  return { old, fresh }
}

/** The new zip, its blockmap and the old blockmap, served like a GitHub release: explicit ranges only. */
function releaseHost(files: Record<string, Buffer>) {
  const asked: { url: string; range: [number, number] | null }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = files[url]
    if (!body) return new Response('not found', { status: 404 })
    const header = new Headers(init?.headers).get('range')
    if (!header) {
      asked.push({ url, range: null })
      return new Response(body)
    }
    const m = /^bytes=(\d*)-(\d*)$/u.exec(header)!
    if (m[1] === '') return new Response('', { status: 501 })
    const start = Number(m[1])
    const end = Math.min(Number(m[2]), body.length - 1)
    asked.push({ url, range: [start, end + 1] })
    return new Response(body.subarray(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${body.length}` }
    })
  }) as unknown as typeof fetch
  return { fetchImpl, asked }
}

const quiet = { print: () => {}, progress: { enabled: false } }

describe('parseBlockmap', () => {
  test('reads a gzipped version-2 blockmap', () => {
    const map = blockmapOf(Buffer.alloc(2500))
    expect(parseBlockmap(gz(map))).toEqual(map)
  })

  test('refuses another version, more than one file, or lists that disagree', () => {
    const map = blockmapOf(Buffer.alloc(2500))
    const file = map.files[0]!
    for (const bad of [
      { ...map, version: '1' },
      { ...map, files: [file, file] },
      { ...map, files: [{ ...file, sizes: [1] }] },
      { ...map, files: [{ ...file, sizes: [1000, -1, 500] }] },
      { ...map, files: [{ ...file, offset: 10 }] }
    ]) {
      expect(() => parseBlockmap(gz(bad as Blockmap))).toThrow()
    }
    expect(() => parseBlockmap(Buffer.from('not gzip'))).toThrow()
  })
})

describe('planBlocks', () => {
  test('copies the blocks the old zip has and downloads the rest, merging neighbours', () => {
    const { old, fresh } = zips()
    expect(planBlocks(blockmapOf(old), blockmapOf(fresh))).toEqual([
      { kind: 'copy', start: 0, end: 3000 },
      { kind: 'download', start: 3000, end: 4000 },
      { kind: 'copy', start: 4000, end: 9000 },
      { kind: 'download', start: 9000, end: 10_000 }
    ])
  })

  test('a block whose checksum matches but whose size does not is downloaded', () => {
    const old = blockmapOf(Buffer.alloc(1000))
    const fresh = blockmapOf(Buffer.alloc(1000))
    fresh.files[0]!.sizes[0] = 999
    expect(planBlocks(old, fresh)).toEqual([{ kind: 'download', start: 0, end: 999 }])
  })
})

describe('buildFromBlockmap', () => {
  test('rebuilds the new zip from the old one and the blocks that changed', async () => {
    const { old, fresh } = zips()
    const dir = await mkdtemp(join(tmpdir(), 'actovia-blockmap-'))
    const oldZip = join(dir, 'old.zip')
    await writeFile(oldZip, old)
    const { fetchImpl, asked } = releaseHost({
      'https://x/new.zip': fresh,
      'https://x/new.zip.blockmap': gz(blockmapOf(fresh)),
      'https://x/old.zip.blockmap': gz(blockmapOf(old))
    })

    const result = await buildFromBlockmap({
      oldZip,
      oldBlockmapUrl: 'https://x/old.zip.blockmap',
      newBlockmapUrl: 'https://x/new.zip.blockmap',
      url: 'https://x/new.zip',
      fetch: fetchImpl,
      mergeGap: 0,
      ...quiet
    })

    expect(Buffer.compare(result.bytes, fresh)).toBe(0)
    expect(result).toMatchObject({ downloaded: 2000, total: 10_000 })
    const zipRanges = asked.filter(a => a.url === 'https://x/new.zip').map(a => a.range)
    expect(zipRanges).toEqual([
      [3000, 4000],
      [9000, 10_000]
    ])
  })

  test('moved blocks are copied from where the old zip has them, and nearby downloads share one range', async () => {
    const old = random(10_000, 1)
    const block = (i: number) => old.subarray(i * 1000, (i + 1) * 1000)
    // Old block 7 moves to the front; three new blocks, the first two 1000 bytes apart.
    const fresh = Buffer.concat([block(7), random(1000, 2), block(0), random(1000, 3), block(1), block(2), random(1000, 4)])
    const dir = await mkdtemp(join(tmpdir(), 'actovia-blockmap-'))
    const oldZip = join(dir, 'old.zip')
    await writeFile(oldZip, old)
    const { fetchImpl, asked } = releaseHost({
      'https://x/new.zip': fresh,
      'https://x/new.zip.blockmap': gz(blockmapOf(fresh)),
      'https://x/old.zip.blockmap': gz(blockmapOf(old))
    })
    const result = await buildFromBlockmap({
      oldZip,
      oldBlockmapUrl: 'https://x/old.zip.blockmap',
      newBlockmapUrl: 'https://x/new.zip.blockmap',
      url: 'https://x/new.zip',
      fetch: fetchImpl,
      mergeGap: 1500,
      ...quiet
    })
    expect(Buffer.compare(result.bytes, fresh)).toBe(0)
    // 1000-2000 and 3000-4000 merge (old block 0 between them comes along); 6000-7000 is 2000 away.
    expect(asked.filter(a => a.url === 'https://x/new.zip').map(a => a.range)).toEqual([
      [1000, 4000],
      [6000, 7000]
    ])
    expect(result.downloaded).toBe(4000)
  })

  test('an old zip that is not the one the old blockmap describes is refused', async () => {
    const { old, fresh } = zips()
    const dir = await mkdtemp(join(tmpdir(), 'actovia-blockmap-'))
    const oldZip = join(dir, 'old.zip')
    await writeFile(oldZip, old.subarray(0, 9000))
    const { fetchImpl } = releaseHost({
      'https://x/new.zip': fresh,
      'https://x/new.zip.blockmap': gz(blockmapOf(fresh)),
      'https://x/old.zip.blockmap': gz(blockmapOf(old))
    })
    await expect(
      buildFromBlockmap({
        oldZip,
        oldBlockmapUrl: 'https://x/old.zip.blockmap',
        newBlockmapUrl: 'https://x/new.zip.blockmap',
        url: 'https://x/new.zip',
        fetch: fetchImpl,
        ...quiet
      })
    ).rejects.toThrow(/does not match/)
  })

  test('a release without blockmaps, or a host without ranges, fails rather than reading the whole zip', async () => {
    const { old, fresh } = zips()
    const dir = await mkdtemp(join(tmpdir(), 'actovia-blockmap-'))
    const oldZip = join(dir, 'old.zip')
    await writeFile(oldZip, old)
    const opts = {
      oldZip,
      oldBlockmapUrl: 'https://x/old.zip.blockmap',
      newBlockmapUrl: 'https://x/new.zip.blockmap',
      url: 'https://x/new.zip',
      ...quiet
    }
    const noOldMap = releaseHost({ 'https://x/new.zip': fresh, 'https://x/new.zip.blockmap': gz(blockmapOf(fresh)) })
    await expect(buildFromBlockmap({ ...opts, fetch: noOldMap.fetchImpl })).rejects.toThrow(/blockmap/)

    const noRanges = (async (url: string) =>
      new Response(
        url.endsWith('old.zip.blockmap') ? gz(blockmapOf(old)) : url.endsWith('.blockmap') ? gz(blockmapOf(fresh)) : fresh
      )) as unknown as typeof fetch
    await expect(buildFromBlockmap({ ...opts, fetch: noRanges })).rejects.toThrow(/range/)
  })
})
