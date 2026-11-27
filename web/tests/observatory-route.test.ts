import { describe, expect, it } from "vitest"

import { DEFAULT_ROUTE, parseRoute, serializeRoute } from "../src/lib/observatory/route"

describe("observatory URL codec", () => {
  it("omits defaults", () => {
    expect(serializeRoute(DEFAULT_ROUTE)).toBe("")
    expect(parseRoute("")).toEqual(DEFAULT_ROUTE)
  })

  it("round-trips selections, Unicode run keys and repeated filters", () => {
    const route = {
      ...DEFAULT_ROUTE,
      repository: "12",
      worktree: "44",
      run: "v1|7:devhost|5:codex|3:é/&",
      tab: "git" as const,
      kinds: ["command", "git_commit"] as const,
      statuses: ["active", "idle"] as const,
      tools: ["codex"],
      host: "devhost",
      query: "a b",
      activeOnly: true,
    }
    const search = serializeRoute({ ...route, kinds: [...route.kinds], statuses: [...route.statuses] })
    expect(parseRoute(search)).toEqual(route)
    expect(serializeRoute(parseRoute(search))).toBe(search)
  })

  it("produces one canonical order", () => {
    expect(serializeRoute(parseRoute("?kind=mcp&run=r&kind=command&kind=mcp"))).toBe(
      "?run=r&kind=command&kind=mcp",
    )
  })

  it("drops invalid values and anything resembling a secret", () => {
    const search = serializeRoute(
      parseRoute(
        "?repository=abc&worktree=-1&tab=nope&kind=bogus&status=gone&token=s3cret&authorization=x&active=maybe",
      ),
    )
    expect(search).toBe("")
  })

  it("bounds free text", () => {
    expect(parseRoute(`?q=${"x".repeat(2000)}`).query).toBeNull()
  })
})
