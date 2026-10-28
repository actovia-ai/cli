import type { Command } from 'commander'

import { openActoviaApp, type OpenAppResult } from '../lib/open-app'
import { colorEnabled } from '../lib/style'
import { makeUi, uiFor } from '../lib/ui'

export interface OpenDeps {
  print?: (text: string) => void
  printError?: (text: string) => void
  color?: boolean
}

export async function runOpen(deps: OpenDeps = {}): Promise<OpenAppResult> {
  const print = deps.print ?? ((text: string) => console.log(text))
  const printError = deps.printError ?? ((text: string) => console.error(text))
  const result = await openActoviaApp()
  if (result.status === 'opened') {
    print(uiFor(deps).done('Opened Actovia.'))
  } else {
    const ui = deps.printError ? uiFor({ print: printError, color: deps.color }) : makeUi(colorEnabled(process.stderr))
    printError(ui.fail("Actovia isn't installed."))
    printError(ui.next('https://actovia.yancey.app'))
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
