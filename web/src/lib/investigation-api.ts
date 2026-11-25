import type {
  AppGraphEntityResponse,
  AppGraphEvidenceResponse,
  AppGraphResponse,
  AskInvestigationRequest,
  AskInvestigationResponse,
  HostsResponse,
  InvestigationEnvelope,
  InvestigationVersionResponse,
  ServerStatsResponse,
  ServerVersionResponse,
  TailLogsResponse,
} from "../contracts/investigation"

export class CortexApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly detail: string

  constructor(status: number, statusText: string, detail: string) {
    const safeDetail = redactTokenLike(detail).slice(0, 240)
    super(`${status} ${statusText}${safeDetail ? ` — ${safeDetail}` : ""}`.trim())
    this.name = "CortexApiError"
    this.status = status
    this.statusText = statusText
    this.detail = safeDetail
  }
}

function redactTokenLike(input: string): string {
  return input.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").trim()
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiRequest<T>(
  path: string,
  token: string,
  options: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeaders(token),
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json"
  }
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: options.signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new CortexApiError(response.status, response.statusText, detail)
  }
  return (await response.json()) as T
}

export function getInvestigationVersion(
  token: string,
  signal?: AbortSignal,
): Promise<InvestigationVersionResponse> {
  return apiRequest<InvestigationVersionResponse>("/api/v1/investigation/version", token, { signal })
}

export function getServerVersion(
  token: string,
  signal?: AbortSignal,
): Promise<ServerVersionResponse> {
  return apiRequest<ServerVersionResponse>("/api/version", token, { signal })
}

export function getServerStats(
  token: string,
  signal?: AbortSignal,
): Promise<ServerStatsResponse> {
  return apiRequest<ServerStatsResponse>("/api/stats", token, { signal })
}

export function getHosts(token: string, signal?: AbortSignal): Promise<HostsResponse> {
  return apiRequest<HostsResponse>("/api/hosts", token, { signal })
}

export function getRecentLogs(
  token: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<TailLogsResponse> {
  const params = new URLSearchParams({ n: String(limit) })
  return apiRequest<TailLogsResponse>(`/api/tail?${params.toString()}`, token, { signal })
}

export function askInvestigation(
  token: string,
  request: AskInvestigationRequest,
  signal?: AbortSignal,
): Promise<InvestigationEnvelope<AskInvestigationResponse>> {
  const payload: AskInvestigationRequest = { prompt: request.prompt.trim() }
  if (request.host?.trim()) payload.host = request.host.trim()
  if (request.since?.trim()) payload.since = request.since.trim()
  if (request.until?.trim()) payload.until = request.until.trim()
  if (typeof request.limit === "number") payload.limit = request.limit
  return apiRequest<InvestigationEnvelope<AskInvestigationResponse>>(
    "/api/v1/investigations/ask",
    token,
    { method: "POST", body: payload, signal },
  )
}

export function lookupGraphEntity(
  token: string,
  query: { entity_type?: string; key?: string; query?: string },
  signal?: AbortSignal,
): Promise<InvestigationEnvelope<AppGraphEntityResponse>> {
  const params = new URLSearchParams()
  if (query.entity_type) params.set("entity_type", query.entity_type)
  if (query.key) params.set("key", query.key)
  if (query.query) params.set("query", query.query)
  return apiRequest<InvestigationEnvelope<AppGraphEntityResponse>>(
    `/api/v1/graph/entity?${params.toString()}`,
    token,
    { signal },
  )
}

export function getGraphAround(
  token: string,
  query: { entity_id?: number; entity_type?: string; key?: string; limit?: number; evidence_sample_limit?: number },
  signal?: AbortSignal,
): Promise<InvestigationEnvelope<AppGraphResponse>> {
  const params = new URLSearchParams()
  if (typeof query.entity_id === "number") params.set("entity_id", String(query.entity_id))
  if (query.entity_type) params.set("entity_type", query.entity_type)
  if (query.key) params.set("key", query.key)
  params.set("limit", String(query.limit ?? 30))
  params.set("evidence_sample_limit", String(query.evidence_sample_limit ?? 3))
  return apiRequest<InvestigationEnvelope<AppGraphResponse>>(
    `/api/v1/graph/around?${params.toString()}`,
    token,
    { signal },
  )
}

export function explainGraphEntity(
  token: string,
  query: { entity_id?: number; entity_type?: string; key?: string; depth?: number; beam_width?: number; evidence_sample_limit?: number },
  signal?: AbortSignal,
): Promise<InvestigationEnvelope<AppGraphResponse>> {
  const params = new URLSearchParams()
  if (typeof query.entity_id === "number") params.set("entity_id", String(query.entity_id))
  if (query.entity_type) params.set("entity_type", query.entity_type)
  if (query.key) params.set("key", query.key)
  params.set("depth", String(query.depth ?? 2))
  params.set("beam_width", String(query.beam_width ?? 20))
  params.set("evidence_sample_limit", String(query.evidence_sample_limit ?? 3))
  return apiRequest<InvestigationEnvelope<AppGraphResponse>>(
    `/api/v1/graph/explain?${params.toString()}`,
    token,
    { signal },
  )
}

export function getGraphEvidence(
  token: string,
  evidenceId: number,
  signal?: AbortSignal,
): Promise<InvestigationEnvelope<AppGraphEvidenceResponse>> {
  const params = new URLSearchParams({ evidence_id: String(evidenceId) })
  return apiRequest<InvestigationEnvelope<AppGraphEvidenceResponse>>(
    `/api/v1/graph/evidence?${params.toString()}`,
    token,
    { signal },
  )
}
