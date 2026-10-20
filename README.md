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
actovia open                       # launch the Actovia desktop app
actovia update [--check]           # update the CLI to the newest version (--check: only report)
actovia pair [--invert]            # pair a phone with this machine's Actovia (QR code in the terminal)
actovia devices [--json]           # list the paired phones
actovia devices revoke <id>        # unpair one
actovia skills                     # interactive TUI: browse, view audits, install/uninstall
actovia skills search <query> [--json]
actovia skills install <id>  [--json]   # e.g. vercel-labs/skills/find-skills
actovia skills list           [--json]
actovia skills uninstall <slug> [--json]
actovia --help
```

`actovia pair` and `actovia devices` talk to the Actovia desktop app running on
the same machine (loopback, `ACTOVIA_API_URL` overrides `http://127.0.0.1:60223`),
so a homelab Mac can pair a phone over SSH without anyone opening its screen.
Each asks for Actovia's app-lock PIN (Settings → General → Lock & Privacy) from
the terminal — never from an argument, a variable or a pipe — and trades it for
a ten-minute pass to the device routes. Ten wrong PINs and Actovia stops
accepting it here until it is typed on its own lock screen. `--invert` draws the
QR code for a light terminal background.

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
