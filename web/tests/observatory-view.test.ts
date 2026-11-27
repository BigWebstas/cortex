import { describe, expect, it } from "vitest"

import type {
  AgentRunEvent,
  Evidence,
  RepositorySummary,
  WorktreeSummary,
} from "../../docs/contracts/agent-observatory-types"
import {
  attribution,
  groupByHost,
  mergeEvents,
  parseFreshness,
  relativeTime,
  worktreeState,
} from "../src/lib/observatory/view"

const evidence = (detail: string, trust: Evidence["trust"]) => ({ detail, trust }) as Evidence
const event = (id: string, observed_at: string) => ({ id, observed_at }) as AgentRunEvent

describe("repository navigator model", () => {
  it("groups repositories by host in name order", () => {
    const repository = (hostname: string, name: string) => ({ hostname, name }) as RepositorySummary
    const groups = groupByHost([repository("b", "z"), repository("a", "y"), repository("b", "c")])
    expect(groups.map(([host, items]) => [host, items.map((item) => item.name)])).toEqual([
      ["a", ["y"]],
      ["b", ["c", "z"]],
    ])
  })

  it("describes a worktree in words, not only colour", () => {
    const worktree = {
      branch: null,
      detached: true,
      head_sha: "0123456789abcdef",
      dirty: true,
      staged: 1,
      unstaged: 0,
      untracked: 2,
      ahead: 3,
      behind: 0,
      locked: true,
      prunable: false,
      removed_at: null,
    } as WorktreeSummary
    expect(worktreeState(worktree)).toEqual({
      title: "Detached HEAD",
      head: "0123456",
      facts: ["1 staged", "2 untracked", "3 ahead", "locked"],
    })
    const clean = { detached: false, branch: "main", dirty: false, locked: false, staged: 0, untracked: 0, ahead: null }
    expect(worktreeState({ ...worktree, ...clean }).facts).toEqual(["clean"])
  })
})

describe("worktree attribution", () => {
  it.each([
    [[], "none"],
    [[evidence("/a", "verified")], "verified"],
    [[evidence("/a", "inferred")], "unverified"],
    [[evidence("/a", "inferred"), evidence("/b", "correlated")], "ambiguous"],
    [[evidence("/a", "verified"), evidence("/b", "inferred")], "verified"],
    [[evidence("/a", "verified"), evidence("/b", "verified")], "ambiguous"],
    [[evidence("/a", "refuted")], "none"],
  ])("classifies %j as %s", (items, expected) => {
    expect(attribution(items).state).toBe(expected)
  })

  it("never names a single worktree when attribution is ambiguous", () => {
    expect(attribution([evidence("/a", "inferred"), evidence("/b", "inferred")]).path).toBeNull()
  })
})

describe("event merging", () => {
  const first = [event("1", "2026-01-01T00:00:01Z"), event("2", "2026-01-01T00:00:02Z")]

  it("orders oldest first and removes duplicates, breaking ties by numeric ID", () => {
    const merged = mergeEvents(first, [event("10", "2026-01-01T00:00:02Z"), first[1]])
    expect(merged.map((item) => item.id)).toEqual(["1", "2", "10"])
  })

  it("returns the same list when nothing is new", () => {
    expect(mergeEvents(first, [first[0]])).toBe(first)
  })
})

describe("presentation helpers", () => {
  it("formats relative time against an injected clock", () => {
    const now = Date.parse("2026-01-02T00:00:00Z")
    expect(relativeTime("2026-01-01T23:59:30Z", now)).toBe("30s ago")
    expect(relativeTime("2026-01-01T23:00:00Z", now)).toBe("1h ago")
    expect(relativeTime("2025-12-30T00:00:00Z", now)).toBe("3d ago")
    expect(relativeTime("not a date", now)).toBe("unknown")
  })

  it("tolerates missing or malformed freshness", () => {
    expect(parseFreshness("{broken")).toEqual([])
    expect(parseFreshness('{"git":{"state":"fresh"},"trace":null}')).toEqual([["git", "fresh"]])
  })
})
