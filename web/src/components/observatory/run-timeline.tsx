"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { Timeline, TimelineItem } from "@/components/ui/aurora/timeline"
import type {
  AgentEventKind,
  AgentRunEvent,
} from "../../../../docs/contracts/agent-observatory-types"
import { listEvents } from "../../lib/observatory/api"
import { errorText, useAuthorizedCall, useRoute } from "../../lib/observatory/hooks"
import { thisRun, useLiveRefresh } from "../../lib/observatory/live-context"
import { mergeEvents } from "../../lib/observatory/view"
import { LoadError, Toggle, When, toggled } from "./shared"

const PAGE_SIZE = 200
const AT_END_PIXELS = 24
const ANCHOR_FRAMES = 30

/** Distance from the top of the scroller to one event row, if it is mounted. */
function rowOffset(scroller: HTMLElement, id: string): number | null {
  const row = scroller.querySelector(`[data-event-id="${CSS.escape(id)}"]`)
  return row ? row.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null
}

const distanceFromEnd = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight

/**
 * Keeps the newest row in view while rows are measured, and gives up as soon as
 * something else scrolls away. The virtualizer's `scrollToIndex` is not used: it
 * keeps retrying and pulls the reader back. Returns a function that stops.
 */
function holdEnd(scroller: HTMLElement): () => void {
  let frames = ANCHOR_FRAMES
  let request = 0
  scroller.scrollTop = scroller.scrollHeight
  let placed = scroller.scrollTop
  const adjust = () => {
    const movedAway =
      scroller.scrollTop < placed - 1 && distanceFromEnd(scroller) >= AT_END_PIXELS
    if (movedAway) return
    scroller.scrollTop = scroller.scrollHeight
    placed = scroller.scrollTop
    if (--frames > 0) request = requestAnimationFrame(adjust)
  }
  request = requestAnimationFrame(adjust)
  return () => cancelAnimationFrame(request)
}

/**
 * Holds a row still while rows added above it are measured and replace their
 * estimated heights. Measuring can push the row out of the rendered range, so
 * jump back to its estimated start until it is mounted. Returns a function that
 * stops.
 */
function holdRow(
  scroller: HTMLElement,
  id: string,
  offset: number,
  estimatedStart: () => number | undefined,
): () => void {
  let frames = ANCHOR_FRAMES
  let request = 0
  const adjust = () => {
    const current = rowOffset(scroller, id)
    if (current === null) {
      const start = estimatedStart()
      if (start !== undefined) scroller.scrollTop = start - offset
    } else if (Math.abs(current - offset) >= 1) {
      scroller.scrollTop += current - offset
    }
    if (--frames > 0) request = requestAnimationFrame(adjust)
  }
  request = requestAnimationFrame(adjust)
  return () => cancelAnimationFrame(request)
}

interface History {
  /** Oldest first. */
  events: AgentRunEvent[]
  older: string | null
}

