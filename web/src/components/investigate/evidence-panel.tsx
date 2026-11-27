"use client"

import { Badge, type BadgeTone } from "@/components/ui/aurora/badge"
import { Banner } from "@/components/ui/aurora/banner"
import { Button } from "@/components/ui/aurora/button"
import { Card, CardContent, CardHeader } from "@/components/ui/aurora/card"
import type {
  AppEvidenceSummary,
  AppGraphEvidenceResponse,
  AppLogSummary,
  HostSourceInput,
  InvestigationClaim,
} from "../../contracts/investigation"
import { type GraphEdgeData, type GraphNodeData, relatedLogsForNode } from "../../lib/host-sources"

export type InspectorSelection =
  | { kind: "none" }
  | { kind: "node"; node: GraphNodeData }
  | { kind: "edge"; edge: GraphEdgeData }
  | { kind: "claim"; claim: InvestigationClaim }

export interface EvidencePanelProps {
  selection: InspectorSelection
  evidenceItems: AppEvidenceSummary[]
  latestLogs: AppLogSummary[]
  latestHosts: HostSourceInput[]
  emptyGraph: boolean
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

function toneForTrust(trust?: string): BadgeTone {
  if (trust === "verified") return "success"
  if (trust === "claimed" || trust === "degraded") return "warn"
  return "neutral"
}

export function EvidencePanel({
  selection,
  evidenceItems,
  latestLogs,
  latestHosts,
  emptyGraph,
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
  let badgeTone: BadgeTone = "neutral"

  if (selection.kind === "node") {
    title = selection.node.label || selection.node.id
    badgeLabel =
      selection.node.kind === "claimed_host" ? "Claimed device name" : selection.node.kind || "node"
    badgeTone =
      selection.node.kind === "claimed_host" || selection.node.status === "degraded"
        ? "warn"
        : toneForTrust(selection.node.trust_level)
  } else if (selection.kind === "edge") {
    title = selection.edge.label || selection.edge.id
    badgeLabel = selection.edge.trust_level || "relationship"
    badgeTone = toneForTrust(selection.edge.trust_level)
  } else if (selection.kind === "claim") {
    title = selection.claim.title
    badgeLabel = selection.claim.claim_type
    badgeTone =
      selection.claim.claim_type === "open_question"
        ? "warn"
        : selection.claim.claim_type === "verified"
          ? "success"
          : "cyan"
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

  const related =
    selection.kind === "node"
      ? relatedLogsForNode(selection.node, latestLogs, latestHosts)
      : { rows: [], ambiguousCount: 0 }
  const relatedLogs = related.rows.slice(0, 5)

  return (
    <aside aria-label="Evidence inspector">
      <Card className="overflow-hidden flex flex-col">
        <CardHeader className="flex items-center justify-between gap-2.5 bg-[var(--aurora-panel-medium)]">
          <div className="min-w-0">
            <span className="aurora-meta-label">Evidence &amp; proof</span>
            <h2 className="m-0 truncate text-[15px] font-bold" data-selected-title>
              {title}
            </h2>
          </div>
          <Badge tone={badgeTone} data-selected-kind>
            {badgeLabel}
          </Badge>
        </CardHeader>

        <CardContent className="grid gap-2.5 p-3 overflow-y-auto max-h-[520px]" data-evidence-list>
          {emptyGraph && (
            <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
              No graph entities returned for this investigation.
            </p>
          )}

          {selection.kind === "none" && (
            <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
              Select a graph node, relationship edge, or answer claim to inspect trust level, reason
              codes, supporting evidence rows, and source log proof.
            </p>
          )}

          {selection.kind === "node" && (
            <>
              <Card elevated={false}>
                <CardContent className="p-3 grid gap-2 text-[13px]">
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
                        {selection.node.trust_level || "unknown"} ·{" "}
                        {selection.node.status || "unknown"}
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
                      <span className="aurora-mono break-all">
                        {selection.node.aliases.join(", ")}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {connected && (selection.node.entity_id || selection.node.entity_key) && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="neutral"
                    disabled={isBusy}
                    onClick={() => onExpandNode(selection.node)}
                  >
                    Expand neighborhood
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="neutral"
                    disabled={isBusy}
                    onClick={() => onExplainNode(selection.node)}
                  >
                    Explain entity
                  </Button>
                  {(selection.node.kind === "host" || selection.node.entity_type === "host") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="neutral"
                      disabled={isBusy}
                      onClick={() => onAskAboutHost(selection.node.label)}
                    >
                      Ask about host
                    </Button>
                  )}
                </div>
              )}

              <div className="grid gap-2">
                <span className="aurora-meta-label">
                  Related log context ({relatedLogs.length})
                </span>
                {related.ambiguousCount > 0 && (
                  <p className="m-0 text-xs text-[var(--aurora-text-muted)]">
                    {related.ambiguousCount} hostname-only log rows were omitted because the name
                    matches multiple sources.
                  </p>
                )}
                {relatedLogs.length === 0 ? (
                  <p className="m-0 text-xs text-[var(--aurora-text-muted)]">
                    No recent log rows matched this node&apos;s aliases in the current window.
                  </p>
                ) : (
                  relatedLogs.map((row, index) => (
                    <Card key={row.id ?? `${row.timestamp}-${index}`} elevated={false}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <Badge tone="neutral">{row.severity || "log"}</Badge>
                          {!row.host_id && (
                            <span className="text-[11px] text-[var(--aurora-text-muted)]">
                              hostname only; device identity unverified
                            </span>
                          )}
                          <span className="aurora-mono text-[var(--aurora-text-muted)]">
                            {row.app_name || row.hostname || ""}
                          </span>
                        </div>
                        <p className="m-0 text-xs text-[var(--aurora-text-primary)] break-words">
                          {row.message || row.raw || "No message"}
                        </p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </>
          )}

          {selection.kind === "edge" && (
            <>
              <Card elevated={false}>
                <CardContent className="p-3 grid gap-2 text-[13px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="aurora-meta-label block">Relationship</span>
                      <span className="aurora-mono">
                        {selection.edge.relationship_type || selection.edge.label}
                      </span>
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
                </CardContent>
              </Card>
              {selection.edge.trust_level !== "verified" && (
                <Banner variant="warn" kind="tag">
                  Guardrail: This relationship is{" "}
                  <strong className="text-[var(--aurora-text-primary)]">
                    {selection.edge.trust_level || "unverified"}
                  </strong>
                  . Inspect supporting evidence before treating timing correlation as causality.
                </Banner>
              )}
            </>
          )}

          {selection.kind === "claim" && (
            <Card elevated={false}>
              <CardContent className="p-3 grid gap-2 text-[13px]">
                <p className="m-0 text-[var(--aurora-text-primary)]">{selection.claim.summary}</p>
                <div className="flex flex-wrap gap-2 text-xs text-[var(--aurora-text-muted)]">
                  <span>Confidence: {selection.claim.confidence}</span>
                  <span>·</span>
                  <span>{selection.claim.relationship_ids.length} relationships</span>
                  <span>·</span>
                  <span>{selection.claim.evidence_ids.length} evidence rows</span>
                </div>
              </CardContent>
            </Card>
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
                  <Card key={item.id} elevated={false}>
                    <CardContent className="p-3 grid gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone={toneForTrust(item.trust_level)}>
                          {item.source_kind} · {item.trust_level}
                        </Badge>
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
                          <Button
                            type="button"
                            size="sm"
                            variant="neutral"
                            disabled={proofLoadingId === item.id}
                            onClick={() => onInspectEvidence(item.id)}
                          >
                            {proofLoadingId === item.id
                              ? "Loading proof..."
                              : "Inspect source proof"}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {proofError && <Banner variant="error" kind="tag" description={proofError} />}

          {selectedProof && (
            <Card elevated={false} accent="cyan">
              <CardContent className="p-3 grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="aurora-meta-label">
                    Source proof #{selectedProof.evidence.id}
                  </span>
                  <Badge tone={toneForTrust(selectedProof.evidence.trust_level)}>
                    {selectedProof.evidence.source_kind}
                  </Badge>
                </div>
                <div className="text-xs text-[var(--aurora-text-muted)]">
                  Relationship:{" "}
                  <span className="aurora-mono">
                    {selectedProof.relationship.relationship_type} (
                    {selectedProof.relationship.reason_code})
                  </span>
                </div>
                {selectedProof.source_log_summary ? (
                  <div className="rounded bg-[var(--aurora-page-bg)] p-2 text-xs">
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
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}
