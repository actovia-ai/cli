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
