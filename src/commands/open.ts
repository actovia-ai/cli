import type { Command } from 'commander'

import { openExodusApp, type OpenAppResult } from '../lib/open-app'

export async function runOpen(): Promise<OpenAppResult> {
  const result = await openExodusApp()
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
