"use client"

import { DataTable } from "@/components/ui/aurora/data-table"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import type { AgentRunDetail } from "../../../../docs/contracts/agent-observatory-types"

/** Where each relation on this run came from, and how far to trust it. */
export function RunEvidence({ detail }: { detail: AgentRunDetail }) {
  const commit = detail.commit_summary
  const rows = [
    ...detail.worktree_evidence.map((item) => ({ subject: item.detail ?? "worktree", ...item })),
    ...(commit?.evidence ?? []).map((item) => ({
      subject: `commit ${commit!.sha.slice(0, 7)}`,
      ...item,
    })),
  ].map((item) => ({
    subject: item.subject,
    trust: item.trust,
    confidence: `${Math.round(item.confidence * 100)}%`,
    kind: item.kind,
    source: item.source,
    first: item.first_seen_at,
    last: item.last_seen_at,
  }))

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No evidence"
        description="Nothing relates this run to a worktree or commit."
      />
    )
  }
  return (
    <div className="grid gap-2">
      <p className="m-0 text-xs text-[var(--aurora-text-muted)]">
        Worktree relations and the latest related commit.
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Evidence">
        <DataTable
          data={rows}
          columns={[
            { key: "subject", label: "Related to", sortable: true },
            { key: "trust", label: "Trust", sortable: true },
            { key: "confidence", label: "Confidence" },
            { key: "kind", label: "Evidence" },
            { key: "source", label: "Source" },
            { key: "first", label: "First seen" },
            { key: "last", label: "Last seen" },
          ]}
        />
      </div>
    </div>
  )
}
