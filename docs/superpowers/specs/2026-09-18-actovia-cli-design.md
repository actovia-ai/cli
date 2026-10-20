# @actovia-ai/cli — Design

Date: 2026-09-18
Status: Approved (design), pending implementation plan

## Summary

A standalone Bun-built CLI (`actovia`) for the actovia ecosystem, covering five
v1 commands: launching the desktop app, checking/applying CLI self-updates,
help, and browsing/installing Agent Skills from **skills.sh** (via the
`skills.sh-bff` OIDC relay built earlier). The skills browser is an
interactive TUI modeled on Claude Code's own plugin-discovery screen
(tabbed header, arrow-key list, live search, footer hint bar), built with
Ink; everything else is a plain Commander.js command. Skills install into
`~/.actovia/skills/<slug>/` + `.lock.json`, the same layout
`the desktop app`'s existing (ClawHub-based) Skills Market already uses —
so a skill installed via the CLI is immediately usable by the desktop app,
and no migration is needed when `the desktop app` itself switches off
ClawHub to skills.sh later.

This CLI is explicitly the pathfinder for that switch: `the desktop app` is
mid-way through an i18n effort and will move its Skills Market from ClawHub
to skills.sh once that's done. Building the skills.sh integration here first
surfaces integration issues (API shape, install mechanics, audit data) ahead
of that migration.

## Goals

- `actovia open` — launch the installed Actovia desktop app, macOS/Windows/Linux.
- `actovia update` — check whether a newer CLI version is available and tell
  the user how to get it (channel-appropriate: the `npm install` command on
  the npm channel, the release URL on the binary channel). **v1 only
  checks — it does not apply the update itself.** (Descoped during
  implementation, ratified here: an unattended `npm install -g` or an
  atomic binary self-replace is real, separately-scoped work with its own
  failure modes — bricking a user's install on a bad replace is worse than
  asking them to run one command. `pickReleaseAssetName()` in `updater.ts`
  already computes the right asset name per platform for whenever this is
  built; `applyUpdate()` is not implemented in v1.)
- `actovia help` / `--help` — standard Commander help output.
- `actovia skills` — interactive TUI: browse/search skills.sh, view a skill's
  README + security audit, install/uninstall/toggle.
- `actovia skills <search|install|list|uninstall>` — non-interactive
  equivalents for scripting/CI, with `--json` output.
- Skills installed via the CLI are byte-for-byte compatible with what
  `the desktop app`'s `skills-manager.ts` reads today (same directory, same
  lockfile shape), so the two are interchangeable with zero migration.
- Ship on both npm (`npm i -g @actovia-ai/cli` / `bunx @actovia-ai/cli`) and as
  compiled per-platform binaries on GitHub Releases
  (`actovia-ai/cli`), each with a working `actovia update`.

## Non-goals (v1)

- ClawHub support — dropped org-wide for quality reasons; not reintroduced
  here even as a fallback.
- A generic multi-registry abstraction — only skills.sh exists today; the
  client layer is isolated behind one module (see Architecture) so adding a
  second source later is a small, contained change, but nothing generic is
  built in advance (YAGNI).
- Windows/Linux packaging beyond raw binaries (no Homebrew tap, no MSI, no
  apt repo) — plain GitHub Release assets only.
- Exhaustive Linux "open the app" discovery (AppImage paths, per-distro
  desktop entries) — v1 tries `actovia` on `PATH`, otherwise prints the
  download link. Broader Linux support is a follow-up once it matters.
- Skill authoring/publishing workflows — this CLI only *consumes* skills.sh,
  it doesn't help anyone publish to it.
- Telemetry/analytics.
- `actovia update` applying the update itself (unattended `npm install -g`,
  or atomic binary self-replace) — see Goals. v1 checks and tells the user
  what to run; it doesn't run it for them.

## Decisions (and rejected alternatives)

- **Commander.js for the command shell, Ink only for the interactive skills
  browser.** Rejected: all-Ink (forces one-shot commands like `open` and
  `update --check` through a React render tree; assumes a TTY, which breaks
  `--json` scripting output) and all-Commander (can't produce the live
  arrow-key/search TUI the screenshot calls for). The split means scripts/CI
  never pay Ink's startup cost, and each command is independently testable.
- **Bin name is `actovia`, not `@actovia-ai/cli`.** The package is published as
  `@actovia-ai/cli` (matches the repo name and avoids npm namespace collision
  risk on the short name), but `package.json#bin` maps the *command* to
  `actovia` so usage reads `actovia open` / `actovia skills`, not
  `@actovia-ai/cli open`.
