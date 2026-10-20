import type { Command } from 'commander'

import { updateBinary, updatePackage } from '../lib/self-update'
import { checkForUpdate, DIST_CHANNEL, type UpdateCheckResult } from '../lib/updater'
import { reportError } from './report-error'

export interface UpdateDeps {
  installPackage?: (version: string) => Promise<boolean>
  installBinary?: () => Promise<boolean>
}

/**
 * Checks, and — unless `--check` — installs the newer version the way this
 * one was installed (`self-update.ts`).
 */
export async function runUpdate(
  opts: { check?: boolean } = {},
  deps: UpdateDeps = {}
): Promise<UpdateCheckResult | null> {
  try {
    const result = await checkForUpdate()

    if (!result.updateAvailable) {
      console.log(`Actovia CLI is up to date (${result.current}).`)
      return result
    }

    console.log(`Update available: ${result.current} → ${result.latest}`)

    if (opts.check) return result

    const installed =
      DIST_CHANNEL === 'npm'
        ? await (deps.installPackage ?? (v => updatePackage(v)))(result.latest)
        : await (deps.installBinary ?? (() => updateBinary()))()
    if (installed) {
      console.log(`Updated to ${result.latest}.`)
    } else {
      process.exitCode = 1
    }
    return result
  } catch (err) {
    reportError(err)
    return null
  }
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update the Actovia CLI to the newest version')
    .option('--check', 'only report whether an update is available, install nothing')
    .action(async (opts: { check?: boolean }) => {
      await runUpdate(opts)
    })
}
