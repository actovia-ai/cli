import { join } from 'node:path'

export type OpenAppResult = { status: 'opened' } | { status: 'not-found' }

type OpenByName = (appName: string) => Promise<boolean>

const openByName: OpenByName = async (appName) => {
  const proc = Bun.spawn(['open', '-a', appName], { stdout: 'ignore', stderr: 'ignore' })
  return (await proc.exited) === 0
}

// An install updated from before the rebrand may still sit at Exodus.app.
const DARWIN_APP_NAMES = ['Actovia', 'Exodus']

async function tryDarwin(open: OpenByName): Promise<OpenAppResult> {
  for (const name of DARWIN_APP_NAMES) {
    if (await open(name)) return { status: 'opened' }
  }
  return { status: 'not-found' }
}

async function tryWin32(): Promise<OpenAppResult> {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Exodus', 'Exodus.exe'),
    join(process.env.ProgramFiles ?? '', 'Exodus', 'Exodus.exe')
  ]
  for (const exePath of candidates) {
    if (await Bun.file(exePath).exists()) {
      Bun.spawn([exePath], { stdout: 'ignore', stderr: 'ignore' })
      return { status: 'opened' }
    }
  }
  return { status: 'not-found' }
}

type FindCommand = (name: string) => Promise<boolean>
type SpawnCommand = (name: string) => void

const findOnPath: FindCommand = async (name) => {
  const check = Bun.spawn(['sh', '-c', `command -v "$1"`, 'sh', name], {
    stdout: 'ignore',
    stderr: 'ignore'
  })
  return (await check.exited) === 0
}

const spawnDetached: SpawnCommand = (name) => {
  Bun.spawn([name], { stdout: 'ignore', stderr: 'ignore' })
}

// The deb/rpm launcher is Actovia; an older install still has `exodus`.
const LINUX_LAUNCHERS = ['actovia', 'Actovia', 'exodus']

async function tryLinux(find: FindCommand, spawn: SpawnCommand): Promise<OpenAppResult> {
  for (const name of LINUX_LAUNCHERS) {
    if (await find(name)) {
      spawn(name)
      return { status: 'opened' }
    }
  }
  return { status: 'not-found' }
}

export async function openExodusApp(
  platform: NodeJS.Platform = process.platform,
  open: OpenByName = openByName,
  find: FindCommand = findOnPath,
  spawn: SpawnCommand = spawnDetached
): Promise<OpenAppResult> {
  if (platform === 'darwin') return tryDarwin(open)
  if (platform === 'win32') return tryWin32()
  if (platform === 'linux') return tryLinux(find, spawn)
  return { status: 'not-found' }
}