- **Dual distribution, detected via a build-time constant.** `DIST_CHANNEL`
  (`"npm" | "binary"`) is injected at build time (`bun build --define`) so
  `actovia update` knows whether to `npm install -g @actovia-ai/cli@latest` or
  download+replace a GitHub Release binary. A CLI run via `bunx` is
  ephemeral (always re-fetches latest on each invocation) — `actovia update`
  detects this case (no persistent global install path) and reports
  "already up to date via bunx" instead of attempting a self-install.
- **Lockfile format is reused as-is, not redesigned.** `SkillsLockfile` /
  `InstalledSkill` (displayName, version, isActive, installPath,
  installedAt) stays exactly as `the desktop app` defines it. One optional
  field is added: `source?: string` (set to `"skills.sh"`), purely
  informational — TypeScript/JSON both treat unknown-but-present fields as
  inert, so this is safe in both directions without touching
  `the desktop app`'s types.
- **skills.sh has no semver per skill — map `hash` into the `version`
  field.** ClawHub skills had real versions; skills.sh's skill-detail
  response instead carries a content `hash`. The lockfile's `version` field
  stores that hash (truncated to 12 chars for display) since there's no
  other version concept to record.
- **Install is a direct file write, no zip.** skills.sh's
  `/api/v1/skills/{source}/{skill}` response inlines `files: [{path,
  contents}]` — simpler than ClawHub's download-zip-then-extract flow.
  `installSkill()` writes each file under `~/.actovia/skills/<slug>/`
  directly.
- **Audit is surfaced before install, not after.** skills.sh's
  `/api/v1/skills/audit/:source/:skill` (Gen Agent Trust Hub, Socket, Snyk,
  Runlayer, ZeroLeaks) is fetched and shown in the TUI's detail view before
  the user confirms install — a direct response to "ClawHub's review
  quality was the reason we dropped it."
- **TUI tabs are trimmed from the screenshot, not copied 1:1.** Claude
  Code's plugin browser has Plugins/Discover/Installed/Marketplaces/Errors
  because it deals with multiple plugin marketplaces. skills.sh is a single
  source, so v1 ships two tabs — **Discover** (search + browse) and
  **Installed** — with the same interaction model (arrow-key list, footer
  hint bar, Enter for detail, Esc to go back).

## Architecture

```
                     ┌─────────────────────────┐
   actovia (bin) ───▶ │   Commander program      │
                     │   (src/cli.ts)            │
                     └──────────┬────────────────┘
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                     ▼
     open / update /    skills <search|install|   skills   (no args)
     help  (plain        list|uninstall> --json   ─────────────────▶ Ink app
     actions)            (plain actions)                    (src/tui/*)
              │                  │                            │
              └──────────────────┴─────────────┬──────────────┘
                                                 ▼
                                   ┌─────────────────────────────┐
                                   │  core lib (UI-agnostic)      │
                                   │  src/lib/skills-sh-client.ts │
                                   │  src/lib/skills-store.ts     │
                                   │  src/lib/paths.ts            │
                                   │  src/lib/updater.ts          │
                                   │  src/lib/open-app.ts          │
                                   └──────────────┬────────────────┘
                                                   ▼
                        skills.sh-bff (https://skills-md.yancey.app)
                        ~/.actovia/skills/<slug>/ + ~/.actovia/skills/.lock.json
                        npm registry / GitHub Releases API
```

### 1. Core lib (`src/lib/`) — no Commander or Ink imports allowed here

- **`paths.ts`** — `getActoviaHome()` = `join(homedir(), '.actovia')`,
  `getSkillsDir()` = `.../skills`. Plain `os`/`path`, no Electron
  dependency (unlike `the desktop app`'s version, which imports `app` from
  `electron` — this CLI can't do that, and doesn't need to).
- **`skills-sh-client.ts`** — thin fetch wrapper around
  `ACTOVIA_SKILLS_BFF_URL` (env var, default
  `https://skills-md.yancey.app`): `listSkills({view, page, perPage})`,
  `searchSkills(q)`, `getSkillDetail(source, skill)`, `getSkillAudit(source,
  skill)`. Non-2xx responses throw a typed `SkillsApiError(status,
  message)` built from the API's `{error, message}` body.
- **`skills-store.ts`** — direct TS port of `the desktop app`'s
  `skills-manager.ts` install/uninstall/toggle/list functions, adapted for
  skills.sh's inline `files[]` payload instead of a ZIP. Writes files
  first, lockfile last (same crash-safety property as the original).
- **`updater.ts`** — `getCurrentVersion()`, `getLatestNpmVersion()` (fetch
  `https://registry.npmjs.org/@actovia-ai/cli/latest`), `getLatestRelease()`
  (GitHub Releases API), `pickReleaseAssetName()` (platform/arch → the
  binary-release asset name, ready for whenever self-apply is built).
  No `applyUpdate()` in v1 — see Goals.
