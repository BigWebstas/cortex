"use client"

import { useMemo, useState } from "react"

import type { AppLogSummary } from "../../contracts/investigation"

export interface TimelinePanelProps {
  logs: AppLogSummary[]
  statusLabel: string
  statusTone: "neutral" | "success" | "warn" | "error"
  connected: boolean
  onPivotHost: (hostname: string) => void
}

const SEVERITY_RANK: Record<string, number> = {
  emerg: 0,
  emergency: 0,
  alert: 1,
  crit: 2,
  critical: 2,
  err: 3,
  error: 3,
  warn: 4,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
}

function severityRank(value?: string): number {
  if (!value) return 6
  return SEVERITY_RANK[value.toLowerCase()] ?? 6
}

function severityBadgeClass(value?: string): string {
  const rank = severityRank(value)
  if (rank <= 3) return "aurora-badge-error"
  if (rank === 4) return "aurora-badge-warn"
  return "aurora-badge-neutral"
}

export function compactTime(value?: string): string {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 19)
  return date.toISOString().slice(11, 19)
}

export function TimelinePanel({
  logs,
  statusLabel,
  statusTone,
  connected,
  onPivotHost,
}: TimelinePanelProps) {
  const [severityFilter, setSeverityFilter] = useState<"all" | "err" | "warn">("all")
  const [textFilter, setTextFilter] = useState("")

  const filteredLogs = useMemo(() => {
    const query = textFilter.trim().toLowerCase()
    return logs
      .filter((row) => {
        if (severityFilter === "err" && severityRank(row.severity) > 3) return false
        if (severityFilter === "warn" && severityRank(row.severity) > 4) return false
        if (!query) return true
        const haystack = [row.hostname, row.host, row.app_name, row.severity, row.message, row.raw]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, 40)
  }, [logs, severityFilter, textFilter])

  const badgeToneClass =
    statusTone === "success"
      ? "aurora-badge-success"
      : statusTone === "warn"
        ? "aurora-badge-warn"
        : statusTone === "error"
          ? "aurora-badge-error"
          : "aurora-badge-neutral"

  return (
    <section className="aurora-surface overflow-hidden" aria-label="Timeline and logs">
      <div className="aurora-panel-head">
        <div>
          <span className="aurora-meta-label">Timeline &amp; log context</span>
          <h2 className="m-0 text-[15px] font-bold">
            Recent log strip{" "}
            <span className="aurora-mono font-normal text-[var(--aurora-text-muted)]">
              ({filteredLogs.length} of {logs.length})
            </span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="timeline-severity-filter">
            Filter severity
          </label>
          <select
            id="timeline-severity-filter"
            className="aurora-select !w-auto !py-1 !text-xs"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as "all" | "err" | "warn")}
          >
            <option value="all">All severities</option>
            <option value="warn">Warn+</option>
            <option value="err">Err+</option>
          </select>

          <label className="sr-only" htmlFor="timeline-text-filter">
            Filter log rows
          </label>
          <input
            id="timeline-text-filter"
            type="search"
            className="aurora-input !w-[180px] !py-1 !text-xs"
            placeholder="Filter host or message"
            value={textFilter}
            onChange={(event) => setTextFilter(event.target.value)}
          />

          <span className={`aurora-badge ${badgeToneClass}`} data-log-status>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="grid gap-2 p-3" data-timeline>
        {filteredLogs.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--aurora-text-muted)]">
            {connected
              ? "No log rows match the current investigation or filter."
              : "Live rows appear after connecting with a bearer token."}
          </p>
        ) : (
          filteredLogs.map((row, index) => {
            const host = row.hostname || row.host || ""
            return (
              <article
                key={row.id ?? `${row.timestamp ?? row.received_at}-${index}`}
                className="aurora-card grid grid-cols-1 gap-2 sm:grid-cols-[84px_84px_130px_minmax(0,1fr)] items-start"
              >
                <time className="aurora-mono text-[var(--aurora-text-muted)]">
                  {compactTime(row.timestamp || row.received_at)}
                </time>
                <span className={`aurora-badge ${severityBadgeClass(row.severity)}`}>
                  {row.severity || "unknown"}
                </span>
                <div className="min-w-0">
                  {host && connected ? (
                    <button
                      type="button"
                      className="aurora-mono text-left text-[var(--aurora-accent-strong)] hover:underline truncate max-w-full cursor-pointer bg-transparent border-0 p-0"
                      title={`Investigate ${host}`}
                      onClick={() => onPivotHost(host)}
                    >
                      {host}
                    </button>
                  ) : (
                    <span className="aurora-mono text-[var(--aurora-text-muted)] truncate block">
                      {host || "--"}
                    </span>
                  )}
                  {row.app_name && (
                    <span className="aurora-mono text-[10px] text-[var(--aurora-text-muted)] block truncate">
                      {row.app_name}
                    </span>
                  )}
                </div>
                <span className="text-[13px] text-[var(--aurora-text-primary)] break-words">
                  {row.message || row.raw || ""}
                  {row.message_truncated && (
                    <span className="aurora-mono ml-1.5 text-[var(--aurora-warn)]">[truncated]</span>
                  )}
                </span>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}
