"use client"

import { Button } from "@/components/ui/aurora/button"
import { DataTable } from "@/components/ui/aurora/data-table"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { getRunTelemetry } from "../../lib/observatory/api"
import { usePagedList } from "../../lib/observatory/hooks"
import { formatNanos, metricSummaries, spanTree } from "../../lib/observatory/telemetry"
import { thisRun } from "../../lib/observatory/live-context"
import { LoadError } from "./shared"

const PAGE = 200

export function RunTelemetry({ runKey }: { runKey: string }) {
  // The route pages spans and metrics independently.
  const spans = usePagedList(`spans:${runKey}`, (cursor) => async (token, options) => {
    const [page] = await getRunTelemetry(
      token,
      runKey,
      { span_cursor: cursor, span_limit: PAGE, metric_limit: 1 },
      options,
    )
    return page
  }, thisRun(runKey))
  const metrics = usePagedList(`metrics:${runKey}`, (cursor) => async (token, options) => {
    const [, page] = await getRunTelemetry(
      token,
      runKey,
      { metric_cursor: cursor, metric_limit: PAGE, span_limit: 1 },
      options,
    )
    return page
  }, thisRun(runKey))
  const rows = spanTree(spans.items)
  const summaries = metricSummaries(metrics.items)

  return (
    <div className="grid gap-4">
      <section className="grid gap-2" aria-label="Trace spans">
        <div className="flex items-center justify-between gap-2">
          <h3 className="aurora-text-eyebrow m-0">Trace spans</h3>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              spans.reload()
              metrics.reload()
            }}
          >
            Refresh
          </Button>
        </div>
        {spans.loading && <Skeleton className="h-24" />}
        {spans.error && <LoadError message={spans.error} onRetry={spans.reload} />}
        {!spans.loading && !spans.error && rows.length === 0 && (
          <EmptyState title="No spans" description="No traces have been related to this run." />
        )}
        <ol className="m-0 grid max-h-[40vh] list-none gap-1 overflow-y-auto p-0" tabIndex={0} aria-label="Spans">
          {rows.map(({ span, depth, offsetPercent, widthPercent }) => (
            <li key={span.id} data-span-row data-depth={depth} className="grid gap-1">
              <span className="text-sm" style={{ paddingLeft: Math.min(depth, 8) * 16 }}>
                <span className="font-semibold">{span.name}</span>{" "}
                <span className="text-xs text-[var(--aurora-text-muted)]">
                  {formatNanos(span.duration_nano)}
                  {span.service_name && ` · ${span.service_name}`}
                  {span.status_code === 2 && ` · error ${span.status_message ?? ""}`}
                </span>
              </span>
              {/* Decorative: the nesting and duration are in the text above. */}
              <span aria-hidden="true" className="relative block h-1.5 rounded bg-[var(--aurora-panel-strong)]">
                <span
                  className="absolute h-full min-w-[2px] rounded"
                  style={{
                    left: `${offsetPercent}%`,
                    width: `${widthPercent}%`,
                    background:
                      span.status_code === 2
                        ? "var(--aurora-error)"
                        : "var(--aurora-accent-primary)",
                  }}
                />
              </span>
            </li>
          ))}
        </ol>
        {spans.hasMore && (
          <Button type="button" size="sm" onClick={spans.loadMore} loading={spans.loadingMore}>
            Load older spans
          </Button>
        )}
      </section>
      <section className="grid gap-2" aria-label="Metrics">
        <h3 className="aurora-text-eyebrow m-0">Metrics, from loaded points</h3>
        {metrics.loading && <Skeleton className="h-24" />}
        {metrics.error && <LoadError message={metrics.error} onRetry={metrics.reload} />}
        {!metrics.loading && !metrics.error && summaries.length === 0 && (
          <EmptyState title="No metrics" description="No metrics have been related to this run." />
        )}
        {summaries.length > 0 && (
          <DataTable
            data={summaries.map((summary) => ({ ...summary }))}
            columns={[
              { key: "name", label: "Metric", sortable: true },
              { key: "latest", label: "Latest value" },
              { key: "unit", label: "Unit" },
              { key: "kind", label: "Kind" },
              { key: "points", label: "Points", numeric: true, sortable: true },
            ]}
          />
        )}
        {metrics.hasMore && (
          <Button type="button" size="sm" onClick={metrics.loadMore} loading={metrics.loadingMore}>
            Load older metric points
          </Button>
        )}
      </section>
    </div>
  )
}
