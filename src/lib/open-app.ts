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

async function tryLinux(): Promise<OpenAppResult> {
  const check = Bun.spawn(['sh', '-c', 'command -v exodus'], {
    stdout: 'ignore',
    stderr: 'ignore'
  })
  const exitCode = await check.exited
  if (exitCode !== 0) return { status: 'not-found' }
  Bun.spawn(['exodus'], { stdout: 'ignore', stderr: 'ignore' })
  return { status: 'opened' }
}

export async function openExodusApp(
  platform: NodeJS.Platform = process.platform,
  open: OpenByName = openByName
): Promise<OpenAppResult> {
  if (platform === 'darwin') return tryDarwin(open)
  if (platform === 'win32') return tryWin32()
  if (platform === 'linux') return tryLinux()
  return { status: 'not-found' }
}
