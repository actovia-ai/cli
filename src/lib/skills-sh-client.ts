import type { SkillDetail } from './skills-store'

export const DEFAULT_BFF_BASE_URL = 'https://skills-md.yancey.app'

function resolveBaseUrl(explicit?: string): string {
  return explicit ?? process.env.ACTOVIA_SKILLS_BFF_URL ?? DEFAULT_BFF_BASE_URL
}

export interface SkillListItem {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: string
  installUrl: string
  url: string
}

export interface SkillListResponse {
  data: SkillListItem[]
  pagination: { page: number; perPage: number; total: number; hasMore: boolean }
}

export interface SkillSearchResponse {
  data: SkillListItem[]
  query: string
  searchType: 'fuzzy' | 'semantic'
  count: number
  durationMs: number
}

export interface SkillAuditEntry {
  provider: string
  slug: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  auditedAt: string
  riskLevel?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  categories?: string[]
}

export interface SkillAuditResponse {
  id: string
  source: string
  slug: string
  audits: SkillAuditEntry[]
}

export class SkillsApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SkillsApiError'
    this.status = status
  }
}

async function request<T>(url: URL): Promise<T> {
  const res = await fetch(url)
  if (res.status === 404) {
    throw new SkillsApiError(404, 'Not found')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new SkillsApiError(res.status, body?.message ?? `Request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

export async function listSkills(
  opts: { view?: 'all-time' | 'trending' | 'hot'; page?: number; perPage?: number } = {},
  baseUrl?: string
): Promise<SkillListResponse> {
  const url = new URL('/api/v1/skills', resolveBaseUrl(baseUrl))
  if (opts.view) url.searchParams.set('view', opts.view)
  if (opts.page !== undefined) url.searchParams.set('page', String(opts.page))
  if (opts.perPage !== undefined) url.searchParams.set('per_page', String(opts.perPage))
  return request<SkillListResponse>(url)
}

export async function searchSkills(
  query: string,
  opts: { owner?: string; limit?: number } = {},
  baseUrl?: string
): Promise<SkillSearchResponse> {
  const url = new URL('/api/v1/skills/search', resolveBaseUrl(baseUrl))
  url.searchParams.set('q', query)
  if (opts.owner) url.searchParams.set('owner', opts.owner)
  if (opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit))
  return request<SkillSearchResponse>(url)
}

export async function getSkillDetail(
  id: string,
  baseUrl?: string
): Promise<SkillDetail> {
  const url = new URL(`/api/v1/skills/${id}`, resolveBaseUrl(baseUrl))
  return request<SkillDetail>(url)
}

export async function getSkillAudit(
  id: string,
  baseUrl?: string
): Promise<SkillAuditResponse | null> {
  const url = new URL(`/api/v1/skills/audit/${id}`, resolveBaseUrl(baseUrl))
  try {
    return await request<SkillAuditResponse>(url)
  } catch (err) {
    if (err instanceof SkillsApiError && err.status === 404) return null
    throw err
  }
}
