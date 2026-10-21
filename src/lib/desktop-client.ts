import { assertListenerIsActovia } from './listener'

/**
 * The Actovia desktop app running on this machine, reached on its loopback
 * port. Its device routes need a person's say-so: `requestCliPass` trades the
 * app-lock PIN for a ten-minute pass that opens them (and nothing else), sent
 * in the presence header.
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:60223'
export const PRESENCE_HEADER = 'x-actovia-presence'

export function resolveApiUrl(explicit?: string): string {
  return explicit ?? process.env.ACTOVIA_API_URL ?? DEFAULT_API_URL
}

export interface CliPass {
  token: string
  expiresAt: number
}

export interface PairedDevice {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
}

export interface PairingWindow {
  expiresAt: number
  /** `actovia://pair?…`, what the phone scans. */
  link: string
}

/** Revoked on the computer; the device has not come back to learn it yet. */
export interface RevokedDevice {
  name: string | null
  revokedAt: string
}

export interface DevicesState {
  devices: PairedDevice[]
  pairing: PairingWindow | null
  lanRunning: boolean
  /** Absent from an Actovia older than the list. */
  revoked?: RevokedDevice[]
}

/** `GET /api/v1/host/status` (Actovia 2.2.0+): answered while locked too. */
export interface HostStatus {
  version: string
  platform: string
  arch: string
  startedAt: string
  dataDir: string
  locked: boolean
  pinSet: boolean
  lan: { running: boolean; port: number }
  devices: number
  secrets: { encryption: 'on' | 'unavailable'; needsReentry: number }
  update: { mode: 'auto' | 'manual'; state: string; availableVersion: string | null }
}

export interface LogEntry {
  timestamp: string
  severityText: string
  body: string
  scope: { name: string }
  attributes: Record<string, unknown>
  traceId?: string
}

export interface LogQuery {
  date?: string
  /** debug | info | warn | error: that level and above. */
  level?: string
  scope?: string
  traceId?: string
  /** The Logger tab's search syntax: words, `-word`, `scope:`, `trace:`. */
  q?: string
  pageSize?: number
}

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
}

export interface ScheduledTask {
  id: string
  title: string
  cronExpression: string | null
  runAt: string | null
  lastRunAt: string | null
  lastRunStatus: 'completed' | 'failed' | null
}

export interface QuotaWindow {
  name: string
  usedPercent: number
  resetsAt: number | null
  model?: string
  rejected?: boolean
}

export interface CliQuota {
  cli: string
  windows: QuotaWindow[]
  state: 'ok' | 'warning' | 'rejected'
  rejectedWindow: string | null
  overage: boolean
  asOf: number
}

export interface UsageSummary {
  totalCost: number
  totalTokens: number
  totalRequests: number
  daily: { date: string; cost: number; tokens: number }[]
  models: { model: string; provider: string; cost: number; requests: number }[]
}

export class DesktopApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs = 0
  ) {
    super(message)
    this.name = 'DesktopApiError'
  }
}

/** What a person reads for each refusal the desktop answers with. */
function messageFor(status: number, code: string, retryAfterMs: number): string {
  switch (code) {
    case 'WRONG_PIN':
      return 'Wrong PIN.'
    case 'PIN_LOCKED_OUT':
      return `Too many wrong PINs. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`
    case 'CLI_PIN_DISABLED':
      return 'Too many wrong PINs: Actovia stopped accepting the PIN from the command line. Unlock Actovia with the PIN on its own lock screen (or restart it), then try again.'
    case 'PIN_NOT_SET':
      return 'Set an app-lock PIN in Actovia first (Settings → General → Lock & Privacy). The CLI uses it to prove it is you.'
    case 'PRESENCE_REQUIRED':
      return 'Actovia refused the request: the pass has expired or this Actovia is too old for `actovia pair`.'
    case 'APP_LOCKED':
      return 'Actovia is locked. Run the command again and enter the PIN.'
    default:
      // A route this Actovia does not have: it is older than the CLI.
      if (status === 404)
        return 'This Actovia is too old for this command. Update it (Settings → About, or download the latest from https://github.com/actovia-ai/actovia/releases/latest), then try again.'
      return `Actovia answered ${status} ${code}.`
  }
}

export interface DesktopClientOptions {
  baseUrl?: string
  fetch?: typeof fetch
  /** Refuses to send the PIN to anything but Actovia; checks the real listener unless `fetch` is a stand-in. */
  verifyListener?: (baseUrl: string) => Promise<void>
}

