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
    await client.authorize(async () => '123456')
    await client.devices()

    expect(seen[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:60223/api/v1/lock/cli-pass' })
    expect(JSON.parse(seen[0]!.body!)).toEqual({ pin: '123456' })
    expect(seen[0]!.headers[PRESENCE_HEADER]).toBeUndefined()
    expect(seen[1]!.headers[PRESENCE_HEADER]).toBe('PASS')
  })

  test('a wrong PIN is asked again, three tries in all', async () => {
    let tries = 0
    const { impl } = fakeFetch(s =>
      JSON.parse(s.body!).pin === '1234'
        ? { status: 200, body: { token: 'PASS', expiresAt: 1 } }
        : { status: 401, body: { error: { code: 'WRONG_PIN' } } }
    )
    const retries: Array<number | undefined> = []
    const client = new DesktopClient({ fetch: impl })
    await client.authorize(async retry => {
      retries.push(retry?.left)
      return ++tries < 3 ? '0000' : '1234'
    })
    expect(client.authorized).toBe(true)
    expect(retries).toEqual([undefined, 2, 1])
  })

  test('the third wrong PIN is the last; a lockout is not retried', async () => {
    for (const [status, code, asked] of [
      [401, 'WRONG_PIN', 3],
      [429, 'PIN_LOCKED_OUT', 1],
      [423, 'CLI_PIN_DISABLED', 1]
    ] as const) {
      let n = 0
      const { impl } = fakeFetch(() => ({ status, body: { error: { code, retryAfterMs: 1000 } } }))
      const error = await new DesktopClient({ fetch: impl })
        .authorize(async () => {
          n++
          return '0000'
        })
        .catch(e => e)
      expect(error.code).toBe(code)
      expect(n).toBe(asked)
    }
  })

  test('says what each refusal means', async () => {
    const cases: Array<[number, unknown, RegExp]> = [
      [401, { error: { code: 'WRONG_PIN' } }, /Wrong PIN/],
      [429, { error: { code: 'PIN_LOCKED_OUT', retryAfterMs: 30_000 } }, /30 seconds/],
      [409, { error: { code: 'PIN_NOT_SET' } }, /Lock & Privacy/],
      [423, { error: { code: 'CLI_PIN_DISABLED' } }, /lock screen/],
      [404, { error: { code: 'NOT_FOUND' } }, /too old/],
      // An Actovia older than the pass route, while locked: its lock gate answers.
      [423, { error: { code: 'APP_LOCKED' } }, /too old.*locked/]
    ]
    for (const [status, body, message] of cases) {
      const { impl } = fakeFetch(() => ({ status, body }))
      const error = await new DesktopClient({ fetch: impl }).authorize(async () => '0000').catch(e => e)
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

describe('the host routes and the reads', () => {
  test('call the paths the desktop app serves, the pass only once bought', async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 200, body: { entries: [], total: 0 } }))
    const client = new DesktopClient({ fetch: impl })
    await client.hostStatus()
    await client.logs({ level: 'warn', scope: 'kernel', traceId: 't1', q: 'boom -noise', pageSize: 5 })
    expect(client.authorized).toBe(false)
    expect(seen.map(s => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
      'GET /api/v1/host/status',
      'GET /api/v1/logs'
    ])
    const params = new URL(seen[1]!.url).searchParams
    expect(Object.fromEntries(params)).toEqual({
      level: 'warn',
      surface: 'kernel',
      traceId: 't1',
      q: 'boom -noise',
      pageSize: '5'
    })
    expect(seen[0]!.headers[PRESENCE_HEADER]).toBeUndefined()
  })

  test('lock, quit and restart are POSTs to the host routes', async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 200, body: { token: 'PASS', expiresAt: 1 } }))
    const client = new DesktopClient({ fetch: impl })
    await client.authorize(async () => '1234')
    await client.lockNow()
    await client.quit()
    await client.restart()
    expect(client.authorized).toBe(true)
    expect(seen.slice(1).map(s => `${s.method} ${new URL(s.url).pathname} ${s.headers[PRESENCE_HEADER]}`)).toEqual([
      'POST /api/v1/host/lock PASS',
      'POST /api/v1/host/quit PASS',
      'POST /api/v1/host/restart PASS'
    ])
  })
})
