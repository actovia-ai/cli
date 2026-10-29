# Actovia CLI

A CLI for the Actovia ecosystem: launch the Actovia desktop app, check for CLI
updates, and browse/install [Agent Skills](https://skills.sh) from the
terminal — either interactively or as scriptable JSON-emitting commands.

## Install

**Requires [Bun](https://bun.sh) `>=1.3.0`** on `PATH` — this CLI is built on
Bun and its compiled bundle runs under the Bun runtime, not plain Node.js.

```bash
npm install -g @actovia-ai/cli
# or, without installing:
bunx @actovia-ai/cli --help
```

Prefer not to install Bun? Download a standalone binary for your platform
from the [latest GitHub release](https://github.com/actovia-ai/cli/releases/latest)
instead — no Bun or Node required.

## Commands

```bash
actovia status [--json]            # the desktop app at a glance: version, lock, phones, keys, updates
actovia doctor [--json]            # what is wrong, and how to fix it
actovia open                       # launch the Actovia desktop app
actovia app check [--json]         # is a newer desktop app out?
actovia app update                 # install it (macOS: checked download, quit, swap, reopen;
                                   #   after the first, only the blocks that changed — see below)
actovia app quit | restart         # quit or restart the desktop app
actovia update [--check]           # update the CLI to the newest version (--check: only report)
actovia pair [--invert]            # pair a phone with this machine's Actovia (QR code in the terminal)
actovia devices [--json]           # list the paired phones
actovia devices revoke <id>        # unpair one
actovia lock                       # lock the desktop app now
actovia logs [-f] [-n 50] [--level warn] [--scope kernel] [--trace <id>] [-q words] [--date YYYY-MM-DD] [--json]
actovia backup [--json]            # list database backups
actovia backup create [--json]     # back up now
actovia tasks [--json]             # Philharmonic's scheduled tasks
actovia quota [--json]             # what Claude Code and Codex last reported of your plan quota
actovia usage [--days 30] [--json] # tokens the models have used
actovia skills                     # interactive TUI: browse, view audits, install/uninstall
actovia skills search <query> [--json]
actovia skills install <id>  [--json]   # e.g. vercel-labs/skills/find-skills
actovia skills list           [--json]
actovia skills uninstall <slug> [--json]
actovia --help
```

Everything but `skills` and `update` talks to the Actovia desktop app running on
the same machine (loopback, `ACTOVIA_API_URL` overrides `http://127.0.0.1:60223`),
so a homelab Mac can pair a phone over SSH without anyone opening its screen.
`pair`, `devices`, `lock` and `app quit|restart|update` ask for Actovia's
app-lock PIN (Settings → General → Lock & Privacy) from the terminal — never from an argument, a variable or a pipe — and trade it for
a ten-minute pass to the device and host routes; the reads (`logs`, `backup`,
`tasks`, `quota`, `usage`) ask for it only while the app is locked, and a correct
PIN unlocks it. `status` and `doctor` never ask. Most of this needs Actovia 2.2.0
or later. Ten wrong PINs and Actovia stops
accepting it here until it is typed on its own lock screen. `--invert` draws the
QR code for a light terminal background.

`app update` on macOS keeps the installed version's zip in
`~/Library/Caches/actovia-cli/desktop/` (about 190 MB, one version at a time).
The next update compares the two versions' published blockmaps and downloads
only the blocks of the new zip that changed (about a quarter of it), the way
the app updates itself; the rebuilt zip is checked against the release's
`SHA256SUMS` like a whole one. With nothing kept — the first update after
installing by hand — or if any of that fails, it downloads the whole zip.
The app's own updater cache (`~/Library/Caches/actovia-updater/update.zip`)
serves too, when the app last updated itself.

When Actovia is running, the app-lock PIN is asked before anything is
downloaded (three tries), and a zip that passed its checksum is kept at once,
so a run that could not swap the app does not download it again. If the
running app has already downloaded that version itself (Settings → About says
"Update ready to install"), `app update` asks it to install its own and waits
for it to come back, instead of downloading a second copy. An Actovia too old
to be asked (before 2.6.0) still lends its download: the zip its updater left
in `~/Library/Caches/actovia-updater/pending/` (or `update.zip` beside it) is used when it matches the
release's `SHA256SUMS`, and it is signature-checked like any other.

Skills install into `~/.actovia/skills/<slug>/`, the same directory
the Actovia desktop app reads — a skill installed via
this CLI is immediately usable there too.

## Development

```bash
bun install
bun run index.ts --help   # run from source
bun test                  # run the test suite
bun run typecheck
```

See `docs/superpowers/specs/2026-09-18-actovia-cli-design.md` and
`docs/superpowers/plans/2026-09-18-actovia-cli-implementation.md` for the
full design and implementation history.

## Release

Pushing to `main` triggers `.github/workflows/release.yml`, which runs
`semantic-release`: it determines the next version from conventional
commits, publishes to npm, compiles cross-platform binaries (`bun build
--compile`), and attaches them to a GitHub Release.
