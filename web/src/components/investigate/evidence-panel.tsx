"use client"

import type {
  AppEvidenceSummary,
  AppGraphEvidenceResponse,
  AppLogSummary,
  InvestigationClaim,
} from "../../contracts/investigation"
import type { GraphEdgeData, GraphNodeData } from "../../lib/host-sources"

export type InspectorSelection =
  | { kind: "none" }
  | { kind: "node"; node: GraphNodeData }
  | { kind: "edge"; edge: GraphEdgeData }
  | { kind: "claim"; claim: InvestigationClaim }

export interface EvidencePanelProps {
  selection: InspectorSelection
  evidenceItems: AppEvidenceSummary[]
  latestLogs: AppLogSummary[]
  selectedProof: AppGraphEvidenceResponse | null
  proofLoadingId: number | null
  proofError: string | null
  connected: boolean
  isBusy: boolean
  onInspectEvidence: (evidenceId: number) => void
  onExpandNode: (node: GraphNodeData) => void
  onExplainNode: (node: GraphNodeData) => void
  onAskAboutHost: (hostname: string) => void
}

function toneForTrust(trust?: string): string {
  if (trust === "verified") return "aurora-badge-success"
  if (trust === "claimed" || trust === "degraded") return "aurora-badge-warn"
  if (trust === "weak" || trust === "inferred") return "aurora-badge-neutral"
  return "aurora-badge-neutral"
}

