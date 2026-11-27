"use client"

import { useMemo, useState } from "react"

import { Badge, type BadgeTone } from "@/components/ui/aurora/badge"
import { Button } from "@/components/ui/aurora/button"
import { Card, CardContent, CardHeader } from "@/components/ui/aurora/card"
import { Input } from "@/components/ui/aurora/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/aurora/select"
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

function severityBadgeTone(value?: string): BadgeTone {
  const rank = severityRank(value)
  if (rank <= 3) return "error"
  if (rank === 4) return "warn"
  return "neutral"
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

  return (
    <section aria-label="Timeline and logs">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2.5 bg-[var(--aurora-panel-medium)]">
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
            <Select
              value={severityFilter}
              onValueChange={(value) => setSeverityFilter(value as "all" | "err" | "warn")}
            >
              <SelectTrigger
                id="timeline-severity-filter"
                aria-label="Filter severity"
                className="h-8 w-auto min-w-[124px] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="warn">Warn+</SelectItem>
                <SelectItem value="err">Err+</SelectItem>
              </SelectContent>
            </Select>

            <div className="w-[180px]">
              <Input
                id="timeline-text-filter"
                type="search"
                size="sm"
                aria-label="Filter log rows"
                placeholder="Filter host or message"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
              />
            </div>

            <Badge tone={statusTone} data-log-status>
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="grid gap-2 p-3" data-timeline>
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
                <Card
                  key={row.id ?? `${row.timestamp ?? row.received_at}-${index}`}
                  elevated={false}
                >
                  <CardContent className="p-3 grid grid-cols-1 gap-2 sm:grid-cols-[84px_84px_130px_minmax(0,1fr)] items-start">
                    <time className="aurora-mono text-[var(--aurora-text-muted)]">
                      {compactTime(row.timestamp || row.received_at)}
                    </time>
                    <Badge tone={severityBadgeTone(row.severity)}>
                      {row.severity || "unknown"}
                    </Badge>
                    <div className="min-w-0">
                      {host && connected ? (
                        <Button
                          type="button"
                          variant="plain"
                          size="unstyled"
                          className="aurora-mono text-left text-[var(--aurora-accent-strong)] hover:underline truncate max-w-full cursor-pointer"
                          title={`Investigate ${host}`}
                          onClick={() => onPivotHost(host)}
                        >
                          {host}
                        </Button>
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
                        <span className="aurora-mono ml-1.5 text-[var(--aurora-warn)]">
                          [truncated]
                        </span>
                      )}
                    </span>
                  </CardContent>
                </Card>
              )
            })
          )}
        </CardContent>
      </Card>
    </section>
  )
}
