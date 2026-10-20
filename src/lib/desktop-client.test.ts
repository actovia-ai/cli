import { describe, expect, test } from 'bun:test'

import { DesktopApiError, DesktopClient, PRESENCE_HEADER, resolveApiUrl } from './desktop-client'

type Seen = { method: string; url: string; headers: Record<string, string>; body?: string }

function fakeFetch(answer: (seen: Seen) => { status: number; body: unknown }) {
  const seen: Seen[] = []
  const impl = (async (input: URL | string | Request, init?: RequestInit) => {
    const s: Seen = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined
    }
    seen.push(s)
    const { status, body } = answer(s)
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { impl, seen }
}

describe('DesktopClient', () => {
  test('trades the PIN for a pass and sends it on every later call', async () => {
    const { impl, seen } = fakeFetch(s =>
      s.url.endsWith('/cli-pass')
        ? { status: 200, body: { token: 'PASS', expiresAt: 1 } }
        : { status: 200, body: { devices: [], pairing: null, lanRunning: false } }
    )
    const client = new DesktopClient({ baseUrl: 'http://127.0.0.1:60223', fetch: impl })
    await client.authorize('123456')
    await client.devices()

    expect(seen[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:60223/api/v1/lock/cli-pass' })
    expect(JSON.parse(seen[0]!.body!)).toEqual({ pin: '123456' })
    expect(seen[0]!.headers[PRESENCE_HEADER]).toBeUndefined()
    expect(seen[1]!.headers[PRESENCE_HEADER]).toBe('PASS')
  })

  test('says what each refusal means', async () => {
    const cases: Array<[number, unknown, RegExp]> = [
      [401, { error: { code: 'WRONG_PIN' } }, /Wrong PIN/],
      [429, { error: { code: 'PIN_LOCKED_OUT', retryAfterMs: 30_000 } }, /30 seconds/],
      [409, { error: { code: 'PIN_NOT_SET' } }, /Lock & Privacy/],
      [423, { error: { code: 'CLI_PIN_DISABLED' } }, /lock screen/]
    ]
    for (const [status, body, message] of cases) {
      const { impl } = fakeFetch(() => ({ status, body }))
      const error = await new DesktopClient({ fetch: impl }).authorize('0000').catch(e => e)
      expect(error).toBeInstanceOf(DesktopApiError)
      expect(error.status).toBe(status)
      expect(error.message).toMatch(message)
    }
  })

  test('nothing listening reads as Actovia not running', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const error = await new DesktopClient({ fetch: impl }).devices().catch(e => e)
    expect(error.code).toBe('UNREACHABLE')
    expect(error.message).toMatch(/isn't running/)
  })

  test('revoke escapes the id into the path', async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 200, body: { ok: true } }))
    await new DesktopClient({ fetch: impl }).revoke('a/b')
    expect(seen[0]).toMatchObject({ method: 'DELETE' })
    expect(seen[0]!.url.endsWith('/api/v1/devices/a%2Fb')).toBe(true)
  })

  test('ACTOVIA_API_URL overrides the default address', () => {
    const before = process.env.ACTOVIA_API_URL
    process.env.ACTOVIA_API_URL = 'http://127.0.0.1:9999'
    expect(resolveApiUrl()).toBe('http://127.0.0.1:9999')
    if (before === undefined) delete process.env.ACTOVIA_API_URL
    else process.env.ACTOVIA_API_URL = before
    expect(resolveApiUrl('http://x')).toBe('http://x')
  })
})
