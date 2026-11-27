// Keeps the page current: take a cursor, follow the stream from it, tell the
// views what changed, and start again from a new cursor after a reset.

import { ObservatoryApiError } from "./api"
import type { FollowOptions, StreamEnd } from "./stream"

export type LiveState = "connecting" | "live" | "reconnecting" | "unavailable" | "stopped"

export interface LiveChange {
  /** Anything may have changed, because updates could have been missed. */
  all: boolean
  runKeys: Set<string>
  /** Repositories or worktrees changed. */
  inventory: boolean
}

const BATCH_MS = 300
const RETRY_MS = 3_000
const MAX_RETRY_MS = 30_000
const RESET_WINDOW_MS = 60_000
// This many resets in a window are retried at once; more are spaced out.
const FREE_RESETS = 2

export interface LiveOptions {
  token: string
  signal: AbortSignal
  /** The stream cursor from a snapshot taken now. */
  snapshotCursor: (signal: AbortSignal) => Promise<string>
  follow: (options: FollowOptions) => Promise<StreamEnd>
  /** The views may load: updates from here on will be reported. */
  onReady: () => void
  onChange: (change: LiveChange) => void
  onState: (state: LiveState) => void
  onUnauthorized: () => void
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  now?: () => number
  /** Runs a task later and returns a way to cancel it. */
  schedule?: (task: () => void, milliseconds: number) => () => void
}

function scheduleTimeout(task: () => void, milliseconds: number) {
  const timer = setTimeout(task, milliseconds)
  return () => clearTimeout(timer)
}

export async function runLive(options: LiveOptions): Promise<void> {
  const { signal, onState } = options
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? scheduleTimeout
  // Assigned inside callbacks, so held in an object the compiler cannot narrow.
  const batch: { pending: LiveChange | null; cancel: (() => void) | null } = {
    pending: null,
    cancel: null,
  }
  let shown = false
  let resets: number[] = []

  const flush = () => {
    const change = batch.pending
    batch.pending = null
    batch.cancel = null
    if (change && !signal.aborted) options.onChange(change)
  }
  const show = () => {
    if (!shown) options.onReady()
    shown = true
  }

  try {
    while (!signal.aborted) {
      onState("connecting")
      let cursor: string
      try {
        cursor = await options.snapshotCursor(signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ObservatoryApiError && [401, 403].includes(error.status)) {
          options.onUnauthorized()
          return
        }
        // The views can still load and refresh by hand.
        show()
        onState("unavailable")
        await options.sleep(RETRY_MS, signal)
        continue
      }
      // Views already on screen may predate this cursor, so refresh them.
      if (shown) options.onChange({ all: true, runKeys: new Set(), inventory: true })
      show()

      const end = await options.follow({
        token: options.token,
        signal,
        after: cursor,
        onStatus: (status) => onState(status.state),
        onEvent: (envelope) => {
          const pending = (batch.pending ??= {
            all: false,
            runKeys: new Set<string>(),
            inventory: false,
          })
          if (envelope.run_key) pending.runKeys.add(envelope.run_key)
          if (envelope.event === "repository.updated" || envelope.event === "worktree.updated") {
            pending.inventory = true
          }
          batch.cancel ??= schedule(flush, BATCH_MS)
        },
      })
      if (end.kind === "aborted") return
      if (end.kind === "unauthorized") {
        options.onUnauthorized()
        return
      }
      if (end.kind === "rejected") {
        onState("stopped")
        return
      }
      // The full refresh that follows covers anything still batched.
      batch.cancel?.()
      batch.cancel = null
      batch.pending = null
      const at = now()
      resets = [...resets.filter((time) => at - time < RESET_WINDOW_MS), at]
      if (resets.length > FREE_RESETS) {
        onState("reconnecting")
        const delay = 1_000 * 2 ** (resets.length - FREE_RESETS - 1)
        await options.sleep(Math.min(delay, MAX_RETRY_MS), signal)
      }
    }
  } finally {
    if (signal.aborted) batch.cancel?.()
  }
}

/**
 * Applies a fresh first page. With one page loaded the result is exact; older
 * pages that were loaded are kept below the new entries.
 */
export function mergePages<T extends { id: string }>(
  current: T[],
  first: T[],
  loadedPages: number,
): T[] {
  if (loadedPages <= 1) return first
  const fresh = new Set(first.map((item) => item.id))
  return [...first, ...current.filter((item) => !fresh.has(item.id))]
}
