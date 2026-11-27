import { describe, expect, it } from "vitest"

import {
  ObservatoryApiError,
  getRun,
  getRunTelemetry,
  listEvents,
  listRepositories,
  listRepositoryRuns,
  listRuns,
  listWorktrees,
} from "../src/lib/observatory/api"

function recorder(body: unknown = {}, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, options: { fetchImpl } }
}

describe("observatory API client", () => {
  it("sends the token only in the Authorization header", async () => {
    const { calls, options } = recorder()
    await listRepositories("secret-token", { limit: 20, include_removed: false }, options)
    expect(calls[0].url).toBe("/api/repositories?limit=20&include_removed=false")
    expect(calls[0].init.headers).toEqual({ Authorization: "Bearer secret-token" })
    expect(calls[0].init.cache).toBe("no-store")
  })

  it("encodes path segments, repeats list filters and omits empty values", async () => {
    const { calls, options } = recorder()
    await listWorktrees("t", "7", { branch: undefined, cursor: null }, options)
    await listRuns("t", { status: ["active", "idle"], tool: [], query: "a b&c" }, options)
    await listRepositoryRuns("t", "7", { active_only: true }, options)
    await getRun("t", "v1|7:devhost|1:a/b", options)
    await listEvents("t", "run/1", { kind: ["command"], order: "asc", include: "payload" }, options)
    await getRunTelemetry("t", "run 1", { span_limit: 5 }, options)
    expect(calls.map((call) => call.url)).toEqual([
      "/api/repositories/7/worktrees",
      "/api/agent-runs?status=active&status=idle&query=a+b%26c",
      "/api/repositories/7/runs?active_only=true",
      "/api/agent-runs/v1%7C7%3Adevhost%7C1%3Aa%2Fb",
      "/api/agent-runs/run%2F1/events?kind=command&order=asc&include=payload",
      "/api/agent-runs/run%201/telemetry?span_limit=5",
    ])
  })

  it.each([
    [401, "unauthorized"],
    [404, "run_not_found"],
    [429, "stream_client_limit"],
  ])("maps a %i response to a typed error", async (status, code) => {
    const { options } = recorder({ error: code }, status)
    const error = await getRun("secret-token", "x", options).catch((caught) => caught)
    expect(error).toBeInstanceOf(ObservatoryApiError)
    expect(error).toMatchObject({ status, code })
    expect(String(error)).not.toContain("secret-token")
  })

  it("never echoes an unexpected error body", async () => {
    const { options } = recorder("Bearer secret-token rejected", 500)
    const error = await getRun("secret-token", "x", options).catch((caught) => caught)
    expect(error.code).toBe("http_error")
    expect(String(error)).not.toContain("secret-token")
  })

  it("rejects malformed and oversized responses", async () => {
    await expect(getRun("t", "x", recorder("{not json").options)).rejects.toMatchObject({
      code: "malformed_response",
    })
    const large = recorder({ blob: "x".repeat(200) }).options
    await expect(getRun("t", "x", { ...large, maxBytes: 100 })).rejects.toMatchObject({
      code: "response_too_large",
    })
  })

  it("passes cancellation through", async () => {
    const controller = new AbortController()
    controller.abort()
    const { calls, options } = recorder()
    await listRuns("t", {}, { ...options, signal: controller.signal })
    expect(calls[0].init.signal).toBe(controller.signal)
  })
})
