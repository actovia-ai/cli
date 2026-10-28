import { describe, expect, spyOn, test } from 'bun:test'

import * as updater from '../lib/updater'
import { runUpdate } from './update'

describe('runUpdate', () => {
  test('reports up to date without side effects', async () => {
    const spy = spyOn(updater, 'checkForUpdate').mockResolvedValue({
      updateAvailable: false,
      current: '0.1.0'
    })
    const result = await runUpdate({ check: true })
    expect(result?.updateAvailable).toBe(false)
    spy.mockRestore()
  })

  test('reports an available update', async () => {
    const spy = spyOn(updater, 'checkForUpdate').mockResolvedValue({
      updateAvailable: true,
      current: '0.1.0',
      latest: '0.2.0'
    })
    const result = await runUpdate({ check: true })
    expect(result).toEqual({ updateAvailable: true, current: '0.1.0', latest: '0.2.0' })
    spy.mockRestore()
  })

  test('resolves to null and sets a non-zero exit code when checkForUpdate rejects', async () => {
    const spy = spyOn(updater, 'checkForUpdate').mockRejectedValue(new Error('offline'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    const result = await runUpdate({ check: true })

    expect(result).toBeNull()
    expect(process.exitCode).toBe(1)

    spy.mockRestore()
    errorSpy.mockRestore()
    // Bun (unlike Node) doesn't clear process.exitCode when set to
    // `undefined` — it must be reset to a real 0 or the whole `bun test`
    // process exits non-zero even though every test passed.
    process.exitCode = 0
  })

  test('installs the newer version unless --check', async () => {
    const spy = spyOn(updater, 'checkForUpdate').mockResolvedValue({
      updateAvailable: true,
      current: '0.1.0',
      latest: '0.2.0'
    })
    const installed: string[] = []
    await runUpdate({}, { installPackage: async v => (installed.push(v), true) })
    expect(installed).toEqual(['0.2.0'])

    await runUpdate({ check: true }, { installPackage: async v => (installed.push(v), true) })
    expect(installed).toEqual(['0.2.0'])

    await runUpdate({}, { installPackage: async () => false })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
    spy.mockRestore()
  })
})

describe('what actovia update says', () => {
  const lines: string[] = []
  const print = (t: string) => lines.push(t)

  test('up to date, out of date with the command, and the update done', async () => {
    const spy = spyOn(updater, 'checkForUpdate').mockResolvedValue({ updateAvailable: false, current: '2.4.0' })
    lines.length = 0
    await runUpdate({ check: true }, { print })
    expect(lines).toEqual(['✓ Actovia CLI 2.4.0 is up to date.'])

    spy.mockResolvedValue({ updateAvailable: true, current: '2.3.1', latest: '2.4.0' })
    lines.length = 0
    await runUpdate({ check: true }, { print })
    expect(lines).toEqual(['! Actovia CLI 2.4.0 is out (this is 2.3.1).', '  → actovia update'])

    lines.length = 0
    await runUpdate({}, { print, installPackage: async () => true })
    expect(lines).toEqual(['! Actovia CLI 2.4.0 is out (this is 2.3.1).', '✓ Updated the CLI to 2.4.0.'])
    spy.mockRestore()
  })
})
