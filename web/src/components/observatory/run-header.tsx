"use client"

import { useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/aurora/badge"
import { Button } from "@/components/ui/aurora/button"
import { Input } from "@/components/ui/aurora/input"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/aurora/sheet"
import { StatusIndicator } from "@/components/ui/aurora/status-indicator"
import type { AgentRunDetail } from "../../../../docs/contracts/agent-observatory-types"
import { STATUS_TONES, attribution, parseFreshness } from "../../lib/observatory/view"
import { When } from "./shared"

const ATTRIBUTION: Record<string, { tone: BadgeTone; label: string }> = {
  verified: { tone: "success", label: "Verified worktree" },
  unverified: { tone: "warn", label: "Unverified worktree" },
  ambiguous: { tone: "warn", label: "Multiple possible worktrees" },
  none: { tone: "neutral", label: "No worktree evidence" },
}

/**
 * Browsers expose the clipboard only on HTTPS and localhost, so show the key
 * for manual copying when it cannot be written.
 */
function CopyRunKey({ runKey }: { runKey: string }) {
  const [result, setResult] = useState<"idle" | "copied" | "manual">("idle")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(runKey)
      setResult("copied")
    } catch {
      // Also reached when `navigator.clipboard` is undefined.
      setResult("manual")
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => void copy()}>
        {result === "copied" ? "Run key copied" : "Copy run key"}
      </Button>
      {result === "manual" && (
        <label className="grid w-full gap-1 text-sm">
          Copying is unavailable here. Select the run key and copy it.
          <Input
            readOnly
            autoFocus
            value={runKey}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="aurora-text-eyebrow">{label}</dt>
      <dd className="m-0 break-all text-sm">{children}</dd>
    </div>
  )
}

export function RunHeader({ detail }: { detail: AgentRunDetail }) {
  const { run, actors, worktree_evidence: evidence, commit_summary: commit } = detail
  const worktree = attribution(evidence)
  const trust = ATTRIBUTION[worktree.state]
  const freshness = parseFreshness(run.freshness_json)

  return (
    <header className="grid gap-3" aria-label="Selected run">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="aurora-text-section m-0 break-all">
          {run.tool} · {run.native_session_id}
        </h2>
        <StatusIndicator tone={STATUS_TONES[run.status]} label={run.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={trust.tone}>{trust.label}</Badge>
        {evidence.length > 0 && (
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" size="sm">
                Worktree evidence ({evidence.length})
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Worktree evidence</SheetTitle>
                <SheetDescription>How this run was related to each worktree.</SheetDescription>
              </SheetHeader>
              <SheetBody>
                <ul className="grid gap-3">
                  {evidence.map((item, index) => (
                    <li key={index} className="grid gap-1 text-sm">
                      <span className="break-all font-semibold">{item.detail}</span>
                      <span>
                        {item.trust} · confidence {Math.round(item.confidence * 100)}% · {item.kind}{" "}
                        from {item.source}
                      </span>
                      <span className="text-[var(--aurora-text-muted)]">
                        <When value={item.first_seen_at} /> to <When value={item.last_seen_at} />
                      </span>
                    </li>
                  ))}
                </ul>
              </SheetBody>
            </SheetContent>
          </Sheet>
        )}
        <CopyRunKey runKey={run.run_key} />
      </div>
      <dl className="m-0 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Fact label="Status reason">{run.status_reason || "none given"}</Fact>
        <Fact label="Host">{run.hostname}</Fact>
        <Fact label="Worktree">{worktree.path ?? "not established"}</Fact>
        <Fact label="Branch">{run.primary_branch ?? "unknown"}</Fact>
        <Fact label="HEAD">
          {run.start_head_sha?.slice(0, 7) ?? "unknown"} →{" "}
          {run.current_head_sha?.slice(0, 7) ?? "unknown"}
        </Fact>
        <Fact label="Started">
          <When value={run.started_at} />
        </Fact>
        <Fact label="Last activity">
          <When value={run.last_activity_at} />
        </Fact>
        <Fact label="Ended">{run.ended_at ? <When value={run.ended_at} /> : "not ended"}</Fact>
        <Fact label="Actors">
          {actors.map((actor) => actor.display_name ?? actor.native_id).join(", ") || "none"}
        </Fact>
        {run.transcript_path && <Fact label="Transcript">{run.transcript_path}</Fact>}
        {commit && (
          <Fact label="Latest related commit">
            {commit.sha.slice(0, 7)} {commit.subject} (
            {commit.evidence.map((item) => item.trust).join(", ")})
          </Fact>
        )}
      </dl>
      {freshness.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Signal freshness">
          {freshness.map(([lane, state]) => (
            <li key={lane}>
              <Badge tone={state === "fresh" ? "success" : "neutral"}>
                {lane}: {state.replace("_", " ")}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}