export class DesktopClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly verifyListener: (baseUrl: string) => Promise<void>
  private pass: string | null = null

  constructor(opts: DesktopClientOptions = {}) {
    this.baseUrl = resolveApiUrl(opts.baseUrl)
    this.fetchImpl = opts.fetch ?? fetch
    this.verifyListener =
      opts.verifyListener ?? (opts.fetch ? async () => {} : baseUrl => assertListenerIsActovia(baseUrl))
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.pass) headers[PRESENCE_HEADER] = this.pass
    let res: Response
    try {
      res = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch {
      throw new DesktopApiError(
        `Actovia isn't running on this machine (nothing answered at ${this.baseUrl}). Open it first: actovia open`,
        0,
        'UNREACHABLE'
      )
    }
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: { code?: string; retryAfterMs?: number } })
      | null
    if (!res.ok) {
      const code = data?.error?.code ?? 'UNKNOWN_ERROR'
      const retryAfterMs = data?.error?.retryAfterMs ?? 0
      throw new DesktopApiError(messageFor(res.status, code, retryAfterMs), res.status, code, retryAfterMs)
    }
    return data as T
  }

  /**
   * Trades the app-lock PIN for a pass; later calls of this client carry it.
   * What listens is checked before the PIN is even asked for.
   */
  async authorize(askPin: () => Promise<string>): Promise<CliPass> {
    await this.verifyListener(this.baseUrl)
    const pin = await askPin()
    let pass: CliPass
    try {
      pass = await this.call<CliPass>('POST', '/api/v1/lock/cli-pass', { pin })
    } catch (err) {
      // Actovia 2.1.0+ answers the pass while locked (a correct PIN unlocks
      // it). An older one has no such route, and while locked its lock gate
      // answers for the missing route instead of a 404.
      if (err instanceof DesktopApiError && err.code === 'APP_LOCKED') {
        throw new DesktopApiError(
          'This Actovia is too old for this command (it needs 2.1.0 or later), and it is locked. Unlock it on its own screen and update it (Settings → About, or download the latest from https://github.com/actovia-ai/actovia/releases/latest), then try again.',
          err.status,
          err.code
        )
      }
      throw err
    }
    this.pass = pass.token
    return pass
  }

  /** Whether a pass is held (bought with the PIN in this run). */
  get authorized(): boolean {
    return this.pass !== null
  }

  hostStatus(): Promise<HostStatus> {
    return this.call<HostStatus>('GET', '/api/v1/host/status')
  }

  lockNow(): Promise<{ locked: boolean; pinSet: boolean }> {
    return this.call('POST', '/api/v1/host/lock')
  }

  async quit(): Promise<void> {
    await this.call('POST', '/api/v1/host/quit')
  }

  async restart(): Promise<void> {
    await this.call('POST', '/api/v1/host/restart')
  }

  logs(query: LogQuery = {}): Promise<{ entries: LogEntry[]; total: number }> {
    const params = new URLSearchParams()
    if (query.date) params.set('date', query.date)
    if (query.level) params.set('level', query.level)
    if (query.scope) params.set('surface', query.scope)
    if (query.traceId) params.set('traceId', query.traceId)
    if (query.q) params.set('q', query.q)
    params.set('pageSize', String(query.pageSize ?? 100))
    return this.call('GET', `/api/v1/logs?${params}`)
  }

  backups(): Promise<BackupInfo[]> {
    return this.call('GET', '/api/v1/backup/list')
  }

  backupStatus(): Promise<{ autoBackup: boolean; lastBackupAt: string | null }> {
    return this.call('GET', '/api/v1/backup/status')
  }

  backupNow(): Promise<{ filePath: string }> {
    return this.call('POST', '/api/v1/backup/now')
  }

  async tasks(): Promise<{ upcoming: ScheduledTask[]; recurring: ScheduledTask[] }> {
    const [upcoming, recurring] = await Promise.all([
      this.call<ScheduledTask[]>('GET', '/api/v1/philharmonic/tasks/upcoming'),
      this.call<ScheduledTask[]>('GET', '/api/v1/philharmonic/tasks/recurring')
    ])
    return { upcoming, recurring }
  }

  quota(): Promise<CliQuota[]> {
    return this.call('GET', '/api/v1/agents/quota')
  }

  usage(): Promise<UsageSummary> {
    return this.call('GET', '/api/v1/usage')
  }

  devices(): Promise<DevicesState> {
    return this.call<DevicesState>('GET', '/api/v1/devices')
  }

  /** Opens a pairing window (two minutes, one use) and answers its link. */
  openPairing(): Promise<PairingWindow> {
    return this.call<PairingWindow>('POST', '/api/v1/devices/pairing')
  }

  async closePairing(): Promise<void> {
    await this.call('DELETE', '/api/v1/devices/pairing')
  }

  async revoke(id: string): Promise<void> {
    await this.call('DELETE', `/api/v1/devices/${encodeURIComponent(id)}`)
  }
}
