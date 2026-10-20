import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'

import type { SkillListItem } from '../lib/skills-sh-client'
import * as store from '../lib/skills-store'
import { DetailScreen } from './detail-screen'

const item: SkillListItem = {
  id: 'vercel-labs/skills/find-skills',
  slug: 'find-skills',
  name: 'find-skills',
  source: 'vercel-labs/skills',
  installs: 24531,
  sourceType: 'github',
  installUrl: 'https://github.com/vercel-labs/skills',
  url: 'https://skills.sh/vercel-labs/skills/find-skills'
}

let skillsDir: string
let fetchSpy: ReturnType<typeof jest.spyOn>

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'actovia-cli-detail-screen-'))
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
    (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/audit/')) {
        return new Response(
          JSON.stringify({
            id: item.id,
            source: item.source,
            slug: item.slug,
            audits: [
              {
                provider: 'Socket',
                slug: 'socket',
                status: 'pass',
                summary: 'No alerts',
                auditedAt: '2026-04-15T12:05:00.000Z'
              }
            ]
          }),
          { status: 200 }
        )
      }
      return new Response(
        JSON.stringify({
          id: item.id,
          source: item.source,
          slug: item.slug,
          installs: item.installs,
          hash: 'deadbeefcafefeed',
          files: [{ path: 'SKILL.md', contents: '---\nname: Find Skills\n---' }]
        }),
        { status: 200 }
      )
    }) as unknown as typeof fetch
  )
})

afterEach(async () => {
  fetchSpy.mockRestore()
  await rm(skillsDir, { recursive: true, force: true })
})

describe('DetailScreen', () => {
  test('frames the skill in a panel with its install count', async () => {
    const { lastFrame } = render(
      <DetailScreen item={item} skillsDir={skillsDir} onBack={() => { }} />
    )
    await new Promise((r) => setTimeout(r, 10))
    const lines = Bun.stripANSI(lastFrame() ?? '').split('\n')
    expect(lines[0]).toMatch(/^╭─+╮$/)
    expect(lines.join('\n')).toContain('24,531 installs')
  })

  test('renders the audit summary after mount', async () => {
    const { lastFrame } = render(
      <DetailScreen item={item} skillsDir={skillsDir} onBack={() => { }} />
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('Socket')
    expect(lastFrame()).toContain('pass')
  })

  test('shows an error message when fetching fails', async () => {
    fetchSpy.mockRestore()
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((async () => new Response('', { status: 500 })) as unknown as typeof fetch)

    const { lastFrame } = render(
      <DetailScreen item={item} skillsDir={skillsDir} onBack={() => { }} />
    )
    await new Promise((r) => setTimeout(r, 10))
    const frame = lastFrame()
    expect(frame).not.toContain('Loading')
    expect(frame).not.toContain('Security audit')
    expect(frame).toContain('Request failed: 500')
  })

  test('Enter installs the skill and confirms it on screen instead of leaving', async () => {
    let backCalled = false
    const { stdin, lastFrame } = render(
      <DetailScreen item={item} skillsDir={skillsDir} onBack={() => (backCalled = true)} />
    )
    await new Promise((r) => setTimeout(r, 10))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 30))
    const frame = Bun.stripANSI(lastFrame() ?? '')
    expect(frame).toContain('✓ Installed find-skills')
    expect(frame).not.toContain('Press Enter to install')
    expect(backCalled).toBe(false)
    expect((await store.readLockfile(skillsDir)).skills['find-skills']).toBeDefined()
  })

  test('a second Enter after installing does not install again', async () => {
    const installSpy = jest.spyOn(store, 'installSkill')
    const { stdin } = render(<DetailScreen item={item} skillsDir={skillsDir} onBack={() => { }} />)
    await new Promise((r) => setTimeout(r, 10))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 30))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 30))
    expect(installSpy).toHaveBeenCalledTimes(1)
    installSpy.mockRestore()
  })

  test('shows an inline install error and does not hang on Installing… when install fails', async () => {
    const installSpy = jest
      .spyOn(store, 'installSkill')
      .mockRejectedValue(new Error('disk full'))

    const { stdin, lastFrame } = render(
      <DetailScreen item={item} skillsDir={skillsDir} onBack={() => { }} />
    )
    await new Promise((r) => setTimeout(r, 10))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 20))
    const frame = lastFrame()
    expect(frame).toContain('Install failed')
    expect(frame).not.toContain('Installing…')

    installSpy.mockRestore()
  })
})
