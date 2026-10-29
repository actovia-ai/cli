import { gunzipSync } from 'node:zlib'

import { download, type DownloadOptions, formatBytes } from './progress'

/**
 * Downloading a release zip as electron-updater does on the app's own update
 * (ISSUE-290): each desktop release publishes `<zip>.blockmap`, the zip cut
 * into blocks by content with a checksum per block. Comparing the installed
 * version's blockmap with the new one says which blocks of the new zip the
 * old zip already has; those are copied from the old zip, the rest are
 * fetched through byte ranges. The result is checked by the caller against
 * the release's `SHA256SUMS`, like a whole download.
 *
 * It needs the old zip itself. The app is installed unpacked, and every
 * Mach-O in it is signed anew on every build, so comparing files instead
 * would download most of the app each time: the old zip is kept from the
 * last update (see `desktop-app.ts`).
 */

export interface Blockmap {
  version: '2'
  files: { name: string; offset: number; checksums: string[]; sizes: number[] }[]
}

export type BlockOperation = { kind: 'copy' | 'download'; start: number; end: number }

/** Two downloads closer than this many bytes are fetched in one range (the gap with them). */
const MERGE_GAP = 64 * 1024

/** A gzipped blockmap, refused unless it is the one-file version-2 shape app-builder writes. */
export function parseBlockmap(gzipped: Uint8Array): Blockmap {
  const map = JSON.parse(gunzipSync(gzipped).toString('utf8')) as Blockmap
  const file = map?.files?.[0]
  if (map?.version !== '2' || map.files.length !== 1 || !file) throw new Error('the blockmap is not one app-builder wrote')
  const { checksums, sizes } = file
  if (
    !Array.isArray(checksums) ||
    !Array.isArray(sizes) ||
    checksums.length !== sizes.length ||
    !checksums.every(c => typeof c === 'string') ||
    !sizes.every(s => Number.isSafeInteger(s) && s > 0) ||
    // The file is the whole zip: its blocks start at the zip's first byte.
    file.offset !== 0
  ) {
    throw new Error('the blockmap is damaged')
  }
  return map
}

export const blockmapSize = (map: Blockmap) => map.files[0]!.sizes.reduce((n, s) => n + s, 0)

/**
 * What builds the new zip, in order: ranges of the old zip to copy and of the
 * new one to download. electron-updater's `computeOperations`: a block is
 * reused when the old blockmap has its checksum with the same size.
 */
export function planBlocks(old: Blockmap, fresh: Blockmap): BlockOperation[] {
  const oldFile = old.files[0]!
  const newFile = fresh.files[0]!
  const oldBlocks = new Map<string, { offset: number; size: number }>()
  let offset = oldFile.offset
  oldFile.checksums.forEach((checksum, i) => {
    const size = oldFile.sizes[i]!
    if (!oldBlocks.has(checksum)) oldBlocks.set(checksum, { offset, size })
    offset += size
  })

  const ops: BlockOperation[] = []
  let newOffset = newFile.offset
  newFile.checksums.forEach((checksum, i) => {
    const size = newFile.sizes[i]!
    const found = oldBlocks.get(checksum)
    const op: BlockOperation =
      found && found.size === size
        ? { kind: 'copy', start: found.offset, end: found.offset + size }
        : { kind: 'download', start: newOffset, end: newOffset + size }
    const last = ops.at(-1)
    if (last && last.kind === op.kind && last.end === op.start) last.end = op.end
    else ops.push(op)
    newOffset += size
  })
  return ops
}

async function rangeRequest(url: string, fetchImpl: typeof fetch, start: number, end: number): Promise<Response> {
  const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (res.status !== 206 || !res.headers.get('content-range')?.startsWith(`bytes ${start}-${end - 1}/`)) {
    await res.body?.cancel()
    throw new Error(`the download server does not answer byte ranges (${res.status})`)
  }
  return res
}

