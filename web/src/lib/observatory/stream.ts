// Follows the run stream with fetch, because EventSource cannot send an
// Authorization header.

import { createParser } from "eventsource-parser"

import type { StreamEnvelope } from "../../../../docs/contracts/agent-observatory-types"
import { queryString } from "./api"

const DEFAULT_RETRY_MS = 3_000
const MAX_RETRY_MS = 30_000
// The server caps one event at 1 MiB at most.
const MAX_BUFFER_CHARS = 2 * 1024 * 1024

export type StreamStatus =
  | { state: "connecting" }
  | { state: "live" }
  | { state: "reconnecting"; failures: number }

/** Why following stopped. Everything else is retried. */
export type StreamEnd =
  | { kind: "aborted" }
  | { kind: "unauthorized" }
  | { kind: "rejected"; status: number }
  /** The local copy can no longer be trusted: take a new snapshot. */
  | { kind: "reset"; reason: string }

export interface FollowOptions {
  token: string
  signal: AbortSignal
  /** The snapshot's `stream_cursor`; without it only new events arrive. */
  after?: string
  filter?: { repository_id?: string; worktree_id?: string; run_key?: string }
  onEvent: (envelope: StreamEnvelope) => void
  onStatus?: (status: StreamStatus) => void
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  random?: () => number
}

function sleepUntilAborted(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener("abort", done)
  })
}

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9]{1,19}$/.test(value)

function parseEnvelope(id: string | undefined, data: string): StreamEnvelope | null {
  try {
    const value = JSON.parse(data) as Partial<StreamEnvelope>
    if (isId(value.id) && value.id === id && typeof value.event === "string") {
      return value as StreamEnvelope
    }
  } catch {
    // Reported by the caller.
  }
  return null
}

export async function followRunStream(options: FollowOptions): Promise<StreamEnd> {
  const { token, signal, onEvent, onStatus } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? sleepUntilAborted
  const random = options.random ?? Math.random
  const url = `/api/agent-runs/stream${queryString(options.filter ?? {})}`
  let lastId = options.after
  let retry = DEFAULT_RETRY_MS
  let failures = 0
  const aborted: StreamEnd = { kind: "aborted" }

  while (!signal.aborted) {
    onStatus?.(failures ? { state: "reconnecting", failures } : { state: "connecting" })
    // Set inside the parser callbacks, so read through a holder.
    const outcome: { end: StreamEnd | null } = { end: null }
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      }
      if (lastId !== undefined) headers["Last-Event-ID"] = lastId
      const response = await fetchImpl(url, { headers, cache: "no-store", signal })
      if (response.status === 401 || response.status === 403) return { kind: "unauthorized" }
      if (response.status === 400) return { kind: "rejected", status: 400 }
      if (!response.ok || !response.body) throw new Error(`stream status ${response.status}`)

      failures = 0
      onStatus?.({ state: "live" })
      const parser = createParser({
        maxBufferSize: MAX_BUFFER_CHARS,
        onRetry: (value) => {
          retry = Math.min(Math.max(value, 1_000), MAX_RETRY_MS)
        },
        onError: (error) => {
          if (error.type === "max-buffer-size-exceeded") {
            outcome.end ??= { kind: "reset", reason: "malformed_frame" }
          }
        },
        onEvent: (message) => {
          if (outcome.end || signal.aborted) return
          const envelope = parseEnvelope(message.id, message.data)
          if (!envelope) {
            outcome.end = { kind: "reset", reason: "malformed_frame" }
            return
          }
          if (envelope.event === "observatory.reset") {
            const reason = envelope.data?.reason
            outcome.end = {
              kind: "reset",
              reason: typeof reason === "string" ? reason : "unknown",
            }
            return
          }
          if (lastId !== undefined && BigInt(envelope.id) <= BigInt(lastId)) return
          lastId = envelope.id
          onEvent(envelope)
        },
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      try {
        while (!outcome.end && !signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          parser.feed(decoder.decode(value, { stream: true }))
        }
      } finally {
        reader.cancel().catch(() => undefined)
      }
      if (signal.aborted) return aborted
      if (outcome.end) return outcome.end
      // A clean close is routine: the server ends each connection periodically.
      await sleep(retry, signal)
    } catch {
      if (signal.aborted) return aborted
      failures += 1
      onStatus?.({ state: "reconnecting", failures })
      const ceiling = Math.min(retry * 2 ** (failures - 1), MAX_RETRY_MS)
      // Jitter spreads reconnects without ever exceeding the ceiling.
      await sleep(Math.round(ceiling * (0.5 + random() / 2)), signal)
    }
  }
  return aborted
}
