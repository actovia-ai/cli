import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildRefreshCommand,
  formatUpdateBadge,
  getUpdateBadge,
  CHECK_INTERVAL_MS,
  getUpdateCachePath,
  getUpdateNotice,
  isCacheStale,
  prepareUpdateNotice,
  readUpdateCache,
  refreshUpdateCache,
  writeUpdateCache
} from './update-notifier'

let exodusHome: string

beforeEach(async () => {
  exodusHome = await mkdtemp(join(tmpdir(), 'exodus-cli-update-notifier-'))
})

afterEach(async () => {
  await rm(exodusHome, { recursive: true, force: true })
})

describe('getUpdateCachePath', () => {
  test('lives at <exodusHome>/update-check.json', () => {
    expect(getUpdateCachePath('/fake-home')).toBe(join('/fake-home', 'update-check.json'))
  })
})

describe('readUpdateCache', () => {
  test('returns null when no check has ever run', async () => {
    expect(await readUpdateCache(exodusHome)).toBeNull()
  })

  test('returns null rather than throwing when the cache file is corrupt', async () => {
    await writeFile(getUpdateCachePath(exodusHome), '{ not json')
    expect(await readUpdateCache(exodusHome)).toBeNull()
  })

  test('reads back what writeUpdateCache stored', async () => {
    await writeUpdateCache({ checkedAt: 1000, latest: '9.9.9' }, exodusHome)
    expect(await readUpdateCache(exodusHome)).toEqual({ checkedAt: 1000, latest: '9.9.9' })
  })

  test('creates the exodus home directory if it is missing', async () => {
    const nested = join(exodusHome, 'does', 'not', 'exist')
    await writeUpdateCache({ checkedAt: 1, latest: '1.0.0' }, nested)
    expect(await readUpdateCache(nested)).toEqual({ checkedAt: 1, latest: '1.0.0' })
  })
})

describe('isCacheStale', () => {
  test('a missing cache is stale', () => {
    expect(isCacheStale(null, 0)).toBe(true)
  })

  test('a cache older than the check interval is stale', () => {
    const cache = { checkedAt: 0, latest: '1.0.0' }
    expect(isCacheStale(cache, CHECK_INTERVAL_MS + 1)).toBe(true)
  })

  test('a cache inside the check interval is fresh', () => {
    const cache = { checkedAt: 0, latest: '1.0.0' }
    expect(isCacheStale(cache, CHECK_INTERVAL_MS - 1)).toBe(false)
  })

  test('a cache with a future timestamp is treated as stale rather than trusted forever', () => {
    const cache = { checkedAt: 10_000, latest: '1.0.0' }
    expect(isCacheStale(cache, 0)).toBe(true)
  })
})

describe('getUpdateNotice', () => {
  test('is silent when there is no cached result yet', () => {
    expect(getUpdateNotice('1.0.0', null)).toBeNull()
  })

  test('is silent when the cached version matches the running one', () => {
    expect(getUpdateNotice('1.0.0', { checkedAt: 0, latest: '1.0.0' })).toBeNull()
  })

  test('is silent when the running version is ahead of the cached one', () => {
    expect(getUpdateNotice('2.0.0', { checkedAt: 0, latest: '1.0.0' })).toBeNull()
  })

  test('names both versions when a newer one is cached', () => {
    const notice = getUpdateNotice('1.0.0', { checkedAt: 0, latest: '1.2.0' })
    expect(notice).toContain('1.0.0')
    expect(notice).toContain('1.2.0')
  })

  test('tells the user how to upgrade', () => {
    const notice = getUpdateNotice('1.0.0', { checkedAt: 0, latest: '1.2.0' })
    expect(notice).toContain('actovia update')
  })
})

describe('buildRefreshCommand', () => {
  test('re-invokes the entry script when running through a runtime', () => {
    expect(buildRefreshCommand(['/path/to/bun', '/app/dist/index.js', 'open'], '/path/to/bun')).toEqual([
      '/path/to/bun',
      '/app/dist/index.js',
      '__update-check'
    ])
  })

  test('re-invokes the executable directly for a compiled binary', () => {
    expect(buildRefreshCommand(['/usr/local/bin/exodus', '/usr/local/bin/exodus'], '/usr/local/bin/exodus')).toEqual([
      '/usr/local/bin/exodus',
      '__update-check'
    ])
  })

  test('falls back to the executable alone when there is no entry argument', () => {
    expect(buildRefreshCommand(['/usr/local/bin/exodus'], '/usr/local/bin/exodus')).toEqual([
      '/usr/local/bin/exodus',
      '__update-check'
    ])
  })
})

