"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { Pagination } from "../../../../docs/contracts/agent-observatory-types"
import { ObservatoryApiError, type RequestOptions } from "./api"
import { useAuth } from "./auth-context"
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
}

export interface Page<T> {
  items: T[]
  pagination: Pagination
}

/** A cursor-paged list. Results for an earlier key are never shown. */
export function usePagedList<T>(
  key: string,
  fetchPage: (cursor: string | null) => Call<Page<T>>,
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

  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    call(fetchRef.current(null), abort.signal)
      .then((page) =>
        setState({
          key: current,
          items: page.items,
          next: page.pagination.next_cursor,
          error: null,
          busy: false,
        }),
      )
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        setState({ key: current, items: [], next: null, error: errorText(error), busy: false })
      })
    return () => abort.abort()
  }, [call, current])

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
                items: [...previous.items, ...page.items],
                next: page.pagination.next_cursor,
                error: null,
                busy: false,
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
