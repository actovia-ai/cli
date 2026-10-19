import { describe, expect, test } from 'bun:test'

import { openExodusApp } from './open-app'

describe('openExodusApp', () => {
  test('darwin: opens Actovia first', async () => {
    const tried: string[] = []
    const result = await openExodusApp('darwin', async (name) => {
      tried.push(name)
      return true
    })
    expect(result.status).toBe('opened')
    expect(tried).toEqual(['Actovia'])
  })

  test('darwin: falls back to Exodus when Actovia is missing', async () => {
    const tried: string[] = []
    const result = await openExodusApp('darwin', async (name) => {
      tried.push(name)
      return name === 'Exodus'
    })
    expect(result.status).toBe('opened')
    expect(tried).toEqual(['Actovia', 'Exodus'])
  })

  test('darwin: reports not-found when neither app is installed', async () => {
    const tried: string[] = []
    const result = await openExodusApp('darwin', async (name) => {
      tried.push(name)
      return false
    })
    expect(result.status).toBe('not-found')
    expect(tried).toEqual(['Actovia', 'Exodus'])
  })

  test('win32: reports not-found when no known install path exists', async () => {
    const result = await openExodusApp('win32')
    expect(result.status).toBe('not-found')
  })

  test('linux: reports not-found when `exodus` is not on PATH', async () => {
    const result = await openExodusApp('linux')
    expect(result.status).toBe('not-found')
  })

  test('unsupported platform reports not-found rather than throwing', async () => {
    const result = await openExodusApp('sunos' as NodeJS.Platform)
    expect(result.status).toBe('not-found')
  })
})
