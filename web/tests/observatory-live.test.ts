import { describe, expect, it } from "vitest"

import type { StreamEnvelope, StreamEventName } from "../../docs/contracts/agent-observatory-types"
import { ObservatoryApiError } from "../src/lib/observatory/api"
import { type LiveChange, type LiveState, mergePages, runLive } from "../src/lib/observatory/live"
import type { FollowOptions, StreamEnd } from "../src/lib/observatory/stream"

const envelope = (id: string, event: StreamEventName, run_key: string | null): StreamEnvelope => ({
  id,
  event,
  entity_type: "run",
  entity_key: run_key ?? "x",
  run_key,
  occurred_at: "2026-01-01T00:00:00Z",
  data: {},
})

type Script = (options: FollowOptions) => StreamEnd

function harness(cursors: Array<string | Error>, streams: Script[]) {
  const controller = new AbortController()
  const followed: Array<string | undefined> = []
  const changes: LiveChange[] = []
  const states: LiveState[] = []
  const delays: number[] = []
  let ready = 0
  let unauthorized = 0
  let flush: (() => void) | null = null
  const run = () =>
    runLive({
      signal: controller.signal,
      snapshotCursor: async () => {
        const next = cursors.shift() ?? "99"
        if (next instanceof Error) throw next
        return next
      },
      follow: async (options) => {
        followed.push(options.after)
        const script = streams.shift()
        if (!script) {
          controller.abort()
          return { kind: "aborted" }
        }
        const end = script({ ...options, signal: controller.signal })
        flush?.()
        return end
      },
      token: "t",
      onReady: () => (ready += 1),
      onChange: (change) => changes.push(change),
      onState: (state) => states.push(state),
      onUnauthorized: () => (unauthorized += 1),
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
      now: () => 0,
      schedule: (task) => {
        flush = () => {
          flush = null
          task()
        }
        return () => (flush = null)
      },
    })
  return {
    run,
    followed,
    changes,
    states,
    delays,
    counts: () => ({ ready, unauthorized }),
  }
}

const reset: Script = () => ({ kind: "reset", reason: "cursor_expired" })

describe("live update controller", () => {
  it("resumes from the snapshot cursor and batches changes", async () => {
    const test = harness(
      ["10"],
      [
        (options) => {
          options.onEvent(envelope("11", "run.event", "a"))
          options.onEvent(envelope("12", "run.status", "a"))
          options.onEvent(envelope("13", "run.event", "b"))
          options.onEvent(envelope("14", "worktree.updated", null))
          return { kind: "aborted" }
        },
      ],
    )
    await test.run()
    expect(test.followed).toEqual(["10"])
    expect(test.changes).toEqual([{ all: false, runKeys: new Set(["a", "b"]), inventory: true }])
    expect(test.counts().ready).toBe(1)
  })

  it("takes a new cursor and refreshes everything after a reset", async () => {
    const test = harness(["10", "40"], [reset])
    await test.run()
    expect(test.followed).toEqual(["10", "40"])
    expect(test.changes).toEqual([{ all: true, runKeys: new Set(), inventory: true }])
    expect(test.delays).toEqual([])
  })

  it("backs off when resets keep coming", async () => {
    const test = harness([], Array.from({ length: 9 }, () => reset))
    await test.run()
    expect(test.delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it("shows the page, then recovers, when the cursor cannot be read", async () => {
    const test = harness([new TypeError("down"), "7"], [])
    await test.run()
    expect(test.states).toContain("unavailable")
    expect(test.delays).toEqual([3000])
    expect(test.followed).toEqual(["7"])
    expect(test.changes).toHaveLength(1)
  })

  it.each([
    ["the cursor request", [new ObservatoryApiError(401, "unauthorized")], []],
    ["the stream", ["1"], [(): StreamEnd => ({ kind: "unauthorized" })]],
  ])("stops and reports a rejected token from %s", async (_name, cursors, streams) => {
    const test = harness(cursors, streams)
    await test.run()
    expect(test.counts().unauthorized).toBe(1)
    expect(test.delays).toEqual([])
  })

  it("stops when the server rejects the stream", async () => {
    const test = harness(["1"], [() => ({ kind: "rejected", status: 400 })])
    await test.run()
    expect(test.states.at(-1)).toBe("stopped")
  })

  it("reports connection states from the stream", async () => {
    const test = harness(
      ["1"],
      [
        (options) => {
          options.onStatus?.({ state: "connecting" })
          options.onStatus?.({ state: "live" })
          options.onStatus?.({ state: "reconnecting", failures: 2 })
          return { kind: "aborted" }
        },
      ],
    )
    await test.run()
    expect(test.states).toEqual(["connecting", "connecting", "live", "reconnecting"])
  })
})

describe("refreshing a paged list", () => {
  const ids = (...values: string[]) => values.map((id) => ({ id }))

  it("replaces a single page, so entries that left the filter disappear", () => {
    expect(mergePages(ids("2", "1"), ids("3", "2"), 1)).toEqual(ids("3", "2"))
  })

  it("keeps older pages that were loaded", () => {
    expect(mergePages(ids("4", "3", "2", "1"), ids("5", "4"), 2)).toEqual(
      ids("5", "4", "3", "2", "1"),
    )
  })
})
