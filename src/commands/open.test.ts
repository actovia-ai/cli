import { describe, expect, spyOn, test } from 'bun:test'

import * as openApp from '../lib/open-app'
import { runOpen } from './open'

describe('runOpen', () => {
  test('prints a success line and returns opened when the app launches', async () => {
    const spy = spyOn(openApp, 'openActoviaApp').mockResolvedValue({ status: 'opened' })
    const result = await runOpen()
    expect(result.status).toBe('opened')
    spy.mockRestore()
  })

  test('returns not-found without throwing when the app is missing', async () => {
    const spy = spyOn(openApp, 'openActoviaApp').mockResolvedValue({ status: 'not-found' })
    const result = await runOpen()
    expect(result.status).toBe('not-found')
    spy.mockRestore()
  })
})

describe('what actovia open says', () => {
  test('opened, or how to get it', async () => {
    const out: string[] = []
    const err: string[] = []
    const spy = spyOn(openApp, 'openActoviaApp').mockResolvedValue({ status: 'opened' })
    await runOpen({ print: t => out.push(t), printError: t => err.push(t) })
    spy.mockResolvedValue({ status: 'not-found' })
    await runOpen({ print: t => out.push(t), printError: t => err.push(t) })
    spy.mockRestore()
    expect(out).toEqual(['✓ Opened Actovia.'])
    expect(err).toEqual(["✗ Actovia isn't installed.", '  → https://actovia.yancey.app'])
  })
})
