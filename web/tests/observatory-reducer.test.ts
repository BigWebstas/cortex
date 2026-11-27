import { describe, expect, it } from "vitest"

import type {
  AgentRunSummary,
  RepositorySummary,
  StreamEnvelope,
  StreamEventName,
} from "../../docs/contracts/agent-observatory-types"
import {
  type ObservatoryAction,
  initialState,
  observatoryReducer,
} from "../src/lib/observatory/reducer"

const run = (run_key: string, id: string, last_activity_at: string) =>
  ({ run_key, id, last_activity_at, status: "active" }) as AgentRunSummary
const repository = (id: string, name: string) => ({ id, name }) as RepositorySummary
const event = (id: string, name: StreamEventName = "run.event", run_key: string | null = "a") => ({
  type: "stream" as const,
  envelope: {
    id,
    event: name,
    entity_type: "run",
    entity_key: run_key ?? "stream",
    run_key,
    occurred_at: "2026-01-01T00:00:00Z",
    data: {},
  } satisfies StreamEnvelope,
})
const apply = (...actions: ObservatoryAction[]) => actions.reduce(observatoryReducer, initialState)

describe("observatory reducer", () => {
  const snapshot: ObservatoryAction = {
    type: "snapshot",
    cursor: "10",
    repositories: [repository("1", "one")],
    runs: [run("a", "1", "2026-01-01T00:00:00Z"), run("b", "2", "2026-01-02T00:00:00Z")],
  }

  it("orders runs by activity and then ID", () => {
    const state = apply(snapshot, {
      type: "snapshot",
      cursor: "12",
      runs: [run("c", "3", "2026-01-02T00:00:00Z")],
    })
    expect(state.runOrder).toEqual(["c", "b", "a"])
  })

  it("keeps the oldest cursor across snapshots so nothing is skipped", () => {
    expect(apply(snapshot, { type: "snapshot", cursor: "15", runs: [] }).cursor).toBe("10")
    expect(apply(snapshot, { type: "snapshot", cursor: "9", runs: [] }).cursor).toBe("9")
  })

  it("replaces a collection so removed entries disappear", () => {
    const state = apply(snapshot, {
      type: "snapshot",
      cursor: "11",
      replace: true,
      runs: [run("b", "2", "2026-01-02T00:00:00Z")],
      repositories: [],
    })
    expect(state.runOrder).toEqual(["b"])
    expect(state.runs.a).toBeUndefined()
    expect(state.repositoryOrder).toEqual([])
  })

  it("applies each stream event once, even when replayed", () => {
    const events = [event("11"), event("12", "run.status", "b"), event("11")]
    const once = apply(snapshot, ...events)
    const twice = events.reduce(observatoryReducer, once)
    expect(once.cursor).toBe("12")
    expect(once.dirtyRuns).toEqual(["a", "b"])
    expect(twice).toBe(once)
  })

  it("ignores events at or before the snapshot cursor", () => {
    const state = apply(snapshot)
    expect(observatoryReducer(state, event("10"))).toBe(state)
  })

  it("marks inventory stale for repository and worktree changes", () => {
    const state = apply(snapshot, event("11", "worktree.updated", null))
    expect(state.inventoryStale).toBe(true)
    expect(state.dirtyRuns).toEqual([])
  })

  it("clears a run's dirty mark once it has been refetched", () => {
    const state = apply(snapshot, event("11"), {
      type: "runRefreshed",
      run: run("a", "1", "2026-01-03T00:00:00Z"),
    })
    expect(state.dirtyRuns).toEqual([])
    expect(state.runOrder).toEqual(["a", "b"])
  })

  it("drops everything on reset and asks for a new snapshot", () => {
    const state = apply(snapshot, { type: "reset", reason: "cursor_expired" })
    expect(state).toEqual({ ...initialState, resetReason: "cursor_expired" })
    expect(observatoryReducer(state, { type: "snapshot", cursor: "40", runs: [] })).toMatchObject({
      cursor: "40",
      resetReason: null,
    })
  })

  it("treats a reset event from the stream the same way", () => {
    const state = apply(snapshot, event("20", "observatory.reset", null))
    expect(state.resetReason).toBe("observatory.reset")
    expect(state.cursor).toBeNull()
  })

  it("does not apply stream events before a snapshot", () => {
    expect(observatoryReducer(initialState, event("1"))).toBe(initialState)
  })
})
