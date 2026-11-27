import { describe, expect, it } from "vitest"

import { followRunStream, type StreamStatus } from "../src/lib/observatory/stream"

const frame = (id: string, event = "run.event", data: object = {}) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({
    id,
    event,
    entity_type: "run",
    entity_key: "r",
    run_key: "r",
    occurred_at: "2026-01-01T00:00:00Z",
    data,
  })}\n\n`

function streamOf(text: string, chunkSize = text.length || 1): Response {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += chunkSize) {
          controller.enqueue(bytes.slice(at, at + chunkSize))
        }
        controller.close()
      },
    }),
    { status: 200 },
  )
}

/** Serves the responses in order, then aborts the follower. */
function harness(responses: Array<() => Response>) {
  const controller = new AbortController()
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  const delays: number[] = []
  const events: string[] = []
  const statuses: StreamStatus[] = []
  const run = (extra: { after?: string; filter?: { run_key?: string } } = {}) =>
    followRunStream({
      token: "secret-token",
      signal: controller.signal,
      onEvent: (envelope) => events.push(envelope.id),
      onStatus: (status) => statuses.push(status),
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
      random: () => 1,
      fetchImpl: (async (url: string, init: RequestInit) => {
        requests.push({ url, headers: init.headers as Record<string, string> })
        const next = responses.shift()
        if (!next) {
          controller.abort()
          throw new DOMException("aborted", "AbortError")
        }
        return next()
      }) as unknown as typeof fetch,
      ...extra,
    })
  return { controller, requests, delays, events, statuses, run }
}

describe("observatory stream client", () => {
  const body =
    "retry: 3000\n\n: keepalive\n\n" +
    frame("1", "run.event", { note: "multi — byte" }) +
    frame("2").replace('data: {"id"', 'data: {\ndata: "id"') +
    frame("3")

  it.each([1, 2, 7, 64, 100_000])("reassembles events split into %i-byte chunks", async (size) => {
    const test = harness([() => streamOf(body, size)])
    await expect(test.run()).resolves.toEqual({ kind: "aborted" })
    expect(test.events).toEqual(["1", "2", "3"])
  })

  it("resumes with Last-Event-ID, drops duplicates and keeps the token in the header", async () => {
    const test = harness([
      () => streamOf(frame("5") + frame("6")),
      () => streamOf(frame("6") + frame("7")),
    ])
    await test.run({ after: "4", filter: { run_key: "a|b" } })
    expect(test.events).toEqual(["5", "6", "7"])
    expect(test.requests.map((request) => request.headers["Last-Event-ID"])).toEqual(["4", "6", "7"])
    expect(test.requests[0].url).toBe("/api/agent-runs/stream?run_key=a%7Cb")
    expect(test.requests[0].headers.Authorization).toBe("Bearer secret-token")
    expect(JSON.stringify(test.requests.map((request) => request.url))).not.toContain("secret-token")
  })

  it("compares IDs numerically beyond double precision", async () => {
    const test = harness([() => streamOf(frame("9007199254740993"))])
    await test.run({ after: "9007199254740992" })
    expect(test.events).toEqual(["9007199254740993"])
  })

  it("returns a reset without retrying", async () => {
    const test = harness([
      () => streamOf(frame("9", "observatory.reset", { reason: "cursor_expired" })),
    ])
    await expect(test.run({ after: "1" })).resolves.toEqual({
      kind: "reset",
      reason: "cursor_expired",
    })
    expect(test.requests).toHaveLength(1)
    expect(test.events).toEqual([])
  })

  it.each([
    ["unparseable data", "id: 1\nevent: run.event\ndata: {oops\n\n"],
    ["an ID mismatch", frame("1").replace("id: 1\n", "id: 2\n")],
  ])("asks for a resynchronisation on %s", async (_name, text) => {
    const test = harness([() => streamOf(text)])
    await expect(test.run()).resolves.toEqual({ kind: "reset", reason: "malformed_frame" })
  })

  it.each([401, 403])("stops on %i", async (status) => {
    const test = harness([() => new Response("", { status })])
    await expect(test.run()).resolves.toEqual({ kind: "unauthorized" })
    expect(test.requests).toHaveLength(1)
  })

  it("stops on a rejected request", async () => {
    const test = harness([() => new Response("", { status: 400 })])
    await expect(test.run()).resolves.toEqual({ kind: "rejected", status: 400 })
  })

  it("backs off with a ceiling while the server is unavailable, then recovers", async () => {
    const unavailable = () => new Response("", { status: 503 })
    const network = () => {
      throw new TypeError("network down")
    }
    const test = harness([
      unavailable,
      () => new Response("", { status: 429 }),
      network,
      unavailable,
      unavailable,
      unavailable,
      () => streamOf(frame("1")),
    ])
    await test.run()
    expect(test.delays.slice(0, 7)).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 3000])
    expect(test.statuses).toContainEqual({ state: "reconnecting", failures: 5 })
    expect(test.statuses).toContainEqual({ state: "live" })
  })

  it("does not report anything after being aborted", async () => {
    const test = harness([() => streamOf(frame("1"))])
    test.controller.abort()
    await expect(test.run()).resolves.toEqual({ kind: "aborted" })
    expect(test.requests).toHaveLength(0)
  })
})
