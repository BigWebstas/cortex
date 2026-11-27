// The bearer token lives only in this closure: never in storage, the URL or
// anything React renders.

export type SessionStatus = "disconnected" | "connected" | "unauthorized"

export interface SessionSnapshot {
  status: SessionStatus
  /** Rises whenever the token changes, so late results can be recognised. */
  epoch: number
  /** Aborted when this epoch ends. */
  signal: AbortSignal
}

export interface Session {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SessionSnapshot
  getToken: () => string | null
  connect: (token: string) => void
  clear: () => void
  /** Reports a rejected token. Pass the epoch of the failed request. */
  unauthorized: (epoch?: number) => void
}

export function createSession(): Session {
  let token: string | null = null
  let controller = new AbortController()
  let snapshot: SessionSnapshot = { status: "disconnected", epoch: 0, signal: controller.signal }
  const listeners = new Set<() => void>()

  const move = (status: SessionStatus, next: string | null) => {
    controller.abort()
    controller = new AbortController()
    token = next
    snapshot = { status, epoch: snapshot.epoch + 1, signal: controller.signal }
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    getToken: () => token,
    connect(value) {
      const trimmed = value.trim()
      if (trimmed) move("connected", trimmed)
    },
    clear: () => move("disconnected", null),
    unauthorized(epoch) {
      if (epoch === undefined || epoch === snapshot.epoch) move("unauthorized", null)
    },
  }
}
