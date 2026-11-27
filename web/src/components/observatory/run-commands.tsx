"use client"

import { useState } from "react"

import { Terminal } from "@/components/aurora/terminal"
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
import { listEvents } from "../../lib/observatory/api"
import {
  type CommandEntry,
  type CommandFilter,
  commandEntry,
  matchesCommandFilter,
} from "../../lib/observatory/events"
import { usePagedList } from "../../lib/observatory/hooks"
import { LoadError, Toggle, When, toggled } from "./shared"

const FILTERS: Array<[CommandFilter, string]> = [
  ["failed", "Failed"],
  ["long", "Long-running"],
  ["git", "Git"],
]

function exitLabel(entry: CommandEntry) {
  if (entry.exitStatus === null) return "exit unknown"
  return `exit ${entry.exitStatus}`
}

function duration(entry: CommandEntry) {
  if (entry.durationMs === null) return "duration unknown"
  return entry.durationMs < 1000
    ? `${entry.durationMs} ms`
    : `${(entry.durationMs / 1000).toFixed(1)} s`
}

export function RunCommands({ runKey }: { runKey: string }) {
  const [filters, setFilters] = useState<CommandFilter[]>([])
  const list = usePagedList(`commands:${runKey}`, (cursor) => async (token, options) => {
    const page = await listEvents(
      token,
      runKey,
      { cursor, limit: 100, kind: ["command", "shell_history"], include: "payload" },
      options,
    )
    return { items: page.events, pagination: page.pagination }
  })
  const entries = list.items.map((event) => ({ event, entry: commandEntry(event) }))
  const shown = entries
    .filter(({ entry }) => filters.every((filter) => matchesCommandFilter(entry, filter)))
    .reverse()

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Command filters">
        {FILTERS.map(([filter, label]) => (
          <Toggle
            key={filter}
            pressed={filters.includes(filter)}
            onToggle={() => setFilters((current) => toggled(current, filter))}
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
      {!list.loading && !list.error && (
        // The server cannot filter on these, so say what was searched.
        <p className="m-0 text-xs text-[var(--aurora-text-muted)]" aria-live="polite">
          {shown.length} of {entries.length} loaded commands shown
          {list.hasMore && "; older commands are not loaded"}
        </p>
      )}
      {!list.loading && !list.error && shown.length === 0 && (
        <EmptyState title="No commands" description="No loaded command matches." />
      )}
      {list.hasMore && (
        <Button type="button" size="sm" onClick={list.loadMore} loading={list.loadingMore}>
          Load older commands
        </Button>
      )}
      <ul className="m-0 grid max-h-[60vh] list-none gap-1 overflow-y-auto p-0" aria-label="Commands">
        {shown.map(({ event, entry }) => (
          <li key={event.id} data-command-row>
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="plain"
                  size="unstyled"
                  className="block w-full rounded-lg border border-[var(--aurora-border-default)] p-2 text-left"
                >
                  <span className="aurora-mono block truncate text-sm">{entry.command}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--aurora-text-muted)]">
                    <Badge tone={entry.exitStatus ? "error" : "neutral"}>{exitLabel(entry)}</Badge>
                    <span>
                      {duration(entry)} · {entry.source} · <When value={event.observed_at} />
                    </span>
                  </span>
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Command detail</SheetTitle>
                  <SheetDescription>
                    {entry.scrubbed ? "Secrets were scrubbed before storage." : "Not scrubbed."}
                  </SheetDescription>
                </SheetHeader>
                <SheetBody className="grid content-start gap-3 overflow-y-auto">
                  <Terminal
                    title={entry.source}
                    status="idle"
                    lines={[{ text: entry.command, type: "command" }]}
                  />
                  <dl className="m-0 grid gap-2 text-sm">
                    {[
                      ["Directory", entry.cwd ?? "unknown"],
                      ["Result", exitLabel(entry)],
                      ["Duration", duration(entry)],
                      ["Started", event.observed_at],
                      ["Finished", entry.finishedAt ?? "unknown"],
                      ["Actor", event.actor_key ?? "unknown"],
                      ["Complete", entry.truncated ? "no, shortened" : "yes"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="aurora-text-eyebrow">{label}</dt>
                        <dd className="m-0 break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </SheetBody>
              </SheetContent>
            </Sheet>
          </li>
        ))}
      </ul>
    </div>
  )
}
