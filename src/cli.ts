import { Command } from 'commander'

import { version } from '../package.json'
import { registerDeviceCommands } from './commands/devices'
import { registerOpenCommand } from './commands/open'
import { registerSkillsCommand } from './commands/skills'
import { registerUpdateCommand } from './commands/update'
import {
  prepareUpdateNotice,
  refreshUpdateCache,
  UPDATE_CHECK_ARG
} from './lib/update-notifier'

/** Hard stop for the detached refresh so a hung connection can't orphan it. */
export const REFRESH_TIMEOUT_MS = 10_000

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('actovia')
    .description('Actovia CLI — launch Actovia, pair phones, manage skills, and self-update')
    .version(version)

  registerOpenCommand(program)
  registerUpdateCommand(program)
  registerSkillsCommand(program)
  registerDeviceCommands(program)

  return program
}

export function wantsUpdateNotice(argv: string[]): boolean {
  if (argv.includes(UPDATE_CHECK_ARG)) return false
  // `actovia update` reports the versions itself; a second line would just echo it.
  return argv[2] !== 'update'
}

export interface CliRuntime {
  parse: (argv: string[]) => Promise<unknown>
  prepareNotice: () => Promise<string | null>
  refreshCache: () => Promise<void>
  writeNotice: (message: string) => void
  exit: () => void
  timeoutMs: number
}

export async function runCli(
  argv: string[] = process.argv,
  runtime: Partial<CliRuntime> = {}
): Promise<void> {
  const {
    parse = (a: string[]) => buildProgram().parseAsync(a),
    prepareNotice = prepareUpdateNotice,
    refreshCache = refreshUpdateCache,
    writeNotice = (message: string) => console.error(message),
    exit = () => process.exit(0),
    timeoutMs = REFRESH_TIMEOUT_MS
  } = runtime

  if (argv.includes(UPDATE_CHECK_ARG)) {
    const deadline = new Promise<void>(resolve => {
      setTimeout(resolve, timeoutMs).unref()
    })
    await Promise.race([refreshCache(), deadline.then(exit)])
    return
  }

  // Started before the command so the detached refresh gets a head start, and
  // awaited after it so the notice lands below the command's own output.
  const pending = wantsUpdateNotice(argv)
    ? prepareNotice().catch(() => null)
    : Promise.resolve(null)

  try {
    await parse(argv)
  } finally {
    const message = await pending
    if (message) writeNotice(message)
  }
}