/** One response streaming the ranges back to back, so the download draws one bar for all of them. */
function rangesResponse(url: string, fetchImpl: typeof fetch, ranges: { start: number; end: number }[]): Response {
  let next = 0
  let reader: { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> } | null = null
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          const r = ranges[next++]
          if (!r) return controller.close()
          reader = (await rangeRequest(url, fetchImpl, r.start, r.end)).body!.getReader()
        }
        const { done, value } = await reader.read()
        if (!done && value) return controller.enqueue(value)
        if (done) reader = null
      }
    },
    async cancel() {
      await reader?.cancel()
    }
  })
  const length = ranges.reduce((n, r) => n + r.end - r.start, 0)
  return new Response(body, { headers: { 'content-length': String(length) } })
}

async function fetchBlockmap(url: string, fetchImpl: typeof fetch): Promise<Blockmap> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`no blockmap at ${url} (${res.status})`)
  return parseBlockmap(new Uint8Array(await res.arrayBuffer()))
}

export interface BlockmapDeltaOptions {
  /** The installed version's zip, as its release published it. */
  oldZip: string
  oldBlockmapUrl: string
  newBlockmapUrl: string
  /** The new zip; its host must answer byte ranges. */
  url: string
  fetch?: typeof fetch
  label?: string
  print: (text: string) => void
  progress?: Omit<DownloadOptions, 'print'>
  mergeGap?: number
}

export interface BlockmapDeltaResult {
  /** The new zip, whole. */
  bytes: Buffer
  downloaded: number
  total: number
}

/** The new release zip, built from the old one and the blocks it lacks. */
export async function buildFromBlockmap(opts: BlockmapDeltaOptions): Promise<BlockmapDeltaResult> {
  const fetchImpl = opts.fetch ?? fetch
  const [old, fresh] = await Promise.all([
    fetchBlockmap(opts.oldBlockmapUrl, fetchImpl),
    fetchBlockmap(opts.newBlockmapUrl, fetchImpl)
  ])
  const oldBytes = Buffer.from(await Bun.file(opts.oldZip).arrayBuffer())
  if (oldBytes.length !== blockmapSize(old)) throw new Error('the kept zip does not match the installed version’s blockmap')

  const ops = planBlocks(old, fresh)
  const total = blockmapSize(fresh)
  const ranges: { start: number; end: number }[] = []
  for (const op of ops) {
    if (op.kind !== 'download') continue
    const last = ranges.at(-1)
    if (last && op.start - last.end <= (opts.mergeGap ?? MERGE_GAP)) last.end = op.end
    else ranges.push({ start: op.start, end: op.end })
  }
  const downloaded = ranges.reduce((n, r) => n + r.end - r.start, 0)
  opts.print(`Only what changed: ${formatBytes(downloaded)} of ${formatBytes(total)} to download.`)

  const fetched = ranges.length
    ? await download(rangesResponse(opts.url, fetchImpl, ranges), opts.label ?? 'the changes', {
        ...opts.progress,
        print: opts.print
      })
    : Buffer.alloc(0)
  if (fetched.length !== downloaded) throw new Error('the changed blocks came back short')

  // Laid out in the new zip's order: copies from the old zip, downloads from
  // what was fetched (a merged range also carries the bytes between two).
  const bytes = Buffer.alloc(total)
  let at = 0
  let rangeIndex = 0
  let rangeStartInFetched = 0
  for (const op of ops) {
    if (op.kind === 'copy') {
      at += oldBytes.copy(bytes, at, op.start, op.end)
      continue
    }
    while (ranges[rangeIndex]!.end < op.end) rangeStartInFetched += ranges[rangeIndex]!.end - ranges[rangeIndex++]!.start
    const from = rangeStartInFetched + op.start - ranges[rangeIndex]!.start
    at += fetched.copy(bytes, at, from, from + op.end - op.start)
  }
  if (at !== total) throw new Error('the rebuilt zip has the wrong length')
  return { bytes, downloaded, total }
}
