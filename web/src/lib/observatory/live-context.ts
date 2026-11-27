"use client"

// A stable publish/subscribe channel, so stream traffic does not re-render
// every consumer of a context value.

import { createContext, useContext, useEffect, useRef } from "react"

import type { LiveChange } from "./live"

export interface LiveBus {
  subscribe: (listener: (change: LiveChange) => void) => () => void
  publish: (change: LiveChange) => void
}

export function createLiveBus(): LiveBus {
  const listeners = new Set<(change: LiveChange) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(change) {
      for (const listener of listeners) listener(change)
    },
  }
}

export const LiveContext = createContext<LiveBus | null>(null)

// A busy agent emits continuously; each view refreshes at most this often.
const MIN_INTERVAL_MS = 1_500

/** Calls `refresh` after a matching change, coalescing bursts. */
export function useLiveRefresh(matches: (change: LiveChange) => boolean, refresh: () => void) {
  const bus = useContext(LiveContext)
  const latest = useRef({ matches, refresh })
  useEffect(() => {
    latest.current = { matches, refresh }
  })
  useEffect(() => {
    if (!bus) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = 0
    const unsubscribe = bus.subscribe((change) => {
      if (timer || !latest.current.matches(change)) return
      timer = setTimeout(
        () => {
          timer = null
          last = Date.now()
          latest.current.refresh()
        },
        Math.max(0, last + MIN_INTERVAL_MS - Date.now()),
      )
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [bus])
}

export const anyRun = (change: LiveChange) => change.all || change.runKeys.size > 0
export const thisRun = (runKey: string) => (change: LiveChange) =>
  change.all || change.runKeys.has(runKey)
/** Run activity also moves repository and worktree counts. */
export const inventoryOrRuns = (change: LiveChange) => change.inventory || anyRun(change)