describe('refreshUpdateCache', () => {
  test('stores the fetched version alongside the time it was fetched', async () => {
    await refreshUpdateCache(exodusHome, async () => '3.1.4', () => 555)
    expect(await readUpdateCache(exodusHome)).toEqual({ checkedAt: 555, latest: '3.1.4' })
  })

  test('leaves a previous result intact when the lookup fails', async () => {
    await writeUpdateCache({ checkedAt: 1, latest: '2.0.0' }, exodusHome)
    await refreshUpdateCache(exodusHome, async () => {
      throw new Error('unknown certificate verification error')
    })
    expect(await readUpdateCache(exodusHome)).toEqual({ checkedAt: 1, latest: '2.0.0' })
  })

  test('swallows lookup failures instead of rejecting', async () => {
    const failing = refreshUpdateCache(exodusHome, async () => {
      throw new Error('offline')
    })
    expect(await failing).toBeUndefined()
  })
})

describe('prepareUpdateNotice', () => {
  test('kicks off a background refresh when the cache is stale', async () => {
    let spawned = 0
    await prepareUpdateNotice({ exodusHome, current: '1.0.0', spawnRefresh: () => { spawned++ } })
    expect(spawned).toBe(1)
  })

  test('does not hit the network again while the cache is fresh', async () => {
    let spawned = 0
    await writeUpdateCache({ checkedAt: 900, latest: '1.0.0' }, exodusHome)
    await prepareUpdateNotice({
      exodusHome,
      current: '1.0.0',
      now: 1000,
      spawnRefresh: () => { spawned++ }
    })
    expect(spawned).toBe(0)
  })

  test('returns the notice for a newer cached version', async () => {
    await writeUpdateCache({ checkedAt: 900, latest: '1.5.0' }, exodusHome)
    const notice = await prepareUpdateNotice({
      exodusHome,
      current: '1.0.0',
      now: 1000,
      spawnRefresh: () => {}
    })
    expect(notice).toContain('1.5.0')
  })

  test('stays silent on a cold cache even though it refreshes for next time', async () => {
    let spawned = 0
    const notice = await prepareUpdateNotice({
      exodusHome,
      current: '1.0.0',
      spawnRefresh: () => { spawned++ }
    })
    expect(notice).toBeNull()
    expect(spawned).toBe(1)
  })

  test('never lets a broken spawn take down the command', async () => {
    const notice = await prepareUpdateNotice({
      exodusHome,
      current: '1.0.0',
      spawnRefresh: () => {
        throw new Error('spawn EPERM')
      }
    })
    expect(notice).toBeNull()
  })
})

describe('formatUpdateBadge', () => {
  test('is silent when there is no cached result', () => {
    expect(formatUpdateBadge('1.0.0', null)).toBeNull()
  })

  test('is silent when the running version is current', () => {
    expect(formatUpdateBadge('1.0.0', { checkedAt: 0, latest: '1.0.0' })).toBeNull()
  })

  test('names the new version', () => {
    expect(formatUpdateBadge('1.0.0', { checkedAt: 0, latest: '1.1.0' })).toBe(
      'Update available: 1.1.0'
    )
  })

  test('stays short enough to share the tab bar with the Tab hint', () => {
    const badge = formatUpdateBadge('1.0.0', { checkedAt: 0, latest: '1.1.0' })
    expect(badge!.length).toBeLessThanOrEqual(30)
  })
})

describe('getUpdateBadge', () => {
  test('formats the badge from whatever the last check cached', async () => {
    await writeUpdateCache({ checkedAt: 0, latest: '4.0.0' }, exodusHome)
    expect(await getUpdateBadge(exodusHome, '1.0.0')).toBe('Update available: 4.0.0')
  })

  test('is silent before any check has run', async () => {
    expect(await getUpdateBadge(exodusHome, '1.0.0')).toBeNull()
  })
})
