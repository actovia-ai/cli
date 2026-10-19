import type { Command } from 'commander'

import { checkForUpdate, DIST_CHANNEL, type UpdateCheckResult } from '../lib/updater'
import { reportError } from './report-error'

export async function runUpdate(opts: { check?: boolean } = {}): Promise<UpdateCheckResult | null> {
  try {
    const result = await checkForUpdate()

    if (!result.updateAvailable) {
      console.log(`actovia-cli is up to date (${result.current}).`)
      return result
    }

    console.log(`Update available: ${result.current} → ${result.latest}`)

    if (opts.check) return result

    if (DIST_CHANNEL === 'npm') {
      console.log('Run: npm install -g actovia-cli@latest')
    } else {
      console.log(
        'Automatic binary self-update isn\'t wired up in this build yet — download the latest release from https://github.com/actovia-ai/cli/releases/latest'
      )
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
    .description('Check for a newer actovia-cli version')
    .option('--check', 'only report whether an update is available, take no further action')
    .action(async (opts: { check?: boolean }) => {
      await runUpdate(opts)
    })
}
