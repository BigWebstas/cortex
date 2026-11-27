"use client"

import type { FormEvent } from "react"

import { Badge, type BadgeTone } from "@/components/ui/aurora/badge"
import { Banner } from "@/components/ui/aurora/banner"
import { Button } from "@/components/ui/aurora/button"
import { Card, CardContent } from "@/components/ui/aurora/card"
import { Input } from "@/components/ui/aurora/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/aurora/select"
import type { AppEntitySummary, InvestigationClaim } from "../../contracts/investigation"

export interface StatusCardMessage {
  tone: "cyan" | "success" | "warn" | "error"
  badge: string
  title: string
  body: string
}

export interface AskPanelProps {
  prompt: string
  hostHint: string
  sinceHint: string
  knownHosts: string[]
  askState: "idle" | "pending" | "complete" | "failed"
  claims: InvestigationClaim[]
  activeClaimIndex: number | null
  openQuestions: string[]
  nextQueries: string[]
  candidates: AppEntitySummary[]
  statusMessage: StatusCardMessage | null
  onPromptChange: (value: string) => void
  onHostHintChange: (value: string) => void
  onSinceHintChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSelectClaim: (claim: InvestigationClaim, index: number) => void
  onRunSuggestedQuery: (query: string) => void
  onSelectCandidate: (candidate: AppEntitySummary) => void
}

const DEFAULT_WINDOW = "default"

function claimBadgeTone(claimType: InvestigationClaim["claim_type"]): BadgeTone {
  switch (claimType) {
    case "verified":
      return "success"
    case "open_question":
    case "weak_correlation":
      return "warn"
    default:
      return "cyan"
  }
}

function statusBadgeTone(tone: StatusCardMessage["tone"]): BadgeTone {
  switch (tone) {
    case "success":
      return "success"
    case "warn":
      return "warn"
    case "error":
      return "error"
    default:
      return "cyan"
  }
}

export function AskPanel({
  prompt,
  hostHint,
  sinceHint,
  knownHosts,
  askState,
  claims,
  activeClaimIndex,
  openQuestions,
  nextQueries,
  candidates,
  statusMessage,
  onPromptChange,
  onHostHintChange,
  onSinceHintChange,
  onSubmit,
  onSelectClaim,
  onRunSuggestedQuery,
  onSelectCandidate,
}: AskPanelProps) {
  return (
    <Card>
      <CardContent className="p-3.5 grid gap-3" aria-label="Ask and explain">
        <form className="grid gap-2.5" data-ask-form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_180px_140px_auto] items-end">
            <div className="grid gap-1">
              <label className="aurora-meta-label" htmlFor="ask-input">
                Ask Cortex
              </label>
              <Input
                id="ask-input"
                name="query"
                type="search"
                placeholder="Why did this host start failing or OOMing?"
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
              />
            </div>

            <div className="grid gap-1">
              <label className="aurora-meta-label" htmlFor="ask-host-hint">
                Host hint (optional)
              </label>
              <Input
                id="ask-host-hint"
                name="host"
                list="known-host-options"
                placeholder="Any host"
                value={hostHint}
                onChange={(event) => onHostHintChange(event.target.value)}
              />
              <datalist id="known-host-options">
                {knownHosts.map((host) => (
                  <option key={host} value={host} />
                ))}
              </datalist>
            </div>

            <div className="grid gap-1">
              <label className="aurora-meta-label" htmlFor="ask-since-hint">
                Window
              </label>
              <Select
                value={sinceHint || DEFAULT_WINDOW}
                onValueChange={(value) => onSinceHintChange(value === DEFAULT_WINDOW ? "" : value)}
              >
                <SelectTrigger id="ask-since-hint" aria-label="Window">
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_WINDOW}>Default</SelectItem>
                  <SelectItem value="15m">Last 15m</SelectItem>
                  <SelectItem value="1h">Last 1h</SelectItem>
                  <SelectItem value="6h">Last 6h</SelectItem>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7d</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" variant="aurora" disabled={askState === "pending"}>
              {askState === "pending" ? "Investigating..." : "Ask"}
            </Button>
          </div>
        </form>

        <div className="grid gap-2.5" data-answer-stack data-ask-state={askState} aria-live="polite">
          {statusMessage && claims.length === 0 && (
            <Card elevated={false}>
              <CardContent className="p-3 grid gap-1.5">
                <Badge tone={statusBadgeTone(statusMessage.tone)}>{statusMessage.badge}</Badge>
                <h2 className="m-0 text-[15px] font-bold">{statusMessage.title}</h2>
                <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
                  {statusMessage.body}
                </p>
              </CardContent>
            </Card>
          )}

          {claims.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {claims.slice(0, 6).map((claim, index) => {
                const selected = activeClaimIndex === index
                return (
                  <Card key={`${claim.title}-${index}`} elevated={false} accent={selected ? "cyan" : false}>
                    <CardContent className="p-3 grid gap-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge tone={claimBadgeTone(claim.claim_type)}>
                          {claim.claim_type.replaceAll("_", " ")}
                        </Badge>
                        <span className="aurora-mono text-[var(--aurora-text-muted)]">
                          {claim.confidence} · {claim.relationship_ids.length} rel ·{" "}
                          {claim.evidence_ids.length} ev
                        </span>
                      </div>
                      <h2 className="m-0 text-[14px] font-bold text-[var(--aurora-text-primary)]">
                        {claim.title}
                      </h2>
                      <p className="m-0 text-[13px] text-[var(--aurora-text-muted)] leading-relaxed">
                        {claim.summary}
                      </p>
                      {claim.claim_type !== "verified" && claim.claim_type !== "open_question" && (
                        <span className="text-[11px] text-[var(--aurora-warn)]">
                          Correlation signal — select to inspect supporting graph evidence.
                        </span>
                      )}
                      <div className="pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={selected ? "aurora" : "neutral"}
                          aria-pressed={selected}
                          onClick={() => onSelectClaim(claim, index)}
                        >
                          {selected ? "Selected claim" : "Inspect claim"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {candidates.length > 1 && (
            <Banner variant="warn" kind="tag">
              <div className="grid gap-2">
                <div className="text-xs">
                  <strong className="text-[var(--aurora-text-primary)]">
                    Ambiguous entity match:
                  </strong>{" "}
                  multiple candidate entities matched. Pivot into a specific entity to narrow the
                  graph:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((candidate) => (
                    <Button
                      key={candidate.id}
                      type="button"
                      size="sm"
                      shape="pill"
                      variant="neutral"
                      onClick={() => onSelectCandidate(candidate)}
                    >
                      <span>{candidate.label || candidate.key}</span>
                      <span className="aurora-mono text-[10px] text-[var(--aurora-text-muted)]">
                        {candidate.entity_type} · {candidate.trust_level}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            </Banner>
          )}

          {openQuestions.length > 0 && (
            <Card elevated={false}>
              <CardContent className="p-3 grid gap-1.5">
                <span className="aurora-meta-label">Open questions</span>
                <ul className="m-0 pl-4 grid gap-1 text-[13px] text-[var(--aurora-warn)]">
                  {openQuestions.map((question, index) => (
                    <li key={`${question}-${index}`}>{question}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {nextQueries.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="aurora-meta-label">Suggested next moves:</span>
              {nextQueries.map((suggestion, index) => (
                <Button
                  key={`${suggestion}-${index}`}
                  type="button"
                  size="sm"
                  shape="pill"
                  variant="neutral"
                  onClick={() => onRunSuggestedQuery(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
