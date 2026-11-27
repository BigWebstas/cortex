"use client"

import { useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import { FilterSearch } from "@/components/ui/aurora/filter-bar"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { StatusIndicator } from "@/components/ui/aurora/status-indicator"
import type { RunStatus } from "../../../../docs/contracts/agent-observatory-types"
import { listRuns } from "../../lib/observatory/api"
import { usePagedList, useRoute } from "../../lib/observatory/hooks"
import { STATUS_TONES } from "../../lib/observatory/view"
import { anyRun } from "../../lib/observatory/live-context"
import { LoadError, Toggle, When, toggled } from "./shared"

const FILTERABLE: RunStatus[] = ["active", "waiting", "idle", "stale", "completed", "failed"]

/** A text filter that updates the URL shortly after typing stops. */
function TextFilter({
  label,
  value,
  onCommit,
  inputRef,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  // Follow the URL when it changes from outside, such as the Back button.
  if (value !== committed) {
    setCommitted(value)
    setDraft(value)
  }
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })
  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => commit.current(draft), 300)
    return () => clearTimeout(timer)
  }, [draft, value])

  return (
    <FilterSearch
      ref={inputRef}
      aria-label={label}
      placeholder={label}
      maxLength={512}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onClear={() => setDraft("")}
    />
  )
}

export function RunList() {
  const { route, navigate } = useRoute()
  const search = useRef<HTMLInputElement>(null)
  const filters = {
    repository_id: route.repository ?? undefined,
    worktree_id: route.worktree ?? undefined,
    status: route.statuses,
    tool: route.tools,
    host: route.host ?? undefined,
    query: route.query ?? undefined,
    active_only: route.activeOnly || undefined,
  }
  const list = usePagedList(`runs:${JSON.stringify(filters)}`, (cursor) => async (token, options) => {
    const page = await listRuns(token, { ...filters, cursor, limit: 100 }, options)
    return { items: page.runs, pagination: page.pagination }
  }, anyRun)

  const scroller = useRef<HTMLDivElement>(null)
  // The virtualizer returns functions that React Compiler cannot memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: list.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 76,
    overscan: 8,
    getItemKey: (index) => list.items[index].run_key,
  })

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== "/" || target.closest("input, textarea, [contenteditable]")) return
      event.preventDefault()
      search.current?.focus()
    }
    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

  return (
    <section className="grid gap-2 content-start" aria-label="Runs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="aurora-text-section m-0">Runs</h2>
        <Button type="button" size="sm" onClick={list.reload}>
          Refresh
        </Button>
      </div>
      <TextFilter
        label="Search runs"
        inputRef={search}
        value={route.query ?? ""}
        onCommit={(query) => navigate({ query: query || null }, { replace: true })}
      />
      <TextFilter
        label="Filter by tool"
        value={route.tools[0] ?? ""}
        onCommit={(tool) => navigate({ tools: tool ? [tool] : [] }, { replace: true })}
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Run status">
        <Toggle
          pressed={route.activeOnly}
          onToggle={() => navigate({ activeOnly: !route.activeOnly })}
        >
          Active only
        </Toggle>
        {FILTERABLE.map((status) => (
          <Toggle
            key={status}
            pressed={route.statuses.includes(status)}
            onToggle={() => navigate({ statuses: toggled(route.statuses, status) })}
          >
            {status}
          </Toggle>
        ))}
      </div>
      {list.loading && <Skeleton className="h-24" />}
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && list.items.length === 0 && (
        <EmptyState title="No runs" description="No agent runs match these filters." />
      )}
      <div ref={scroller} className="max-h-[60vh] overflow-y-auto" data-run-scroller>
        <ul className="relative m-0 list-none p-0" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const run = list.items[row.index]
            const selected = route.run === run.run_key
            return (
              <li
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                data-run-row
                className="absolute left-0 top-0 w-full pb-1"
                style={{ transform: `translateY(${row.start}px)` }}
                aria-setsize={list.items.length}
                aria-posinset={row.index + 1}
              >
                <Button
                  type="button"
                  variant="plain"
                  size="unstyled"
                  className="block w-full rounded-lg border border-[var(--aurora-border-default)] p-2 text-left"
                  style={selected ? { background: "var(--aurora-hover-bg)" } : undefined}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => navigate({ run: run.run_key })}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {run.tool} · {run.native_session_id}
                    </span>
                    <StatusIndicator tone={STATUS_TONES[run.status]} label={run.status} />
                  </span>
                  <span className="block truncate text-xs text-[var(--aurora-text-muted)]">
                    {run.primary_branch ?? "no branch"} · {run.hostname} ·{" "}
                    <When value={run.last_activity_at} />
                    {run.error_count > 0 && ` · ${run.error_count} errors`}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      </div>
      {list.hasMore && (
        <Button type="button" onClick={list.loadMore} loading={list.loadingMore}>
          Load more runs
        </Button>
      )}
    </section>
  )
}
