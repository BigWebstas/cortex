"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { Pagination } from "../../../../docs/contracts/agent-observatory-types"
import { ObservatoryApiError, type RequestOptions } from "./api"
import { useAuth } from "./auth-context"
import { mergePages } from "./live"
import type { LiveChange } from "./live"
import { useLiveRefresh } from "./live-context"
import { type Route, parseRoute, serializeRoute } from "./route"

const ROUTE_EVENT = "cortex:route"

function subscribeToLocation(listener: () => void) {
  window.addEventListener("popstate", listener)
  window.addEventListener(ROUTE_EVENT, listener)
  return () => {
    window.removeEventListener("popstate", listener)
    window.removeEventListener(ROUTE_EVENT, listener)
  }
}

/** The URL is the source of truth for selection and filters. */
export function useRoute() {
  const search = useSyncExternalStore(
    subscribeToLocation,
    () => window.location.search,
    () => "",
  )
  const route = useMemo(() => parseRoute(search), [search])
  const navigate = useCallback((change: Partial<Route>, options: { replace?: boolean } = {}) => {
    const next = serializeRoute({ ...parseRoute(window.location.search), ...change })
    if (next === window.location.search) return
    const url = `${window.location.pathname}${next}`
    window.history[options.replace ? "replaceState" : "pushState"](null, "", url)
    window.dispatchEvent(new Event(ROUTE_EVENT))
  }, [])
  return { route, navigate }
}

export type Call<T> = (token: string, options: RequestOptions) => Promise<T>

/** Runs a request for the current token, reporting a rejected one. */
export function useAuthorizedCall() {
  const { session, snapshot } = useAuth()
  return useCallback(
    async <T,>(call: Call<T>, signal?: AbortSignal): Promise<T> => {
      const token = session.getToken()
      if (!token) throw new DOMException("disconnected", "AbortError")
      const combined = signal ? AbortSignal.any([snapshot.signal, signal]) : snapshot.signal
      try {
        const value = await call(token, { signal: combined })
        combined.throwIfAborted()
        return value
      } catch (error) {
        if (error instanceof ObservatoryApiError && [401, 403].includes(error.status)) {
          session.unauthorized(snapshot.epoch)
        }
        throw error
      }
    },
    [session, snapshot],
  )
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed"
}

interface Loaded<T> {
  key: string
  items: T[]
  next: string | null
  error: string | null
  busy: boolean
  pages: number
}

export interface Page<T> {
  items: T[]
  pagination: Pagination
}

/**
 * A cursor-paged list. Results for an earlier key are never shown. With `live`,
 * matching changes refresh it in place.
 */
export function usePagedList<T extends { id: string }>(
  key: string,
  fetchPage: (cursor: string | null) => Call<Page<T>>,
  live?: (change: LiveChange) => boolean,
) {
  const call = useAuthorizedCall()
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<Loaded<T> | null>(null)
  const current = `${key}#${version}`
  const fetchRef = useRef(fetchPage)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    fetchRef.current = fetchPage
  })

  // Only the newest refresh may apply, and one asked for during the first load
  // runs after it.
  const refreshes = useRef(0)
  const missed = useRef(false)
  const loadedKey = useRef<string | null>(null)

  const revalidate = useCallback(() => {
    if (loadedKey.current !== current) {
      missed.current = true
      return
    }
    const signal = controller.current?.signal
    const sequence = ++refreshes.current
    call(fetchRef.current(null), signal)
      .then((page) => {
        if (sequence !== refreshes.current) return
        setState((previous) => {
          if (previous?.key !== current) return previous
          const more = previous.pages > 1
          return {
            ...previous,
            items: mergePages(previous.items, page.items, previous.pages),
            next: more ? previous.next : page.pagination.next_cursor,
            error: null,
          }
        })
      })
      // What is on screen stays; the next change or a manual refresh retries.
      .catch(() => undefined)
  }, [call, current])

  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    missed.current = false
    call(fetchRef.current(null), abort.signal)
      .then((page) => {
        loadedKey.current = current
        setState({
          key: current,
          items: page.items,
          next: page.pagination.next_cursor,
          error: null,
          busy: false,
          pages: 1,
        })
        if (missed.current) revalidate()
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        loadedKey.current = current
        setState({
          key: current,
          items: [],
          next: null,
          error: errorText(error),
          busy: false,
          pages: 0,
        })
      })
    return () => abort.abort()
  }, [call, current, revalidate])
  useLiveRefresh(live ?? (() => false), revalidate)

  const loaded = state?.key === current ? state : null
  const loadMore = () => {
    if (!loaded?.next || loaded.busy) return
    const signal = controller.current?.signal
    setState({ ...loaded, busy: true, error: null })
    call(fetchRef.current(loaded.next), signal)
      .then((page) =>
        setState((previous) =>
          previous?.key === current
            ? {
                key: current,
                // A live refresh may already have brought some of these in.
                items: [
                  ...previous.items,
                  ...page.items.filter(
                    (item) => !previous.items.some((held) => held.id === item.id),
                  ),
                ],
                next: page.pagination.next_cursor,
                error: null,
                busy: false,
                pages: previous.pages + 1,
              }
            : previous,
        ),
      )
      .catch((error: unknown) => {
        if (signal?.aborted) return
        setState((previous) =>
          previous?.key === current
            ? { ...previous, error: errorText(error), busy: false }
            : previous,
        )
      })
  }

  return {
    items: loaded?.items ?? [],
    loading: loaded === null,
    loadingMore: loaded?.busy ?? false,
    hasMore: Boolean(loaded?.next),
    error: loaded?.error ?? null,
    loadMore,
    reload: () => setVersion((value) => value + 1),
  }
}
