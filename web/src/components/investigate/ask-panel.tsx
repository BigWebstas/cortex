"use client"

import type { FormEvent } from "react"

import type { AppEntitySummary, InvestigationClaim } from "../../contracts/investigation"

export interface StatusCardMessage {
  tone: "violet" | "success" | "warn" | "error"
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

function claimBadgeTone(claimType: InvestigationClaim["claim_type"]): string {
  switch (claimType) {
    case "verified":
      return "aurora-badge-success"
    case "open_question":
    case "weak_correlation":
      return "aurora-badge-warn"
    default:
      return "aurora-badge-violet"
  }
}

function statusBadgeTone(tone: StatusCardMessage["tone"]): string {
  switch (tone) {
    case "success":
      return "aurora-badge-success"
    case "warn":
      return "aurora-badge-warn"
    case "error":
      return "aurora-badge-error"
    default:
      return "aurora-badge-violet"
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
    <section className="aurora-surface p-3.5 grid gap-3" aria-label="Ask and explain">
      <form className="grid gap-2.5" data-ask-form onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_180px_130px_auto] items-end">
          <div className="grid gap-1">
            <label className="aurora-meta-label" htmlFor="ask-input">
              Ask Cortex
            </label>
            <input
              id="ask-input"
              name="query"
              type="search"
              className="aurora-input"
              placeholder="Why did this host start failing or OOMing?"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </div>

          <div className="grid gap-1">
            <label className="aurora-meta-label" htmlFor="ask-host-hint">
              Host hint (optional)
            </label>
            <input
              id="ask-host-hint"
              name="host"
              list="known-host-options"
              className="aurora-input"
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
            <select
              id="ask-since-hint"
              name="since"
              className="aurora-select"
              value={sinceHint}
              onChange={(event) => onSinceHintChange(event.target.value)}
            >
              <option value="">Default</option>
              <option value="15m">Last 15m</option>
              <option value="1h">Last 1h</option>
              <option value="6h">Last 6h</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
            </select>
          </div>

          <button type="submit" className="aurora-btn-primary" disabled={askState === "pending"}>
            {askState === "pending" ? "Investigating..." : "Ask"}
          </button>
        </div>
      </form>

      <div className="grid gap-2.5" data-answer-stack data-ask-state={askState} aria-live="polite">
        {statusMessage && claims.length === 0 && (
          <article className="aurora-card grid gap-1.5">
            <span className={`aurora-badge ${statusBadgeTone(statusMessage.tone)}`}>
              {statusMessage.badge}
            </span>
            <h2 className="m-0 text-[15px] font-bold">{statusMessage.title}</h2>
            <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">{statusMessage.body}</p>
          </article>
        )}

        {claims.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {claims.slice(0, 6).map((claim, index) => {
              const selected = activeClaimIndex === index
              return (
                <button
                  key={`${claim.title}-${index}`}
                  type="button"
                  className={`aurora-card aurora-card-interactive grid gap-1.5 ${
                    selected ? "aurora-card-selected" : ""
                  }`}
                  onClick={() => onSelectClaim(claim, index)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`aurora-badge ${claimBadgeTone(claim.claim_type)}`}>
                      {claim.claim_type.replaceAll("_", " ")}
                    </span>
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
                </button>
              )
            })}
          </div>
        )}

        {candidates.length > 1 && (
          <div className="aurora-banner aurora-banner-warn flex-col gap-2">
            <div className="text-xs">
              <strong>Ambiguous entity match:</strong> multiple candidate entities matched. Pivot
              into a specific entity to narrow the graph:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="aurora-chip"
                  onClick={() => onSelectCandidate(candidate)}
                >
                  <span>{candidate.label || candidate.key}</span>
                  <span className="aurora-mono text-[10px] text-[var(--aurora-text-muted)]">
                    {candidate.entity_type} · {candidate.trust_level}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {openQuestions.length > 0 && (
          <div className="aurora-card grid gap-1.5">
            <span className="aurora-meta-label">Open questions</span>
            <ul className="m-0 pl-4 grid gap-1 text-[13px] text-[var(--aurora-warn)]">
              {openQuestions.map((question, index) => (
                <li key={`${question}-${index}`}>{question}</li>
              ))}
            </ul>
          </div>
        )}

        {nextQueries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="aurora-meta-label">Suggested next moves:</span>
            {nextQueries.map((suggestion, index) => (
              <button
                key={`${suggestion}-${index}`}
                type="button"
                className="aurora-chip"
                onClick={() => onRunSuggestedQuery(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
