# [1.2.0](https://github.com/exodus-ai-org/cli/compare/v1.1.0...v1.2.0) (2026-09-19)


### Features

* **update:** check for a new version on every launch ([ca61aa8](https://github.com/exodus-ai-org/cli/commit/ca61aa8085321892eca2bf21fd96f030483321ad))

# [1.1.0](https://github.com/exodus-ai-org/cli/compare/v1.0.2...v1.1.0) (2026-09-18)


### Features

* **tui:** redesign the skills browser with panels, windowed lists and full-screen mode ([2072c30](https://github.com/exodus-ai-org/cli/commit/2072c308da72bac116a68b73b6989b5a6aa4724d))

## [1.0.2](https://github.com/exodus-ai-org/cli/compare/v1.0.1...v1.0.2) (2026-09-18)


### Bug Fixes

* drop the leading ./ from the bin field's path ([d595033](https://github.com/exodus-ai-org/cli/commit/d59503305cc7aeabd08c85c62c01f6cc42c847e2))

## [1.0.1](https://github.com/exodus-ai-org/cli/compare/v1.0.0...v1.0.1) (2026-09-18)


### Bug Fixes

* stop hardcoding the expected version in getCurrentVersion's test ([0ccc2d6](https://github.com/exodus-ai-org/cli/commit/0ccc2d66748a90b6335ad0fae2c72cc9fecc07f2))

# 1.0.0 (2026-09-18)


### Bug Fixes

* address final review findings (release version ordering, error handling, stale-dir reinstall, npm docs) ([7df082f](https://github.com/exodus-ai-org/cli/commit/7df082fb5f7d38e6c1d8fc5a5cbc1f976b1e5353))
* reject path traversal in skills-store installSkill ([2a1f6b0](https://github.com/exodus-ai-org/cli/commit/2a1f6b0b0347f957dd3008bea126c4866c2865a3))
* reset process.exitCode to 0, not undefined, in error-path tests ([9b3e644](https://github.com/exodus-ai-org/cli/commit/9b3e644480f09ee408952ef8853d808647473ecf))
* surface fetch errors in DetailScreen instead of hanging ([e320816](https://github.com/exodus-ai-org/cli/commit/e3208163c50249951129859c7d5f9c8d622f54ec))
* wire toggle/uninstall into InstalledScreen ([b9ff449](https://github.com/exodus-ai-org/cli/commit/b9ff4494bac64246057885c773f0ba38e9db8bff))


### Features

* add cross-platform Exodus app launcher ([6e48f45](https://github.com/exodus-ai-org/cli/commit/6e48f455d1c34db771bd3ed2de6bc1f09f9ecdb4))
* add exodus home/skills dir path helpers ([dd0f8cd](https://github.com/exodus-ai-org/cli/commit/dd0f8cdd374abf3be1b3f9555c981db8fb998d04))
* add exodus open command and Commander shell ([fff1d25](https://github.com/exodus-ai-org/cli/commit/fff1d250d728aa4eca03d1fee12efe5a1c59ff92))
* add exodus update command ([81dcf20](https://github.com/exodus-ai-org/cli/commit/81dcf204702be58be3dece736e14abf4749187c8))
* add local skills store (install/uninstall/toggle/list) ([2523e9e](https://github.com/exodus-ai-org/cli/commit/2523e9e775310bdbe75afbceaf0fb386ddfe2865))
* add non-interactive exodus skills subcommands ([fe7c1be](https://github.com/exodus-ai-org/cli/commit/fe7c1be7d2dcb1a891333e0bfa7544f1aa5a9602))
* add skills.sh-bff client ([54df586](https://github.com/exodus-ai-org/cli/commit/54df586df36d4166e53561754dd3222d95e94201))
* add TUI app shell with Discover/Installed tabs ([43749b7](https://github.com/exodus-ai-org/cli/commit/43749b7de555b311c8ed767f0e64e912948eb709))
* add TUI detail/audit screen with install confirm ([ace0199](https://github.com/exodus-ai-org/cli/commit/ace0199a558b8250f06fd79663355792e78ca831))
* add TUI Discover screen ([fe8bcb3](https://github.com/exodus-ai-org/cli/commit/fe8bcb37ff069d91735cc135f415c8e412708b75))
* add TUI Installed screen ([a3f9648](https://github.com/exodus-ai-org/cli/commit/a3f9648f9f33e98b55761bb562488051d5d4164b))
* add TUI list navigation hook and footer hint bar ([002b8df](https://github.com/exodus-ai-org/cli/commit/002b8df5bf69e2930048fab75fefbe9744846dc0))
* add version check (npm registry + GitHub releases) ([cade26b](https://github.com/exodus-ai-org/cli/commit/cade26bcc8d9aca451d8864830840d4fc72fe5c6))
* initial repo ([d8d9f55](https://github.com/exodus-ai-org/cli/commit/d8d9f55efcbb56ae83afd46c32ca6f63510bf69d))
* launch the Ink TUI from exodus skills with no subcommand ([38e7049](https://github.com/exodus-ai-org/cli/commit/38e704918cd2532d3c5c2d7f6de4a01f4bb016e5))
