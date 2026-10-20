import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'

import { installSkill, readLockfile } from '../lib/skills-store'
import { InstalledScreen } from './installed-screen'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'actovia-cli-installed-screen-'))
  await installSkill(skillsDir, {
    id: 'vercel-labs/skills/find-skills',
    source: 'vercel-labs/skills',
    slug: 'find-skills',
    installs: 1,
    hash: 'deadbeefcafefeed',
    files: [{ path: 'SKILL.md', contents: '---\nname: Find Skills\n---' }]
  })
})

afterEach(async () => {
  await rm(skillsDir, { recursive: true, force: true })
})

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const END = `${ESC}[F`
const plain = (frame: string | undefined) => Bun.stripANSI(frame ?? '')
const settle = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Installs `count` more skills after find-skills, listed in this order.
async function installMore(count: number) {
  for (let i = 0; i < count; i++) {
    await installSkill(skillsDir, {
      id: `owner/repo/extra-${i}`,
      source: 'owner/repo',
      slug: `extra-${i}`,
      installs: 1,
      hash: `hash-${i}`,
      files: [{ path: 'SKILL.md', contents: `---\nname: Extra ${i}\n---` }]
    })
  }
}

describe('InstalledScreen', () => {
  test('points at the Discover tab when nothing is installed', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'actovia-cli-installed-screen-empty-'))
    const { lastFrame } = render(<InstalledScreen skillsDir={emptyDir} />)
    await settle()
    expect(plain(lastFrame())).toContain('Press Tab')
    await rm(emptyDir, { recursive: true, force: true })
  })

  test('shows the slug beneath the name and the status beside it', async () => {
    const { lastFrame } = render(<InstalledScreen skillsDir={skillsDir} />)
    await settle()
    const lines = plain(lastFrame()).split('\n')
    const nameLine = lines.findIndex((l) => l.includes('Find Skills'))
    expect(lines[nameLine]).toMatch(/Find Skills\s+active/)
    expect(lines[nameLine + 1]).toContain('find-skills')
  })

  test('renders only the first screenful of a long list and shows the position', async () => {
    await installMore(60)
    const { lastFrame } = render(<InstalledScreen skillsDir={skillsDir} />)
    await settle(150)
    const frame = plain(lastFrame())
    expect(frame).toContain('Find Skills')
    expect(frame).not.toContain('Extra 59')
    expect(frame).toMatch(/↓ \d+ more/)
    expect(frame).toContain('1/61')
  })

  test('End scrolls the last skill into view', async () => {
    await installMore(60)
    const { lastFrame, stdin } = render(<InstalledScreen skillsDir={skillsDir} />)
    await settle(150)
    stdin.write(END)
    await settle()
    const frame = plain(lastFrame())
    expect(frame).toContain('Extra 59')
    expect(frame).not.toContain('Find Skills')
    expect(frame).toContain('61/61')
  })

  test('toggling a skill keeps the cursor where it was', async () => {
    await installMore(60)
    const { lastFrame, stdin } = render(<InstalledScreen skillsDir={skillsDir} />)
    await settle(150)
    stdin.write(DOWN)
    stdin.write(DOWN)
    await settle()
    stdin.write(' ')
    await settle(100)
    expect((await readLockfile(skillsDir)).skills['extra-1']?.isActive).toBe(false)
    expect(plain(lastFrame())).toContain('3/61')
  })

  test('uninstalling the last skill moves the cursor up to the new last one', async () => {
    await installMore(2)
    const { lastFrame, stdin } = render(<InstalledScreen skillsDir={skillsDir} />)
    await settle(100)
    stdin.write(END)
    await settle()
    expect(plain(lastFrame())).toContain('3/3')
    stdin.write('x')
    await settle(100)
    expect(plain(lastFrame())).toContain('2/2')
  })

  test('renders the installed skill after mount', async () => {
    const { lastFrame } = render(<InstalledScreen skillsDir={skillsDir} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('Find Skills')
  })

  test('shows a message when nothing is installed', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'actovia-cli-installed-screen-empty-'))
    const { lastFrame } = render(<InstalledScreen skillsDir={emptyDir} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('No skills installed')
    await rm(emptyDir, { recursive: true, force: true })
  })

  test('space toggles the selected skill\'s isActive and persists it', async () => {
    const { stdin } = render(<InstalledScreen skillsDir={skillsDir} />)
    await new Promise((r) => setTimeout(r, 10))
    stdin.write(' ')
    await new Promise((r) => setTimeout(r, 30))
    const lock = await readLockfile(skillsDir)
    expect(lock.skills['find-skills']?.isActive).toBe(false)
  })

  test('x uninstalls the selected skill', async () => {
    const { stdin, lastFrame } = render(<InstalledScreen skillsDir={skillsDir} />)
    await new Promise((r) => setTimeout(r, 10))
    stdin.write('x')
    await new Promise((r) => setTimeout(r, 30))
    expect(lastFrame()).toContain('No skills installed')
  })

  test('shows an error message when toggling fails', async () => {
    const lockPath = join(skillsDir, '.lock.json')
    await chmod(lockPath, 0o444)

    const { stdin, lastFrame } = render(<InstalledScreen skillsDir={skillsDir} />)
    await new Promise((r) => setTimeout(r, 10))
    stdin.write(' ')
    await new Promise((r) => setTimeout(r, 30))
    const frame = lastFrame()
    expect(frame).toMatch(/permission|denied|EACCES/i)

    await chmod(lockPath, 0o644)
  })
})
