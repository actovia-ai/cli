# @actovia-ai/cli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@actovia-ai/cli` — a Bun CLI providing `actovia open`, `actovia update`, `actovia skills` (interactive TUI + scripted subcommands), and `actovia help` — published to both npm and GitHub Releases binaries.

**Architecture:** A UI-agnostic core lib (`src/lib/*`) talks to the skills.sh-bff relay and to `~/.actovia/skills/` on disk. A Commander.js shell (`src/cli.ts` + `src/commands/*`) exposes every command non-interactively with `--json` output. An Ink TUI (`src/tui/*`), entered only by `actovia skills` with no subcommand, wraps the same core lib for the interactive Discover/Installed browser. Both layers call the exact same core functions — no logic is duplicated between the scripted and interactive paths.

**Tech Stack:** Bun 1.3+, TypeScript, Commander 15, Ink 7 + React 19, ink-text-input, ink-spinner, ink-testing-library (dev), bun:test.

**Spec:** `docs/superpowers/specs/2026-09-18-actovia-cli-design.md`

## Global Constraints

- Bin command is `actovia` (package name stays `@actovia-ai/cli`).
- Skills install to `~/.actovia/skills/<slug>/` with a `.lock.json` lockfile in the exact shape `the desktop app`'s `skills-manager.ts` already uses (`{ skills: Record<slug, { displayName, version, isActive, installPath, installedAt, source? }>> }`), so a skill installed via this CLI is immediately usable by the desktop app.
- skills.sh has no per-skill semver — the lockfile's `version` field stores the skill's content `hash`, truncated to 12 characters.
- All skills.sh calls go through the already-deployed BFF at `https://skills-md.yancey.app` (custom domain for the `skills.sh-bff` Vercel project; no auth header needed — the BFF injects the Vercel OIDC token server-side). Default base URL is overridable via the `ACTOVIA_SKILLS_BFF_URL` env var.
- No Commander file or Ink component may call `fetch`/`fs` directly — only `src/lib/*` does. Command files and TUI screens only call into `src/lib/*`.
- ClawHub is not supported. No generic multi-registry abstraction is built — `skills-sh-client.ts` is the only registry client, isolated behind its own module boundary for a future second source.
- npm channel assumes `bun` is on the end user's `PATH` (matches this org's Bun-first convention — see `CLAUDE.md`). Users without Bun are pointed at the compiled-binary GitHub Release instead.
- Every new file's exported function names/types must match exactly what later tasks' "Consumes" blocks say — checked in this plan's self-review, and re-checked by whoever implements it.

---

## Task 1: Project setup — dependencies, scripts, tsconfig

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `src/lib/.gitkeep` (placeholder so the empty dir is real before Task 2 — delete once Task 2 adds a file)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `bun run typecheck`, `bun test`, `bun run dev` scripts that every later task's steps rely on to verify their work

- [ ] **Step 1: Add runtime and dev dependencies**

Run:
```bash
cd ~/Code/actovia/cli
bun add commander@15.0.0 ink@7.1.1 react@19.3.0 ink-text-input@6.0.0 ink-spinner@5.0.0
bun add -d typescript@5.9.3 @types/react@19.3.0 ink-testing-library@4.0.0
```

These exact versions were verified together (no peer-dependency conflicts) before writing this plan.

- [ ] **Step 2: Update `package.json`**

Replace the whole file with:

```json
{
  "name": "@actovia-ai/cli",
  "version": "0.1.0",
  "module": "index.ts",
  "type": "module",
  "bin": {
    "actovia": "./index.ts"
  },
  "scripts": {
    "dev": "bun run index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "build:npm": "bun build ./index.ts --outdir dist --target bun --format esm && chmod +x dist/index.js",
    "build:binaries": "bash scripts/build-binaries.sh"
  },
  "dependencies": {
    "commander": "15.0.0",
    "ink": "7.1.1",
    "react": "19.3.0",
    "ink-text-input": "6.0.0",
    "ink-spinner": "5.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "19.3.0",
    "ink-testing-library": "4.0.0",
    "typescript": "5.9.3"
  }
}
```

(`bin` points at `index.ts` for local dev via `bun link`; Task 16 repoints published-package `bin` at the bundled `dist/index.js` output — see that task for why both exist.)

- [ ] **Step 3: Add `resolveJsonModule` to tsconfig**

Read `tsconfig.json`, add `"resolveJsonModule": true` to `compilerOptions` (needed so `tsc --noEmit` accepts `import { version } from '../../package.json'` in Task 6):

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "types": ["bun"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}
```

- [ ] **Step 4: Verify the baseline**

Run:
```bash
bun run typecheck
```
Expected: no output, exit code 0 (the untouched `index.ts` with `console.log("Hello via Bun!")` still type-checks).

```bash
bun test
```
Expected: `0 tests` (no test files exist yet) — exits 0, not an error.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "chore: add cli dependencies and scripts"
```

---

## Task 2: `src/lib/paths.ts`

**Files:**
- Create: `src/lib/paths.ts`
- Test: `src/lib/paths.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getActoviaHome(): string`, `getSkillsDir(actoviaHome?: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/paths.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/paths.test.ts`
Expected: FAIL — `Cannot find module './paths'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/paths.ts`:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getActoviaHome(): string {
  return join(homedir(), '.actovia')
}

export function getSkillsDir(actoviaHome: string = getActoviaHome()): string {
  return join(actoviaHome, 'skills')
}
```

- [ ] **Step 4: Remove the placeholder and run tests**

```bash
rm -f src/lib/.gitkeep
bun test src/lib/paths.test.ts
```
Expected: `3 pass`, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts src/lib/paths.test.ts
git rm --cached src/lib/.gitkeep 2>/dev/null || true
git commit -m "feat: add actovia home/skills dir path helpers"
```

---

## Task 3: `src/lib/skills-store.ts` — local install/lockfile

**Files:**
- Create: `src/lib/skills-store.ts`
- Test: `src/lib/skills-store.test.ts`

**Interfaces:**
- Consumes: nothing beyond Node builtins
- Produces:
  - `interface InstalledSkill { slug: string; displayName: string; version: string; isActive: boolean; installPath: string; installedAt: number; source?: string }`
  - `interface SkillsLockfile { skills: Record<string, Omit<InstalledSkill, 'slug'>> }`
  - `interface SkillFile { path: string; contents: string }`
  - `interface SkillDetail { id: string; source: string; slug: string; installs: number; hash: string; files: SkillFile[] }`
  - `readLockfile(skillsDir: string): Promise<SkillsLockfile>`
  - `writeLockfile(skillsDir: string, lock: SkillsLockfile): Promise<void>`
  - `listInstalledSkills(skillsDir: string): Promise<InstalledSkill[]>`
  - `installSkill(skillsDir: string, detail: SkillDetail): Promise<InstalledSkill>`
  - `uninstallSkill(skillsDir: string, slug: string): Promise<void>`
  - `toggleSkillActive(skillsDir: string, slug: string, isActive: boolean): Promise<void>`
  - Every function here is consumed directly by Task 9 (`skills` commands) and Tasks 12–14 (TUI screens) — the names/signatures above are load-bearing for both.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/skills-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/skills-store.test.ts`
Expected: FAIL — `Cannot find module './skills-store'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/skills-store.ts`:

```ts
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LOCK_FILE = '.lock.json'

export interface InstalledSkill {
  slug: string
  displayName: string
  version: string
  isActive: boolean
  installPath: string
  installedAt: number
  source?: string
}

export interface SkillsLockfile {
  skills: Record<string, Omit<InstalledSkill, 'slug'>>
}

export interface SkillFile {
  path: string
  contents: string
}

export interface SkillDetail {
  id: string
  source: string
  slug: string
  installs: number
  hash: string
  files: SkillFile[]
}

function getLockfilePath(skillsDir: string): string {
  return join(skillsDir, LOCK_FILE)
}

export async function readLockfile(skillsDir: string): Promise<SkillsLockfile> {
  try {
    const raw = await readFile(getLockfilePath(skillsDir), 'utf-8')
    return JSON.parse(raw) as SkillsLockfile
  } catch {
    return { skills: {} }
  }
}

export async function writeLockfile(skillsDir: string, lock: SkillsLockfile): Promise<void> {
  await mkdir(skillsDir, { recursive: true })
  await writeFile(getLockfilePath(skillsDir), JSON.stringify(lock, null, 2), 'utf-8')
}

function parseDisplayName(files: SkillFile[], fallback: string): string {
  const skillMd = files.find((f) => f.path === 'SKILL.md')
  if (!skillMd) return fallback
  const match = skillMd.contents.match(/^---[\s\S]*?name:\s*(.+)/m)
  return match?.[1]?.trim() || fallback
}

