import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'

import { version as packageVersion } from '../../package.json'
import {
  checkForUpdate,
  getCurrentVersion,
  getLatestNpmVersion,
  getLatestRelease,
  getLatestVersion,
  isNewerVersion,
  pickReleaseAssetName
} from './updater'

describe('getCurrentVersion', () => {
  test('reads the version from package.json', () => {
    // Compared against the real package.json's version rather than a
    // hardcoded string, so this doesn't break on every release's version
    // bump (it broke exactly this way once already, see git history).
    expect(getCurrentVersion()).toBe(packageVersion)
  })
})

describe('isNewerVersion', () => {
  test('true when latest has a higher patch/minor/major', () => {
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '1.0.0')).toBe(true)
  })

  test('false when equal or lower', () => {
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
  })
})

describe('pickReleaseAssetName', () => {
  test('maps darwin/arm64 to actovia-darwin-arm64', () => {
    expect(pickReleaseAssetName('darwin', 'arm64')).toBe('actovia-darwin-arm64')
  })
  test('maps win32/x64 to actovia-windows-x64.exe', () => {
    expect(pickReleaseAssetName('win32', 'x64')).toBe('actovia-windows-x64.exe')
  })
  test('maps linux/x64 to actovia-linux-x64', () => {
    expect(pickReleaseAssetName('linux', 'x64')).toBe('actovia-linux-x64')
  })
  test('returns null for an unsupported combination', () => {
    expect(pickReleaseAssetName('sunos' as NodeJS.Platform, 'x64')).toBeNull()
  })
})

describe('getLatestNpmVersion', () => {
  let fetchSpy: ReturnType<typeof jest.spyOn>
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })
  afterEach(() => fetchSpy.mockRestore())

  test('reads .version from the npm registry "latest" endpoint', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })
    )
    const version = await getLatestNpmVersion('https://fake-registry.example.test')
    expect(version).toBe('9.9.9')
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://fake-registry.example.test/@actovia-ai%2Fcli/latest'
    )
  })
})

describe('getLatestRelease', () => {
  let fetchSpy: ReturnType<typeof jest.spyOn>
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })
  afterEach(() => fetchSpy.mockRestore())

  test('reads tag_name/assets from the GitHub releases/latest endpoint', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: 'v9.9.9',
          assets: [{ name: 'actovia-darwin-arm64', browser_download_url: 'https://x/y' }]
        }),
        { status: 200 }
      )
    )
    const release = await getLatestRelease('https://fake-api.example.test')
    expect(release.tag_name).toBe('v9.9.9')
    expect(release.assets[0]?.name).toBe('actovia-darwin-arm64')
  })
})

describe('checkForUpdate', () => {
  test('reports updateAvailable: false when already current', async () => {
    // DIST_CHANNEL defaults to 'npm' in dev/test — checkForUpdate hits
    // getLatestNpmVersion, which we stub via fetch.
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '0.1.0' }), { status: 200 })
    )
    const result = await checkForUpdate()
    expect(result.updateAvailable).toBe(false)
    fetchSpy.mockRestore()
  })
})

describe('getLatestVersion', () => {
  test('returns the bare npm version on the npm channel', async () => {
    // DIST_CHANNEL defaults to 'npm' in dev/test, so this resolves through
    // getLatestNpmVersion, which we stub via fetch.
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })
    )
    expect(await getLatestVersion()).toBe('9.9.9')
    fetchSpy.mockRestore()
  })
})
