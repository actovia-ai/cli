import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  installSkill,
  listInstalledSkills,
  readLockfile,
  toggleSkillActive,
  uninstallSkill,
  type SkillDetail
} from './skills-store'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'actovia-cli-skills-store-'))
})

afterEach(async () => {
  await rm(skillsDir, { recursive: true, force: true })
})

const sampleDetail: SkillDetail = {
  id: 'vercel-labs/skills/find-skills',
  source: 'vercel-labs/skills',
  slug: 'find-skills',
  installs: 24531,
  hash: 'a1b2c3d4e5f60708',
  files: [
    { path: 'SKILL.md', contents: '---\nname: Find Skills\n---\nBody text.' },
    { path: 'examples/app-router.ts', contents: '// example' }
  ]
}

describe('readLockfile', () => {
  test('returns an empty lockfile when none exists yet', async () => {
    const lock = await readLockfile(skillsDir)
    expect(lock).toEqual({ skills: {} })
  })
})

describe('installSkill', () => {
  test('writes every file under <skillsDir>/<slug>/', async () => {
    await installSkill(skillsDir, sampleDetail)
    const skillMd = await readFile(join(skillsDir, 'find-skills', 'SKILL.md'), 'utf-8')
    expect(skillMd).toContain('Body text.')
    const example = await readFile(
      join(skillsDir, 'find-skills', 'examples', 'app-router.ts'),
      'utf-8'
    )
    expect(example).toBe('// example')
  })

  test('derives displayName from SKILL.md frontmatter', async () => {
    const installed = await installSkill(skillsDir, sampleDetail)
    expect(installed.displayName).toBe('Find Skills')
  })

  test('falls back to slug when SKILL.md has no name field', async () => {
    const detail: SkillDetail = {
      ...sampleDetail,
      files: [{ path: 'SKILL.md', contents: 'no frontmatter here' }]
    }
    const installed = await installSkill(skillsDir, detail)
    expect(installed.displayName).toBe('find-skills')
  })

  test('records version as the hash truncated to 12 chars, source as skills.sh', async () => {
    const installed = await installSkill(skillsDir, sampleDetail)
    expect(installed.version).toBe('a1b2c3d4e5f6')
    expect(installed.source).toBe('skills.sh')
    expect(installed.isActive).toBe(true)
  })

  test('updates the lockfile', async () => {
    await installSkill(skillsDir, sampleDetail)
    const lock = await readLockfile(skillsDir)
    expect(lock.skills['find-skills']?.displayName).toBe('Find Skills')
  })

  test('rejects a file path that traverses outside the skill directory', async () => {
    const maliciousDetail: SkillDetail = {
      ...sampleDetail,
      files: [{ path: '../../../../etc/evil-file', contents: 'pwned' }]
    }
    await expect(installSkill(skillsDir, maliciousDetail)).rejects.toThrow(
      'Refusing to write outside the skill directory'
    )
  })

  test('rejects an absolute file path', async () => {
    const maliciousDetail: SkillDetail = {
      ...sampleDetail,
      files: [{ path: '/etc/evil-file', contents: 'pwned' }]
    }
    await expect(installSkill(skillsDir, maliciousDetail)).rejects.toThrow(
      'Refusing to write outside the skill directory'
    )
  })

  test('clears stale files from a previous install when the upstream file set shrinks', async () => {
    await installSkill(skillsDir, sampleDetail)
    expect(
      existsSync(join(skillsDir, 'find-skills', 'examples', 'app-router.ts'))
    ).toBe(true)

    const shrunkDetail: SkillDetail = {
      ...sampleDetail,
      files: [{ path: 'SKILL.md', contents: '---\nname: Find Skills\n---\nUpdated body.' }]
    }
    await installSkill(skillsDir, shrunkDetail)

    expect(
      existsSync(join(skillsDir, 'find-skills', 'examples', 'app-router.ts'))
    ).toBe(false)
    const skillMd = await readFile(join(skillsDir, 'find-skills', 'SKILL.md'), 'utf-8')
    expect(skillMd).toContain('Updated body.')
  })

  test('does not write any file to disk outside skillsDir when rejecting', async () => {
    const maliciousDetail: SkillDetail = {
      ...sampleDetail,
      files: [{ path: '../../outside-file', contents: 'pwned' }]
    }
    await expect(installSkill(skillsDir, maliciousDetail)).rejects.toThrow()
    // the escape target must not exist one level above the temp skillsDir
    const { existsSync: fileExists } = await import('node:fs')
    const { dirname, join: pathJoin } = await import('node:path')
    expect(fileExists(pathJoin(dirname(skillsDir), 'outside-file'))).toBe(false)
  })
})

describe('uninstallSkill', () => {
  test('removes the skill directory and lockfile entry', async () => {
    await installSkill(skillsDir, sampleDetail)
    await uninstallSkill(skillsDir, 'find-skills')
    expect(existsSync(join(skillsDir, 'find-skills'))).toBe(false)
    const lock = await readLockfile(skillsDir)
    expect(lock.skills['find-skills']).toBeUndefined()
  })

  test('is a no-op for an unknown slug', async () => {
    await expect(uninstallSkill(skillsDir, 'does-not-exist')).resolves.toBeUndefined()
  })
})

describe('toggleSkillActive', () => {
  test('flips isActive in the lockfile', async () => {
    await installSkill(skillsDir, sampleDetail)
    await toggleSkillActive(skillsDir, 'find-skills', false)
    const lock = await readLockfile(skillsDir)
    expect(lock.skills['find-skills']?.isActive).toBe(false)
  })
})

describe('listInstalledSkills', () => {
  test('reflects the lockfile, slug included on each entry', async () => {
    await installSkill(skillsDir, sampleDetail)
    const installed = await listInstalledSkills(skillsDir)
    expect(installed).toHaveLength(1)
    expect(installed[0]?.slug).toBe('find-skills')
  })
})
