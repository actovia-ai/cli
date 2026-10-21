# [2.4.0](https://github.com/actovia-ai/cli/compare/v2.3.1...v2.4.0) (2026-10-21)


### Bug Fixes

* **status:** a count from the app that is not a number prints as ? ([7fe7d83](https://github.com/actovia-ai/cli/commit/7fe7d83b3561d1dd3494daace8a2a19c92527e1c))


### Features

* **status:** a readable status with a spinner while the app answers ([92599cb](https://github.com/actovia-ai/cli/commit/92599cbcd8e58c81a716b67a9ff98666bf4b7e30))

## [2.3.1](https://github.com/actovia-ai/cli/compare/v2.3.0...v2.3.1) (2026-10-21)


### Bug Fixes

* **security:** the PIN goes only to the installed Actovia on this machine ([23334c4](https://github.com/actovia-ai/cli/commit/23334c4ce5500db67f539e64827641a3a496ad43))

# [2.3.0](https://github.com/actovia-ai/cli/compare/v2.2.0...v2.3.0) (2026-10-21)


### Bug Fixes

* pair and devices say an Actovia older than 2.1.0 is too old, not to retype the PIN ([6d7d288](https://github.com/actovia-ai/cli/commit/6d7d288ef47d39b9202953a4784ecc0f571946fd))
* status, doctor, backup, tasks, quota and usage print what the app reports as text ([c4c2760](https://github.com/actovia-ai/cli/commit/c4c276077e05e32a8e760baf908cba2524caf379))
* the CLI reaches the desktop app on a machine with an HTTP proxy ([05dfb5c](https://github.com/actovia-ai/cli/commit/05dfb5c5b47f4892ffb83e9bd48ec52e1c685e12))


### Features

* status, doctor, app check/update/open/quit/restart, lock, logs, backup, tasks, quota, usage ([d18c46e](https://github.com/actovia-ai/cli/commit/d18c46eae14511c9dd70274f64fa88e8ef8380f9))


### Reverts

* the CLI does not work around an HTTP proxy ([03dacd3](https://github.com/actovia-ai/cli/commit/03dacd3c3dd24b8624628504827a5001c3df0dd9))

# [2.2.0](https://github.com/actovia-ai/cli/compare/v2.1.1...v2.2.0) (2026-10-21)


### Bug Fixes

* actovia update refuses a release without checksums instead of installing it unchecked ([4d89695](https://github.com/actovia-ai/cli/commit/4d89695d9eb202ce71845a610479b2051f1e1219))


### Features

* actovia devices lists the phones revoked here that have not been told yet ([41c29f3](https://github.com/actovia-ai/cli/commit/41c29f38472dd7d4264c396623d72f5bfbedd646))
* actovia update installs the new version itself; an Actovia too old for pair says so ([def9d28](https://github.com/actovia-ai/cli/commit/def9d28d355d99dac28998944e11ace547f4c24c))

## [2.1.1](https://github.com/actovia-ai/cli/compare/v2.1.0...v2.1.1) (2026-10-20)


### Bug Fixes

* actovia pair closes its pairing window however it ends, and a device's name cannot drive the terminal ([e2a7cd9](https://github.com/actovia-ai/cli/commit/e2a7cd96d663496ae38aefe831e46bc46ae0a8fa))

# [2.1.0](https://github.com/actovia-ai/cli/compare/v2.0.0...v2.1.0) (2026-10-20)


### Features

* actovia pair and actovia devices — pair a phone with this machine's Actovia from a shell ([e25c747](https://github.com/actovia-ai/cli/commit/e25c747542c7f729c59661d5935336d83cb790f8))

# [2.0.0](https://github.com/actovia-ai/cli/compare/v1.2.0...v2.0.0) (2026-10-19)


* feat!: the CLI is actovia-cli with the command actovia; it launches Actovia (or an install still named Exodus) and updates from actovia-ai/cli ([9d5cd42](https://github.com/actovia-ai/cli/commit/9d5cd426945785747ced9797c1a1cb6528509594))


### Bug Fixes

* **open:** on Linux launch actovia, Actovia or (an older install) exodus, in that order ([c545ea3](https://github.com/actovia-ai/cli/commit/c545ea39a1b73bef79951c034b0c32fd916eae5c))


### Features

* publish as the scoped package @actovia-ai/cli (command stays actovia); updater looks up the scoped name ([3c26ba0](https://github.com/actovia-ai/cli/commit/3c26ba0564a293250afa1e8ecf99a60f4407e7d3))


### BREAKING CHANGES

* the npm package is now actovia-cli and the command is actovia (no exodus alias); release assets are actovia-<platform>-<arch>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

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