- **`open-app.ts`** — `openActoviaApp()`, one function per platform branch
  (`process.platform`), returns a typed result (`opened | not-found`) rather
  than throwing, so callers can print a consistent "not installed, download
  it here: <ACTOVIA_WEBSITE>" message.

### 2. Command shell (`src/cli.ts`, `src/commands/*.ts`)

Commander program named `actovia`. Each file in `src/commands/` registers one
subcommand and calls only into `src/lib/*` — no direct `fetch`/`fs` calls in
command files, so behavior stays identical between the TUI and the scripted
path.

- `open.ts` → `open-app.ts`
- `update.ts` → `updater.ts`, with `--check` (report only — the only mode
  in v1, since there's no self-apply to skip a confirmation for)
- `skills.ts` → registers `skills` (no subcommand → launches the Ink app),
  plus `skills search/install/list/uninstall` as plain actions with a
  `--json` flag on every read command

### 3. TUI (`src/tui/`)

Ink components, entered only from `skills.ts` when invoked with no
subcommand. Two screens (`Discover`, `Installed`) sharing one footer-hint
component and one list-navigation hook (`useListNav` — arrow keys, Enter,
Esc), mirroring the screenshot's interaction model. The detail/audit view is
a third screen pushed on top (Enter from either list), showing the skill's
`SKILL.md` excerpt and the audit table before the install confirmation.

## Data flow

1. **Discover tab**: on mount, `listSkills({view: 'all-time'})` via
   `skills-sh-client`; typing in the search box debounces into
   `searchSkills(q)`, same as `the desktop app`'s existing debounce
   pattern.
2. **Enter on a row** → `getSkillDetail()` + `getSkillAudit()` in parallel →
   detail screen.
3. **Install confirm** → `skills-store.installSkill(detail)` writes
   `files[]` to `~/.actovia/skills/<slug>/`, then updates `.lock.json` →
   both tabs' local state refresh (Installed tab re-reads the lockfile).
4. **Installed tab**: reads `skills-store.listInstalledSkills()` directly
   (no network) — toggle/uninstall are local lockfile + filesystem
   operations only.
5. **Non-interactive commands** call the exact same `skills-sh-client` /
   `skills-store` functions and print/format the result instead of
   rendering Ink — same data flow, different presentation layer.

## Error handling

- **Network/API errors** (BFF unreachable, skills.sh non-2xx passed
  through): TUI shows a red inline error with a retry hint, matching the
  existing app's "Failed to load skills… Retry" pattern; scripted commands
  print `{"error": "...", "message": "..."}` to stdout on `--json`, or a
  plain one-line message otherwise, and exit non-zero.
- **Filesystem errors during install** (permissions, disk full): caught
  per-skill, lockfile is never written for a partially-extracted skill —
  same ordering guarantee as `the desktop app`'s implementation.
- **`actovia update`**: v1 only checks (see Goals) — it prints the newer
  version and the channel-appropriate next step (the `npm install` command,
  or the release URL) and exits. No download, no self-replace, so there's
  no half-replaced-binary failure mode to guard against in v1.
- **`actovia open` when the app isn't installed**: never throws to the user
  as a stack trace — always resolves to a one-line "Actovia isn't installed.
  Download it: https://actovia.yancey.app" message.

## Testing

- `bun test` unit tests for `skills-sh-client` (mocked `fetch`) and
  `skills-store` (real filesystem ops against a `fs.mkdtemp` temp dir, not
  `~/.actovia`).
- `ink-testing-library` smoke tests for `useListNav` (up/down/enter/esc) and
  the Discover/Installed screens' basic render + key handling — not
  exhaustive snapshot coverage.
- Manual verification before considering any command done: run `actovia
  open`, `actovia skills`, `actovia update --check` for real, per this
  project's standing rule to verify features by using them, not just by
  type-checking.

## Rollout / future

- Once `the desktop app` finishes its i18n work and switches its own
  Skills Market from ClawHub to skills.sh, it can reuse this CLI's
  `skills-sh-client.ts`/`skills-store.ts` logic near-verbatim (same
  lockfile shape, same API) — that migration is out of scope here but this
  design is explicitly shaped to make it a copy, not a rewrite.
- A second skills registry (if one is ever needed again) slots in behind
  `skills-sh-client.ts`'s existing call boundary without touching
  `skills-store.ts` or either UI layer.
- Homebrew tap / other packaging formats are a v2 concern if the compiled
  binary distribution proves popular.
- `applyUpdate()` (self-apply for `actovia update`) is a natural v1.1: the
  npm side is a confirmed `npm install -g @actovia-ai/cli@latest` spawn, the
  binary side is `pickReleaseAssetName()` (already built and tested) plus
  a download-to-temp-then-atomic-rename-over-`process.execPath` step,
  documented in enough detail in earlier drafts of this spec to implement
  directly when it's prioritized.
