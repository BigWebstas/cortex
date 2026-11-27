// Typed, bounded readers for the Agent Observatory REST routes.

import type {
  AgentEventKind,
  AgentRunDetail,
  AgentRunEventPage,
  AgentRunPage,
  PageEnvelope,
  Pagination,
  RepositoryPage,
  RepositorySummary,
  RunStatus,
  WorktreePage,
} from "../../../../docs/contracts/agent-observatory-types"

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export class ObservatoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Cortex request failed: ${code} (${status})`)
    this.name = "ObservatoryApiError"
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  maxBytes?: number
}

type QueryValue = string | number | boolean | null | undefined | readonly string[]
type Query = Record<string, QueryValue>

export function queryString(query: Query): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item)
    } else {
      params.set(name, String(value))
    }
  }
  const text = params.toString()
  return text ? `?${text}` : ""
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let received = 0
  let text = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new ObservatoryApiError(response.status, "response_too_large")
    }
    text += decoder.decode(value, { stream: true })
  }
}

/** Only short machine codes are surfaced, so error text cannot echo secrets. */
function errorCode(body: string): string {
  try {
    const code = (JSON.parse(body) as { error?: unknown }).error
    if (typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code)) return code
  } catch {
    // Not a JSON error envelope.
  }
  return "http_error"
}

async function get<T>(token: string, path: string, options: RequestOptions): Promise<T> {
  const response = await (options.fetchImpl ?? fetch)(path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: options.signal,
  })
  const body = await readBounded(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
  if (!response.ok) throw new ObservatoryApiError(response.status, errorCode(body))
  try {
    const value: unknown = JSON.parse(body)
    if (typeof value === "object" && value !== null) return value as T
  } catch {
    // Reported below.
  }
  throw new ObservatoryApiError(response.status, "malformed_response")
}

const segment = encodeURIComponent

export type PageQuery = { cursor?: string | null; limit?: number }

export type RepositoryQuery = PageQuery & {
  host?: string
  query?: string
  active_runs_only?: boolean
  include_removed?: boolean
  since?: string
  until?: string
}

export type WorktreeQuery = PageQuery & {
  branch?: string
  dirty?: boolean
  include_removed?: boolean
}

export type RepositoryRunQuery = PageQuery & {
  worktree_id?: string
  branch?: string
  status?: readonly RunStatus[]
  tool?: readonly string[]
  host?: string
  query?: string
  since?: string
  until?: string
  active_only?: boolean
}

export type RunQuery = RepositoryRunQuery & { repository_id?: string }

export type EventQuery = PageQuery & {
  kind?: readonly AgentEventKind[]
  severity_min?: number
  actor_key?: string
  trace_id?: string
  query?: string
  since?: string
  until?: string
  order?: "asc" | "desc"
  include?: "payload"
}

export type TelemetryQuery = {
  trace_id?: string
  metric_name?: string
  since_nano?: string
  until_nano?: string
  span_cursor?: string | null
  span_limit?: number
  metric_cursor?: string | null
  metric_limit?: number
}

/**
 * Telemetry is a span page and a metric page. Nanosecond timestamps are decimal
 * strings because they exceed double precision.
 */
export interface TelemetrySpanRow {
  id: string
  trace_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  kind: number
  start_time_unix_nano: string
  end_time_unix_nano: string
  duration_nano: number
  status_code: number
  status_message: string | null
  service_name: string | null
  attributes_json: string
}

export interface TelemetryMetricRow {
  id: string
  point_key: string
  metric_name: string
  description: string
  unit: string
  instrument_kind: string
  start_time_unix_nano: string | null
  time_unix_nano: string
  value_json: string
  attributes_json: string
}

type ItemPage<T> = { items: T[]; pagination: Pagination } & Omit<PageEnvelope, "pagination">

export type RunTelemetry = [ItemPage<TelemetrySpanRow>, ItemPage<TelemetryMetricRow>]

export const listRepositories = (token: string, query: RepositoryQuery = {}, o: RequestOptions = {}) =>
  get<RepositoryPage>(token, `/api/repositories${queryString(query)}`, o)

export const getRepository = (token: string, id: string, o: RequestOptions = {}) =>
  get<RepositorySummary>(token, `/api/repositories/${segment(id)}`, o)

export const listWorktrees = (
  token: string,
  repositoryId: string,
  query: WorktreeQuery = {},
  o: RequestOptions = {},
) =>
  get<WorktreePage>(
    token,
    `/api/repositories/${segment(repositoryId)}/worktrees${queryString(query)}`,
    o,
  )

export const listRuns = (token: string, query: RunQuery = {}, o: RequestOptions = {}) =>
  get<AgentRunPage>(token, `/api/agent-runs${queryString(query)}`, o)

export const listRepositoryRuns = (
  token: string,
  repositoryId: string,
  query: RepositoryRunQuery = {},
  o: RequestOptions = {},
) =>
  get<AgentRunPage>(
    token,
    `/api/repositories/${segment(repositoryId)}/runs${queryString(query)}`,
    o,
  )

export const getRun = (token: string, runKey: string, o: RequestOptions = {}) =>
  get<AgentRunDetail>(token, `/api/agent-runs/${segment(runKey)}`, o)

export const listEvents = (
  token: string,
  runKey: string,
  query: EventQuery = {},
  o: RequestOptions = {},
) =>
  get<AgentRunEventPage>(
    token,
    `/api/agent-runs/${segment(runKey)}/events${queryString(query)}`,
    o,
  )

export const getRunTelemetry = (
  token: string,
  runKey: string,
  query: TelemetryQuery = {},
  o: RequestOptions = {},
) =>
  get<RunTelemetry>(
    token,
    `/api/agent-runs/${segment(runKey)}/telemetry${queryString(query)}`,
    o,
  )
