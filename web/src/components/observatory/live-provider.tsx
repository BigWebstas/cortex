"use client"

import { type ReactNode, useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/aurora/button"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { StatusIndicator } from "@/components/ui/aurora/status-indicator"
import { listRuns } from "../../lib/observatory/api"
import { useAuth } from "../../lib/observatory/auth-context"
import { LiveContext, createLiveBus } from "../../lib/observatory/live-context"
import { type LiveState, runLive } from "../../lib/observatory/live"
import { followRunStream, sleepUntilAborted } from "../../lib/observatory/stream"

const LABELS: Record<LiveState, { tone: "online" | "syncing" | "degraded" | "offline"; text: string }> = {
  connecting: { tone: "syncing", text: "Connecting live updates" },
  live: { tone: "online", text: "Live updates on" },
  reconnecting: { tone: "degraded", text: "Reconnecting; the page may be out of date" },
  unavailable: { tone: "degraded", text: "Live updates unavailable; retrying" },
  stopped: { tone: "offline", text: "Live updates stopped" },
}

/** One stream per connected token, shared by every view. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { session, snapshot } = useAuth()
  const [bus] = useState(createLiveBus)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<LiveState>("connecting")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const token = session.getToken()
    if (!token) return
    const abort = new AbortController()
    const signal = AbortSignal.any([snapshot.signal, abort.signal])
    void runLive({
      token,
      signal,
      snapshotCursor: async (current) =>
        (await listRuns(token, { limit: 1 }, { signal: current })).stream_cursor,
      follow: followRunStream,
      sleep: sleepUntilAborted,
      onReady: () => setReady(true),
      onChange: bus.publish,
      onState: setState,
      onUnauthorized: () => session.unauthorized(snapshot.epoch),
    })
    return () => abort.abort()
  }, [bus, session, snapshot, attempt])

  const retry = useCallback(() => {
    // Views refresh once the new stream has its cursor.
    bus.publish({ all: true, runKeys: new Set(), inventory: true })
    setAttempt((value) => value + 1)
  }, [bus])
  const label = LABELS[state]

  return (
    <LiveContext.Provider value={bus}>
      <div className="flex flex-wrap items-center gap-3" data-live-state={state} role="status">
        <StatusIndicator tone={label.tone} label={label.text} />
        {state === "stopped" && (
          <Button type="button" size="sm" onClick={retry}>
            Retry live updates
          </Button>
        )}
      </div>
      {/* Views load after the cursor exists, so no change falls between them. */}
      {ready ? children : <Skeleton className="h-40" />}
    </LiveContext.Provider>
  )
}