export async function installSkill(
  skillsDir: string,
  detail: SkillDetail
): Promise<InstalledSkill> {
  const skillDir = join(skillsDir, detail.slug)
  await mkdir(skillDir, { recursive: true })

  for (const file of detail.files) {
    const targetPath = join(skillDir, file.path)
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, file.contents, 'utf-8')
  }

  const lock = await readLockfile(skillsDir)
  const installed: Omit<InstalledSkill, 'slug'> = {
    displayName: parseDisplayName(detail.files, detail.slug),
    version: detail.hash.slice(0, 12),
    isActive: true,
    installPath: skillDir,
    installedAt: Date.now(),
    source: 'skills.sh'
  }
  lock.skills[detail.slug] = installed
  await writeLockfile(skillsDir, lock)

  return { slug: detail.slug, ...installed }
}

export async function uninstallSkill(skillsDir: string, slug: string): Promise<void> {
  const lock = await readLockfile(skillsDir)
  const entry = lock.skills[slug]
  if (!entry) return
  if (existsSync(entry.installPath)) {
    await rm(entry.installPath, { recursive: true, force: true })
  }
  delete lock.skills[slug]
  await writeLockfile(skillsDir, lock)
}

export async function toggleSkillActive(
  skillsDir: string,
  slug: string,
  isActive: boolean
): Promise<void> {
  const lock = await readLockfile(skillsDir)
  const entry = lock.skills[slug]
  if (!entry) return
  entry.isActive = isActive
  await writeLockfile(skillsDir, lock)
}

export async function listInstalledSkills(skillsDir: string): Promise<InstalledSkill[]> {
  const lock = await readLockfile(skillsDir)
  return Object.entries(lock.skills).map(([slug, info]) => ({ slug, ...info }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/skills-store.test.ts`
Expected: `10 pass`, 0 fail.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/lib/skills-store.ts src/lib/skills-store.test.ts
git commit -m "feat: add local skills store (install/uninstall/toggle/list)"
```

---

## Task 4: `src/lib/skills-sh-client.ts` — BFF client

**Files:**
- Create: `src/lib/skills-sh-client.ts`
- Test: `src/lib/skills-sh-client.test.ts`

**Interfaces:**
- Consumes: nothing beyond builtins
- Produces:
  - `DEFAULT_BFF_BASE_URL = 'https://skills-md.yancey.app'`, overridable per-call by the `baseUrl` param (tests use this) and by the `ACTOVIA_SKILLS_BFF_URL` env var when no explicit `baseUrl` is passed
  - `interface SkillListItem { id: string; slug: string; name: string; source: string; installs: number; sourceType: string; installUrl: string; url: string }`
  - `interface SkillListResponse { data: SkillListItem[]; pagination: { page: number; perPage: number; total: number; hasMore: boolean } }`
  - `interface SkillSearchResponse { data: SkillListItem[]; query: string; searchType: 'fuzzy' | 'semantic'; count: number; durationMs: number }`
  - `interface SkillAuditEntry { provider: string; slug: string; status: 'pass' | 'warn' | 'fail'; summary: string; auditedAt: string; riskLevel?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; categories?: string[] }`
  - `interface SkillAuditResponse { id: string; source: string; slug: string; audits: SkillAuditEntry[] }`
  - `class SkillsApiError extends Error { status: number }`
  - `listSkills(opts?: { view?: 'all-time' | 'trending' | 'hot'; page?: number; perPage?: number }, baseUrl?: string): Promise<SkillListResponse>`
  - `searchSkills(query: string, opts?: { owner?: string; limit?: number }, baseUrl?: string): Promise<SkillSearchResponse>`
  - `getSkillDetail(id: string, baseUrl?: string): Promise<import('./skills-store').SkillDetail>`
  - `getSkillAudit(id: string, baseUrl?: string): Promise<SkillAuditResponse | null>` (null on 404 — "no audits exist" per the API docs)
  - This is consumed by Task 9 (`skills` commands) and Tasks 12–14 (TUI screens).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/skills-sh-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'

import {
  getSkillAudit,
  getSkillDetail,
  listSkills,
  searchSkills,
  SkillsApiError
} from './skills-sh-client'

const BASE = 'https://fake-bff.example.test'

let fetchSpy: ReturnType<typeof jest.spyOn>

beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('listSkills', () => {
  test('requests /api/v1/skills with view/page/perPage query params', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        data: [],
        pagination: { page: 0, perPage: 10, total: 0, hasMore: false }
      })
    )
    await listSkills({ view: 'trending', page: 1, perPage: 10 }, BASE)
    const calledUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]))
    expect(calledUrl.pathname).toBe('/api/v1/skills')
    expect(calledUrl.searchParams.get('view')).toBe('trending')
    expect(calledUrl.searchParams.get('page')).toBe('1')
    expect(calledUrl.searchParams.get('per_page')).toBe('10')
  })

  test('throws SkillsApiError on a non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: 'rate_limited', message: 'Too many requests' }, 429)
    )
    await expect(listSkills({}, BASE)).rejects.toThrow(SkillsApiError)
  })
})

describe('searchSkills', () => {
  test('requests /api/v1/skills/search with q/owner/limit query params', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ data: [], query: 'react native', searchType: 'semantic', count: 0, durationMs: 1 })
    )
    await searchSkills('react native', { owner: 'expo', limit: 5 }, BASE)
    const calledUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]))
    expect(calledUrl.pathname).toBe('/api/v1/skills/search')
    expect(calledUrl.searchParams.get('q')).toBe('react native')
    expect(calledUrl.searchParams.get('owner')).toBe('expo')
    expect(calledUrl.searchParams.get('limit')).toBe('5')
  })
})

describe('getSkillDetail', () => {
  test('requests /api/v1/skills/{id} and returns the parsed body', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        id: 'vercel-labs/skills/find-skills',
        source: 'vercel-labs/skills',
        slug: 'find-skills',
        installs: 24531,
        hash: 'a1b2c3d4e5f6',
        files: [{ path: 'SKILL.md', contents: '---\nname: Find Skills\n---' }]
      })
    )
    const detail = await getSkillDetail('vercel-labs/skills/find-skills', BASE)
    const calledUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]))
    expect(calledUrl.pathname).toBe('/api/v1/skills/vercel-labs/skills/find-skills')
    expect(detail.slug).toBe('find-skills')
    expect(detail.files[0]?.path).toBe('SKILL.md')
  })
})

describe('getSkillAudit', () => {
  test('requests /api/v1/skills/audit/{id} and returns the audits array', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        id: 'vercel-labs/skills/find-skills',
        source: 'vercel-labs/skills',
        slug: 'find-skills',
        audits: [
          {
            provider: 'Socket',
            slug: 'socket',
            status: 'pass',
            summary: 'No alerts',
            auditedAt: '2026-04-15T12:05:00.000Z'
          }
        ]
      })
    )
    const audit = await getSkillAudit('vercel-labs/skills/find-skills', BASE)
    const calledUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]))
    expect(calledUrl.pathname).toBe('/api/v1/skills/audit/vercel-labs/skills/find-skills')
    expect(audit?.audits[0]?.provider).toBe('Socket')
  })

  test('returns null on 404 (no audits exist)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'not_found', message: 'No audits' }, 404))
    const audit = await getSkillAudit('unaudited/skill', BASE)
    expect(audit).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/skills-sh-client.test.ts`
Expected: FAIL — `Cannot find module './skills-sh-client'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/skills-sh-client.ts`:

```ts
import type { SkillDetail } from './skills-store'

export const DEFAULT_BFF_BASE_URL = 'https://skills-md.yancey.app'

function resolveBaseUrl(explicit?: string): string {
  return explicit ?? process.env.ACTOVIA_SKILLS_BFF_URL ?? DEFAULT_BFF_BASE_URL
}

export interface SkillListItem {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: string
  installUrl: string
  url: string
}

export interface SkillListResponse {
  data: SkillListItem[]
  pagination: { page: number; perPage: number; total: number; hasMore: boolean }
}

export interface SkillSearchResponse {
  data: SkillListItem[]
  query: string
  searchType: 'fuzzy' | 'semantic'
  count: number
  durationMs: number
}

export interface SkillAuditEntry {
  provider: string
  slug: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  auditedAt: string
  riskLevel?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  categories?: string[]
}

export interface SkillAuditResponse {
  id: string
  source: string
  slug: string
  audits: SkillAuditEntry[]
}

export class SkillsApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SkillsApiError'
    this.status = status
  }
}

