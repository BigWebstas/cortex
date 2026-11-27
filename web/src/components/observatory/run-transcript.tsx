"use client"

import { useState } from "react"

import { Message, MessageContent } from "@/components/aurora/ai/message"
import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import { FilterSearch } from "@/components/ui/aurora/filter-bar"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { listEvents } from "../../lib/observatory/api"
import { transcriptEntry } from "../../lib/observatory/events"
import { usePagedList } from "../../lib/observatory/hooks"
import { LoadError, Toggle, When } from "./shared"

/** Newest page first from the server; shown oldest to newest. */
export function RunTranscript({ runKey }: { runKey: string }) {
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState("")
  const [hideTools, setHideTools] = useState(false)
  const list = usePagedList(`transcript:${runKey}:${search}`, (cursor) => async (token, options) => {
    const page = await listEvents(
      token,
      runKey,
      {
        cursor,
        limit: 100,
        kind: ["transcript", "provider_event"],
        include: "payload",
        query: search || undefined,
      },
      options,
    )
    return { items: page.events, pagination: page.pagination }
  })
  const entries = list.items
    .map((event) => ({ event, ...transcriptEntry(event) }))
    .reverse()
  const shown = hideTools ? entries.filter((entry) => entry.role !== "tool") : entries
  const hidden = entries.length - shown.length

  return (
    <div className="grid gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(draft.trim())
        }}
      >
        <FilterSearch
          aria-label="Search this transcript"
          placeholder="Search this transcript, then press Enter"
          maxLength={512}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClear={() => {
            setDraft("")
            setSearch("")
          }}
        />
        <Toggle pressed={hideTools} onToggle={() => setHideTools((value) => !value)}>
          Hide tool messages
        </Toggle>
        <Button type="button" size="sm" onClick={list.reload}>
          Refresh
        </Button>
      </form>
      {list.loading && <Skeleton className="h-40" />}
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && shown.length === 0 && (
        <EmptyState
          title="No messages"
          description={search ? "Nothing matches this search." : "No transcript has been observed."}
        />
      )}
      {list.hasMore && (
        <Button type="button" size="sm" onClick={list.loadMore} loading={list.loadingMore}>
          Load older messages
        </Button>
      )}
      <p className="m-0 text-xs text-[var(--aurora-text-muted)]" aria-live="polite">
        {shown.length} messages shown{hidden > 0 && `, ${hidden} tool messages hidden`}
      </p>
      <div
        className="grid max-h-[60vh] gap-3 overflow-y-auto px-1"
        tabIndex={0}
        role="region"
        aria-label="Transcript"
      >
        {shown.map(({ event, role, text, partial }) => (
          <Message
            key={event.id}
            role={role === "user" ? "user" : role === "assistant" ? "assistant" : "system"}
            data-speaker={role}
          >
            <MessageContent
              tone={role === "user" ? "user" : role === "assistant" ? "assistant" : "system"}
              className="min-w-0 max-w-full"
            >
              <span className="mb-1 block text-xs text-[var(--aurora-text-muted)]">
                {role === "unknown" ? "unknown speaker" : role} · <When value={event.observed_at} />
                {event.actor_key && ` · ${event.actor_key}`}
                {partial && " · shortened"}
              </span>
              <span className="block whitespace-pre-wrap break-words">{text}</span>
            </MessageContent>
          </Message>
        ))}
      </div>
    </div>
  )
}
