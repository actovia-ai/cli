import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { getActoviaHome, getSkillsDir } from './paths'

describe('paths', () => {
  test('getActoviaHome resolves to ~/.actovia', () => {
    expect(getActoviaHome()).toBe(join(homedir(), '.actovia'))
  })

  test('getSkillsDir defaults to <actoviaHome>/skills', () => {
    expect(getSkillsDir()).toBe(join(getActoviaHome(), 'skills'))
  })

  test('getSkillsDir accepts an override home for testing', () => {
    expect(getSkillsDir('/tmp/fake-home')).toBe(join('/tmp/fake-home', 'skills'))
  })
})
