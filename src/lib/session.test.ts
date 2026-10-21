import { describe, expect, test } from 'bun:test'

import { DesktopApiError, type DesktopClient } from './desktop-client'
import { ensurePass, whileUnlocked } from './session'

const locked = () => new DesktopApiError('locked', 423, 'APP_LOCKED')

function fakeClient() {
  const calls: string[] = []
  let authorized = false
  const client = {
    get authorized() {
      return authorized
    },
    authorize: async (askPin: () => Promise<string>) => {
      const pin = await askPin()
      calls.push(`authorize ${pin}`)
      authorized = true
      return { token: 'P', expiresAt: 0 }
    }
  } as unknown as DesktopClient
  return { client, calls }
}

describe('whileUnlocked', () => {
  test('asks for the PIN only when the app is locked, then reads again', async () => {
    const { client, calls } = fakeClient()
    let reads = 0
    const value = await whileUnlocked(client, async () => '1234', async () => {
      reads++
      if (reads === 1) throw locked()
      return 'data'
    })
    expect(value).toBe('data')
    expect(reads).toBe(2)
    expect(calls).toEqual(['authorize 1234'])
  })

  test('never asks when the read succeeds, and passes other errors on', async () => {
    const { client, calls } = fakeClient()
    expect(await whileUnlocked(client, async () => 'x', async () => 1)).toBe(1)
    const other = new DesktopApiError('nope', 500, 'UNKNOWN_ERROR')
    await expect(
      whileUnlocked(client, async () => 'x', async () => {
        throw other
      })
    ).rejects.toBe(other)
    expect(calls).toEqual([])
  })

  test('asks once: a pass already held is not bought again', async () => {
    const { client, calls } = fakeClient()
    await ensurePass(client, async () => '1')
    await ensurePass(client, async () => '2')
    expect(calls).toEqual(['authorize 1'])
    // Locked again after the pass: the error stands rather than looping.
    await expect(
      whileUnlocked(client, async () => '3', async () => {
        throw locked()
      })
    ).rejects.toThrow('locked')
  })
})
