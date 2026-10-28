import { describe, expect, test } from 'bun:test'

import type { DesktopClient } from '../lib/desktop-client'
import { runAppCheck } from './app'

const client = (version: string | null) =>
  ({
    hostStatus: async () => {
      if (!version) throw new Error('down')
      return { version }
    }
  }) as unknown as DesktopClient

describe('actovia app check', () => {
  const check = async (running: string | null, installed: string | null) => {
    const lines: string[] = []
    await runAppCheck(
      {},
      { client: client(running), print: t => lines.push(t), installedVersion: async () => installed, latest: async () => '2.4.0' }
    )
    return lines
  }

  test('up to date, out of date with the command, or none here', async () => {
    expect(await check('2.4.0', '2.4.0')).toEqual(['✓ Actovia 2.4.0 is up to date.'])
    expect(await check('2.2.0', '2.2.0')).toEqual(['! Actovia 2.4.0 is out (this is 2.2.0).', '  → actovia app update'])
    expect(await check(null, null)).toEqual([
      'Actovia 2.4.0 is the latest; none is installed here.',
      '  → https://github.com/actovia-ai/actovia/releases/latest'
    ])
  })
})