export function EvidencePanel({
  selection,
  evidenceItems,
  latestLogs,
  selectedProof,
  proofLoadingId,
  proofError,
  connected,
  isBusy,
  onInspectEvidence,
  onExpandNode,
  onExplainNode,
  onAskAboutHost,
}: EvidencePanelProps) {
  let title = "Nothing selected"
  let badgeLabel = "Idle"
  let badgeClass = "aurora-badge-neutral"

  if (selection.kind === "node") {
    title = selection.node.label || selection.node.id
    badgeLabel =
      selection.node.kind === "claimed_host" ? "Claimed device name" : selection.node.kind || "node"
    badgeClass =
      selection.node.kind === "claimed_host" || selection.node.status === "degraded"
        ? "aurora-badge-warn"
        : toneForTrust(selection.node.trust_level)
  } else if (selection.kind === "edge") {
    title = selection.edge.label || selection.edge.id
    badgeLabel = selection.edge.trust_level || "relationship"
    badgeClass = toneForTrust(selection.edge.trust_level)
  } else if (selection.kind === "claim") {
    title = selection.claim.title
    badgeLabel = selection.claim.claim_type
    badgeClass =
      selection.claim.claim_type === "open_question"
        ? "aurora-badge-warn"
        : selection.claim.claim_type === "verified"
          ? "aurora-badge-success"
          : "aurora-badge-violet"
  }

  const filteredEvidence =
    selection.kind === "edge" && selection.edge.relationship_id
      ? evidenceItems.filter((item) => item.relationship_id === selection.edge.relationship_id)
      : selection.kind === "claim"
        ? evidenceItems.filter(
            (item) =>
              selection.claim.evidence_ids.includes(item.id) ||
              selection.claim.relationship_ids.includes(item.relationship_id),
          )
        : []

  const relatedLogs =
    selection.kind === "node"
      ? latestLogs
          .filter((row) => {
            const host = row.hostname || row.host || ""
            const aliases = Array.isArray(selection.node.aliases)
              ? selection.node.aliases
              : [selection.node.label]
            return aliases.some((alias) => alias === String(host))
          })
          .slice(0, 5)
      : []

  return (
    <aside className="aurora-surface overflow-hidden flex flex-col" aria-label="Evidence inspector">
      <div className="aurora-panel-head">
        <div className="min-w-0">
          <span className="aurora-meta-label">Evidence &amp; proof</span>
          <h2 className="m-0 truncate text-[15px] font-bold" data-selected-title>
            {title}
          </h2>
        </div>
        <span className={`aurora-badge ${badgeClass}`} data-selected-kind>
          {badgeLabel}
        </span>
      </div>

      <div className="grid gap-2.5 p-3 overflow-y-auto max-h-[520px]" data-evidence-list>
        {selection.kind === "none" && (
          <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
            Select a graph node, relationship edge, or answer claim to inspect trust level, reason
            codes, supporting evidence rows, and source log proof.
          </p>
        )}

        {selection.kind === "node" && (
          <>
            <div className="aurora-card grid gap-2 text-[13px]">
              <div>
                <span className="aurora-meta-label block">Node id</span>
                <span className="aurora-mono break-all">{selection.node.id}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="aurora-meta-label block">Kind</span>
                  <span>{badgeLabel}</span>
                </div>
                <div>
                  <span className="aurora-meta-label block">Trust / Status</span>
                  <span>
                    {selection.node.trust_level || "unknown"} · {selection.node.status || "unknown"}
                  </span>
                </div>
              </div>
              {selection.node.host_id && (
                <div>
                  <span className="aurora-meta-label block">Heartbeat ID</span>
                  <span className="aurora-mono break-all">{selection.node.host_id}</span>
                </div>
              )}
              {selection.node.aliases && selection.node.aliases.length > 1 && (
                <div>
                  <span className="aurora-meta-label block">Observed aliases</span>
                  <span className="aurora-mono break-all">{selection.node.aliases.join(", ")}</span>
                </div>
              )}
            </div>

            {connected && (selection.node.entity_id || selection.node.entity_key) && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="aurora-btn-secondary"
                  disabled={isBusy}
                  onClick={() => onExpandNode(selection.node)}
                >
                  Expand neighborhood
                </button>
                <button
                  type="button"
                  className="aurora-btn-secondary"
                  disabled={isBusy}
                  onClick={() => onExplainNode(selection.node)}
                >
                  Explain entity
                </button>
                {(selection.node.kind === "host" || selection.node.entity_type === "host") && (
                  <button
                    type="button"
                    className="aurora-btn-secondary"
                    disabled={isBusy}
                    onClick={() => onAskAboutHost(selection.node.label)}
                  >
                    Ask about host
                  </button>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <span className="aurora-meta-label">Related log context ({relatedLogs.length})</span>
              {relatedLogs.length === 0 ? (
                <p className="m-0 text-xs text-[var(--aurora-text-muted)]">
                  No recent log rows matched this node&apos;s aliases in the current window.
                </p>
              ) : (
                relatedLogs.map((row, index) => (
                  <article key={row.id ?? `${row.timestamp}-${index}`} className="aurora-card">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="aurora-badge aurora-badge-neutral">
                        {row.severity || "log"}
                      </span>
                      <span className="aurora-mono text-[var(--aurora-text-muted)]">
                        {row.app_name || row.hostname || ""}
                      </span>
                    </div>
                    <p className="m-0 text-xs text-[var(--aurora-text-primary)] break-words">
                      {row.message || row.raw || "No message"}
                    </p>
                  </article>
                ))
              )}
            </div>
          </>
        )}

        {selection.kind === "edge" && (
          <>
            <div className="aurora-card grid gap-2 text-[13px]">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="aurora-meta-label block">Relationship</span>
                  <span className="aurora-mono">{selection.edge.relationship_type || selection.edge.label}</span>
                </div>
                <div>
                  <span className="aurora-meta-label block">Reason code</span>
                  <span className="aurora-mono">{selection.edge.reason_code || "topology"}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="aurora-meta-label block">Confidence</span>
                  <span>
                    {typeof selection.edge.confidence === "number"
                      ? `${Math.round(selection.edge.confidence * 100)}%`
                      : "--"}
                  </span>
                </div>
                <div>
                  <span className="aurora-meta-label block">Evidence rows</span>
                  <span>{selection.edge.evidence_count ?? filteredEvidence.length}</span>
                </div>
              </div>
            </div>
            {selection.edge.trust_level !== "verified" && (
              <div className="aurora-banner aurora-banner-warn text-xs">
                <span>
                  Guardrail: This relationship is <strong>{selection.edge.trust_level || "unverified"}</strong>.
                  Inspect supporting evidence before treating timing correlation as causality.
                </span>
              </div>
            )}
          </>
        )}

        {selection.kind === "claim" && (
          <div className="aurora-card grid gap-2 text-[13px]">
            <p className="m-0 text-[var(--aurora-text-primary)]">{selection.claim.summary}</p>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--aurora-text-muted)]">
              <span>Confidence: {selection.claim.confidence}</span>
              <span>·</span>
              <span>{selection.claim.relationship_ids.length} relationships</span>
              <span>·</span>
              <span>{selection.claim.evidence_ids.length} evidence rows</span>
            </div>
          </div>
        )}

        {(selection.kind === "edge" || selection.kind === "claim") && (
          <div className="grid gap-2">
            <span className="aurora-meta-label">
              Supporting evidence ({filteredEvidence.length})
            </span>
            {filteredEvidence.length === 0 ? (
              <p className="m-0 text-xs text-[var(--aurora-text-muted)]">
                No evidence samples were attached to this selection.
              </p>
            ) : (
              filteredEvidence.map((item) => (
                <article key={item.id} className="aurora-card grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`aurora-badge ${toneForTrust(item.trust_level)}`}>
                      {item.source_kind} · {item.trust_level}
                    </span>
                    <span className="aurora-mono text-[var(--aurora-text-muted)]">
                      {item.observed_at.slice(0, 19)}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--aurora-text-muted)]">
                    Reason: <span className="aurora-mono">{item.reason_code}</span>
                    {item.reason_text ? ` — ${item.reason_text}` : ""}
                  </div>
                  {item.excerpt && (
                    <p className="m-0 text-xs text-[var(--aurora-text-primary)] break-words">
                      {item.excerpt}
                    </p>
                  )}
                  {item.missing_source_reason && (
                    <p className="m-0 text-xs text-[var(--aurora-warn)]">
                      Missing source: {item.missing_source_reason}
                    </p>
                  )}
                  {connected && (
                    <div>
                      <button
                        type="button"
                        className="aurora-btn-secondary !py-1 !text-xs"
                        disabled={proofLoadingId === item.id}
                        onClick={() => onInspectEvidence(item.id)}
                      >
                        {proofLoadingId === item.id ? "Loading proof..." : "Inspect source proof"}
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {proofError && (
          <div className="aurora-banner aurora-banner-error text-xs">{proofError}</div>
        )}

        {selectedProof && (
          <article className="aurora-card aurora-card-selected grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="aurora-meta-label">Source proof #{selectedProof.evidence.id}</span>
              <span className={`aurora-badge ${toneForTrust(selectedProof.evidence.trust_level)}`}>
                {selectedProof.evidence.source_kind}
              </span>
            </div>
            <div className="text-xs text-[var(--aurora-text-muted)]">
              Relationship:{" "}
              <span className="aurora-mono">
                {selectedProof.relationship.relationship_type} ({selectedProof.relationship.reason_code})
              </span>
            </div>
            {selectedProof.source_log_summary ? (
              <div className="rounded bg-[#07131c] p-2 text-xs">
                <div className="aurora-mono text-[var(--aurora-text-muted)] mb-1">
                  {selectedProof.source_log_summary.timestamp?.slice(0, 19)} ·{" "}
                  {selectedProof.source_log_summary.hostname} ·{" "}
                  {selectedProof.source_log_summary.severity}
                </div>
                <p className="m-0 text-[var(--aurora-text-primary)] break-words">
                  {selectedProof.source_log_summary.message}
                </p>
              </div>
            ) : (
              <p className="m-0 text-xs text-[var(--aurora-warn)]">
                Source log unavailable:{" "}
                {selectedProof.missing_source_reason ||
                  selectedProof.evidence.missing_source_reason ||
                  "retained out or not log-backed"}
              </p>
            )}
          </article>
        )}
      </div>
    </aside>
  )
}