/** Mount with a key of the run and kind filter so state never crosses them. */
export function RunTimeline({ runKey, kinds }: { runKey: string; kinds: AgentEventKind[] }) {
  const call = useAuthorizedCall()
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const kindKey = kinds.join(",")

  const fetchPage = useCallback(
    (cursor: string | null) =>
      call((token, options) =>
        listEvents(
          token,
          runKey,
          {
            cursor,
            limit: PAGE_SIZE,
            kind: kindKey ? (kindKey.split(",") as AgentEventKind[]) : [],
          },
          options,
        ),
      ),
    [call, runKey, kindKey],
  )

  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  // The row to keep in place after older events are added above it.
  const anchor = useRef<{ id: string; offset: number } | null>(null)
  const events = history?.events ?? []
  // The virtualizer returns functions that React Compiler cannot memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 84,
    overscan: 8,
    getItemKey: (index) => events[index].id,
  })

  const loadLatest = useCallback(() => {
    fetchPage(null)
      .then((page) => {
        setError(null)
        setHistory((previous) => {
          const incoming = [...page.events].reverse()
          if (!previous) {
            return { events: mergeEvents([], incoming), older: page.pagination.next_cursor }
          }
          const merged = mergeEvents(previous.events, incoming)
          const added = merged.length - previous.events.length
          // With no overlap there may be a hole, so start again from the newest page.
          if (added === incoming.length && page.pagination.next_cursor && previous.events.length) {
            return { events: mergeEvents([], incoming), older: page.pagination.next_cursor }
          }
          if (added && !following.current) setUnseen((count) => count + added)
          return { ...previous, events: merged }
        })
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException)) setError(errorText(caught))
      })
  }, [fetchPage])

  useEffect(loadLatest, [loadLatest])
  useLiveRefresh(thisRun(runKey), loadLatest)

  const loadOlder = () => {
    if (!history?.older || busy) return
    setBusy(true)
    fetchPage(history.older)
      .then((page) => {
        const element = scroller.current
        const first = virtualizer
          .getVirtualItems()
          .find((item) => item.end > (element?.scrollTop ?? 0))
        const id = first && history.events[first.index].id
        const offset = element && id ? rowOffset(element, id) : null
        if (id && offset !== null) anchor.current = { id, offset }
        following.current = false
        setError(null)
        setHistory((previous) =>
          previous && {
            events: mergeEvents(previous.events, page.events),
            older: page.pagination.next_cursor,
          },
        )
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException)) setError(errorText(caught))
      })
      .finally(() => setBusy(false))
  }

  const stopFollowing = useRef<(() => void) | null>(null)
  const goToEnd = useCallback(() => {
    following.current = true
    setUnseen(0)
    stopFollowing.current?.()
    if (scroller.current) stopFollowing.current = holdEnd(scroller.current)
  }, [])
  useEffect(() => () => stopFollowing.current?.(), [])

  useLayoutEffect(() => {
    const kept = anchor.current
    anchor.current = null
    if (kept && scroller.current) {
      const index = history?.events.findIndex((item) => item.id === kept.id) ?? -1
      if (index < 0) return
      // Jump close enough to mount the row, then correct it from the page. The
      // virtualizer's scrollToIndex keeps re-aligning and would fight this.
      const estimatedStart = () => virtualizer.getOffsetForIndex(index, "start")?.[0]
      const start = estimatedStart()
      if (start !== undefined) scroller.current.scrollTop = start - kept.offset
      return holdRow(scroller.current, kept.id, kept.offset, estimatedStart)
    } else if (following.current && history?.events.length && scroller.current) {
      return holdEnd(scroller.current)
    }
  }, [history, virtualizer])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== "L" || !event.shiftKey || target.closest("input, textarea")) return
      goToEnd()
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [goToEnd])

  if (!history) {
    return error ? <LoadError message={error} onRetry={loadLatest} /> : <Skeleton className="h-40" />
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {history.older && (
          <Button type="button" size="sm" onClick={loadOlder} loading={busy}>
            Load older events
          </Button>
        )}
        <Button type="button" size="sm" onClick={loadLatest}>
          Check for new events
        </Button>
        {unseen > 0 && (
          <Button type="button" size="sm" variant="aurora" onClick={goToEnd}>
            Return to live ({unseen} new)
          </Button>
        )}
        <span className="text-xs text-[var(--aurora-text-muted)]" aria-live="polite">
          {events.length} events loaded
        </span>
      </div>
      {error && <LoadError message={error} onRetry={loadLatest} />}
      {events.length === 0 && (
        <EmptyState title="No events" description="No events match this filter." />
      )}
      <div
        ref={scroller}
        className="max-h-[55vh] overflow-y-auto px-1"
        data-timeline-scroller
        tabIndex={0}
        role="region"
        aria-label="Run timeline"
        onScroll={(event) => {
          const element = event.currentTarget
          following.current = distanceFromEnd(element) < AT_END_PIXELS
          if (following.current) setUnseen(0)
        }}
      >
        <Timeline className="relative m-0 list-none p-0" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const event = events[row.index]
            return (
              <TimelineItem
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                data-event-id={event.id}
                className="!absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
                aria-setsize={events.length}
                aria-posinset={row.index + 1}
                tone={event.severity === "error" || event.severity === "err" ? "error" : "queued"}
                title={<span className="break-words">{event.title}</span>}
                meta={
                  <>
                    {event.kind.replace("_", " ")} · {event.severity} ·{" "}
                    <When value={event.observed_at} />
                    {event.actor_key && ` · ${event.actor_key}`}
                  </>
                }
              >
                <span className="block whitespace-pre-wrap break-words">{event.summary}</span>
              </TimelineItem>
            )
          })}
        </Timeline>
      </div>
    </div>
  )
}

export function TimelineFilters({ available }: { available: AgentEventKind[] }) {
  const { route, navigate } = useRoute()
  if (available.length < 2 && route.kinds.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Event kinds">
      {[...new Set([...available, ...route.kinds])].sort().map((kind) => (
        <Toggle
          key={kind}
          pressed={route.kinds.includes(kind)}
          onToggle={() => navigate({ kinds: toggled(route.kinds, kind) })}
        >
          {kind.replace("_", " ")}
        </Toggle>
      ))}
    </div>
  )
}
