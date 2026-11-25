export const INVESTIGATION_UI_VERSION = "investigation-v1"

export interface InvestigationVersionResponse {
  ui_version: string
  schema_version: string
}

export interface InvestigationBudget {
  max_graph_calls: number
  max_log_rows: number
  max_evidence_rows: number
  max_candidate_explanations: number
  max_wall_time_ms: number
  max_payload_bytes: number
}

export interface InvestigationBudgetUsed {
  graph_calls: number
  log_rows: number
  evidence_rows: number
  candidate_explanations: number
  wall_time_ms: number
  payload_bytes: number
}

export interface InvestigationMetadata {
  server_version: string
  schema_version: string
  graph_projection_status: string | null
  source_watermark: string | null
  degraded_reasons: string[]
  truncated: boolean
  truncation_reasons: string[]
  partial: boolean
  partial_reasons: string[]
  auth_state: string
  budget: InvestigationBudget
  budget_used: InvestigationBudgetUsed
  payload_limit_bytes: number
  version_skew: string | null
}

export interface InvestigationEnvelope<T> {
  metadata: InvestigationMetadata
  result: T
}

export type InvestigationClaimType =
  | "verified"
  | "supported_correlation"
  | "weak_correlation"
  | "open_question"

export interface InvestigationClaim {
  claim_type: InvestigationClaimType
  title: string
  summary: string
  confidence: string
  relationship_ids: number[]
  evidence_ids: number[]
}

export interface AppEntitySummary {
  id: number
  entity_type: string
  key: string
  label: string
  trust_level: string
}

export interface AppRelationshipSummary {
  id: number
  source_entity_id: number
  target_entity_id: number
  relationship_type: string
  reason_code: string
  trust_level: string
  confidence: number
  evidence_count: number
}

export interface AppEvidenceSummary {
  id: number
  relationship_id: number
  source_kind: string
  source_log_id: number | null
  observed_at: string
  reason_code: string
  reason_text: string | null
  confidence_delta: number
  trust_level: string
  excerpt: string | null
  missing_source_reason: string | null
}

export interface AppLogSummary {
  id?: number
  timestamp?: string
  received_at?: string
  hostname?: string
  host?: string
  severity?: string
  app_name?: string | null
  message?: string
  raw?: string
  message_truncated?: boolean
}

export interface AppGraphResponse {
  focus: AppEntitySummary | null
  entities: AppEntitySummary[]
  relationships: AppRelationshipSummary[]
  evidence: AppEvidenceSummary[]
}

export interface AppGraphEntityResponse {
  resolved_entity: AppEntitySummary | null
  candidates: AppEntitySummary[]
}

export interface AppGraphEvidenceResponse {
  evidence: AppEvidenceSummary
  relationship: AppRelationshipSummary
  source_log_summary: AppLogSummary | null
  missing_source_reason: string | null
}

export interface AskInvestigationRequest {
  prompt: string
  host?: string
  since?: string
  until?: string
  limit?: number
}

export interface AskInvestigationResponse {
  prompt: string
  resolved_entity: AppEntitySummary | null
  candidates: AppEntitySummary[]
  claims: InvestigationClaim[]
  open_questions: string[]
  next_queries: string[]
  graph: AppGraphResponse
  logs: AppLogSummary[]
}

export interface ServerVersionResponse {
  version?: string
  schema_version?: number | string
}

export interface ServerStatsResponse {
  total_logs?: number
  total?: number
}

export interface RawHostSource {
  hostname?: string | null
  host_id?: string | null
  source_kind?: string | null
  aliases?: Array<string | null | undefined>
}

export type HostSourceInput = string | RawHostSource | null | undefined

export interface HostsResponse {
  hosts?: HostSourceInput[]
  items?: HostSourceInput[]
}

export interface TailLogsResponse {
  logs?: AppLogSummary[]
  entries?: AppLogSummary[]
  items?: AppLogSummary[]
}
