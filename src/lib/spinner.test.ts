import { describe, expect, test } from 'bun:test'

import { SPINNER_FRAMES, withSpinner } from './spinner'

const tty = () => {
  const chunks: string[] = []
  return { chunks, stream: { isTTY: true, write: (c: string) => chunks.push(c) } }
}
const later = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms))

describe('withSpinner', () => {
  test('draws on a terminal while the work runs, and erases itself before returning', async () => {
    const { chunks, stream } = tty()
    const result = await withSpinner('Checking…', () => later(60, 42), { stream, enabled: true, delayMs: 0, intervalMs: 10 })
    expect(result).toBe(42)
    expect(chunks[0]).toContain(`${SPINNER_FRAMES[0]}`)
    expect(chunks[0]).toContain('Checking…')
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.at(-1)).toBe('\r\x1b[2K')
  })

  test('a quick answer draws nothing', async () => {
    const { chunks, stream } = tty()
    await withSpinner('Checking…', () => later(5, null), { stream, enabled: true, delayMs: 100 })
    expect(chunks).toEqual([])
  })

  test('a pipe draws nothing, even when the work is slow', async () => {
    const chunks: string[] = []
    await withSpinner('Checking…', () => later(30, null), {
      stream: { isTTY: false, write: c => chunks.push(c) },
      delayMs: 0
    })
    expect(chunks).toEqual([])
  })

  test('erases itself when the work fails, and the failure goes on', async () => {
    const { chunks, stream } = tty()
    const failing = withSpinner('Checking…', async () => {
      await later(30, null)
      throw new Error('boom')
    }, { stream, enabled: true, delayMs: 0, intervalMs: 10 })
    await expect(failing).rejects.toThrow('boom')
    expect(chunks.at(-1)).toBe('\r\x1b[2K')
  })
})
