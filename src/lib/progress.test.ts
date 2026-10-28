import { describe, expect, test } from 'bun:test'

import { download, formatBytes, formatProgress } from './progress'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('formatProgress', () => {
  test('a known size: a bar, the share, how much of how much, the speed', () => {
    const line = formatProgress({ label: 'Actovia 2.4.0', received: 94.1e6, total: 180.3e6, rate: 12.4e6 }, { columns: 120 })
    expect(line).toBe('Downloading Actovia 2.4.0  ████████████░░░░░░░░░░░░  52%  94.1 / 180.3 MB  12.4 MB/s')
  })

  test('no speed until there is one to show', () => {
    const line = formatProgress({ label: 'x', received: 0, total: 10e6, rate: null }, { columns: 120 })
    expect(line).toBe('Downloading x  ░░░░░░░░░░░░░░░░░░░░░░░░   0%  0.0 / 10.0 MB')
  })

  test('an unknown size: how much so far', () => {
    expect(formatProgress({ label: 'x', received: 3.2e6, total: null, rate: 1e6 }, { columns: 120 })).toBe('Downloading x  3.2 MB  1.0 MB/s')
  })

  test('at 80 columns the bar shrinks to fit rather than going', () => {
    const line = formatProgress({ label: 'Actovia 2.4.0', received: 94.1e6, total: 180.3e6, rate: 12.4e6 }, { columns: 80 })
    expect(line).toBe('Downloading Actovia 2.4.0  ████████░░░░░░░░░  52%  94.1 / 180.3 MB  12.4 MB/s')
    expect(line.length).toBeLessThan(80)
  })

  test('the bar keeps one width for the whole download, whatever the numbers beside it', () => {
    const widths = [0, 1e6, 99e6, 180e6].map(received => {
      const line = formatProgress({ label: 'Actovia 2.4.0', received, total: 180e6, rate: received ? 128.4e6 : null }, { columns: 80 })
      return (line.match(/[█░]/g) ?? []).length
    })
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBeGreaterThanOrEqual(10)
  })

  test('a narrow terminal loses the bar before the numbers, and the line never wraps', () => {
    const line = formatProgress({ label: 'Actovia 2.4.0', received: 94.1e6, total: 180.3e6, rate: 12.4e6 }, { columns: 60 })
    expect(line).toBe('Downloading Actovia 2.4.0  52%  94.1 / 180.3 MB  12.4 MB/s')
    const tiny = formatProgress({ label: 'Actovia 2.4.0', received: 94.1e6, total: 180.3e6, rate: 12.4e6 }, { columns: 20 })
    expect(tiny.length).toBeLessThan(20)
  })

  test('a terminal that reports no width is taken as 80 columns, not as none', () => {
    const p = { label: 'x', received: 5e6, total: 10e6, rate: 1e6 }
    expect(formatProgress(p, { columns: 0 })).toBe(formatProgress(p, { columns: 80 }))
  })

  test('colour changes nothing but the escapes', () => {
    const p = { label: 'x', received: 5e6, total: 10e6, rate: 1e6 }
    const colored = formatProgress(p, { columns: 120, color: true })
    expect(colored).toContain('\x1b[')
    expect(strip(colored)).toBe(formatProgress(p, { columns: 120 }))
  })

  test('sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(48_000)).toBe('48 KB')
    expect(formatBytes(180.3e6)).toBe('180.3 MB')
  })
})

function responseOf(chunks: Uint8Array[], length?: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    }
  })
  return new Response(body, { headers: length === undefined ? {} : { 'content-length': String(length) } })
}

describe('download', () => {
  const chunks = [new Uint8Array(600_000).fill(1), new Uint8Array(400_000).fill(2)]

  test('off a terminal: one line saying what it downloads, and the bytes', async () => {
    const printed: string[] = []
    const written: string[] = []
    const bytes = await download(responseOf(chunks, 1_000_000), 'Actovia 2.4.0', {
      print: t => printed.push(t),
      stream: { isTTY: false, write: c => written.push(c) },
      enabled: false
    })
    expect(bytes.length).toBe(1_000_000)
    expect(bytes[0]).toBe(1)
    expect(bytes[999_999]).toBe(2)
    expect(printed).toEqual(['Downloading Actovia 2.4.0…'])
    expect(written).toEqual([])
  })

  test('on a terminal: a bar redrawn in place, erased at the end, then one line saying it is done', async () => {
    const printed: string[] = []
    const written: string[] = []
    let t = 0
    const bytes = await download(responseOf(chunks, 1_000_000), 'Actovia 2.4.0', {
      print: s => printed.push(s),
      stream: { isTTY: true, columns: 120, write: c => written.push(c) },
      enabled: true,
      color: false,
      now: () => (t += 500)
    })
    expect(bytes.length).toBe(1_000_000)
    const frames = written.filter(w => w.includes('Downloading'))
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(f => f.startsWith('\r\x1b[2K'))).toBe(true)
    expect(frames.at(-1)).toContain('100%')
    expect(written.at(-1)).toBe('\r\x1b[2K')
    expect(printed).toEqual(['Downloaded Actovia 2.4.0 · 1.0 MB'])
  })

  test('a failed response is an error, and nothing is drawn', async () => {
    const written: string[] = []
    await expect(
      download(new Response('no', { status: 404 }), 'x', { print: () => {}, stream: { isTTY: true, write: c => written.push(c) }, enabled: true })
    ).rejects.toThrow('Download failed: 404')
    expect(written).toEqual([])
  })
})
