import { describe, expect, test } from 'bun:test'

import { openActoviaApp } from './open-app'

describe('openActoviaApp', () => {
  test('darwin: opens Actovia', async () => {
    const tried: string[] = []
    const result = await openActoviaApp('darwin', async (name) => {
      tried.push(name)
      return true
    })
    expect(result.status).toBe('opened')
    expect(tried).toEqual(['Actovia'])
  })

  test('darwin: reports not-found when the app is not installed', async () => {
    const tried: string[] = []
    const result = await openActoviaApp('darwin', async (name) => {
      tried.push(name)
      return false
    })
    expect(result.status).toBe('not-found')
    expect(tried).toEqual(['Actovia'])
  })

  test('win32: reports not-found when no known install path exists', async () => {
    const result = await openActoviaApp('win32')
    expect(result.status).toBe('not-found')
  })

  for (const only of ['actovia', 'Actovia']) {
    test(`linux: launches ${only} when it is the only one on PATH`, async () => {
      const spawned: string[] = []
      const result = await openActoviaApp(
        'linux',
        undefined,
        async (n) => n === only,
        (n) => void spawned.push(n)
      )
      expect(result.status).toBe('opened')
      expect(spawned).toEqual([only])
    })
  }

  test('linux: prefers actovia when several launchers exist', async () => {
    const spawned: string[] = []
    await openActoviaApp(
      'linux',
      undefined,
      async () => true,
      (n) => void spawned.push(n)
    )
    expect(spawned).toEqual(['actovia'])
  })

  test('linux: reports not-found when no launcher is on PATH', async () => {
    const spawned: string[] = []
    const result = await openActoviaApp(
      'linux',
      undefined,
      async () => false,
      (n) => void spawned.push(n)
    )
    expect(result.status).toBe('not-found')
    expect(spawned).toEqual([])
  })

  test('unsupported platform reports not-found rather than throwing', async () => {
    const result = await openActoviaApp('sunos' as NodeJS.Platform)
    expect(result.status).toBe('not-found')
  })
})
