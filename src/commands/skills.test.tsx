import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as client from '../lib/skills-sh-client'
import * as store from '../lib/skills-store'
import {
  runSkillsInstall,
  runSkillsList,
  runSkillsSearch,
  runSkillsUninstall
} from './skills'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'actovia-cli-skills-cmd-'))
})

afterEach(async () => {
  await rm(skillsDir, { recursive: true, force: true })
})

describe('runSkillsSearch', () => {
  test('returns the data array from the client', async () => {
    const spy = spyOn(client, 'searchSkills').mockResolvedValue({
      data: [
        {
          id: 'expo/skills/react-native',
          slug: 'react-native',
          name: 'React Native',
          source: 'expo/skills',
          installs: 3842,
          sourceType: 'github',
          installUrl: 'https://github.com/expo/skills',
          url: 'https://skills.sh/expo/skills/react-native'
        }
      ],
      query: 'react native',
      searchType: 'semantic',
      count: 1,
      durationMs: 100
    })
    const results = await runSkillsSearch('react native', { json: true })
    expect(results).toHaveLength(1)
    expect(results[0]?.slug).toBe('react-native')
    spy.mockRestore()
  })
})

describe('error handling', () => {
  test('runSkillsSearch resolves to [] and prints {error, message} JSON on failure', async () => {
    const spy = spyOn(client, 'searchSkills').mockRejectedValue(new Error('network down'))
    const logSpy = spyOn(console, 'log').mockImplementation(() => { })

    const results = await runSkillsSearch('react native', { json: true })

    expect(results).toEqual([])
    expect(process.exitCode).toBe(1)
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n')
    expect(printed).toContain('"error":"command_failed"')
    expect(printed).toContain('network down')

    spy.mockRestore()
    logSpy.mockRestore()
    // Bun (unlike Node) doesn't clear process.exitCode when set to
    // `undefined` — it must be reset to a real 0 or the whole `bun test`
    // process exits non-zero even though every test passed.
    process.exitCode = 0
  })

  test('runSkillsInstall resolves to null and prints a plain error without --json', async () => {
    const spy = spyOn(client, 'getSkillDetail').mockRejectedValue(new Error('not found'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => { })

    const installed = await runSkillsInstall('bad/skill/id', { skillsDir })

    expect(installed).toBeNull()
    expect(process.exitCode).toBe(1)
    expect(errorSpy.mock.calls.map((call) => call[0]).join('\n')).toContain('not found')

    spy.mockRestore()
    errorSpy.mockRestore()
    // Bun (unlike Node) doesn't clear process.exitCode when set to
    // `undefined` — it must be reset to a real 0 or the whole `bun test`
    // process exits non-zero even though every test passed.
    process.exitCode = 0
  })
})

describe('runSkillsInstall + runSkillsList + runSkillsUninstall', () => {
  test('install writes to the given skills dir and list/uninstall reflect it', async () => {
    const detailSpy = spyOn(client, 'getSkillDetail').mockResolvedValue({
      id: 'vercel-labs/skills/find-skills',
      source: 'vercel-labs/skills',
      slug: 'find-skills',
      installs: 1,
      hash: 'deadbeefcafefeed',
      files: [{ path: 'SKILL.md', contents: '---\nname: Find Skills\n---' }]
    })

    const installed = await runSkillsInstall('vercel-labs/skills/find-skills', {
      json: true,
      skillsDir
    } as never)
    expect(installed?.slug).toBe('find-skills')

    const listed = await runSkillsList({ json: true, skillsDir } as never)
    expect(listed).toHaveLength(1)

    await runSkillsUninstall('find-skills', { json: true, skillsDir } as never)
    const afterUninstall = await runSkillsList({ json: true, skillsDir } as never)
    expect(afterUninstall).toHaveLength(0)

    detailSpy.mockRestore()
  })
})
