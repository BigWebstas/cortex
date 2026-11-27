"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/aurora/badge"
import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/aurora/sheet"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { type ActivityKind, activityEntry } from "../../lib/observatory/activity"
import { listEvents } from "../../lib/observatory/api"
import { usePagedList } from "../../lib/observatory/hooks"
import { LoadError, Toggle, When, toggled } from "./shared"

const KINDS: Array<[ActivityKind, string]> = [
  ["mcp", "MCP"],
  ["hook", "Hooks"],
  ["skill", "Skills"],
  ["llm", "Model calls"],
]

export function RunActivity({ runKey }: { runKey: string }) {
  const [chosen, setChosen] = useState<ActivityKind[]>([])
  const kinds = chosen.length ? chosen : KINDS.map(([kind]) => kind)
  const list = usePagedList(`activity:${runKey}:${kinds.join(",")}`, (cursor) => async (token, options) => {
    const page = await listEvents(
      token,
      runKey,
      { cursor, limit: 100, kind: kinds, include: "payload" },
      options,
    )
    return { items: page.events, pagination: page.pagination }
  })

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Activity kinds">
        {KINDS.map(([kind, label]) => (
          <Toggle
            key={kind}
            pressed={chosen.includes(kind)}
            onToggle={() => setChosen((current) => toggled(current, kind))}
          >
            {label}
          </Toggle>
        ))}
        <Button type="button" size="sm" onClick={list.reload}>
          Refresh
        </Button>
      </div>
      {list.loading && <Skeleton className="h-40" />}
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && list.items.length === 0 && (
        <EmptyState title="No activity" description="Nothing of these kinds was observed." />
      )}
      <ul className="m-0 grid max-h-[60vh] list-none gap-1 overflow-y-auto p-0" aria-label="Activity">
        {list.items.map((event) => {
          const entry = activityEntry(event)
          return (
            <li key={event.id} data-activity-row>
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="plain"
                    size="unstyled"
                    className="block w-full rounded-lg border border-[var(--aurora-border-default)] p-2 text-left"
                  >
                    <span className="block truncate text-sm font-semibold">{entry.name}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--aurora-text-muted)]">
                      <Badge tone="neutral">{entry.kind}</Badge>
                      <Badge tone={entry.failed ? "error" : "neutral"}>{entry.result}</Badge>
                      <span>
                        {entry.durationMs !== null && `${entry.durationMs} ms · `}
                        <When value={event.observed_at} />
                      </span>
                    </span>
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>{entry.name}</SheetTitle>
                    <SheetDescription>
                      {entry.truncated
                        ? "The details were too large to store."
                        : `${entry.kind} activity, ${entry.result}`}
                    </SheetDescription>
                  </SheetHeader>
                  <SheetBody className="grid content-start gap-3 overflow-y-auto">
                    {entry.details.length === 0 && <p className="m-0 text-sm">No details recorded.</p>}
                    {entry.details.map(([label, value]) => (
                      <section key={label} className="grid gap-1">
                        <h3 className="aurora-text-eyebrow m-0">{label}</h3>
                        <pre
                          className="aurora-mono m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs"
                          tabIndex={0}
                        >
                          {value}
                        </pre>
                      </section>
                    ))}
                  </SheetBody>
                </SheetContent>
              </Sheet>
            </li>
          )
        })}
      </ul>
      {list.hasMore && (
        <Button type="button" size="sm" onClick={list.loadMore} loading={list.loadingMore}>
          Load older activity
        </Button>
      )}
    </div>
  )
}