async function request<T>(url: URL): Promise<T> {
  const res = await fetch(url)
  if (res.status === 404) {
    throw new SkillsApiError(404, 'Not found')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new SkillsApiError(res.status, body?.message ?? `Request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

export async function listSkills(
  opts: { view?: 'all-time' | 'trending' | 'hot'; page?: number; perPage?: number } = {},
  baseUrl?: string
): Promise<SkillListResponse> {
  const url = new URL('/api/v1/skills', resolveBaseUrl(baseUrl))
  if (opts.view) url.searchParams.set('view', opts.view)
  if (opts.page !== undefined) url.searchParams.set('page', String(opts.page))
  if (opts.perPage !== undefined) url.searchParams.set('per_page', String(opts.perPage))
  return request<SkillListResponse>(url)
}

export async function searchSkills(
  query: string,
  opts: { owner?: string; limit?: number } = {},
  baseUrl?: string
): Promise<SkillSearchResponse> {
  const url = new URL('/api/v1/skills/search', resolveBaseUrl(baseUrl))
  url.searchParams.set('q', query)
  if (opts.owner) url.searchParams.set('owner', opts.owner)
  if (opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit))
  return request<SkillSearchResponse>(url)
}

export async function getSkillDetail(
  id: string,
  baseUrl?: string
): Promise<SkillDetail> {
  const url = new URL(`/api/v1/skills/${id}`, resolveBaseUrl(baseUrl))
  return request<SkillDetail>(url)
}

export async function getSkillAudit(
  id: string,
  baseUrl?: string
): Promise<SkillAuditResponse | null> {
  const url = new URL(`/api/v1/skills/audit/${id}`, resolveBaseUrl(baseUrl))
  try {
    return await request<SkillAuditResponse>(url)
  } catch (err) {
    if (err instanceof SkillsApiError && err.status === 404) return null
    throw err
  }
}
```

Note: `new URL('/api/v1/skills/${id}', baseUrl)` where `id` already contains slashes (e.g. `vercel-labs/skills/find-skills`) works correctly because the id is interpolated into the *path string* before `URL` parses it — `URL` does not re-encode already-present `/` characters in a path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/skills-sh-client.test.ts`
Expected: `7 pass`, 0 fail.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/lib/skills-sh-client.ts src/lib/skills-sh-client.test.ts
git commit -m "feat: add skills.sh-bff client"
```

---

## Task 5: `src/lib/open-app.ts`

**Files:**
- Create: `src/lib/open-app.ts`
- Test: `src/lib/open-app.test.ts`

**Interfaces:**
- Consumes: nothing beyond builtins
- Produces: `type OpenAppResult = { status: 'opened' } | { status: 'not-found' }`, `openActoviaApp(platform?: NodeJS.Platform): Promise<OpenAppResult>` — consumed by Task 7 (`open` command).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/open-app.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { openActoviaApp } from './open-app'

describe('openActoviaApp', () => {
  test('darwin: reports not-found when Actovia.app is not installed', async () => {
    // CI/dev sandboxes never have Actovia.app installed, so `open -a Actovia`
    // genuinely fails here — this exercises the real code path, no mocking.
    const result = await openActoviaApp('darwin')
    expect(result.status).toBe('not-found')
  })

  test('win32: reports not-found when no known install path exists', async () => {
    const result = await openActoviaApp('win32')
    expect(result.status).toBe('not-found')
  })

  test('linux: reports not-found when `actovia` is not on PATH', async () => {
    const result = await openActoviaApp('linux')
    expect(result.status).toBe('not-found')
  })

  test('unsupported platform reports not-found rather than throwing', async () => {
    const result = await openActoviaApp('sunos' as NodeJS.Platform)
    expect(result.status).toBe('not-found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/open-app.test.ts`
Expected: FAIL — `Cannot find module './open-app'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/open-app.ts`:

```ts
import { join } from 'node:path'

export type OpenAppResult = { status: 'opened' } | { status: 'not-found' }

async function tryDarwin(): Promise<OpenAppResult> {
  const proc = Bun.spawn(['open', '-a', 'Actovia'], { stdout: 'ignore', stderr: 'ignore' })
  const exitCode = await proc.exited
  return exitCode === 0 ? { status: 'opened' } : { status: 'not-found' }
}

async function tryWin32(): Promise<OpenAppResult> {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Actovia', 'Actovia.exe'),
    join(process.env.ProgramFiles ?? '', 'Actovia', 'Actovia.exe')
  ]
  for (const exePath of candidates) {
    if (await Bun.file(exePath).exists()) {
      Bun.spawn([exePath], { stdout: 'ignore', stderr: 'ignore' })
      return { status: 'opened' }
    }
  }
  return { status: 'not-found' }
}

async function tryLinux(): Promise<OpenAppResult> {
  const check = Bun.spawn(['sh', '-c', 'command -v actovia'], {
    stdout: 'ignore',
    stderr: 'ignore'
  })
  const exitCode = await check.exited
  if (exitCode !== 0) return { status: 'not-found' }
  Bun.spawn(['actovia'], { stdout: 'ignore', stderr: 'ignore' })
  return { status: 'opened' }
}

export async function openActoviaApp(
  platform: NodeJS.Platform = process.platform
): Promise<OpenAppResult> {
  if (platform === 'darwin') return tryDarwin()
  if (platform === 'win32') return tryWin32()
  if (platform === 'linux') return tryLinux()
  return { status: 'not-found' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/open-app.test.ts`
Expected: `4 pass`, 0 fail.

(If step 1's darwin test ever runs on a machine that *does* have Actovia.app installed, it will fail with `opened` instead — that's expected and correct; skip that assertion locally if so. CI runners never have it installed.)

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/lib/open-app.ts src/lib/open-app.test.ts
git commit -m "feat: add cross-platform Actovia app launcher"
```

---

## Task 6: `src/lib/updater.ts` + `src/lib/dist-channel.ts`

**Files:**
- Create: `src/lib/dist-channel.ts`
- Create: `src/lib/updater.ts`
- Test: `src/lib/updater.test.ts`

**Interfaces:**
- Consumes: `package.json`'s `version` field (JSON import)
- Produces:
  - `DIST_CHANNEL: 'npm' | 'binary'` (from `dist-channel.ts`)
  - `getCurrentVersion(): string`
  - `isNewerVersion(current: string, latest: string): boolean`
  - `pickReleaseAssetName(platform: NodeJS.Platform, arch: string): string | null`
  - `getLatestNpmVersion(baseUrl?: string): Promise<string>`
  - `interface GithubReleaseAsset { name: string; browser_download_url: string }`
  - `interface GithubRelease { tag_name: string; assets: GithubReleaseAsset[] }`
  - `getLatestRelease(baseUrl?: string): Promise<GithubRelease>`
  - `type UpdateCheckResult = { updateAvailable: false; current: string } | { updateAvailable: true; current: string; latest: string }`
  - `checkForUpdate(): Promise<UpdateCheckResult>` — consumed by Task 8 (`update` command)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/updater.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'

import {
  checkForUpdate,
  getCurrentVersion,
  getLatestNpmVersion,
  getLatestRelease,
  isNewerVersion,
  pickReleaseAssetName
} from './updater'

describe('getCurrentVersion', () => {
  test('reads the version from package.json', () => {
    expect(getCurrentVersion()).toBe('0.1.0')
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
      'https://fake-registry.example.test/@actovia-ai/cli/latest'
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/updater.test.ts`
Expected: FAIL — `Cannot find module './updater'`

- [ ] **Step 3: Write `dist-channel.ts`**

Create `src/lib/dist-channel.ts`:

```ts
// Overwritten to 'binary' by scripts/build-binaries.sh right before compiling
// each platform target, and restored to 'npm' afterward — see Task 16. Local
// dev and the published npm package both see 'npm'.
export const DIST_CHANNEL: 'npm' | 'binary' = 'npm'
```

- [ ] **Step 4: Write `updater.ts`**

Create `src/lib/updater.ts`:

```ts
import { version as currentVersion } from '../../package.json'
import { DIST_CHANNEL } from './dist-channel'

export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'
export const DEFAULT_GITHUB_API = 'https://api.github.com/repos/actovia-ai/cli'

export function getCurrentVersion(): string {
  return currentVersion
}

export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

export function pickReleaseAssetName(platform: NodeJS.Platform, arch: string): string | null {
  const platformName = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : null
  if (!platformName) return null
  if (arch !== 'x64' && arch !== 'arm64') return null
  const suffix = platform === 'win32' ? '.exe' : ''
  return `actovia-${platformName}-${arch}${suffix}`
}

export async function getLatestNpmVersion(
  baseUrl: string = DEFAULT_NPM_REGISTRY
): Promise<string> {
  const res = await fetch(`${baseUrl}/@actovia-ai/cli/latest`)
  if (!res.ok) throw new Error(`npm registry lookup failed: ${res.status}`)
  const body = (await res.json()) as { version: string }
  return body.version
}

export interface GithubReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GithubRelease {
  tag_name: string
  assets: GithubReleaseAsset[]
}

export async function getLatestRelease(
  baseUrl: string = DEFAULT_GITHUB_API
): Promise<GithubRelease> {
  const res = await fetch(`${baseUrl}/releases/latest`)
  if (!res.ok) throw new Error(`GitHub releases lookup failed: ${res.status}`)
  return (await res.json()) as GithubRelease
}

export type UpdateCheckResult =
  | { updateAvailable: false; current: string }
  | { updateAvailable: true; current: string; latest: string }

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = getCurrentVersion()
  const latest =
    DIST_CHANNEL === 'npm'
      ? await getLatestNpmVersion()
      : (await getLatestRelease()).tag_name.replace(/^v/, '')
  if (!isNewerVersion(current, latest)) {
    return { updateAvailable: false, current }
  }
  return { updateAvailable: true, current, latest }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/lib/updater.test.ts`
Expected: `10 pass`, 0 fail.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add src/lib/dist-channel.ts src/lib/updater.ts src/lib/updater.test.ts
git commit -m "feat: add version check (npm registry + GitHub releases)"
```

---

## Task 7: Command shell skeleton + `actovia open`

**Files:**
- Create: `src/cli.ts`
- Create: `src/commands/open.ts`
- Modify: `index.ts`
- Test: `src/commands/open.test.ts`

**Interfaces:**
- Consumes: `openActoviaApp` from `src/lib/open-app.ts` (Task 5)
- Produces: `buildProgram(): Command` (from `src/cli.ts`) — every later command task (8, 9) adds its own `register*Command(program)` call inside this function; `runOpen(): Promise<{ status: 'opened' | 'not-found' }>` (from `src/commands/open.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/commands/open.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/commands/open.test.ts`
Expected: FAIL — `Cannot find module './open'`

- [ ] **Step 3: Write `src/commands/open.ts`**

Create `src/commands/open.ts`:

```ts
import type { Command } from 'commander'

import { openActoviaApp, type OpenAppResult } from '../lib/open-app'

export async function runOpen(): Promise<OpenAppResult> {
  const result = await openActoviaApp()
  if (result.status === 'opened') {
    console.log('Opened Actovia.')
  } else {
    console.error("Actovia isn't installed. Download it: https://actovia.yancey.app")
  }
  return result
}

export function registerOpenCommand(program: Command): void {
  program
    .command('open')
    .description('Launch the Actovia desktop app')
    .action(async () => {
      const result = await runOpen()
      if (result.status === 'not-found') process.exitCode = 1
    })
}
```

- [ ] **Step 4: Write `src/cli.ts`**

Create `src/cli.ts`:

```ts
import { Command } from 'commander'

import { version } from '../package.json'
import { registerOpenCommand } from './commands/open'

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('actovia')
    .description('@actovia-ai/cli — launch Actovia, manage skills, and self-update')
    .version(version)

  registerOpenCommand(program)

  return program
}
```

- [ ] **Step 5: Wire up `index.ts`**

Replace `index.ts`:

```ts
#!/usr/bin/env bun
import { buildProgram } from './src/cli'

await buildProgram().parseAsync(process.argv)
```

- [ ] **Step 6: Run tests, then verify manually**

Run: `bun test src/commands/open.test.ts`
Expected: `2 pass`, 0 fail.

Run: `bun run typecheck`
Expected: no output, exit 0.

Manual verification:
```bash
bun run index.ts --help
```
Expected: usage text listing the `open` command.

```bash
bun run index.ts open
```
Expected (no Actovia.app installed on this machine): prints `Actovia isn't installed. Download it: https://actovia.yancey.app` and exits 1.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/commands/open.ts src/commands/open.test.ts index.ts
git commit -m "feat: add actovia open command and Commander shell"
```

---

## Task 8: `actovia update`

**Files:**
- Create: `src/commands/update.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/update.test.ts`

**Interfaces:**
- Consumes: `checkForUpdate`, `getCurrentVersion`, `DIST_CHANNEL` from `src/lib/updater.ts` (Task 6)
- Produces: `runUpdate(opts: { check?: boolean }): Promise<import('../lib/updater').UpdateCheckResult>`

- [ ] **Step 1: Write the failing tests**

Create `src/commands/update.test.ts`:

```ts
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
    expect(result.updateAvailable).toBe(false)
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/commands/update.test.ts`
Expected: FAIL — `Cannot find module './update'`

- [ ] **Step 3: Write `src/commands/update.ts`**

`--check` only reports; without it, npm-channel installs get a copy-pasteable command (actually running a global npm install from inside the CLI without the user's explicit confirmation is a destructive-ish action on their global package state, so v1 prints the command rather than auto-executing it) and binary-channel installs print that self-replace isn't implemented in this task (Task 16 documents the full binary self-replace flow as part of packaging — this task establishes the check, which is the part every channel needs).

Create `src/commands/update.ts`:

```ts
import type { Command } from 'commander'

import { checkForUpdate, DIST_CHANNEL, type UpdateCheckResult } from '../lib/updater'

export async function runUpdate(opts: { check?: boolean } = {}): Promise<UpdateCheckResult> {
  const result = await checkForUpdate()

  if (!result.updateAvailable) {
    console.log(`@actovia-ai/cli is up to date (${result.current}).`)
    return result
  }

  console.log(`Update available: ${result.current} → ${result.latest}`)

  if (opts.check) return result

  if (DIST_CHANNEL === 'npm') {
    console.log('Run: npm install -g @actovia-ai/cli@latest')
  } else {
    console.log(
      'Automatic binary self-update isn\'t wired up in this build yet — download the latest release from https://github.com/actovia-ai/cli/releases/latest'
    )
  }

  return result
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for a newer @actovia-ai/cli version')
    .option('--check', 'only report whether an update is available, take no further action')
    .action(async (opts: { check?: boolean }) => {
      await runUpdate(opts)
    })
}
```

- [ ] **Step 4: Register it in `src/cli.ts`**

Edit `src/cli.ts`, add the import and registration call:

```ts
import { registerOpenCommand } from './commands/open'
import { registerUpdateCommand } from './commands/update'
```

```ts
  registerOpenCommand(program)
  registerUpdateCommand(program)
```

- [ ] **Step 5: Run tests and verify manually**

Run: `bun test src/commands/update.test.ts`
Expected: `2 pass`, 0 fail.

Manual verification (hits the real npm registry — network required):
```bash
bun run index.ts update --check
```
Expected: either "up to date (0.1.0)" (nothing published yet, so this call will actually fail with a 404 from the registry since `@actovia-ai/cli` isn't published — that's fine to see locally; it confirms the command wiring runs. This becomes meaningful after Task 16 publishes an 0.1.0 to npm).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/commands/update.ts src/commands/update.test.ts
git commit -m "feat: add actovia update command"
```

---

## Task 9: `actovia skills <search|install|list|uninstall>` (non-interactive)

**Files:**
- Create: `src/commands/skills.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/skills.test.ts`

**Interfaces:**
- Consumes: `listSkills`, `searchSkills`, `getSkillDetail` from `src/lib/skills-sh-client.ts` (Task 4); `installSkill`, `uninstallSkill`, `listInstalledSkills` from `src/lib/skills-store.ts` (Task 3); `getSkillsDir` from `src/lib/paths.ts` (Task 2)
- Produces:
  - `runSkillsSearch(query: string, opts: { json?: boolean }): Promise<import('../lib/skills-sh-client').SkillListItem[]>`
  - `runSkillsInstall(id: string, opts: { json?: boolean }): Promise<import('../lib/skills-store').InstalledSkill>`
  - `runSkillsList(opts: { json?: boolean }): Promise<import('../lib/skills-store').InstalledSkill[]>`
  - `runSkillsUninstall(slug: string, opts: { json?: boolean }): Promise<void>`
  - `registerSkillsCommand(program: Command): Command` — returns the `skills` sub-`Command` so Task 15 can attach the no-args TUI action to it

- [ ] **Step 1: Write the failing tests**

Create `src/commands/skills.test.ts`:

```ts
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
    expect(installed.slug).toBe('find-skills')

    const listed = await runSkillsList({ json: true, skillsDir } as never)
    expect(listed).toHaveLength(1)

    await runSkillsUninstall('find-skills', { json: true, skillsDir } as never)
    const afterUninstall = await runSkillsList({ json: true, skillsDir } as never)
    expect(afterUninstall).toHaveLength(0)

    detailSpy.mockRestore()
  })
})
```

(The `{ skillsDir } as never` cast is deliberate: production callers never pass `skillsDir` — it's the default-parameter escape hatch the test uses to avoid touching the real `~/.actovia/skills`. See Step 3's signatures: `skillsDir` is an optional last parameter defaulting to `getSkillsDir()`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/commands/skills.test.ts`
Expected: FAIL — `Cannot find module './skills'`

- [ ] **Step 3: Write `src/commands/skills.ts`**

Create `src/commands/skills.ts`:

```ts
import type { Command } from 'commander'

import { getSkillDetail, listSkills, searchSkills, type SkillListItem } from '../lib/skills-sh-client'
import { getSkillsDir } from '../lib/paths'
import {
  installSkill,
  listInstalledSkills,
  uninstallSkill,
  type InstalledSkill
} from '../lib/skills-store'

interface JsonOpt {
  json?: boolean
  skillsDir?: string
}

export async function runSkillsSearch(
  query: string,
  opts: JsonOpt = {}
): Promise<SkillListItem[]> {
  const { data } = await searchSkills(query)
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    for (const item of data) {
      console.log(`${item.id}  (${item.installs.toLocaleString()} installs)`)
    }
  }
  return data
}

export async function runSkillsInstall(
  id: string,
  opts: JsonOpt = {}
): Promise<InstalledSkill> {
  const detail = await getSkillDetail(id)
  const installed = await installSkill(opts.skillsDir ?? getSkillsDir(), detail)
  if (opts.json) {
    console.log(JSON.stringify(installed, null, 2))
  } else {
    console.log(`Installed "${installed.displayName}" (${installed.slug}).`)
  }
  return installed
}

export async function runSkillsList(opts: JsonOpt = {}): Promise<InstalledSkill[]> {
  const installed = await listInstalledSkills(opts.skillsDir ?? getSkillsDir())
  if (opts.json) {
    console.log(JSON.stringify(installed, null, 2))
  } else if (installed.length === 0) {
    console.log('No skills installed.')
  } else {
    for (const skill of installed) {
      console.log(`${skill.slug}  ${skill.isActive ? '(active)' : '(inactive)'}`)
    }
  }
  return installed
}

export async function runSkillsUninstall(slug: string, opts: JsonOpt = {}): Promise<void> {
  await uninstallSkill(opts.skillsDir ?? getSkillsDir(), slug)
  if (!opts.json) console.log(`Uninstalled ${slug}.`)
}

export function registerSkillsCommand(program: Command): Command {
  const skills = program.command('skills').description('Browse and manage skills.sh skills')

  skills
    .command('search <query>')
    .description('Search skills.sh')
    .option('--json', 'output JSON instead of a formatted list')
    .action(async (query: string, opts: { json?: boolean }) => {
      await runSkillsSearch(query, opts)
    })

  skills
    .command('install <id>')
    .description('Install a skill by id (e.g. vercel-labs/skills/find-skills)')
    .option('--json', 'output JSON instead of a formatted message')
    .action(async (id: string, opts: { json?: boolean }) => {
      await runSkillsInstall(id, opts)
    })

  skills
    .command('list')
    .description('List installed skills')
    .option('--json', 'output JSON instead of a formatted list')
    .action(async (opts: { json?: boolean }) => {
      await runSkillsList(opts)
    })

  skills
    .command('uninstall <slug>')
    .description('Uninstall a skill')
    .option('--json', 'output JSON instead of a formatted message')
    .action(async (slug: string, opts: { json?: boolean }) => {
      await runSkillsUninstall(slug, opts)
    })

  return skills
}
```

Note: `listSkills` is imported but not yet called from a command in this task — it's wired into the TUI's Discover screen in Task 12. Keeping the import now would trigger an unused-import lint later; instead, remove it from this file's imports for now and re-add it in Task 12 where it's actually used. Adjust the import line to:

```ts
import { getSkillDetail, searchSkills, type SkillListItem } from '../lib/skills-sh-client'
```

- [ ] **Step 4: Register it in `src/cli.ts`**

Edit `src/cli.ts`:

```ts
import { registerOpenCommand } from './commands/open'
import { registerSkillsCommand } from './commands/skills'
import { registerUpdateCommand } from './commands/update'
```

```ts
  registerOpenCommand(program)
  registerUpdateCommand(program)
  registerSkillsCommand(program)
```

- [ ] **Step 5: Run tests and verify manually**

Run: `bun test src/commands/skills.test.ts`
Expected: `2 pass`, 0 fail.

```bash
bun run typecheck
bun run index.ts skills list --json
```
Expected: `[]` (nothing installed on this machine yet).

```bash
bun run index.ts skills search "react native" --json
```
Expected (network required, hits the real deployed BFF): a JSON array of skills.sh results.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/commands/skills.ts src/commands/skills.test.ts
git commit -m "feat: add non-interactive actovia skills subcommands"
```

---

## Task 10: TUI shared primitives — `useListNav` + `FooterHint`

**Files:**
- Create: `src/tui/use-list-nav.ts`
- Create: `src/tui/footer-hint.tsx`
- Test: `src/tui/use-list-nav.test.tsx`

**Interfaces:**
- Consumes: nothing beyond `ink`/`react`
- Produces:
  - `useListNav<T>(items: T[], opts?: { onSelect?: (item: T, index: number) => void; onEscape?: () => void }): { selectedIndex: number }` — consumed by Tasks 12–13
  - `FooterHint(props: { hints: Array<{ key: string; label: string }> })` component — consumed by Tasks 12–14

- [ ] **Step 1: Write the failing test**

Create `src/tui/use-list-nav.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import React from 'react'

import { useListNav } from './use-list-nav'

function Harness({ items, onSelect }: { items: string[]; onSelect: (item: string) => void }) {
  const { selectedIndex } = useListNav(items, { onSelect: (item) => onSelect(item) })
  return <Text>{`index:${selectedIndex}`}</Text>
}

describe('useListNav', () => {
  test('starts at index 0', () => {
    const { lastFrame } = render(<Harness items={['a', 'b', 'c']} onSelect={() => {}} />)
    expect(lastFrame()).toBe('index:0')
  })

  test('down arrow advances, up arrow retreats, clamped to bounds', () => {
    const { lastFrame, stdin } = render(<Harness items={['a', 'b', 'c']} onSelect={() => {}} />)
    stdin.write('[B') // down
    expect(lastFrame()).toBe('index:1')
    stdin.write('[B') // down
    stdin.write('[B') // down (would overshoot past index 2)
    expect(lastFrame()).toBe('index:2')
    stdin.write('[A') // up
    expect(lastFrame()).toBe('index:1')
  })

  test('enter calls onSelect with the item at the current index', () => {
    let selected: string | undefined
    const { stdin } = render(
      <Harness items={['a', 'b', 'c']} onSelect={(item) => (selected = item)} />
    )
    stdin.write('[B')
    stdin.write('\r')
    expect(selected).toBe('b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui/use-list-nav.test.tsx`
Expected: FAIL — `Cannot find module './use-list-nav'`

- [ ] **Step 3: Write `src/tui/use-list-nav.ts`**

Create `src/tui/use-list-nav.ts`:

```ts
import { useInput } from 'ink'
import { useState } from 'react'

export function useListNav<T>(
  items: T[],
  opts: { onSelect?: (item: T, index: number) => void; onEscape?: () => void } = {}
): { selectedIndex: number } {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useInput((_input, key) => {
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
    } else if (key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (key.return) {
      const item = items[selectedIndex]
      if (item !== undefined) opts.onSelect?.(item, selectedIndex)
    } else if (key.escape) {
      opts.onEscape?.()
    }
  })

  return { selectedIndex }
}
```

- [ ] **Step 4: Write `src/tui/footer-hint.tsx`**

Create `src/tui/footer-hint.tsx`:

```tsx
import { Text } from 'ink'
import React from 'react'

export function FooterHint({ hints }: { hints: Array<{ key: string; label: string }> }) {
  const text = hints.map((h) => `${h.key} to ${h.label}`).join(' · ')
  return (
    <Text dimColor italic>
      {text}
    </Text>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/tui/use-list-nav.test.tsx`
Expected: `3 pass`, 0 fail.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/use-list-nav.ts src/tui/footer-hint.tsx src/tui/use-list-nav.test.tsx
git commit -m "feat: add TUI list navigation hook and footer hint bar"
```

---

## Task 11: TUI Discover screen

**Files:**
- Create: `src/tui/discover-screen.tsx`
- Test: `src/tui/discover-screen.test.tsx`

**Interfaces:**
- Consumes: `listSkills`, `searchSkills`, `SkillListItem` from `src/lib/skills-sh-client.ts` (Task 4); `useListNav` from Task 10; `FooterHint` from Task 10
- Produces: `DiscoverScreen(props: { onSelect: (item: SkillListItem) => void })` — consumed by Task 14 (App shell)

- [ ] **Step 1: Write the failing test**

Create `src/tui/discover-screen.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { render } from 'ink-testing-library'
import React from 'react'

import { DiscoverScreen } from './discover-screen'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('DiscoverScreen', () => {
  let fetchSpy: ReturnType<typeof jest.spyOn>
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'vercel-labs/skills/find-skills',
            slug: 'find-skills',
            name: 'find-skills',
            source: 'vercel-labs/skills',
            installs: 24531,
            sourceType: 'github',
            installUrl: 'https://github.com/vercel-labs/skills',
            url: 'https://skills.sh/vercel-labs/skills/find-skills'
          }
        ],
        pagination: { page: 0, perPage: 100, total: 1, hasMore: false }
      })
    )
  })
  afterEach(() => fetchSpy.mockRestore())

  test('renders the loaded skill name after mount', async () => {
    const { lastFrame } = render(<DiscoverScreen onSelect={() => {}} />)
    // allow the effect's async listSkills() call to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('find-skills')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui/discover-screen.test.tsx`
Expected: FAIL — `Cannot find module './discover-screen'`

- [ ] **Step 3: Write `src/tui/discover-screen.tsx`**

Create `src/tui/discover-screen.tsx`:

```tsx
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import TextInput from 'ink-text-input'
import React, { useEffect, useState } from 'react'

import { listSkills, searchSkills, type SkillListItem } from '../lib/skills-sh-client'
import { FooterHint } from './footer-hint'
import { useListNav } from './use-list-nav'

export function DiscoverScreen({ onSelect }: { onSelect: (item: SkillListItem) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SkillListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const trimmed = query.trim()
    const request = trimmed
      ? searchSkills(trimmed).then((r) => r.data)
      : listSkills({ view: 'all-time' }).then((r) => r.data)
    request
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load skills')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const { selectedIndex } = useListNav(items, { onSelect })

  return (
    <Box flexDirection="column">
      <Box>
        <Text>Search: </Text>
        <TextInput value={query} onChange={setQuery} />
      </Box>
      {loading && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Loading…</Text>
        </Box>
      )}
      {error && <Text color="red">{error}</Text>}
      {!loading &&
        !error &&
        items.map((item, i) => (
          <Text key={item.id} inverse={i === selectedIndex}>
            {item.name} · {item.source} · {item.installs.toLocaleString()} installs
          </Text>
        ))}
      <FooterHint
        hints={[
          { key: 'Type', label: 'search' },
          { key: '↑/↓', label: 'move' },
          { key: 'Enter', label: 'view' },
          { key: 'Esc', label: 'go back' }
        ]}
      />
    </Box>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tui/discover-screen.test.tsx`
Expected: `1 pass`, 0 fail.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/discover-screen.tsx src/tui/discover-screen.test.tsx
git commit -m "feat: add TUI Discover screen"
```

---

## Task 12: TUI Installed screen

**Files:**
- Create: `src/tui/installed-screen.tsx`
- Test: `src/tui/installed-screen.test.tsx`

**Interfaces:**
- Consumes: `listInstalledSkills`, `uninstallSkill`, `toggleSkillActive`, `InstalledSkill` from `src/lib/skills-store.ts` (Task 3); `getSkillsDir` from `src/lib/paths.ts` (Task 2); `useListNav`, `FooterHint` from Task 10
- Produces: `InstalledScreen(props: { skillsDir?: string })` — consumed by Task 14 (App shell); the `skillsDir` prop defaults to `getSkillsDir()` and exists so tests can point at a temp dir

- [ ] **Step 1: Write the failing test**

Create `src/tui/installed-screen.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
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

describe('InstalledScreen', () => {
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui/installed-screen.test.tsx`
Expected: FAIL — `Cannot find module './installed-screen'`

- [ ] **Step 3: Write `src/tui/installed-screen.tsx`**

Create `src/tui/installed-screen.tsx`:

```tsx
import { Box, Text, useInput } from 'ink'
import React, { useEffect, useState } from 'react'

import { getSkillsDir } from '../lib/paths'
import {
  listInstalledSkills,
  toggleSkillActive,
  uninstallSkill,
  type InstalledSkill
} from '../lib/skills-store'
import { FooterHint } from './footer-hint'
import { useListNav } from './use-list-nav'

export function InstalledScreen({ skillsDir = getSkillsDir() }: { skillsDir?: string }) {
  const [items, setItems] = useState<InstalledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listInstalledSkills(skillsDir).then((data) => {
      if (!cancelled) {
        setItems(data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [skillsDir, reloadToken])

  const { selectedIndex } = useListNav(items, {})

  useInput((input) => {
    const item = items[selectedIndex]
    if (!item) return
    if (input === ' ') {
      toggleSkillActive(skillsDir, item.slug, !item.isActive).then(() =>
        setReloadToken((t) => t + 1)
      )
    } else if (input === 'x') {
      uninstallSkill(skillsDir, item.slug).then(() => setReloadToken((t) => t + 1))
    }
  })

  return (
    <Box flexDirection="column">
      {loading && <Text>Loading…</Text>}
      {!loading && items.length === 0 && <Text>No skills installed.</Text>}
      {!loading &&
        items.map((item, i) => (
          <Text key={item.slug} inverse={i === selectedIndex}>
            {item.displayName} ({item.slug}) · {item.isActive ? 'active' : 'inactive'}
          </Text>
        ))}
      <FooterHint
        hints={[
          { key: '↑/↓', label: 'move' },
          { key: 'Space', label: 'toggle active' },
          { key: 'x', label: 'uninstall' },
          { key: 'Esc', label: 'quit' }
        ]}
      />
    </Box>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tui/installed-screen.test.tsx`
Expected: `4 pass`, 0 fail.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/installed-screen.tsx src/tui/installed-screen.test.tsx
git commit -m "feat: add TUI Installed screen"
```

---

## Task 13: TUI detail/audit + install-confirm screen

**Files:**
- Create: `src/tui/detail-screen.tsx`
- Test: `src/tui/detail-screen.test.tsx`

**Interfaces:**
- Consumes: `getSkillDetail`, `getSkillAudit`, `SkillListItem` from `src/lib/skills-sh-client.ts` (Task 4); `installSkill` from `src/lib/skills-store.ts` (Task 3); `getSkillsDir` from `src/lib/paths.ts` (Task 2)
- Produces: `DetailScreen(props: { item: SkillListItem; skillsDir?: string; onBack: () => void; onInstalled: () => void })` — consumed by Task 14 (App shell)

- [ ] **Step 1: Write the failing test**

Create `src/tui/detail-screen.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'

import type { SkillListItem } from '../lib/skills-sh-client'
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
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
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
  })
})

afterEach(async () => {
  fetchSpy.mockRestore()
  await rm(skillsDir, { recursive: true, force: true })
})

describe('DetailScreen', () => {
  test('renders the audit summary after mount', async () => {
    const { lastFrame } = render(
      <DetailScreen item={item} skillsDir={skillsDir} onBack={() => {}} onInstalled={() => {}} />
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('Socket')
    expect(lastFrame()).toContain('pass')
  })

  test('Enter installs the skill and calls onInstalled', async () => {
    let installedCalled = false
    const { stdin } = render(
      <DetailScreen
        item={item}
        skillsDir={skillsDir}
        onBack={() => {}}
        onInstalled={() => (installedCalled = true)}
      />
    )
    await new Promise((r) => setTimeout(r, 10))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 10))
    expect(installedCalled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui/detail-screen.test.tsx`
Expected: FAIL — `Cannot find module './detail-screen'`

- [ ] **Step 3: Write `src/tui/detail-screen.tsx`**

Create `src/tui/detail-screen.tsx`:

```tsx
import { Box, Text, useInput } from 'ink'
import Spinner from 'ink-spinner'
import React, { useEffect, useState } from 'react'

import { getSkillsDir } from '../lib/paths'
import {
  getSkillAudit,
  getSkillDetail,
  type SkillAuditResponse,
  type SkillDetail as ClientSkillDetail,
  type SkillListItem
} from '../lib/skills-sh-client'
import { installSkill } from '../lib/skills-store'
import { FooterHint } from './footer-hint'

export function DetailScreen({
  item,
  skillsDir = getSkillsDir(),
  onBack,
  onInstalled
}: {
  item: SkillListItem
  skillsDir?: string
  onBack: () => void
  onInstalled: () => void
}) {
  const [detail, setDetail] = useState<ClientSkillDetail | null>(null)
  const [audit, setAudit] = useState<SkillAuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSkillDetail(item.id), getSkillAudit(item.id)]).then(([d, a]) => {
      if (cancelled) return
      setDetail(d)
      setAudit(a)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [item.id])

  useInput((_input, key) => {
    if (key.escape) {
      onBack()
      return
    }
    if (key.return && detail && !installing) {
      setInstalling(true)
      installSkill(skillsDir, detail).then(() => {
        setInstalling(false)
        onInstalled()
      })
    }
  })

  if (loading) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Loading {item.name}…</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>{item.name}</Text>
      <Text dimColor>{item.source}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text underline>Security audit</Text>
        {!audit && <Text dimColor>No audit data available for this skill.</Text>}
        {audit?.audits.map((a) => (
          <Text key={a.slug}>
            {a.provider}: {a.status}
            {a.riskLevel ? ` (${a.riskLevel})` : ''} — {a.summary}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        {installing ? (
          <Text color="cyan">
            <Spinner type="dots" /> Installing…
          </Text>
        ) : (
          <Text>Press Enter to install.</Text>
        )}
      </Box>
      <FooterHint
        hints={[
          { key: 'Enter', label: 'install' },
          { key: 'Esc', label: 'go back' }
        ]}
      />
    </Box>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tui/detail-screen.test.tsx`
Expected: `2 pass`, 0 fail.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/detail-screen.tsx src/tui/detail-screen.test.tsx
git commit -m "feat: add TUI detail/audit screen with install confirm"
```

---

## Task 14: TUI app shell (tabs + screen stack)

**Files:**
- Create: `src/tui/app.tsx`
- Test: `src/tui/app.test.tsx`

**Interfaces:**
- Consumes: `DiscoverScreen` (Task 11), `InstalledScreen` (Task 12), `DetailScreen` (Task 13), `FooterHint` (Task 10)
- Produces: `App(props: { skillsDir?: string })` — consumed by Task 15 (`skills` command's no-args branch, via `render(<App />)` from `ink`)

- [ ] **Step 1: Write the failing test**

Create `src/tui/app.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'

import { App } from './app'

let skillsDir: string
let fetchSpy: ReturnType<typeof jest.spyOn>

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'actovia-cli-app-'))
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ data: [], pagination: { page: 0, perPage: 100, total: 0, hasMore: false } }),
      { status: 200 }
    )
  )
})

afterEach(async () => {
  fetchSpy.mockRestore()
  await rm(skillsDir, { recursive: true, force: true })
})

describe('App', () => {
  test('starts on the Discover tab', async () => {
    const { lastFrame } = render(<App skillsDir={skillsDir} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('Discover')
    expect(lastFrame()).toContain('Installed')
  })

  test('Tab switches to the Installed tab', async () => {
    const { lastFrame, stdin } = render(<App skillsDir={skillsDir} />)
    await new Promise((r) => setTimeout(r, 10))
    stdin.write('\t')
    await new Promise((r) => setTimeout(r, 10))
    expect(lastFrame()).toContain('No skills installed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui/app.test.tsx`
Expected: FAIL — `Cannot find module './app'`

- [ ] **Step 3: Write `src/tui/app.tsx`**

Create `src/tui/app.tsx`:

```tsx
import { Box, Text, useApp, useInput } from 'ink'
import React, { useState } from 'react'

import { getSkillsDir } from '../lib/paths'
import type { SkillListItem } from '../lib/skills-sh-client'
import { DetailScreen } from './detail-screen'
import { DiscoverScreen } from './discover-screen'
import { InstalledScreen } from './installed-screen'

type Tab = 'discover' | 'installed'

export function App({ skillsDir = getSkillsDir() }: { skillsDir?: string }) {
  const [tab, setTab] = useState<Tab>('discover')
  const [selected, setSelected] = useState<SkillListItem | null>(null)
  const { exit } = useApp()

  useInput((_input, key) => {
    if (selected) return // detail screen owns input while open
    if (key.tab) {
      setTab((t) => (t === 'discover' ? 'installed' : 'discover'))
    } else if (key.escape) {
      exit()
    }
  })

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold={tab === 'discover'} inverse={tab === 'discover'}>
          {' Discover '}
        </Text>
        <Text bold={tab === 'installed'} inverse={tab === 'installed'}>
          {' Installed '}
        </Text>
      </Box>
      {selected ? (
        <DetailScreen
          item={selected}
          skillsDir={skillsDir}
          onBack={() => setSelected(null)}
          onInstalled={() => setSelected(null)}
        />
      ) : tab === 'discover' ? (
        <DiscoverScreen onSelect={setSelected} />
      ) : (
        <InstalledScreen skillsDir={skillsDir} />
      )}
    </Box>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tui/app.test.tsx`
Expected: `2 pass`, 0 fail.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/app.tsx src/tui/app.test.tsx
git commit -m "feat: add TUI app shell with Discover/Installed tabs"
```

---

## Task 15: Wire the TUI into `actovia skills` (no subcommand)

**Files:**
- Modify: `src/commands/skills.ts`

**Interfaces:**
- Consumes: `App` from `src/tui/app.tsx` (Task 14); `registerSkillsCommand` return value (the `skills` sub-`Command`) from Task 9
- Produces: nothing new exported — this task only adds a default action to the existing `skills` command

- [ ] **Step 1: Add the Ink entry point**

Edit `src/commands/skills.ts`. Add imports at the top:

```ts
import { render } from 'ink'
import React from 'react'

import { App } from '../tui/app'
```

Change the `registerSkillsCommand` function's `skills` command declaration to add a default action (Commander runs a parent command's own `.action()` only when none of its subcommands matched — i.e., when `actovia skills` is invoked with no further arguments):

```ts
export function registerSkillsCommand(program: Command): Command {
  const skills = program
    .command('skills')
    .description('Browse and manage skills.sh skills')
    .action(() => {
      render(<App />)
    })
```

(the rest of the function — `.command('search <query>')` etc. — is unchanged)

Since this file now contains JSX, rename it from `skills.ts` to `skills.tsx`:

```bash
git mv src/commands/skills.ts src/commands/skills.tsx
git mv src/commands/skills.test.ts src/commands/skills.test.tsx
```

Update the import in `src/cli.ts` (extensionless import, so no change needed there — `verbatimModuleSyntax`/bundler resolution finds `.tsx` automatically) — confirm with the typecheck in Step 2.

- [ ] **Step 2: Typecheck and run the full test suite**

```bash
bun run typecheck
bun test
```
Expected: typecheck passes; every test file from Tasks 2–14 still passes (this task doesn't change any tested function's behavior, only adds a new Commander action).

- [ ] **Step 3: Verify manually**

```bash
bun run index.ts skills
```
Expected: the Ink TUI renders in the terminal, showing the Discover tab with a search box; `Tab` switches to Installed; `Esc`/Ctrl+C exits.

- [ ] **Step 4: Commit**

`src/cli.ts` is unchanged by this task (Step 1 confirmed its extensionless import needs no edit) — only the renamed files are staged:

```bash
git add src/commands/skills.tsx src/commands/skills.test.tsx
git commit -m "feat: launch the Ink TUI from actovia skills with no subcommand"
```

---

## Task 16: Packaging — npm publish shape + cross-platform binaries + release workflow

**Files:**
- Create: `scripts/build-binaries.sh`
- Create: `.releaserc.json`
- Create: `.github/workflows/release.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DIST_CHANNEL` constant location (`src/lib/dist-channel.ts`, Task 6); `version` field convention already used by `updater.ts` (Task 6)
- Produces: a working `bun run build:npm`, a working `bash scripts/build-binaries.sh`, and a CI workflow that runs both and publishes on every push to `main`

- [ ] **Step 1: Point the published `bin` at the bundled output**

Edit `package.json`. `bin` currently points at `./index.ts` (needed for local `bun link`/dev); the published package instead ships the bundled, shebang-carrying `dist/index.js` produced by `bun run build:npm`. Add a `files` allowlist and switch `bin`, and add `prepublishOnly` so `npm publish` always bundles fresh:

```json
{
  "name": "@actovia-ai/cli",
  "version": "0.1.0",
  "module": "index.ts",
  "type": "module",
  "bin": {
    "actovia": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "dev": "bun run index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "build:npm": "bun build ./index.ts --outdir dist --target bun --format esm && chmod +x dist/index.js",
    "build:binaries": "bash scripts/build-binaries.sh",
    "prepublishOnly": "bun run build:npm"
  },
  "dependencies": {
    "commander": "15.0.0",
    "ink": "7.1.1",
    "react": "19.3.0",
    "ink-text-input": "6.0.0",
    "ink-spinner": "5.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "19.3.0",
    "ink-testing-library": "4.0.0",
    "typescript": "5.9.3"
  }
}
```

- [ ] **Step 2: Verify the npm bundle actually runs**

```bash
bun run build:npm
head -1 dist/index.js
```
Expected: first line is `#!/usr/bin/env bun` (the bundler hoists the entrypoint's shebang to the top of the bundle).

```bash
./dist/index.js --help
```
Expected: same Commander usage output as `bun run index.ts --help`.

```bash
npm pack --dry-run
```
Expected: file listing includes `dist/index.js` and excludes `src/`, `*.test.ts(x)` — confirms the `files` allowlist works.

- [ ] **Step 3: Write `scripts/build-binaries.sh`**

Create `scripts/build-binaries.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

DIST_CHANNEL_FILE="src/lib/dist-channel.ts"
DIST_CHANNEL_BACKUP="$(mktemp)"
cp "$DIST_CHANNEL_FILE" "$DIST_CHANNEL_BACKUP"

restore() {
  cp "$DIST_CHANNEL_BACKUP" "$DIST_CHANNEL_FILE"
  rm -f "$DIST_CHANNEL_BACKUP"
}
trap restore EXIT

cat > "$DIST_CHANNEL_FILE" <<'EOF'
export const DIST_CHANNEL: 'npm' | 'binary' = 'binary'
EOF

mkdir -p release-binaries

# name : bun --compile --target value
declare -A TARGETS=(
  [actovia-darwin-arm64]=bun-darwin-arm64
  [actovia-darwin-x64]=bun-darwin-x64
  [actovia-linux-arm64]=bun-linux-arm64
  [actovia-linux-x64]=bun-linux-x64
  [actovia-windows-x64.exe]=bun-windows-x64
)

failed=()
for name in "${!TARGETS[@]}"; do
  target="${TARGETS[$name]}"
  echo "Building $name ($target)..."
  if ! bun build --compile --target="$target" --outfile "release-binaries/$name" ./index.ts; then
    echo "FAILED: $name" >&2
    failed+=("$name")
  fi
done

echo "Built:"
ls -la release-binaries

if [ ${#failed[@]} -gt 0 ]; then
  echo "The following targets failed to build: ${failed[*]}" >&2
  exit 1
fi
```

Two things worth calling out about this script:

- **Backup via a temp-file copy, not a captured string.** An earlier draft captured the original file's content with `ORIGINAL_CONTENT="$(cat ...)"` and rewrote it with `printf '%s' "$ORIGINAL_CONTENT"` — command substitution strips trailing newlines, so every run silently dropped `dist-channel.ts`'s trailing newline, leaving a spurious one-line git diff after every build. Copying the file itself sidesteps the whole class of quoting/newline problems.
- **`set -e` removed, failures collected instead.** With `-e`, one target failing (e.g. a transient network hiccup fetching a cross-compile toolchain) would abort the loop immediately, silently skipping every target that hadn't run yet. The script now attempts all 5 unconditionally and only exits non-zero at the end if any failed — a transient failure on one target no longer costs you the other four.

The asset names here (`actovia-darwin-arm64`, `actovia-windows-x64.exe`, etc.) must match exactly what `pickReleaseAssetName()` in `src/lib/updater.ts` (Task 6) computes — both were written against the same convention; if either changes, the other must change with it.

Also add `release-binaries` to `.gitignore` (under the existing "# output" section, alongside `dist`) — these are multi-hundred-MB build artifacts that must never be committed.

- [ ] **Step 4: Verify the binary build locally (macOS targets only need no extra toolchain download; Linux/Windows targets download a cross-compile toolchain on first use and need network access)**

```bash
chmod +x scripts/build-binaries.sh
bun run build:binaries
cat src/lib/dist-channel.ts
```
Expected: `release-binaries/` contains all five files; `dist-channel.ts` is back to `DIST_CHANNEL: 'npm' | 'binary' = 'npm'` (the `trap restore EXIT` ran).

```bash
./release-binaries/actovia-darwin-arm64 --help  # or the x64 one, whichever matches this machine
```
Expected: same Commander usage output, and this binary runs with no `bun`/`node` installed at all (it's fully standalone).

- [ ] **Step 5: Add semantic-release config**

This org already uses semantic-release (see `the desktop app/.releaserc.json`) for changelog + GitHub release automation. Reuse the same plugin set, but with `npmPublish: true` this time since — unlike the Electron app — this package is meant to be installed from npm.

Create `.releaserc.json`:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/npm",
      {
        "npmPublish": true
      }
    ],
    [
      "@semantic-release/changelog",
      {
        "changelogFile": "CHANGELOG.md"
      }
    ],
    ["@semantic-release/github", { "assets": [{ "path": "release-binaries/*" }] }],
    [
      "@semantic-release/git",
      {
        "assets": ["CHANGELOG.md", "package.json"],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ]
  ]
}
```

Add the semantic-release plugins as dev dependencies:

```bash
bun add -d semantic-release @semantic-release/commit-analyzer @semantic-release/release-notes-generator @semantic-release/npm @semantic-release/changelog @semantic-release/github @semantic-release/git
```

- [ ] **Step 6: Write the release workflow**

Bun's `--compile` cross-compiles every target from one host (verified while writing this plan — `bun-darwin-arm64`/`bun-darwin-x64`/`bun-windows-x64` all compiled successfully from a single macOS host; `bun-linux-x64`/`bun-linux-arm64` only failed locally due to a sandboxed network's cert restrictions, not the target syntax — on an unrestricted CI runner all five build from one job). This means, unlike `the desktop app`'s Electron matrix build (which genuinely needs native per-OS runners), this workflow needs only one job.

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.12

      - run: bun install

      - run: bun run typecheck

      - run: bun test

      - run: bun run build:binaries

      - name: Run semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: bunx semantic-release
```

- [ ] **Step 7: Document the required repo secret**

`NPM_TOKEN` (an npm automation token with publish rights for the `@actovia-ai/cli` package) must be added to the repo's Actions secrets (`Settings → Secrets and variables → Actions` on `actovia-ai/cli`) before this workflow can publish — this is an account-level action only the repo owner can do, so it isn't part of this plan's automated steps. `GITHUB_TOKEN` is provided automatically by Actions and needs no setup.

- [ ] **Step 8: Commit**

```bash
git add package.json scripts/build-binaries.sh .releaserc.json .github/workflows/release.yml bun.lock
git commit -m "build: add npm + cross-platform binary release pipeline"
```

---

## Self-Review Notes

**Spec coverage:**
- `actovia open` → Task 5 (lib) + Task 7 (command). ✓
- `actovia update` → Task 6 (lib) + Task 8 (command). ✓
- `actovia help`/`--help` → free from Commander once `buildProgram()` exists (Task 7); no dedicated task needed, verified manually in Task 7 Step 6. ✓
- `actovia skills` interactive TUI with Discover/Installed tabs, audit-before-install → Tasks 10–15. ✓
- `actovia skills search/install/list/uninstall` scripted + `--json` → Task 9. ✓
- Lockfile compatible with `the desktop app` → Task 3, verified field-by-field against `skills-manager.ts`. ✓
- Dual npm + GitHub Releases binary distribution with `DIST_CHANNEL` → Task 16 (plus Task 6 for the constant itself and `checkForUpdate`'s branch on it). ✓
- Non-goals (ClawHub, generic multi-registry, Windows self-replace-in-place, exhaustive Linux discovery) are honored: no task builds any of them.

**Placeholder scan:** none found — every step above has real, complete code or a real shell command with a stated expected result.

**Type consistency check:**
- `InstalledSkill`/`SkillsLockfile`/`SkillFile`/`SkillDetail` are defined once in Task 3 and only ever imported (Tasks 4, 9, 13), never redefined.
- `SkillListItem`/`SkillListResponse`/`SkillSearchResponse`/`SkillAuditEntry`/`SkillAuditResponse`/`SkillsApiError` are defined once in Task 4 and only imported thereafter (Tasks 9, 11, 13).
- `OpenAppResult` defined in Task 5, imported by Task 7.
- `UpdateCheckResult`/`DIST_CHANNEL` defined in Task 6, imported by Task 8 and Task 16.
- Function names used across task boundaries match exactly: `getSkillsDir`, `installSkill`, `uninstallSkill`, `toggleSkillActive`, `listInstalledSkills`, `listSkills`, `searchSkills`, `getSkillDetail`, `getSkillAudit`, `openActoviaApp`, `checkForUpdate`, `getCurrentVersion` — each spelled identically at its definition site and every call site above.
- Release binary asset naming (`actovia-<platform>-<arch>[.exe]`) is defined once (Task 6's `pickReleaseAssetName`) and Task 16's build script comment explicitly flags the two places that must stay in sync.
